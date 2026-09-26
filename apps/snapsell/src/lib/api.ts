import type {
  AnalyzeEvent,
  ExtensionStatus,
  Listing,
  Me,
  Platform,
  PlatformStatus,
  Settings,
} from "../../shared/types.ts";

export class AuthError extends Error {}

export type Health = {
  ai: boolean;
  demo: boolean;
  model: string;
  googleLogin: boolean;
  lens: { vision: boolean; serpapi: boolean };
  ebayApp: boolean;
  /** Web preview: fake backend in the page, sample AI results */
  preview?: boolean;
};

/** The web preview serves photos from memory; everywhere else they're real server paths. */
export const photoResolver: { resolve: (path: string) => string } = { resolve: (p) => p };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError((body as { error?: string }).error ?? "Please sign in");
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const send = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  health: () => fetch("/api/health").then((r) => json<Health>(r)),
  me: () => fetch("/api/me").then((r) => json<Me>(r)),
  logout: () => fetch("/auth/logout", { method: "POST" }).then((r) => json(r)),
  settings: () => fetch("/api/settings").then((r) => json<Settings>(r)),
  saveSettings: (s: Partial<Settings>) => send("/api/settings", s, "PUT").then((r) => json<Settings>(r)),
  platforms: () => fetch("/api/platforms").then((r) => json<PlatformStatus[]>(r)),
  extension: () => fetch("/api/extension").then((r) => json<ExtensionStatus & { paired: boolean }>(r)),
  pairExtension: () => send("/api/extension/pair", {}).then((r) => json<{ token: string; server: string }>(r)),
  ebayRefresh: () => send("/api/ebay/refresh", {}).then((r) => json<PlatformStatus>(r)),
  ebayLocation: (postalCode: string, country: string) =>
    send("/api/ebay/location", { postalCode, country }).then((r) => json<PlatformStatus>(r)),
  ebayDisconnect: () => send("/api/ebay/disconnect", {}).then((r) => json(r)),
  listings: () => fetch("/api/listings").then((r) => json<Listing[]>(r)),
  listing: (id: string) => fetch(`/api/listings/${id}`).then((r) => json<Listing>(r)),
  update: (id: string, patch: Partial<Pick<Listing, "edits" | "status">>) =>
    send(`/api/listings/${id}`, patch, "PATCH").then((r) => json<Listing>(r)),
  remove: (id: string) => fetch(`/api/listings/${id}`, { method: "DELETE" }).then((r) => json(r)),
  publish: (id: string, platforms: Platform[]) => send(`/api/listings/${id}/publish`, { platforms }).then((r) => json<Listing>(r)),
  uploadEnhanced: (id: string, blobs: Blob[]) => {
    const form = new FormData();
    blobs.forEach((b, i) => form.append("photos", b, `enhanced-${i}.jpeg`));
    return fetch(`/api/listings/${id}/enhanced`, { method: "PUT", body: form }).then((r) => json<Listing>(r));
  },

  /** Uploads photos and yields analysis progress events from the server-sent event stream. */
  async *analyze(photos: Blob[], note: string): AsyncGenerator<AnalyzeEvent> {
    const form = new FormData();
    photos.forEach((p, i) => form.append("photos", p, `photo-${i}.jpeg`));
    if (note.trim()) form.append("note", note.trim());
    const res = await fetch("/api/analyze", { method: "POST", body: form });
    if (!res.ok || !res.body) await json(res);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) yield JSON.parse(data) as AnalyzeEvent;
      }
    }
  },
};

export const photoUrl = (l: Listing, i: number, enhanced = true) =>
  photoResolver.resolve(`/photos/${l.id}/${(enhanced && l.enhanced[i]) || l.photos[i]}`);

/** Copies text; returns false where the clipboard is blocked (some embedded views). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function formatPrice(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(currency === "CZK" ? "cs-CZ" : undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

/** Photos picked on one screen (e.g. dropped on the desktop home) handed to the new-listing flow. */
export const pendingPhotos: { files: File[] } = { files: [] };
