import { describe, expect, it } from "vitest";
import {
  browserEffect,
  navigatedTab,
  nextCurrentTab,
  paramsForClassification,
  pinToTab,
  tabToVerify,
  UNKNOWN_TAB,
} from "./tabs.js";

const ownBlock = (error: string) => error.startsWith("BLOCKED");
const ok = (
  action: string,
  details: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  params: { action, ...extra },
  result: { content: [], details },
});

describe("paramsForClassification", () => {
  it("points an act without request.targetId at the current tab and drops the top-level targetId", () => {
    const params = { action: "act", targetId: "A", request: { kind: "click", ref: "e1" } };
    expect(paramsForClassification(params, "B")).toEqual({
      action: "act",
      request: { kind: "click", ref: "e1", targetId: "B" },
    });
    expect(paramsForClassification(params, undefined)).toEqual({
      action: "act",
      request: { kind: "click", ref: "e1", targetId: UNKNOWN_TAB },
    });
    // The original params are not changed.
    expect(params.targetId).toBe("A");
  });

  it("leaves other calls and acts that name their tab alone", () => {
    const named = { action: "act", request: { kind: "click", ref: "e1", targetId: "A" } };
    expect(paramsForClassification(named, "B")).toBe(named);
    const upload = { action: "upload", targetId: "A", paths: ["/tmp/a.pdf"] };
    expect(paramsForClassification(upload, "B")).toBe(upload);
    const navigate = { action: "navigate", targetUrl: "https://example.com" };
    expect(paramsForClassification(navigate, "B")).toBe(navigate);
  });

  it("points an upload or dialog without targetId at the current tab", () => {
    const upload = { action: "upload", paths: ["/tmp/a.pdf"], ref: "e1" };
    expect(paramsForClassification(upload, "B")).toEqual({ ...upload, targetId: "B" });
    const dialog = { action: "dialog", accept: true };
    expect(paramsForClassification(dialog, undefined)).toEqual({
      ...dialog,
      targetId: UNKNOWN_TAB,
    });
  });
});

describe("tabToVerify", () => {
  it("names the tab a tab-dependent call was judged against", () => {
    const act = (request: Record<string, unknown>) => ({ action: "act", request });
    expect(tabToVerify(act({ kind: "click", ref: "e1", targetId: "A" }))).toBe("A");
    expect(tabToVerify(act({ kind: "type", targetId: "A" }))).toBe("A");
    expect(tabToVerify({ action: "upload", targetId: "A" })).toBe("A");
    expect(tabToVerify({ action: "dialog", accept: true, targetId: "A" })).toBe("A");
    // Calls that do not depend on a tab's snapshot, or whose tab is unknown.
    expect(tabToVerify(act({ kind: "hover", ref: "e1", targetId: "A" }))).toBeUndefined();
    expect(tabToVerify(act({ kind: "close", targetId: "A" }))).toBeUndefined();
    expect(tabToVerify({ action: "dialog", accept: false, targetId: "A" })).toBeUndefined();
    expect(tabToVerify({ action: "navigate", targetId: "A" })).toBeUndefined();
    expect(tabToVerify(act({ kind: "click", targetId: UNKNOWN_TAB }))).toBeUndefined();
  });
});

describe("browserEffect", () => {
  it("reports the tab a call changed or closed", () => {
    const act = (request: Record<string, unknown>) => ({ action: "act", request });
    expect(
      browserEffect(ok("act", { targetId: "A" }, { request: { kind: "type" } }), "B", ownBlock),
    ).toEqual({
      changed: "A",
    });
    expect(
      browserEffect(ok("navigate", { targetId: "A", url: "https://x" }), "B", ownBlock),
    ).toEqual({ changed: "A" });
    expect(browserEffect(ok("upload", { ok: true }), "B", ownBlock)).toEqual({ changed: "B" });
    expect(browserEffect(ok("close", { ok: true }), "B", ownBlock)).toEqual({ closed: "B" });
    expect(browserEffect(ok("close", { ok: true }, { targetId: "C" }), "B", ownBlock)).toEqual({
      closed: "C",
    });
    expect(
      browserEffect({ params: act({ kind: "close", targetId: "C" }), result: {} }, "B", ownBlock),
    ).toEqual({ closed: "C" });
    // A failed act may have changed the page part way.
    expect(
      browserEffect(
        { params: act({ kind: "fill", targetId: "C" }), error: "timeout" },
        "B",
        ownBlock,
      ),
    ).toEqual({ changed: "C" });
  });

  it("ignores looking, passive acts and calls the sentinel blocked", () => {
    expect(browserEffect(ok("snapshot", { targetId: "A" }), "B", ownBlock)).toEqual({});
    expect(browserEffect(ok("focus", { ok: true }, { targetId: "A" }), "B", ownBlock)).toEqual({});
    expect(
      browserEffect(ok("act", { targetId: "A" }, { request: { kind: "hover" } }), "B", ownBlock),
    ).toEqual({});
    expect(
      browserEffect(
        { params: { action: "act", request: { kind: "click" } }, error: "BLOCKED by Muse" },
        "B",
        ownBlock,
      ),
    ).toEqual({});
    expect(browserEffect({ params: { action: "close" }, error: "boom" }, "B", ownBlock)).toEqual(
      {},
    );
  });
});

describe("pinToTab", () => {
  it("pins acts, uploads and dialogs without a tab of their own to the current tab", () => {
    const act = { action: "act", request: { kind: "click", ref: "e1" } };
    expect(pinToTab(act, "B")).toEqual({
      action: "act",
      request: { kind: "click", ref: "e1", targetId: "B" },
    });
    const upload = { action: "upload", paths: ["/tmp/a.pdf"] };
    expect(pinToTab(upload, "B")).toEqual({ ...upload, targetId: "B" });
    expect(pinToTab({ action: "dialog", accept: true }, "B")).toEqual({
      action: "dialog",
      accept: true,
      targetId: "B",
    });
  });

  it("leaves calls that name their tab, other actions and an unknown tab alone", () => {
    const named = { action: "act", request: { kind: "click", ref: "e1", targetId: "A" } };
    expect(pinToTab(named, "B")).toBe(named);
    const act = { action: "act", request: { kind: "click", ref: "e1" } };
    expect(pinToTab(act, undefined)).toBe(act);
    const navigate = { action: "navigate", targetUrl: "https://example.com" };
    expect(pinToTab(navigate, "B")).toBe(navigate);
  });
});

describe("nextCurrentTab", () => {
  it("follows the tab a successful call reports or names", () => {
    expect(nextCurrentTab("A", ok("snapshot", { targetId: "B" }), ownBlock)).toBe("B");
    expect(nextCurrentTab("A", ok("act", { ok: true, targetId: "C" }), ownBlock)).toBe("C");
    expect(nextCurrentTab("A", ok("open", { targetId: "N", url: "https://x" }), ownBlock)).toBe(
      "N",
    );
    expect(nextCurrentTab("A", ok("focus", { ok: true }, { targetId: "F" }), ownBlock)).toBe("F");
    expect(nextCurrentTab("A", ok("tabs", { tabs: [{ targetId: "A" }] }), ownBlock)).toBe("A");
  });

  it("forgets the current tab when a tabs result no longer lists it", () => {
    expect(nextCurrentTab("A", ok("tabs", { tabs: [{ targetId: "B" }] }), ownBlock)).toBe(
      undefined,
    );
    expect(nextCurrentTab("A", ok("tabs", { ok: true, tabCount: 0 }), ownBlock)).toBeUndefined();
    // The browser tool returns the list as JSON text; its details only carry tabCount.
    const asText = (tabs: unknown[]) => ({
      params: { action: "tabs" },
      result: {
        content: [{ type: "text", text: `<<<EXTERNAL>>>\n${JSON.stringify({ tabs }, null, 2)}` }],
        details: { ok: true, tabCount: tabs.length },
      },
    });
    expect(nextCurrentTab("A", asText([{ targetId: "A" }, { targetId: "B" }]), ownBlock)).toBe("A");
    expect(nextCurrentTab("A", asText([{ targetId: "B" }]), ownBlock)).toBeUndefined();
    // A page title that spells out the current tab's id does not count as listing it.
    const spoof = asText([{ targetId: "B", title: '"targetId": "A"' }]);
    expect(nextCurrentTab("A", spoof, ownBlock)).toBeUndefined();
    // No readable list: the current tab is kept.
    expect(nextCurrentTab("A", ok("tabs", { ok: true, tabCount: 2 }), ownBlock)).toBe("A");
  });

  it("forgets the tab when it cannot know which one the browser uses next", () => {
    expect(nextCurrentTab("A", ok("close", { ok: true }), ownBlock)).toBeUndefined();
    expect(
      nextCurrentTab("A", ok("close", { ok: true }, { targetId: "A" }), ownBlock),
    ).toBeUndefined();
    expect(nextCurrentTab("A", ok("stop", { ok: true }), ownBlock)).toBeUndefined();
    expect(
      nextCurrentTab("A", ok("act", { ok: true }, { request: { kind: "close" } }), ownBlock),
    ).toBeUndefined();
    // A failed call that named another tab may have switched to it.
    expect(
      nextCurrentTab(
        "A",
        { params: { action: "act", request: { kind: "click", targetId: "B" } }, error: "boom" },
        ownBlock,
      ),
    ).toBeUndefined();
  });

  it("keeps the tab when another tab is closed, a call fails on it, or the sentinel blocked", () => {
    expect(nextCurrentTab("A", ok("close", { ok: true }, { targetId: "B" }), ownBlock)).toBe("A");
    expect(nextCurrentTab("A", { params: { action: "act" }, error: "timeout" }, ownBlock)).toBe(
      "A",
    );
    expect(
      nextCurrentTab(
        "A",
        {
          params: { action: "act", request: { kind: "click", targetId: "B" } },
          error: "BLOCKED by Muse Sentinel: this needs the owner's approval",
        },
        ownBlock,
      ),
    ).toBe("A");
  });
});

describe("navigatedTab", () => {
  it("returns the tab and URL of successful navigate and open calls only", () => {
    const details = { ok: true, targetId: "A", url: "https://example.com/next" };
    expect(navigatedTab(ok("navigate", details))).toEqual({
      targetId: "A",
      url: "https://example.com/next",
    });
    expect(navigatedTab(ok("snapshot", details))).toBeUndefined();
    expect(navigatedTab({ params: { action: "navigate" }, error: "nope" })).toBeUndefined();
  });
});
