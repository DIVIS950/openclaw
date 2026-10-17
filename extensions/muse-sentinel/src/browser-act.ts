// Classifies browser `act` calls (click, type, press, select, fill, drag) from the tab's last
// snapshot. A decision that rests on the snapshot needs one that still shows the page, and no
// approval is ever made for an element the sentinel cannot see.
// Pure module: no runtime imports from OpenClaw.
import { normalizeRef } from "./snapshot.js";
import { PASSIVE_ACT_KINDS } from "./tabs.js";
import {
  asRecord,
  clip,
  detailLines,
  hostOf,
  hostPath,
  oneLine,
  pageKey,
  quote,
  readString,
  semanticHash,
} from "./text.js";
import type { ActionDescriptor, Decision, ElementInfo } from "./types.js";
import { hasRiskyWord, hasSafeWord, isCheckoutPage, mentionsMoney, riskyUrl } from "./words.js";

/** What the browser rules need from the snapshot cache (see snapshot.ts SnapshotCache). */
export type ElementLookup = {
  elementContext(targetId: string | undefined, ref: string): ElementInfo | undefined;
  urlFor(targetId: string | undefined): string | undefined;
  /** The focused element (`[active]`) in the tab's last snapshot. */
  activeElement(targetId: string | undefined): ElementInfo | undefined;
  hasSnapshot(targetId: string | undefined): boolean;
  /** True when the tab has no snapshot or something ran on it after its last snapshot. */
  isStale(targetId: string | undefined): boolean;
  /** Sequence number of the tab's last change: any change after an approval needs a new one. */
  changeSeq(targetId: string | undefined): number;
  /** True when another cached tab has the same ref on a different element. */
  refConflicts(targetId: string | undefined, ref: string): boolean;
};

const REF_CONFLICT_NOTE =
  "Note: the same element reference points to a different element on another open tab.";

// Clicking these only focuses a field or switches a view.
const FOCUS_ROLES: ReadonlySet<string> = new Set(["tab", "textbox", "searchbox", "combobox"]);
// Fields that `type` with slowly: true clicks and types into without pressing anything else.
const TEXT_ENTRY_ROLES: ReadonlySet<string> = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
]);
// Keys that only move focus, scroll or dismiss. Every other key can act on the focused element
// (Enter sends, Space presses, "l" likes on x.com, Delete deletes in Gmail and Drive).
const NAV_KEYS: ReadonlySet<string> = new Set([
  "tab",
  "shift+tab",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "pageup",
  "pagedown",
  "home",
  "end",
  "escape",
]);
// `fill` fields of these types are set with Playwright setChecked, which clicks the element.
const CHECKABLE_FIELD_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio"]);
// Snapshot tags that differ between two snapshots of the same page state.
const VOLATILE_TAG_RE = /\s*\[(?:ref|nth)=[^\]]*\]|\s*\[cursor=pointer\]|\s*\[active\]/g;

const EVALUATE_DENY_REASON =
  "BLOCKED by Muse Sentinel: running JavaScript in the page is turned off on this Muse server.";
/** The sentinel has no snapshot of the tab, or the ref is not in it. */
export const NO_SNAPSHOT_REASON =
  "BLOCKED by Muse Sentinel: take a snapshot of this tab first, then use a ref from that snapshot. If the page is very long, take the snapshot with interactive: true.";
/** Something ran on the tab after its last snapshot, so the snapshot may not show the page. */
export const STALE_SNAPSHOT_REASON =
  "BLOCKED by Muse Sentinel: the page changed since your last snapshot. Take a new snapshot, then retry.";

const ALLOW: Decision = { kind: "allow" };
const ask = (action: ActionDescriptor): Decision => ({ kind: "ask", action });
const judge = (action: ActionDescriptor): Decision => ({ kind: "judge", action });
const deny = (reason: string): Decision => ({ kind: "deny", reason });

/** Reads a flag the way the browser route does (routes/utils.ts toBoolean): true, "true", "1", "yes". */
function routeTrue(value: unknown): boolean {
  return (
    value === true ||
    (typeof value === "string" && ["true", "1", "yes"].includes(value.trim().toLowerCase()))
  );
}

/** Schemes other than http(s) and about: (javascript:, data:, file:, chrome:) need the owner. */
export function hasUnusualScheme(url: string | undefined): boolean {
  // "localhost:3000" is a host and port, not a scheme.
  const scheme = /^\s*([a-z][a-z0-9+.-]*):(?!\d)/i.exec(url ?? "")?.[1]?.toLowerCase();
  return scheme !== undefined && scheme !== "http" && scheme !== "https" && scheme !== "about";
}

/** "Shift+Tab" -> "shift+tab"; a lone space stays a space. */
function normalizeKey(key: string): string {
  return key === " "
    ? key
    : key
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .join("+");
}

/** Values the way the browser route reads them (routes/utils.ts toStringArray). */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((v) =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v).trim()
        : "",
    )
    .filter(Boolean);
}

/** How core's fillFormViaPlaywright reads a checkbox value. */
function isChecked(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function elementLabel(element: ElementInfo | undefined, ref?: string): string {
  if (element?.name) {
    return quote(element.name, 80);
  }
  if (element) {
    return `a ${element.role}`;
  }
  return `an element the sentinel could not identify${ref ? ` (${oneLine(ref, 20)})` : ""}`;
}

/** What an approval is tied to for one element: what it is, and the page text around it. */
export function elementKey(element: ElementInfo | undefined): Record<string, unknown> | undefined {
  if (!element) {
    return undefined;
  }
  return {
    role: element.role,
    name: element.name,
    nth: element.nth,
    // The form around the element (recipient, text, amounts): when it changes, the owner is
    // asked again. Refs are dropped, so a re-render that only renumbers them still matches.
    context: element.context.map((line) => line.replace(VOLATILE_TAG_RE, "")),
  };
}

/** The tab an act runs on, as the snapshot cache knows it. */
export type ActTab = {
  url: string | undefined;
  /** Sequence number of the tab's last change (SnapshotCache.changeSeq). */
  changes: number;
};

type ActDescription = {
  summary: string;
  /** Extra detail lines for the owner. */
  lines?: Array<string | false | undefined>;
  /** Extra parts of the approval key. */
  key?: Record<string, unknown>;
};

function describeAct(
  kind: string,
  request: Record<string, unknown>,
  tab: ActTab,
  element: ElementInfo | undefined,
  description: ActDescription,
): ActionDescriptor {
  const text = typeof request.text === "string" ? request.text : undefined;
  // Not readString: a single space is a real key.
  const key = typeof request.key === "string" && request.key ? request.key : undefined;
  return {
    tool: "browser",
    verb: kind,
    summary: oneLine(description.summary, 240),
    detail: detailLines([
      `Page: ${tab.url ?? "(unknown)"}`,
      element && `Element: ${element.line}`,
      text !== undefined && `Text: ${clip(text, 500)}`,
      key && `Key: ${key}`,
      ...(description.lines ?? []),
      element &&
        element.context.length > 0 &&
        `Around it on the page:\n${element.context.join("\n")}`,
    ]),
    url: tab.url,
    element,
    text,
    key,
    semanticKey: semanticHash({
      tool: "browser",
      kind,
      element: elementKey(element),
      text,
      key: key === undefined ? undefined : normalizeKey(key),
      submit: routeTrue(request.submit) || undefined,
      slowly: routeTrue(request.slowly) || undefined,
      // The full address: the query or fragment often names the draft, cart or recipient.
      page: pageKey(tab.url),
      // Anything typed, filled or clicked on the tab after the request needs a new approval.
      changes: tab.changes,
      ...description.key,
    }),
  };
}

/** What a click on `element` needs: nothing, the guard, or (element unknown) the owner. */
function clickOutcome(
  element: ElementInfo | undefined,
  url: string | undefined,
): "allow" | "judge" | "ask" {
  if (!element) {
    // The guard would have nothing to judge.
    return "ask";
  }
  if (hasRiskyWord(element.name) || isCheckoutPage(hostPath(url))) {
    return "judge";
  }
  if (element.role === "link") {
    // A link is a GET, but some GETs vote, unsubscribe, run script or carry data out.
    const href = element.href;
    return href !== undefined && (hasUnusualScheme(href) || riskyUrl(href, url))
      ? "judge"
      : "allow";
  }
  if (FOCUS_ROLES.has(element.role)) {
    return "allow";
  }
  return element.name && hasSafeWord(element.name, element.context) ? "allow" : "judge";
}

function decisionFor(outcome: "allow" | "judge" | "ask", action: ActionDescriptor): Decision {
  if (outcome === "allow") {
    return ALLOW;
  }
  return outcome === "judge" ? judge(action) : ask(action);
}

/** A decision for one act, before checking that the tab's snapshot shows the page as it is. */
type ActVerdict = {
  decision: Decision;
  /** The decision relied on the tab's snapshot (an element, the focus or the page). */
  usesSnapshot: boolean;
  /** A ref the call needs is not in the tab's snapshot. */
  unknownRef?: boolean;
  /** What the call does, for a decision that allows it (see classifyAct ref conflicts). */
  action?: ActionDescriptor;
};

/** Looks up a ref (as core normalizes it) in the tab's last snapshot. */
type RefLookup = (raw: unknown) => ElementInfo | undefined;

const PLAIN_ALLOW: ActVerdict = { decision: ALLOW, usesSnapshot: false };

function clickVerdict(request: Record<string, unknown>, tab: ActTab, lookup: RefLookup) {
  const element = lookup(request.ref);
  const action = describeAct("click", request, tab, element, {
    summary: `Click ${elementLabel(element, readString(request.ref))} on ${hostOf(tab.url)}`,
    lines: [element?.href !== undefined && `Link target: ${clip(element.href, 300)}`],
  });
  const decision = decisionFor(clickOutcome(element, tab.url), action);
  return { decision, usesSnapshot: true, unknownRef: !element, action };
}

function typeVerdict(request: Record<string, unknown>, tab: ActTab, lookup: RefLookup) {
  const text = typeof request.text === "string" ? request.text : "";
  const slowly = routeTrue(request.slowly);
  // Typing a newline key by key presses Enter, which submits like submit: true.
  const submits = routeTrue(request.submit) || /[\r\n]/.test(text);
  if (!submits && !slowly) {
    // Playwright fill only sets the field's value.
    return PLAIN_ALLOW;
  }
  const element = lookup(request.ref);
  // With slowly, core's typeViaPlaywright clicks the element first, then presses each key on
  // it: on a button that is a click with no other check.
  const clicks = slowly && !(element && TEXT_ENTRY_ROLES.has(element.role));
  const label = elementLabel(element, readString(request.ref));
  const action = describeAct("type", request, tab, element, {
    summary: `Type ${quote(text, 80)} into ${label}${submits ? " and submit it" : ""} on ${hostOf(tab.url)}`,
    lines: [slowly && "Typed key by key after clicking the element."],
  });
  const decision = submits || clicks ? judge(action) : ALLOW;
  return { decision, usesSnapshot: true, unknownRef: !element, action };
}

function pressVerdict(
  request: Record<string, unknown>,
  tab: ActTab,
  focused: ElementInfo | undefined,
) {
  const key = typeof request.key === "string" ? request.key : "";
  if (NAV_KEYS.has(normalizeKey(key))) {
    return PLAIN_ALLOW;
  }
  // Core presses the key on whatever has focus and ignores request.ref, so the element shown is
  // the focused one from the tab's last snapshot (which must be current, see classifyAct).
  const name = key === " " ? "Space" : oneLine(key || "a key", 30);
  const action = describeAct("press", request, tab, focused, {
    summary: `Press ${name}${focused ? ` in ${elementLabel(focused)}` : ""} on ${hostOf(tab.url)}`,
    lines: [
      focused
        ? "The key goes to the focused element, shown as it was in the last snapshot."
        : "The key goes to whichever element has focus; the sentinel cannot see which.",
    ],
  });
  return { decision: judge(action), usesSnapshot: true };
}

function selectVerdict(request: Record<string, unknown>, tab: ActTab, lookup: RefLookup) {
  const element = lookup(request.ref);
  const values = stringList(request.values);
  const label = elementLabel(element, readString(request.ref));
  const chosen = values.map((v) => quote(v, 40)).join(", ") || "an option";
  const action = describeAct("select", request, tab, element, {
    summary: `Choose ${chosen} in ${label} on ${hostOf(tab.url)}`,
    lines: [values.length > 0 && `Values: ${values.join(", ")}`],
    key: { values },
  });
  // Change handlers run at once: a quantity of "0 (Delete)" or a paid plan can take effect.
  const risky =
    !element ||
    hasRiskyWord([...values, element.name].join("\n")) ||
    element.context.some((line) => hasRiskyWord(line)) ||
    mentionsMoney(action);
  return {
    decision: risky ? judge(action) : ALLOW,
    usesSnapshot: true,
    unknownRef: !element,
    action,
  };
}

function fillVerdict(request: Record<string, unknown>, tab: ActTab, lookup: RefLookup) {
  const fields = Array.isArray(request.fields) ? request.fields.map(asRecord) : [];
  const toggles = fields.filter((field) =>
    CHECKABLE_FIELD_TYPES.has((readString(field.type) ?? "").trim().toLowerCase()),
  );
  if (toggles.length === 0) {
    // Playwright fill only sets values (and throws on anything that is not a text field).
    return PLAIN_ALLOW;
  }
  // Checkboxes and radios are set with setChecked, which clicks: judge them like clicks.
  const items = toggles.map((field) => {
    const element = lookup(field.ref);
    const ref = readString(field.ref);
    const state = isChecked(field.value) ? "on" : "off";
    return { element, ref, state, outcome: clickOutcome(element, tab.url) };
  });
  const host = hostOf(tab.url);
  const first = items[0];
  const summary =
    items.length === 1 && first
      ? `Turn ${elementLabel(first.element, first.ref)} ${first.state} on ${host}`
      : `Change ${items.length} checkboxes (${items
          .map((item) => `${elementLabel(item.element, item.ref)} ${item.state}`)
          .join(", ")}) on ${host}`;
  const shown = (items.find((item) => item.outcome !== "allow") ?? first)?.element;
  const action = describeAct("fill", request, tab, shown, {
    summary,
    lines: items.map((item) => `Set to ${item.state}: ${item.element?.line ?? item.ref}`),
    key: { fields: items.map((item) => ({ element: elementKey(item.element), on: item.state })) },
  });
  const risky = items.some((item) => item.outcome !== "allow");
  return {
    decision: risky ? judge(action) : ALLOW,
    usesSnapshot: true,
    unknownRef: items.some((item) => !item.element),
    action,
  };
}

function dragVerdict(request: Record<string, unknown>, tab: ActTab, lookup: RefLookup) {
  const start = lookup(request.startRef);
  const end = lookup(request.endRef);
  const from = elementLabel(start, readString(request.startRef));
  const onto = elementLabel(end, readString(request.endRef));
  const action = describeAct("drag", request, tab, start, {
    summary: `Drag ${from} onto ${onto} on ${hostOf(tab.url)}`,
    lines: [
      end && `Dropped on: ${end.line}`,
      end && end.context.length > 0 && `Around the drop target:\n${end.context.join("\n")}`,
    ],
    key: { end: elementKey(end) },
  });
  // A drop can delete, move or share (onto Trash, another folder, a person): the guard decides.
  return { decision: judge(action), usesSnapshot: true, unknownRef: !start || !end };
}

function actVerdict(
  kind: string,
  request: Record<string, unknown>,
  tab: ActTab,
  lookup: RefLookup,
  focused: () => ElementInfo | undefined,
): ActVerdict {
  switch (kind) {
    case "click":
      return clickVerdict(request, tab, lookup);
    case "type":
      return typeVerdict(request, tab, lookup);
    case "press":
      return pressVerdict(request, tab, focused());
    case "select":
      return selectVerdict(request, tab, lookup);
    case "fill":
      return fillVerdict(request, tab, lookup);
    case "drag":
      return dragVerdict(request, tab, lookup);
    default: {
      const summary = `Browser ${oneLine(kind || "act", 30)} on ${hostOf(tab.url)}`;
      return {
        decision: ask(describeAct(kind, request, tab, undefined, { summary })),
        usesSnapshot: false,
      };
    }
  }
}

export function classifyAct(
  params: Record<string, unknown>,
  snapshots: ElementLookup | undefined,
): Decision {
  const request = asRecord(params.request);
  const kind = (readString(request.kind) ?? "").trim().toLowerCase();
  if (kind === "evaluate" || (kind === "wait" && readString(request.fn))) {
    return deny(EVALUATE_DENY_REASON);
  }
  if (PASSIVE_ACT_KINDS.has(kind) || kind === "close") {
    return ALLOW;
  }
  // The act request carries its own tab; a top-level targetId is not merged by core.
  const tabId = readString(request.targetId) ?? readString(params.targetId);
  const snaps = snapshots;
  const tab: ActTab = { url: snaps?.urlFor(tabId), changes: snaps?.changeSeq(tabId) ?? 0 };
  let refConflict = false;
  const lookup: RefLookup = (raw) => {
    const ref = normalizeRef(readString(raw));
    if (ref && snaps?.refConflicts(tabId, ref)) {
      refConflict = true;
    }
    return ref ? snaps?.elementContext(tabId, ref) : undefined;
  };
  const verdict = actVerdict(kind, request, tab, lookup, () => snaps?.activeElement(tabId));
  if (!verdict.usesSnapshot) {
    return verdict.decision;
  }
  // The decision came from the tab's last snapshot: it must show the page as it is now.
  if (!snaps?.hasSnapshot(tabId)) {
    return deny(NO_SNAPSHOT_REASON);
  }
  if (snaps.isStale(tabId)) {
    return deny(STALE_SNAPSHOT_REASON);
  }
  // No approval is ever made for an element the sentinel cannot see.
  if (verdict.unknownRef) {
    return deny(NO_SNAPSHOT_REASON);
  }
  // The same ref names another element on another cached tab: if the browser ends up on that
  // tab, the act hits something else, so a harmless-looking target is not enough.
  if (refConflict && verdict.decision.kind === "allow" && verdict.action) {
    return judge({
      ...verdict.action,
      detail: `${verdict.action.detail}\n${REF_CONFLICT_NOTE}`,
    });
  }
  return verdict.decision;
}
