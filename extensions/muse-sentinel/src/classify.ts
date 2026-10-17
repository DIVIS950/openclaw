// Decides, per tool call, whether Muse may go ahead, must stop, or needs the owner.
// Pure module: no runtime imports from OpenClaw.
import { classifyBrowser, type ElementLookup, INTEGRITY_DENY_REASONS } from "./browser.js";
import { classifyMessage, isMessageModifyAction } from "./message.js";
import {
  asRecord,
  clip,
  detailLines,
  jsonPreview,
  oneLine,
  quote,
  readString,
  semanticHash,
} from "./text.js";
import type { ActionDescriptor, Decision, SentinelConfig } from "./types.js";
import { mentionsMoney, riskyUrl } from "./words.js";

export {
  BROWSER_READ_ACTIONS,
  type ElementLookup,
  NO_SNAPSHOT_REASON,
  STALE_SNAPSHOT_REASON,
} from "./browser.js";
export { isOwnerTarget, MESSAGE_READ_ONLY_ACTIONS } from "./message.js";
export { hasRiskyWord, hasSafeWord, isCheckoutPage, mentionsMoney, riskyUrl } from "./words.js";

export type ClassifyInfo = {
  config: SentinelConfig;
  snapshots?: ElementLookup;
};

/** Tools that never run on a Muse server (the config denies them too). */
export const ALWAYS_DENY_TOOLS: ReadonlySet<string> = new Set([
  "exec",
  "process",
  "gateway",
  "cron",
  "nodes",
  "sessions_send",
  "sessions_spawn",
  "lobster",
  "apply_patch",
]);

/** Tools that only read, or only write inside the workspace (tools.fs.workspaceOnly). */
export const ALLOW_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "write",
  "edit",
  "web_search",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "session_status",
  "agents_list",
  "subagents",
  "image",
  "tts",
  "canvas",
]);

export function toolDenyReason(tool: string): string {
  return `BLOCKED by Muse Sentinel: the ${tool} tool is turned off on this Muse server.`;
}

const ALLOW: Decision = { kind: "allow" };
const ask = (action: ActionDescriptor): Decision => ({ kind: "ask", action });

function normalizeToolName(name: string): string {
  const tool = name.trim().toLowerCase();
  if (tool === "bash") {
    return "exec";
  }
  return tool === "apply-patch" ? "apply_patch" : tool;
}

// ---------------------------------------------------------------- web_fetch

/** A fetch is a plain GET: allowed unless the URL votes, unsubscribes or carries data out. */
function classifyWebFetch(params: Record<string, unknown>): Decision {
  const url = readString(params.url);
  if (!riskyUrl(url)) {
    return ALLOW;
  }
  return ask({
    tool: "web_fetch",
    verb: "fetch",
    summary: oneLine(`Fetch ${quote(url ?? "", 160)}`, 240),
    detail: detailLines([`URL: ${clip(url ?? "", 1500)}`]),
    url,
    semanticKey: semanticHash({ tool: "web_fetch", url }),
  });
}

// ---------------------------------------------------------------- any other tool

function describeOtherTool(tool: string, params: Record<string, unknown>): ActionDescriptor {
  return {
    tool,
    verb: "call",
    summary: oneLine(`Use the ${tool} tool: ${jsonPreview(params, 200)}`, 240),
    detail: detailLines([`Tool: ${tool}`, `Parameters: ${jsonPreview(params, 1500)}`]),
    semanticKey: semanticHash({ tool, params }),
  };
}

/**
 * Classifies one tool call. `deny` reasons are the full text for the model. Every `ask` and
 * `judge` carries an ActionDescriptor whose semanticKey ties a later retry to the approval.
 */
export function classify(toolName: string, rawParams: unknown, info: ClassifyInfo): Decision {
  const tool = normalizeToolName(toolName);
  if (ALWAYS_DENY_TOOLS.has(tool)) {
    return { kind: "deny", reason: toolDenyReason(tool) };
  }
  const params = asRecord(rawParams);
  let decision: Decision;
  if (ALLOW_TOOLS.has(tool)) {
    decision = ALLOW;
  } else if (tool === "web_fetch") {
    decision = classifyWebFetch(params);
  } else if (tool === "message") {
    decision = classifyMessage(params, info.config);
  } else if (tool === "browser") {
    decision = classifyBrowser(params, info.snapshots);
  } else {
    decision = ask(describeOtherTool(tool, params));
  }
  if (decision.kind === "allow") {
    return decision;
  }
  if (decision.kind === "deny") {
    // With the sentinel off only the hard denials apply (turned-off tools, page JavaScript).
    const integrityOnly = INTEGRITY_DENY_REASONS.has(decision.reason);
    return info.config.mode === "off" && integrityOnly ? ALLOW : decision;
  }
  // "off" lets everything through except denials; "money" only stops what mentions money.
  if (info.config.mode === "off") {
    return ALLOW;
  }
  // Edits and deletes of chat messages still ask: they could rewrite a pending approval request.
  if (
    info.config.mode === "money" &&
    !mentionsMoney(decision.action) &&
    !isMessageModifyAction(decision.action)
  ) {
    return ALLOW;
  }
  return decision;
}
