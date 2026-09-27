import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { PLATFORMS, type Listing, type Platform, type Settings } from "../shared/types.ts";
import { applyAssistantChanges, assistantPrompt, parseAssistantReply, type AssistantTurn } from "../shared/assistant.ts";
import { aiConfigured, analyzeItem, assistantTurn, claudeConfigured, MODEL, type Photo } from "./ai/analyze.ts";
import { GEMINI_MODEL, geminiConfigured } from "./ai/gemini.ts";
import { storageCheck, supabaseConfigured } from "./storage.ts";
import { lensSearch, publicPhoto, serpEnabled, visionEnabled } from "./ai/lens.ts";
import { googleCallback, googleEnabled, googleStart, logout, me, onCloud, publicUrl, requireUser, type Env } from "./auth.ts";
import {
  ebayAppConfigured,
  ebayCreateLocation,
  ebayDisconnect,
  ebayLoginCallback,
  ebayLoginStart,
  ebayPublisher,
  ebaySetup,
} from "./publish/ebay.ts";
import { extensionPing, extensionReport, extensionStatus, facebookPublisher, vintedPublisher } from "./publish/extension.ts";
import type { Publisher } from "./publish/types.ts";
import {
  bestPhotoNames,
  createListing,
  deleteListing,
  getListing,
  getUser,
  listListings,
  newExtensionToken,
  loadPhoto,
  savePhoto,
  updateListing,
  updateUser,
} from "./store.ts";

const publishers: Record<Platform, Publisher> = { ebay: ebayPublisher, facebook: facebookPublisher, vinted: vintedPublisher };
const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];

const app = new Hono<Env>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: errorText(err) }, 500);
});

// The Chrome extension calls the API with a bearer token from its own origin.
app.use(
  "/api/ext/*",
  cors({ origin: (o) => (o?.startsWith("chrome-extension://") ? o : null), allowHeaders: ["Authorization", "Content-Type"] }),
);
app.use(
  "/photos/*",
  cors({ origin: (o) => (o?.startsWith("chrome-extension://") ? o : null), allowHeaders: ["Authorization"] }),
);

// ---------- public ----------

app.get("/api/health", (c) =>
  c.json({
    ai: aiConfigured(),
    demo: !aiConfigured(),
    model: MODEL,
    googleLogin: googleEnabled(),
    lens: { vision: visionEnabled(), serpapi: serpEnabled() },
    ebayApp: ebayAppConfigured(),
    gemini: geminiConfigured(),
    claude: claudeConfigured(),
  }),
);

/**
 * Setup checklist (public, shows only yes/no per item and the exact addresses to paste into
 * Google and eBay; never any secret values).
 */
app.get("/api/setup", async (c) => {
  const url = publicUrl(c);
  const storageError = await storageCheck();
  return c.json({
    cloud: onCloud(),
    publicUrl: url,
    storage: { ok: supabaseConfigured() && !storageError, configured: supabaseConfigured(), error: storageError, required: onCloud() },
    ai: { gemini: geminiConfigured(), claude: claudeConfigured(), geminiModel: GEMINI_MODEL, claudeModel: MODEL },
    google: { ok: googleEnabled(), redirectUri: `${url}/auth/google/callback`, origin: url, allowList: Boolean(process.env.ALLOWED_EMAILS) },
    ebay: { ok: ebayAppConfigured(), acceptUrl: `${url}/auth/ebay/callback` },
    lens: { vision: visionEnabled(), serpapi: serpEnabled() },
    ready: googleEnabled() && (!onCloud() || (supabaseConfigured() && !storageError)) && aiConfigured(),
  });
});
app.get("/auth/google", googleStart);
app.get("/auth/google/callback", googleCallback);
app.post("/auth/logout", logout);

/** Short-lived public link to one photo, used only by the Google Lens (SerpApi) lookup. */
app.get("/p/:token", async (c) => {
  const p = publicPhoto(c.req.param("token"));
  if (!p) return c.notFound();
  const data = await loadPhoto(p.id, p.name);
  return data ? c.body(new Uint8Array(data), 200, { "Content-Type": "image/jpeg" }) : c.notFound();
});

// ---------- signed in ----------

const api = app;
// Everything below needs a signed-in user (or the paired Chrome extension's token).
app.use("/api/*", (c, next) => (c.req.path === "/api/health" ? next() : requireUser(c, next)));
app.use("/auth/ebay", requireUser);
app.use("/auth/ebay/*", requireUser);
app.use("/photos/*", requireUser);

api.get("/api/me", (c) => c.json(me(c.var.user)));

api.get("/api/settings", (c) => c.json(c.var.user.settings));
api.put("/api/settings", async (c) => {
  const patch = (await c.req.json()) as Partial<Settings>;
  const u = await updateUser(c.var.user.email, (u) => void (u.settings = { ...u.settings, ...patch }));
  return c.json(u.settings);
});

api.get("/api/platforms", async (c) => c.json(await Promise.all(PLATFORMS.map((p) => publishers[p].status(c.var.user)))));

// eBay: "Log in with eBay"
api.get("/auth/ebay", (c) => ebayLoginStart(c));
api.get("/auth/ebay/callback", (c) => ebayLoginCallback(c, c.var.user));
api.post("/api/ebay/refresh", async (c) => {
  await ebaySetup(c.var.user.email);
  return c.json(await ebayPublisher.status((await getUser(c.var.user.email))!));
});
api.post("/api/ebay/location", async (c) => {
  const { postalCode, country } = (await c.req.json()) as { postalCode: string; country: string };
  if (!/^[\w -]{2,12}$/.test(postalCode ?? "") || !/^[A-Za-z]{2}$/.test(country ?? "")) {
    return c.json({ error: "Enter a postal code and a 2-letter country code" }, 400);
  }
  const u = await ebayCreateLocation(c.var.user, postalCode, country);
  return c.json(await ebayPublisher.status(u));
});
api.post("/api/ebay/disconnect", async (c) => {
  await ebayDisconnect(c.var.user);
  return c.json({ ok: true });
});

// Chrome extension
api.get("/api/extension", (c) => c.json({ ...extensionStatus(c.var.user), paired: Boolean(c.var.user.extTokenHash) }));
api.post("/api/extension/pair", async (c) => c.json({ token: await newExtensionToken(c.var.user.email), server: publicUrl(c) }));
api.post("/api/ext/ping", async (c) => {
  const { sites } = (await c.req.json()) as { sites?: { facebook?: boolean; vinted?: boolean } };
  const job = await extensionPing(c.var.user, { facebook: !!sites?.facebook, vinted: !!sites?.vinted }, publicUrl(c));
  const u = c.var.user;
  return c.json({ job, user: { email: u.email, name: u.name, vintedDomain: u.settings.vintedDomain } });
});
api.post("/api/ext/jobs/:id/:platform", async (c) => {
  const platform = c.req.param("platform");
  if (platform !== "facebook" && platform !== "vinted") return c.json({ error: "Unknown platform" }, 400);
  const report = (await c.req.json()) as Parameters<typeof extensionReport>[3];
  if (!["working", "needs_review", "live", "error"].includes(report.status)) return c.json({ error: "Bad status" }, 400);
  await extensionReport(c.var.user, c.req.param("id"), platform, report);
  return c.json({ ok: true });
});

// Listings
api.get("/api/listings", async (c) => c.json(await listListings(c.var.user.email)));

api.get("/api/listings/:id", async (c) => {
  const l = await getListing(c.req.param("id"), c.var.user.email);
  return l ? c.json(l) : c.json({ error: "Not found" }, 404);
});

api.patch("/api/listings/:id", async (c) => {
  const body = (await c.req.json()) as Partial<Pick<Listing, "edits" | "status">>;
  const l = await updateListing(c.req.param("id"), c.var.user.email, (l) => {
    if (body.edits) l.edits = { ...l.edits, ...body.edits };
    if (body.status) {
      if (body.status === "sold" && l.status !== "sold") l.soldAt = new Date().toISOString();
      if (body.status !== "sold") delete l.soldAt;
      l.status = body.status;
    }
  });
  return c.json(l);
});

api.post("/api/listings/:id/assistant", async (c) => {
  const body = (await c.req.json()) as { text?: string; history?: AssistantTurn[]; language?: string };
  const user = c.var.user;
  const current = await getListing(c.req.param("id"), user.email);
  if (!current?.analysis) return c.json({ error: "Not found" }, 404);
  try {
    const r = parseAssistantReply(
      await assistantTurn(user.settings, assistantPrompt(current, user.settings, body.history ?? [], String(body.text ?? ""), body.language)),
    );
    const l = await updateListing(current.id, user.email, (l) => void (l.edits = applyAssistantChanges(l, r.changes)));
    return c.json({ reply: r.reply, changes: r.changes, listing: l });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.delete("/api/listings/:id", async (c) => {
  await deleteListing(c.req.param("id"), c.var.user.email);
  return c.json({ ok: true });
});

function mediaType(file: File): Photo["mediaType"] {
  return file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
}

/** Upload photos + optional note, stream analysis progress back as server-sent events. */
api.post("/api/analyze", async (c) => {
  const user = c.var.user;
  const form = await c.req.formData();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  const note = (form.get("note") as string | null)?.trim() || undefined;
  if (!files.length) return c.json({ error: "Add at least one photo" }, 400);

  const listing = await createListing(user.email, note);
  const photos: Photo[] = [];
  const names: string[] = [];
  for (const [i, f] of files.slice(0, 12).entries()) {
    const data = Buffer.from(await f.arrayBuffer());
    const name = `photo-${i}.${mediaType(f).split("/")[1]}`;
    await savePhoto(listing.id, name, data);
    photos.push({ data, mediaType: mediaType(f) });
    names.push(name);
  }
  const withPhotos = await updateListing(listing.id, user.email, (l) => void (l.photos = names));
  const origin = publicUrl(c);

  return streamSSE(c, async (stream) => {
    const send = (e: unknown) => stream.writeSSE({ data: JSON.stringify(e) });
    await send({ type: "listing", listing: withPhotos });
    try {
      const emit = (e: Parameters<typeof send>[0]) => void send(e);
      const visual = await lensSearch({
        photo: photos[0],
        listingId: listing.id,
        photoName: names[0],
        origin,
        settings: user.settings,
        emit,
      });
      const analysis = await analyzeItem(photos, user.settings, note, emit, visual || undefined);
      const done = await updateListing(listing.id, user.email, (l) => {
        l.analysis = analysis;
        l.status = "draft";
      });
      await send({ type: "stage", stage: "done" });
      await send({ type: "listing", listing: done });
    } catch (err) {
      const message = errorText(err);
      console.error("analyze failed", err);
      await updateListing(listing.id, user.email, (l) => {
        l.status = "failed";
        l.error = message;
      });
      await send({ type: "error", message });
    }
  });
});

/** Replace enhanced photos produced by the in-browser photo studio. */
api.put("/api/listings/:id/enhanced", async (c) => {
  const id = c.req.param("id");
  if (!(await getListing(id, c.var.user.email))) return c.json({ error: "Not found" }, 404);
  const form = await c.req.formData();
  const names: string[] = [];
  const stamp = Date.now().toString(36);
  for (const [i, f] of form.getAll("photos").entries()) {
    if (!(f instanceof File)) continue;
    const name = `enhanced-${i}-${stamp}.jpeg`;
    await savePhoto(id, name, Buffer.from(await f.arrayBuffer()));
    names.push(name);
  }
  return c.json(await updateListing(id, c.var.user.email, (l) => void (l.enhanced = names)));
});

api.post("/api/listings/:id/publish", async (c) => {
  const user = c.var.user;
  const id = c.req.param("id");
  const { platforms } = (await c.req.json()) as { platforms: string[] };
  const listing = await getListing(id, user.email);
  if (!listing?.analysis) return c.json({ error: "Listing isn't ready" }, 400);
  const targets = platforms.filter(isPlatform);

  const setState = (p: Platform, state: NonNullable<Listing["publish"][Platform]>) =>
    updateListing(id, user.email, (l) => {
      l.publish[p] = { ...state, updatedAt: new Date().toISOString() };
      if (state.status === "live") l.status = "live";
    });

  await Promise.all(targets.map((p) => setState(p, { status: "working", message: "Starting" })));
  // Run in the background; the app polls the listing for per-platform progress.
  for (const p of targets) {
    void (async () => {
      try {
        if (!(await publishers[p].status(user)).connected) {
          await setState(p, { status: "error", message: "Not connected yet. Set it up in Connections." });
          return;
        }
        const current = (await getListing(id, user.email))!;
        const state = await publishers[p].publish({
          user,
          listing: current,
          settings: user.settings,
          photoNames: bestPhotoNames(current),
          progress: (message) => void setState(p, { status: "working", message }),
        });
        await setState(p, state);
      } catch (err) {
        await setState(p, { status: "error", message: errorText(err) });
      }
    })();
  }
  return c.json(await getListing(id, user.email));
});

api.get("/photos/:id/:name", async (c) => {
  if (!(await getListing(c.req.param("id"), c.var.user.email))) return c.notFound();
  const name = c.req.param("name");
  const file = await loadPhoto(c.req.param("id"), name).catch(() => null);
  if (!file) return c.notFound();
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return c.body(new Uint8Array(file), 200, { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" });
});

// `npm start` serves the built app from dist/ on the same port as the API.
if (process.env.NODE_ENV === "production" || process.argv.includes("--prod")) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, () => {
  const notes = [
    aiConfigured() ? "" : "demo mode: no ANTHROPIC_API_KEY",
    googleEnabled() ? "" : "no Google login: local mode, anyone who can reach this address can use it",
  ].filter(Boolean);
  console.log(`SnapSell server on http://localhost:${port}${notes.length ? `\n  ${notes.join("\n  ")}` : ""}`);
});
