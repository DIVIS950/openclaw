// Classifies `browser` tool calls: browsing is reading; clicks, keys, form changes, uploads and
// dialogs that can leave the machine go to the guard model or the owner (acts: browser-act.ts).
// Every decision that rests on a snapshot needs a current snapshot of the tab the browser will
// really use. Pure module: no runtime imports from OpenClaw.
import {
  type ActTab,
  classifyAct,
  elementKey,
  type ElementLookup,
  hasUnusualScheme,
  NO_SNAPSHOT_REASON,
  STALE_SNAPSHOT_REASON,
} from "./browser-act.js";
import { normalizeRef } from "./snapshot.js";
import {
  detailLines,
  hostOf,
  jsonPreview,
  oneLine,
  pageKey,
  quote,
  readString,
  semanticHash,
} from "./text.js";
import type { ActionDescriptor, Decision, ElementInfo } from "./types.js";
import { riskyUrl } from "./words.js";

export { type ElementLookup, NO_SNAPSHOT_REASON, STALE_SNAPSHOT_REASON } from "./browser-act.js";

/** Browser actions that only look at or move around the web (browsing is reading). */
export const BROWSER_READ_ACTIONS: ReadonlySet<string> = new Set([
  "status",
  "start",
  "stop",
  "profiles",
  "tabs",
  "open",
  "focus",
  "close",
  "snapshot",
  "screenshot",
  "navigate",
  "console",
  "pdf",
]);

// Denials that only exist so the sentinel judges the real page; with mode "off" they do not apply.
export const INTEGRITY_DENY_REASONS: ReadonlySet<string> = new Set([
  NO_SNAPSHOT_REASON,
  STALE_SNAPSHOT_REASON,
]);

const ALLOW: Decision = { kind: "allow" };
const ask = (action: ActionDescriptor): Decision => ({ kind: "ask", action });
const judge = (action: ActionDescriptor): Decision => ({ kind: "judge", action });
const deny = (reason: string): Decision => ({ kind: "deny", reason });

function describeBrowserGeneric(
  action: string,
  params: Record<string, unknown>,
  snapshots: ElementLookup | undefined,
): ActionDescriptor {
  const url = readString(params.targetUrl) ?? snapshots?.urlFor(readString(params.targetId));
  const where = readString(params.targetUrl)
    ? ` ${quote(readString(params.targetUrl) ?? "", 100)}`
    : "";
  return {
    tool: "browser",
    verb: action || "unknown",
    summary: oneLine(`Browser "${action || "unknown"}"${where} on ${hostOf(url)}`, 240),
    detail: detailLines([`Browser parameters: ${jsonPreview(params, 1500)}`]),
    url,
    semanticKey: semanticHash({ tool: "browser", params }),
  };
}

function describeUpload(
  params: Record<string, unknown>,
  tab: ActTab,
  element: ElementInfo | undefined,
): ActionDescriptor {
  const paths = Array.isArray(params.paths)
    ? params.paths.filter((p) => typeof p === "string")
    : [];
  const names = paths.map((p) => p.split(/[\\/]/).pop() ?? p).join(", ");
  const count = paths.length === 1 ? "1 file" : `${paths.length} files`;
  return {
    tool: "browser",
    verb: "upload",
    summary: oneLine(`Upload ${count}${names ? ` (${names})` : ""} on ${hostOf(tab.url)}`, 240),
    detail: detailLines([
      `Page: ${tab.url ?? "(unknown)"}`,
      `Files: ${paths.join(", ") || "(none)"}`,
      element
        ? `Element: ${element.line}`
        : readString(params.element) && `Element: ${readString(params.element)}`,
    ]),
    url: tab.url,
    element,
    semanticKey: semanticHash({
      tool: "browser",
      action: "upload",
      paths,
      element: elementKey(element) ?? readString(params.element),
      page: pageKey(tab.url),
      changes: tab.changes,
    }),
  };
}

function describeDialog(params: Record<string, unknown>, tab: ActTab): ActionDescriptor {
  const promptText = typeof params.promptText === "string" ? params.promptText : undefined;
  const answer = promptText ? ` and answer ${quote(promptText, 80)}` : "";
  return {
    tool: "browser",
    verb: "dialog",
    summary: oneLine(`Accept the next page dialog${answer} on ${hostOf(tab.url)}`, 240),
    detail: detailLines([`Page: ${tab.url ?? "(unknown)"}`, promptText && `Answer: ${promptText}`]),
    url: tab.url,
    text: promptText,
    semanticKey: semanticHash({
      tool: "browser",
      action: "dialog",
      accept: true,
      promptText,
      url: pageKey(tab.url),
      changes: tab.changes,
    }),
  };
}

/**
 * Uploads and accepted dialogs always need the owner, who must see the real page: they are
 * judged against the tab they run on (paramsForClassification fills in the current tab), and
 * only from a snapshot that is still current.
 */
function classifyTabAction(
  params: Record<string, unknown>,
  snapshots: ElementLookup | undefined,
  action: string,
) {
  const tabId = readString(params.targetId);
  const snaps = snapshots;
  if (!snaps?.hasSnapshot(tabId)) {
    return deny(NO_SNAPSHOT_REASON);
  }
  if (snaps.isStale(tabId)) {
    return deny(STALE_SNAPSHOT_REASON);
  }
  const tab: ActTab = { url: snaps.urlFor(tabId), changes: snaps.changeSeq(tabId) };
  if (action === "dialog") {
    return ask(describeDialog(params, tab));
  }
  const ref = normalizeRef(readString(params.ref) ?? readString(params.inputRef));
  const element = ref ? snaps.elementContext(tabId, ref) : undefined;
  return ref && !element ? deny(NO_SNAPSHOT_REASON) : ask(describeUpload(params, tab, element));
}

export function classifyBrowser(
  params: Record<string, unknown>,
  snapshots: ElementLookup | undefined,
): Decision {
  const action = (readString(params.action) ?? "").trim().toLowerCase();
  if (BROWSER_READ_ACTIONS.has(action)) {
    if (action !== "open" && action !== "navigate") {
      return ALLOW;
    }
    const targetUrl = readString(params.targetUrl);
    if (hasUnusualScheme(targetUrl)) {
      return ask(describeBrowserGeneric(action, params, snapshots));
    }
    // Opening a page is reading, except GET URLs that vote, unsubscribe or carry data out.
    return riskyUrl(targetUrl) ? judge(describeBrowserGeneric(action, params, snapshots)) : ALLOW;
  }
  if (action === "upload") {
    return classifyTabAction(params, snapshots, action);
  }
  if (action === "dialog") {
    // The tool sends Boolean(accept); only accepting commits to anything.
    return params.accept ? classifyTabAction(params, snapshots, action) : ALLOW;
  }
  if (action === "act") {
    return classifyAct(params, snapshots);
  }
  return ask(describeBrowserGeneric(action, params, snapshots));
}
