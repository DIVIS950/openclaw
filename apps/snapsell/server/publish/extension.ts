import {
  effectiveCondition,
  effectiveCopy,
  effectivePrice,
  PLATFORM_META,
  type ExtJob,
  type ExtensionStatus,
  type Listing,
  type PlatformStatus,
} from "../../shared/types.ts";
import { allListings, bestPhotoNames, updateListing, updateUser, type User } from "../store.ts";
import type { Publisher } from "./types.ts";

/**
 * Facebook Marketplace and Vinted have no public listing API. Their postings are handed to the
 * SnapSell Chrome extension, which fills in the site's own form in the user's logged-in Chrome.
 * The extension polls /api/ext/ping; listings wait here with publish status "queued".
 */
type SitePlatform = "facebook" | "vinted";
const ONLINE_MS = 2 * 60_000;
const STALE_MS = 10 * 60_000;

export function extensionStatus(user: User): ExtensionStatus {
  const seen = user.extension?.lastSeen;
  return {
    online: Boolean(seen && Date.now() - Date.parse(seen) < ONLINE_MS),
    lastSeen: seen,
    sites: user.extension?.sites ?? {},
  };
}

function sitePublisher(platform: SitePlatform): Publisher {
  const name = PLATFORM_META[platform].name;
  return {
    platform,
    async status(user): Promise<PlatformStatus> {
      const base = { platform, mode: "extension" as const };
      if (!user.extTokenHash) {
        return { ...base, connected: false, action: "install_extension", detail: "Install the SnapSell Chrome extension" };
      }
      const ext = extensionStatus(user);
      if (!ext.sites[platform]) {
        return { ...base, connected: false, action: "chrome_login", detail: `Log in to ${name} in Chrome` };
      }
      return {
        ...base,
        connected: true,
        detail: ext.online ? "Logged in, in your Chrome" : "Chrome is offline: posts wait until it's back",
      };
    },
    async publish({ user }) {
      const online = extensionStatus(user).online;
      return { status: "queued", message: online ? "Sent to your Chrome" : "Waiting for your Chrome to come online" };
    },
  };
}

export const facebookPublisher = sitePublisher("facebook");
export const vintedPublisher = sitePublisher("vinted");

/** Called by the extension every ~30 s: records it's alive and hands out the next job. */
export async function extensionPing(user: User, sites: ExtensionStatus["sites"], origin: string): Promise<ExtJob | null> {
  await updateUser(user.email, (u) => void (u.extension = { lastSeen: new Date().toISOString(), sites }));

  const mine = (await allListings()).filter((l) => l.owner === user.email && l.analysis);
  // A job the extension claimed but never finished (Chrome closed mid-way) is surfaced as an error.
  for (const l of mine) {
    for (const p of ["facebook", "vinted"] as const) {
      const st = l.publish[p];
      if (st?.status === "working" && st.updatedAt && Date.now() - Date.parse(st.updatedAt) > STALE_MS) {
        await setState(l, p, { status: "error", message: "Chrome stopped before finishing. Try again." });
      }
    }
  }

  const queued = mine
    .flatMap((l) => (["facebook", "vinted"] as const).filter((p) => l.publish[p]?.status === "queued").map((p) => ({ l, p })))
    .filter(({ p }) => sites[p])
    .sort((a, b) => (a.l.publish[a.p]?.updatedAt ?? "").localeCompare(b.l.publish[b.p]?.updatedAt ?? ""));
  const next = queued[0];
  if (!next) return null;

  const { l, p } = next;
  await setState(l, p, { status: "working", message: "Chrome is filling in the form" });
  const copy = effectiveCopy(l, p);
  const a = l.analysis!;
  return {
    listingId: l.id,
    platform: p,
    title: copy.title,
    description: copy.description,
    price: Math.round(effectivePrice(l)),
    currency: user.settings.currency,
    condition: effectiveCondition(l),
    category: a.item.category,
    brand: a.item.brand,
    size: a.item.size,
    photos: bestPhotoNames(l).map((n) => `${origin}/photos/${l.id}/${n}`),
    autoPublish: user.settings.autoPublish,
    vintedDomain: user.settings.vintedDomain,
  };
}

function setState(l: Listing, p: SitePlatform, state: NonNullable<Listing["publish"][SitePlatform]>) {
  return updateListing(l.id, l.owner, (x) => {
    x.publish[p] = { ...state, updatedAt: new Date().toISOString() };
    if (state.status === "live") x.status = "live";
  });
}

/** Progress / result reports from the extension while it works on a job. */
export async function extensionReport(
  user: User,
  listingId: string,
  platform: SitePlatform,
  report: { status: "working" | "needs_review" | "live" | "error"; message?: string; url?: string },
) {
  const l = (await allListings()).find((x) => x.id === listingId && x.owner === user.email);
  if (!l) throw new Error("Listing not found");
  const message = report.message?.slice(0, 300);
  const url = report.url && /^https:\/\//.test(report.url) ? report.url : undefined;
  return setState(l, platform, { status: report.status, message, url });
}
