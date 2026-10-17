// Tracks which browser tab an `act` call without `request.targetId` will run on, so the click is
// classified against that tab's snapshot and not another one.
// Why: the browser runs an act on `request.targetId` or, without it, on the tab it used last
// (any snapshot, act, navigate, focus or open moves it). A top-level `targetId` is ignored for
// act. The snapshot cache alone only knows which tab was snapshotted last, which can differ.
// Pure module: no runtime imports from OpenClaw.
import { asRecord, readString } from "./text.js";

/** Classification tab id when the browser's current tab is not known: no element matches it. */
export const UNKNOWN_TAB = "\u0000unknown-tab";

type BrowserEventLike = {
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

function browserAction(params: Record<string, unknown>): string {
  return (readString(params.action) ?? "").trim().toLowerCase();
}

/**
 * The params to classify a browser call with. For an act without `request.targetId`, the request
 * is pointed at the tab the browser will really use (or UNKNOWN_TAB) and the ignored top-level
 * `targetId` is dropped. An upload or dialog without `targetId` also runs on the current tab.
 * The params the tool runs with are not changed.
 */
export function paramsForClassification(
  params: Record<string, unknown>,
  currentTab: string | undefined,
): Record<string, unknown> {
  const action = browserAction(params);
  if (action === "upload" || action === "dialog") {
    return readString(params.targetId)
      ? params
      : { ...params, targetId: currentTab ?? UNKNOWN_TAB };
  }
  if (action !== "act") {
    return params;
  }
  const request = asRecord(params.request);
  if (readString(request.targetId)) {
    return params;
  }
  const rest: Record<string, unknown> = { ...params };
  delete rest.targetId;
  return { ...rest, request: { ...request, targetId: currentTab ?? UNKNOWN_TAB } };
}

/** Act kinds that never change the page (and never depend on which tab they run on). */
export const PASSIVE_ACT_KINDS: ReadonlySet<string> = new Set([
  "hover",
  "wait",
  "resize",
  "scrollintoview",
]);

function actKind(params: Record<string, unknown>): string {
  return (readString(asRecord(params.request).kind) ?? "").trim().toLowerCase();
}

/**
 * For classified params (see paramsForClassification): the tab whose snapshot the decision
 * relied on, which must still be open when the call runs. Undefined when the call does not
 * depend on a tab, or the tab is not known (the classifier already refused element lookups).
 */
export function tabToVerify(classified: Record<string, unknown>): string | undefined {
  const action = browserAction(classified);
  let tab: string | undefined;
  if (action === "act") {
    const kind = actKind(classified);
    if (!PASSIVE_ACT_KINDS.has(kind) && kind !== "close") {
      tab = readString(asRecord(classified.request).targetId);
    }
  } else if (action === "upload" || (action === "dialog" && classified.accept)) {
    tab = readString(classified.targetId);
  }
  return tab && tab !== UNKNOWN_TAB ? tab.trim() : undefined;
}

/**
 * What a finished browser call (the after_tool_call event with the full result) did to tabs:
 * the tab it may have changed, and the tab it closed. `currentBefore` is the browser's current
 * tab before the call. Calls the sentinel blocked never ran.
 */
export function browserEffect(
  event: BrowserEventLike,
  currentBefore: string | undefined,
  isOwnBlock: (error: string) => boolean,
): { changed?: string; closed?: string } {
  if (event.error !== undefined && isOwnBlock(event.error)) {
    return {};
  }
  const action = browserAction(event.params);
  const kind = action === "act" ? actKind(event.params) : "";
  const details = asRecord(asRecord(event.result).details);
  const tab = readString(details.targetId)?.trim() || namedTab(event.params) || currentBefore;
  if (action === "close" || kind === "close") {
    return event.error === undefined && tab ? { closed: tab } : {};
  }
  // A failed act or navigate may still have changed the page part way.
  const changes =
    (action === "act" && !PASSIVE_ACT_KINDS.has(kind)) ||
    action === "navigate" ||
    action === "upload";
  return changes && tab ? { changed: tab } : {};
}

/** The tab a browser call named explicitly, if any. */
function namedTab(params: Record<string, unknown>): string | undefined {
  if (browserAction(params) === "act") {
    return readString(asRecord(params.request).targetId)?.trim();
  }
  return readString(params.targetId)?.trim();
}

/**
 * The browser's current tab after a finished browser call (the after_tool_call event with the
 * full result). Returns undefined when it can no longer be known for sure.
 * `isOwnBlock` tells apart calls the sentinel blocked: those never reached the browser.
 */
export function nextCurrentTab(
  current: string | undefined,
  event: BrowserEventLike,
  isOwnBlock: (error: string) => boolean,
): string | undefined {
  const action = browserAction(event.params);
  const named = namedTab(event.params);
  if (event.error !== undefined) {
    if (isOwnBlock(event.error)) {
      return current;
    }
    // A failed call may still have switched to the tab it named.
    return named && named !== current ? undefined : current;
  }
  const request = asRecord(event.params.request);
  if (action === "start" || action === "stop") {
    return undefined;
  }
  if (action === "close" || (action === "act" && readString(request.kind) === "close")) {
    // Closing another tab keeps the current one; closing the current one picks some other tab.
    return named && current && named !== current && !current.startsWith(named)
      ? current
      : undefined;
  }
  const details = asRecord(asRecord(event.result).details);
  if (action === "tabs" && current) {
    // The current tab is gone (closed by the page or by the owner): core will pick another one.
    const listed = listedTabIds(event.result);
    if (listed && !listed.includes(current)) {
      return undefined;
    }
  }
  // Snapshot, act, navigate, open, screenshot and pdf report the tab they used. Focus, upload
  // and dialog switch to the tab they name; tabs, status and profiles leave it alone.
  return readString(details.targetId)?.trim() || named || current;
}

// A "targetId" key in the JSON text of a tabs result. Page text inside it (titles, URLs) is
// JSON-escaped, so its quotes are preceded by a backslash and cannot match.
const TAB_ID_KEY_RE = /"targetId":\s*"([^"\\]+)"/g;

/**
 * The tab ids a `tabs` result lists: `details.tabs`, else the JSON text the browser tool
 * returns (its details only carry `tabCount`). Undefined when the list cannot be read.
 */
function listedTabIds(result: unknown): string[] | undefined {
  const record = asRecord(result);
  const details = asRecord(record.details);
  if (Array.isArray(details.tabs)) {
    return details.tabs.flatMap((tab) => readString(asRecord(tab).targetId)?.trim() || []);
  }
  if (details.tabCount === 0) {
    return [];
  }
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content.map((item) => readString(asRecord(item).text) ?? "").join("\n");
  const ids = [...text.matchAll(TAB_ID_KEY_RE)].map((match) => match[1] ?? "");
  return ids.length > 0 ? ids : undefined;
}

/**
 * Browser params pinned to the tab they were classified against: an act without
 * `request.targetId`, or an upload or dialog without `targetId`, gets `currentTab`. If that
 * tab is gone when the call runs, the browser fails with "tab not found" instead of running
 * the call on whichever tab it falls back to. Other params are returned unchanged.
 */
export function pinToTab(
  params: Record<string, unknown>,
  currentTab: string | undefined,
): Record<string, unknown> {
  if (!currentTab) {
    return params;
  }
  const action = browserAction(params);
  if (action === "upload" || action === "dialog") {
    return readString(params.targetId) ? params : { ...params, targetId: currentTab };
  }
  if (action !== "act") {
    return params;
  }
  const request = asRecord(params.request);
  return readString(request.targetId)
    ? params
    : { ...params, request: { ...request, targetId: currentTab } };
}

/** For a successful navigate or open: the tab and its new URL. */
export function navigatedTab(
  event: BrowserEventLike,
): { targetId: string; url: string } | undefined {
  const action = browserAction(event.params);
  if (event.error !== undefined || (action !== "navigate" && action !== "open")) {
    return undefined;
  }
  const details = asRecord(asRecord(event.result).details);
  const targetId = readString(details.targetId)?.trim();
  const url = readString(details.url)?.trim();
  return targetId && url ? { targetId, url } : undefined;
}
