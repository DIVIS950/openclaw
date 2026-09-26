import fs from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PLATFORMS, type Listing, type Platform, type Settings } from "../shared/types.ts";
import { aiConfigured, analyzeItem, MODEL, type Photo } from "./ai/analyze.ts";
import { ebayPublisher } from "./publish/ebay.ts";
import { facebook } from "./publish/facebook.ts";
import type { Publisher } from "./publish/types.ts";
import { vinted } from "./publish/vinted.ts";
import {
  bestPhotoPaths,
  createListing,
  deleteListing,
  getListing,
  getSettings,
  listListings,
  photoPath,
  saveSettings,
  savePhoto,
  updateListing,
} from "./store.ts";

const publishers: Record<Platform, Publisher> = { ebay: ebayPublisher, facebook, vinted };
const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);

/** First line of an error, without Playwright's call log or ANSI colors. */
function friendlyError(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-control-regex
  const line = raw.replace(/\u001b\[\d+m/g, "").split("\n")[0].replace(/^[\w.]+: /, "");
  return /ERR_(NAME|TUNNEL|INTERNET|CONNECTION)/.test(line) ? `Couldn't reach the site (${line.match(/ERR_\w+/)?.[0]})` : line;
}

const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get("/api/health", (c) => c.json({ ai: aiConfigured(), demo: !aiConfigured(), model: MODEL }));

app.get("/api/settings", async (c) => c.json(await getSettings()));
app.put("/api/settings", async (c) => c.json(await saveSettings((await c.req.json()) as Partial<Settings>)));

app.get("/api/platforms", async (c) => {
  const settings = await getSettings();
  return c.json(await Promise.all(PLATFORMS.map((p) => publishers[p].status(settings))));
});

app.post("/api/platforms/:p/connect", async (c) => {
  const p = c.req.param("p");
  if (!isPlatform(p) || !publishers[p].connect) return c.json({ error: "Not supported" }, 400);
  // Login happens in a visible browser window; the client polls /api/platforms for the result.
  void publishers[p].connect(await getSettings()).catch((e) => console.error(`connect ${p}`, e));
  return c.json({ started: true });
});

app.post("/api/platforms/:p/disconnect", async (c) => {
  const p = c.req.param("p");
  if (!isPlatform(p)) return c.json({ error: "Unknown platform" }, 400);
  await publishers[p].disconnect?.();
  return c.json({ ok: true });
});

app.get("/api/listings", async (c) => c.json(await listListings()));

app.get("/api/listings/:id", async (c) => {
  const l = await getListing(c.req.param("id"));
  return l ? c.json(l) : c.json({ error: "Not found" }, 404);
});

app.patch("/api/listings/:id", async (c) => {
  const body = (await c.req.json()) as Partial<Pick<Listing, "edits" | "status">>;
  const l = await updateListing(c.req.param("id"), (l) => {
    if (body.edits) l.edits = { ...l.edits, ...body.edits };
    if (body.status) l.status = body.status;
  });
  return c.json(l);
});

app.delete("/api/listings/:id", async (c) => {
  await deleteListing(c.req.param("id"));
  return c.json({ ok: true });
});

function mediaType(file: File): Photo["mediaType"] {
  return file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
}

/** Upload photos + optional note, stream analysis progress back as server-sent events. */
app.post("/api/analyze", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  const note = (form.get("note") as string | null)?.trim() || undefined;
  if (!files.length) return c.json({ error: "Add at least one photo" }, 400);

  const listing = await createListing(note);
  const photos: Photo[] = [];
  for (const [i, f] of files.slice(0, 12).entries()) {
    const data = Buffer.from(await f.arrayBuffer());
    const name = `photo-${i}.${mediaType(f).split("/")[1]}`;
    await savePhoto(listing.id, name, data);
    photos.push({ data, mediaType: mediaType(f) });
  }
  const withPhotos = await updateListing(listing.id, (l) => {
    l.photos = photos.map((p, i) => `photo-${i}.${p.mediaType.split("/")[1]}`);
  });

  return streamSSE(c, async (stream) => {
    const send = (e: unknown) => stream.writeSSE({ data: JSON.stringify(e) });
    await send({ type: "listing", listing: withPhotos });
    try {
      const analysis = await analyzeItem(photos, await getSettings(), note, (e) => void send(e));
      const done = await updateListing(listing.id, (l) => {
        l.analysis = analysis;
        l.status = "draft";
      });
      await send({ type: "stage", stage: "done" });
      await send({ type: "listing", listing: done });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("analyze failed", err);
      await updateListing(listing.id, (l) => {
        l.status = "failed";
        l.error = message;
      });
      await send({ type: "error", message });
    }
  });
});

/** Replace enhanced photos produced by the in-browser photo studio. */
app.put("/api/listings/:id/enhanced", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const names: string[] = [];
  const stamp = Date.now().toString(36);
  for (const [i, f] of form.getAll("photos").entries()) {
    if (!(f instanceof File)) continue;
    const name = `enhanced-${i}-${stamp}.jpeg`;
    await savePhoto(id, name, Buffer.from(await f.arrayBuffer()));
    names.push(name);
  }
  return c.json(await updateListing(id, (l) => void (l.enhanced = names)));
});

app.post("/api/listings/:id/publish", async (c) => {
  const id = c.req.param("id");
  const { platforms } = (await c.req.json()) as { platforms: string[] };
  const listing = await getListing(id);
  if (!listing?.analysis) return c.json({ error: "Listing isn't ready" }, 400);
  const settings = await getSettings();
  const targets = platforms.filter(isPlatform);

  const setState = (p: Platform, state: Listing["publish"][Platform]) =>
    updateListing(id, (l) => {
      l.publish[p] = { ...state!, updatedAt: new Date().toISOString() };
      if (state?.status === "live") l.status = "live";
    });

  await Promise.all(targets.map((p) => setState(p, { status: "working", message: "Starting" })));
  // Run in the background; the app polls the listing for per-platform progress.
  for (const p of targets) {
    void (async () => {
      try {
        if (!(await publishers[p].status(settings)).connected) {
          await setState(p, { status: "error", message: "Not connected yet. Set it up in Settings." });
          return;
        }
        const current = (await getListing(id))!;
        const state = await publishers[p].publish({
          listing: current,
          settings,
          photoPaths: bestPhotoPaths(current),
          progress: (message) => void setState(p, { status: "working", message }),
        });
        await setState(p, state);
      } catch (err) {
        await setState(p, { status: "error", message: friendlyError(err) });
      }
    })();
  }
  return c.json(await getListing(id));
});

app.get("/photos/:id/:name", async (c) => {
  try {
    const file = await fs.readFile(photoPath(c.req.param("id"), c.req.param("name")));
    const name = c.req.param("name");
    const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return c.body(file, 200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
  } catch {
    return c.notFound();
  }
});

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, () => {
  console.log(`SnapSell server on http://localhost:${port}${aiConfigured() ? "" : "  (demo mode: no ANTHROPIC_API_KEY)"}`);
});
