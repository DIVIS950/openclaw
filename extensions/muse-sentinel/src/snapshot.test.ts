import { describe, expect, it } from "vitest";
import {
  captureSnapshotFromToolResult,
  extractSnapshotBody,
  MAX_CHANGE_RECORDS,
  normalizeRef,
  parseSnapshot,
  parseSnapshotLine,
  resolveTabId,
  SnapshotCache,
} from "./snapshot.js";
import { CHECKOUT_BODY, CHECKOUT_SNAPSHOT, CHECKOUT_URL, wrapSnapshot } from "./test-helpers.js";

describe("parseSnapshot", () => {
  it("reads the realistic checkout snapshot", () => {
    expect(extractSnapshotBody(CHECKOUT_SNAPSHOT)).toBe(CHECKOUT_BODY);
    const snap = parseSnapshot(CHECKOUT_SNAPSHOT);
    expect([...snap.elements.keys()]).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]);
    expect(snap.elements.get("e8")).toMatchObject({ role: "button", name: "Place order" });
    expect(snap.elements.get("e3")).toMatchObject({ role: "link", name: "Example Shop" });
    expect(snap.elements.get("e4")).toMatchObject({ role: "searchbox", name: "Search products" });
    expect(snap.elements.get("e1")).toMatchObject({ role: "generic", name: "" });
  });

  it("ignores the warning text and works without markers", () => {
    const snap = parseSnapshot('- button "Go" [ref=e1]');
    expect(snap.elements.get("e1")).toMatchObject({ role: "button", name: "Go" });
    const body = extractSnapshotBody(CHECKOUT_SNAPSHOT);
    expect(body).not.toContain("SECURITY NOTICE");
    expect(body).not.toContain("Source: Browser");
  });

  it("decodes escaped and YAML single-quoted names", () => {
    expect(parseSnapshotLine('  - button "Say \\"hi\\"" [ref=e2]')).toEqual({
      role: "button",
      name: 'Say "hi"',
      refs: ["e2"],
    });
    expect(parseSnapshotLine(`- 'button "Price: 199" [ref=e9]'`)).toEqual({
      role: "button",
      name: "Price: 199",
      refs: ["e9"],
    });
    expect(parseSnapshotLine(`- 'link "It''s here: now" [ref=f1e3] [cursor=pointer]':`)).toEqual({
      role: "link",
      name: "It's here: now",
      refs: ["f1e3"],
    });
  });

  it("does not let page text claim another element's ref", () => {
    const snap = parseSnapshot(
      wrapSnapshot(
        [
          '- button "Place order" [ref=e8]',
          "- text: Search [ref=e8]",
          '- paragraph [ref=e9]: Click "Search" [ref=e8]',
          '- button "Search [ref=e8]" [ref=e10]',
        ].join("\n"),
      ),
    );
    expect(snap.elements.get("e8")).toMatchObject({ role: "button", name: "Place order" });
    expect(snap.elements.get("e9")).toMatchObject({ role: "paragraph" });
    expect(snap.elements.get("e10")).toMatchObject({ name: "Search [ref=e8]" });
  });

  it("drops refs that appear twice (unescaped quotes in role mode)", () => {
    const snap = parseSnapshot(
      wrapSnapshot(
        ['- button "Search" [ref=e8] "" [ref=e5]', '- button "Place order" [ref=e8]'].join("\n"),
      ),
    );
    expect(snap.elements.has("e8")).toBe(false);
    expect(snap.elements.has("e5")).toBe(false);
  });

  it("counts duplicate role/name pairs", () => {
    const snap = parseSnapshot(
      wrapSnapshot(['- button "Delete" [ref=e1]', '- button "Delete" [ref=e2]'].join("\n")),
    );
    expect(snap.elements.get("e1")?.nth).toBe(0);
    expect(snap.elements.get("e2")?.nth).toBe(1);
  });

  it("caps stored lines but still sees refs past the cap", () => {
    const lines = ['- button "Search" [ref=e8]', "- text: filler", '- button "Buy" [ref=e8]'];
    const snap = parseSnapshot(wrapSnapshot(lines.join("\n")), 2);
    expect(snap.lines).toHaveLength(2);
    expect(snap.elements.has("e8")).toBe(false);
  });

  it("reads the JSON aria format", () => {
    const text = wrapSnapshot(
      JSON.stringify({
        ok: true,
        format: "aria",
        url: "https://example.com/",
        nodes: [
          { ref: "ax1", role: "main", name: "", depth: 0 },
          { ref: "ax2", role: "button", name: "Send", depth: 1 },
        ],
      }),
    );
    const snap = parseSnapshot(text);
    expect(snap.url).toBe("https://example.com/");
    expect(snap.elements.get("ax2")).toMatchObject({ role: "button", name: "Send" });
  });
});

describe("SnapshotCache", () => {
  it("returns the element with up to 6 lines of context around it", () => {
    const cache = new SnapshotCache();
    cache.remember("T1", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
    const el = cache.elementContext("T1", "e8");
    expect(el).toMatchObject({ role: "button", name: "Place order", nth: 0 });
    expect(el?.line).toBe('- button "Place order" [ref=e8] [cursor=pointer]');
    expect(el?.context).toHaveLength(7);
    expect(el?.context.join("\n")).toContain('heading "Checkout"');
    expect(el?.context.join("\n")).toContain('textbox "Card number"');
    expect(cache.urlFor("T1")).toBe(CHECKOUT_URL);
  });

  it("cuts long lines to 160 characters", () => {
    const cache = new SnapshotCache();
    cache.remember("T", wrapSnapshot(`- button "${"x".repeat(400)}" [ref=e1]`));
    const el = cache.elementContext("T", "e1");
    expect(el?.line.length).toBe(160);
    expect(el?.context[0]?.length).toBe(160);
    expect(el?.name.length).toBe(400);
  });

  it("uses the most recently used tab when no targetId is given", () => {
    const cache = new SnapshotCache();
    cache.remember("A", wrapSnapshot('- button "Alpha" [ref=e1]'), "https://a.example/");
    cache.remember("B", wrapSnapshot('- button "Beta" [ref=e1]'), "https://b.example/");
    expect(cache.elementContext(undefined, "e1")?.name).toBe("Beta");
    cache.touch("A");
    expect(cache.elementContext(undefined, "e1")?.name).toBe("Alpha");
    expect(cache.urlFor(undefined)).toBe("https://a.example/");
    cache.noteUrl("A", "https://a.example/next");
    expect(cache.urlFor("A")).toBe("https://a.example/next");
    expect(cache.elementContext("A", "e1")?.name).toBe("Alpha");
    expect(cache.elementContext("A", "e99")).toBeUndefined();
    expect(cache.elementContext("missing", "e1")).toBeUndefined();
  });

  it("tells when another tab has the same ref on a different element", () => {
    const cache = new SnapshotCache();
    cache.remember("A", wrapSnapshot('- link "Next page" [ref=e1]\n- button "Close" [ref=e2]'));
    cache.remember("B", wrapSnapshot('- button "Send" [ref=e1]\n- button "Close" [ref=e2]'));
    expect(cache.refConflicts("A", "e1")).toBe(true);
    expect(cache.refConflicts("B", "@e1")).toBe(true);
    // Same role and name on both tabs, a ref only one tab has, or an unknown tab: no conflict.
    expect(cache.refConflicts("A", "e2")).toBe(false);
    expect(cache.refConflicts("A", "e9")).toBe(false);
    expect(cache.refConflicts("missing", "e1")).toBe(false);
    cache.forget("B");
    expect(cache.refConflicts("A", "e1")).toBe(false);
  });

  it("keeps at most 20 tabs, dropping the least recently used", () => {
    const cache = new SnapshotCache();
    for (let i = 0; i < 21; i += 1) {
      cache.remember(`T${i}`, wrapSnapshot(`- button "B${i}" [ref=e1]`));
      if (i === 5) {
        cache.touch("T0");
      }
    }
    expect(cache.size).toBe(20);
    expect(cache.elementContext("T0", "e1")?.name).toBe("B0");
    expect(cache.elementContext("T1", "e1")).toBeUndefined();
  });

  it("keeps at most 4000 lines per tab by default", () => {
    const body = Array.from({ length: 4100 }, (_, i) => `- button "B${i}" [ref=e${i}]`).join("\n");
    const cache = new SnapshotCache();
    cache.remember("T", wrapSnapshot(body));
    expect(cache.elementContext("T", "e3999")?.name).toBe("B3999");
    expect(cache.elementContext("T", "e4000")).toBeUndefined();
  });

  it("looks refs up the way the browser reads them", () => {
    expect(normalizeRef("@e5")).toBe("e5");
    expect(normalizeRef(" ref=e5 ")).toBe("e5");
    expect(normalizeRef("@ref=f1e3")).toBe("f1e3");
    expect(normalizeRef("  ")).toBeUndefined();
    const cache = new SnapshotCache();
    cache.remember("T1", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
    expect(cache.elementContext("T1", "@e8")?.name).toBe("Place order");
    expect(cache.elementContext("T1", "ref=e8")?.name).toBe("Place order");
  });

  it("keeps a link's href and the focused element", () => {
    const cache = new SnapshotCache();
    cache.remember("T1", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
    expect(cache.elementContext("T1", "e3")?.href).toBe("/");
    expect(cache.elementContext("T1", "e4")?.href).toBeUndefined();
    expect(cache.activeElement("T1")).toMatchObject({ role: "generic", name: "" });
    cache.remember(
      "T2",
      wrapSnapshot(
        [
          '- link "Unsubscribe" [ref=e1]:',
          '  - /url: "https://list.example.com/u?id=1&x=\\"y\\""',
          "- iframe [active] [ref=e2]:",
          '  - textbox "Card" [active] [ref=f1e1]: 4111',
        ].join("\n"),
      ),
    );
    expect(cache.elementContext("T2", "e1")?.href).toBe('https://list.example.com/u?id=1&x="y"');
    // The iframe holding the focus is skipped; the field inside it is the focused element.
    expect(cache.activeElement("T2")?.line).toBe('- textbox "Card" [active] [ref=f1e1]: 4111');
    // Two focused elements cannot both be real: trust neither.
    cache.remember(
      "T3",
      wrapSnapshot('- textbox "A" [active] [ref=e1]\n- textbox "B" [active] [ref=e2]'),
    );
    expect(cache.activeElement("T3")).toBeUndefined();
    // A /url line that is not below the link does not count.
    expect(
      parseSnapshot(wrapSnapshot('- link "A" [ref=e1]\n- /url: /x')).elements.get("e1")?.href,
    ).toBeUndefined();
  });

  it("forgets closed tabs and resolves id prefixes like the browser", () => {
    const cache = new SnapshotCache();
    cache.remember("ABC123", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
    cache.remember("ABD999", CHECKOUT_SNAPSHOT, "https://other.example/");
    expect(cache.knownId("abc")).toBe("ABC123");
    expect(cache.knownId("AB")).toBeUndefined();
    expect(cache.urlFor("abc")).toBe(CHECKOUT_URL);
    expect(resolveTabId("ab", ["ABC123", "ABD999"])).toBeUndefined();
    expect(resolveTabId("ABD999", ["ABD999", "ABD9990"])).toBe("ABD999");
    cache.forget("abc");
    expect(cache.hasSnapshot("ABC123")).toBe(false);
    expect(cache.elementContext("ABC123", "e8")).toBeUndefined();
    expect(cache.hasSnapshot("ABD999")).toBe(true);
  });

  it("tells when a tab changed after its last snapshot", () => {
    const cache = new SnapshotCache();
    expect(cache.isStale("T1")).toBe(true);
    cache.remember("T1", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
    const before = cache.changeSeq("T1");
    expect(cache.isStale("T1")).toBe(false);
    cache.noteChange("T1");
    expect(cache.isStale("T1")).toBe(true);
    expect(cache.changeSeq("T1")).toBeGreaterThan(before);
    // A navigate result alone does not make the old snapshot current again.
    cache.noteUrl("T1", "https://shop.example.com/next");
    expect(cache.isStale("T1")).toBe(true);
    cache.remember("T1", CHECKOUT_SNAPSHOT);
    expect(cache.isStale("T1")).toBe(false);
    expect(cache.urlFor("T1")).toBe("https://shop.example.com/next");
    // Only known by URL (navigate before any snapshot): stale.
    cache.noteUrl("T2", "https://x.example/");
    expect(cache.hasSnapshot("T2")).toBe(false);
    expect(cache.isStale("T2")).toBe(true);
  });

  it("never lets a dropped change record make a changed tab look unchanged", () => {
    const cache = new SnapshotCache();
    cache.remember("T", CHECKOUT_SNAPSHOT);
    const untouched = cache.changeSeq("T");
    cache.noteChange("T");
    for (let i = 0; i <= MAX_CHANGE_RECORDS; i += 1) {
      cache.noteChange(`other-${i}`);
    }
    // T's own record was dropped, but its sequence still differs from before the change.
    expect(cache.changeSeq("T")).not.toBe(untouched);
    expect(cache.isStale("T")).toBe(true);
  });
});

describe("captureSnapshotFromToolResult", () => {
  const result = {
    content: [{ type: "text", text: CHECKOUT_SNAPSHOT }],
    details: { ok: true, format: "ai", targetId: "T1", url: CHECKOUT_URL },
  };

  it("stores full snapshots from the adapter emit (no durationMs key)", () => {
    const cache = new SnapshotCache();
    const stored = captureSnapshotFromToolResult(cache, {
      toolName: "browser",
      params: { action: "snapshot" },
      result,
    });
    expect(stored).toBe(true);
    expect(cache.elementContext("T1", "e8")?.name).toBe("Place order");
  });

  it("ignores the truncated emit, errors and other actions", () => {
    const cache = new SnapshotCache();
    const base = { toolName: "browser", params: { action: "snapshot" }, result };
    expect(captureSnapshotFromToolResult(cache, { ...base, durationMs: 12 })).toBe(false);
    expect(captureSnapshotFromToolResult(cache, { ...base, durationMs: undefined })).toBe(false);
    expect(captureSnapshotFromToolResult(cache, { ...base, error: "boom" })).toBe(false);
    expect(captureSnapshotFromToolResult(cache, { ...base, params: { action: "tabs" } })).toBe(
      false,
    );
    expect(captureSnapshotFromToolResult(cache, { ...base, toolName: "web_fetch" })).toBe(false);
    expect(
      captureSnapshotFromToolResult(cache, { ...base, result: { content: [], details: {} } }),
    ).toBe(false);
    expect(cache.size).toBe(0);
  });
});

describe("SnapshotCache change numbers", () => {
  it("never repeat across a restart, so an old approval key cannot match again", async () => {
    const first = new SnapshotCache();
    first.noteChange("TAB");
    const before = first.changeSeq("TAB");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const restarted = new SnapshotCache();
    restarted.noteChange("TAB");
    expect(restarted.changeSeq("TAB")).toBeGreaterThan(before);
  });
});
