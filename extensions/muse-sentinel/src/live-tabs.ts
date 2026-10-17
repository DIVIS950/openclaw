// Asks the browser which tabs are really open (CDP /json/list). When a tab named by a call has
// closed, the browser quietly runs the call on another tab (core's ensureTabAvailable falls back
// to the only remaining tab for remote profiles), so the sentinel must never judge a call
// against a closed tab's snapshot.
// No runtime imports from OpenClaw.
import { safeUrl } from "./text.js";

export const TAB_CHECK_TIMEOUT_MS = 2_000;

/** The part of OpenClaw's `browser` config this module reads. */
export type BrowserConfigLike = {
  cdpUrl?: string;
  defaultProfile?: string;
  profiles?: Record<string, { cdpUrl?: string; cdpPort?: number } | undefined>;
};

/** The part of `fetch` used here (injectable for tests). */
export type TabsFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The CDP base URL of a browser profile, resolved like core's browser/config.ts: the profile's
 * own cdpUrl, else its cdpPort on the host of `browser.cdpUrl` (or loopback). The legacy
 * top-level `browser.cdpUrl` also serves the "openclaw" profile.
 */
export function cdpUrlForProfile(
  browser: BrowserConfigLike | undefined,
  profile?: string,
): string | undefined {
  const name = profile?.trim() || browser?.defaultProfile?.trim() || "openclaw";
  const entry = browser?.profiles?.[name];
  const own = entry?.cdpUrl?.trim();
  if (own) {
    return own;
  }
  const root = safeUrl(browser?.cdpUrl?.trim() ?? "");
  const rootPort = root ? Number(root.port || (root.protocol === "https:" ? 443 : 80)) : undefined;
  const port = entry?.cdpPort ?? (name === "openclaw" ? rootPort : undefined);
  if (!port) {
    return undefined;
  }
  const protocol = root?.protocol === "https:" ? "https" : "http";
  return `${protocol}://${root?.hostname ?? "127.0.0.1"}:${port}`;
}

/** Ids of the open page tabs of the browser at `cdpUrl`. Throws when it cannot tell. */
export async function fetchOpenPageIds(
  cdpUrl: string,
  opts: { fetch?: TabsFetch; timeoutMs?: number } = {},
): Promise<string[]> {
  const url = new URL(cdpUrl);
  const headers: Record<string, string> = {};
  // fetch refuses URLs with credentials; core sends them as Basic auth (cdp.helpers.ts).
  if (url.username || url.password) {
    const user = decodeURIComponent(url.username);
    const pass = decodeURIComponent(url.password);
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    url.username = "";
    url.password = "";
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/json/list`;
  url.search = "";
  url.hash = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TAB_CHECK_TIMEOUT_MS);
  try {
    const doFetch: TabsFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    const res = await doFetch(url.toString(), { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`CDP /json/list answered HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      throw new Error("CDP /json/list did not return a list");
    }
    const ids: string[] = [];
    for (const item of body) {
      const target =
        typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
      if (target.type === "page" && typeof target.id === "string" && target.id) {
        ids.push(target.id);
      }
    }
    return ids;
  } finally {
    clearTimeout(timer);
  }
}
