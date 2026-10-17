import { describe, expect, it } from "vitest";
import {
  ALLOW_TOOLS,
  ALWAYS_DENY_TOOLS,
  classify,
  hasRiskyWord,
  hasSafeWord,
  isOwnerTarget,
  MESSAGE_READ_ONLY_ACTIONS,
} from "./classify.js";
import { SnapshotCache } from "./snapshot.js";
import { buttonsSnapshot } from "./test-helpers.js";
import type { ActionDescriptor, Decision, SentinelMode } from "./types.js";
import { resolveSentinelConfig } from "./types.js";

const TG_OWNER = "123456789";
const WA_OWNER = "+420123456789";

function info(mode: SentinelMode = "outbound", snapshots?: SnapshotCache) {
  return {
    config: resolveSentinelConfig({
      owners: { telegram: [TG_OWNER], whatsapp: [WA_OWNER] },
      mode,
    }),
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

describe("tool lists", () => {
  it("always denies the dangerous tools, in every mode", () => {
    for (const tool of ALWAYS_DENY_TOOLS) {
      for (const mode of ["outbound", "money", "off"] as const) {
        expect(classify(tool, {}, info(mode))).toEqual({
          kind: "deny",
          reason: `BLOCKED by Muse Sentinel: the ${tool} tool is turned off on this Muse server.`,
        });
      }
    }
    expect(classify("Bash", { command: "ls" }, info()).kind).toBe("deny");
    expect(classify("apply-patch", {}, info()).kind).toBe("deny");
  });

  it("allows reading and workspace tools", () => {
    for (const tool of ALLOW_TOOLS) {
      expect(classify(tool, { path: "x" }, info())).toEqual({ kind: "allow" });
    }
  });

  it("asks before any other tool (plugins, MCP)", () => {
    const decision = classify("github_create_issue", { title: "Hi" }, info());
    expect(decision.kind).toBe("ask");
    expect(actionOf(decision).summary).toBe('Use the github_create_issue tool: { "title": "Hi" }');
    expect(actionOf(decision).tool).toBe("github_create_issue");
  });
});

describe("message tool", () => {
  it("allows read-only actions", () => {
    for (const action of MESSAGE_READ_ONLY_ACTIONS) {
      expect(classify("message", { action, target: "+15550000000" }, info()).kind).toBe("allow");
    }
  });

  it("allows sends to the owner on Telegram and WhatsApp", () => {
    const sends = [
      { target: `telegram:${TG_OWNER}` },
      { target: TG_OWNER },
      { target: `tg:${TG_OWNER}`, channel: "telegram" },
      { to: TG_OWNER, channel: "Telegram" },
      { target: "+420 123 456 789", channel: "whatsapp" },
      { target: `whatsapp:${WA_OWNER}` },
      { target: WA_OWNER },
      { channelId: "420123456789", channel: "whatsapp" },
      { targets: [TG_OWNER, `telegram:${TG_OWNER}`], channel: "telegram" },
    ];
    for (const params of sends) {
      expect(classify("message", { action: "send", message: "hi", ...params }, info())).toEqual({
        kind: "allow",
      });
    }
  });

  it("allows a reply to the current chat (no explicit target)", () => {
    expect(classify("message", { action: "send", message: "done" }, info()).kind).toBe("allow");
    expect(classify("message", { action: "react", emoji: "👍" }, info()).kind).toBe("allow");
    expect(
      classify("message", { action: "send", channel: "whatsapp", message: "x" }, info()).kind,
    ).toBe("allow");
  });

  it("asks when there is no target but the action is not a reply", () => {
    expect(classify("message", { action: "kick", userId: "42" }, info()).kind).toBe("ask");
    expect(classify("message", { action: "broadcast", message: "x" }, info()).kind).toBe("ask");
    expect(
      classify("message", { action: "send", channel: "discord", message: "x" }, info()).kind,
    ).toBe("ask");
  });

  it("asks before messaging anyone else", () => {
    const decision = classify(
      "message",
      { action: "send", channel: "whatsapp", target: "+420999888777", message: "hello there" },
      info(),
    );
    expect(decision.kind).toBe("ask");
    const action = actionOf(decision);
    expect(action.summary).toBe('Send a WhatsApp message to +420999888777: "hello there"');
    expect(action.tool).toBe("message");
    expect(action.text).toBe("hello there");
    expect(action.detail).toContain("Text: hello there");
  });

  it("asks when any target is not an owner, or the channel does not match", () => {
    const cases = [
      { targets: [TG_OWNER, "555"], channel: "telegram" },
      { target: TG_OWNER, channel: "discord" },
      { target: `telegram:${TG_OWNER}`, channel: "whatsapp" },
      { target: "telegram:group:-100123" },
      { target: `${TG_OWNER}:topic:5`, channel: "telegram" },
      { target: "@someone", channel: "telegram" },
      { chatId: "555", channel: "telegram" },
      { target: TG_OWNER, to: "555", channel: "telegram" },
    ];
    for (const params of cases) {
      expect(classify("message", { action: "send", message: "x", ...params }, info()).kind).toBe(
        "ask",
      );
    }
  });

  it("asks for a broadcast unless it names one owner channel", () => {
    expect(
      classify("message", { action: "broadcast", targets: [TG_OWNER], message: "x" }, info()).kind,
    ).toBe("ask");
    expect(
      classify(
        "message",
        { action: "broadcast", channel: "telegram", targets: [TG_OWNER], message: "x" },
        info(),
      ).kind,
    ).toBe("allow");
  });

  it("checks owner targets per channel", () => {
    const owners = { telegram: [TG_OWNER], whatsapp: [WA_OWNER] };
    expect(isOwnerTarget(TG_OWNER, undefined, owners)).toBe(true);
    expect(isOwnerTarget("420123456789", undefined, owners)).toBe(true);
    expect(isOwnerTarget(`+${TG_OWNER}`, undefined, owners)).toBe(false);
    expect(isOwnerTarget("someone", undefined, owners)).toBe(false);
    expect(isOwnerTarget("", "telegram", owners)).toBe(false);
  });

  it("gives the same key for equivalent targets and a new key for new text", () => {
    const a = actionOf(
      classify(
        "message",
        { action: "send", target: "555", channel: "telegram", message: "m" },
        info(),
      ),
    );
    const b = actionOf(
      classify(
        "message",
        { action: "send", target: "telegram:555", channel: "telegram", message: "m" },
        info(),
      ),
    );
    const c = actionOf(
      classify(
        "message",
        { action: "send", target: "555", channel: "telegram", message: "n" },
        info(),
      ),
    );
    expect(a.semanticKey).toBe(b.semanticKey);
    expect(a.semanticKey).not.toBe(c.semanticKey);
  });
});

describe("modes", () => {
  it("off allows everything except denials", () => {
    expect(classify("github_create_issue", {}, info("off")).kind).toBe("allow");
    expect(
      classify("message", { action: "send", target: "555", channel: "telegram" }, info("off")).kind,
    ).toBe("allow");
    expect(classify("exec", {}, info("off")).kind).toBe("deny");
  });

  it("money only stops actions that mention money", () => {
    expect(click("e1", pageWith([["button", "Place order"]]), "money").kind).toBe("judge");
    expect(click("e1", pageWith([["button", "Post comment"]]), "money").kind).toBe("allow");
    expect(click("e1", pageWith([["button", "Zaplatit 1 290 Kč"]]), "money").kind).toBe("judge");
    // Money words in the text around the element count too.
    const form = pageWith([
      ["button", "Post comment"],
      ["text", "Total: 40 EUR"],
    ]);
    expect(click("e1", form, "money").kind).toBe("judge");
    const send = (message: string) =>
      classify(
        "message",
        { action: "send", target: "555", channel: "telegram", message },
        info("money"),
      ).kind;
    expect(send("see you at 6")).toBe("allow");
    expect(send("I will transfer it tomorrow")).toBe("ask");
    expect(send("it costs €40")).toBe("ask");
    expect(send("cena je 200,-")).toBe("ask");
  });
});

describe("word helpers", () => {
  it("matches whole words, not fragments", () => {
    expect(hasRiskyWord("Facebook")).toBe(false);
    expect(hasRiskyWord("Postal code")).toBe(false);
    expect(hasRiskyWord("PayPal")).toBe(false);
    expect(hasRiskyWord("Pay with PayPal")).toBe(true);
    expect(hasRiskyWord("Poslední zprávy")).toBe(false);
    for (const name of ["upvote", "Downvote", "Reorder", "Resubmit", "flag"]) {
      expect({ name, risky: hasRiskyWord(name) }).toEqual({ name, risky: true });
    }
    expect(hasRiskyWord("Flags of the world")).toBe(false);
    expect(hasSafeWord("Search")).toBe(true);
    expect(hasSafeWord("Researcher")).toBe(false);
  });

  it("counts a name as safe only when the whole name is a safe word", () => {
    for (const name of ["Close", "Close menu", "Next ›", "Show all", "Accept all cookies"]) {
      expect({ name, safe: hasSafeWord(name) }).toEqual({ name, safe: true });
    }
    for (const name of [
      "Close issue",
      "Close pull request",
      "Agree & Join",
      "I agree to the terms",
      "Accept all invitations",
    ]) {
      expect({ name, safe: hasSafeWord(name) }).toEqual({ name, safe: false });
    }
  });

  it("sends buttons that only start with a safe word to the guard", () => {
    for (const name of ["Close issue", "Agree & Join", "I agree to the terms"]) {
      expect({ name, kind: click("e1", pageWith([["button", name]])).kind }).toEqual({
        name,
        kind: "judge",
      });
    }
    expect(click("e1", pageWith([["button", "Close"]])).kind).toBe("allow");
  });

  it("counts agree as safe only on a cookie banner", () => {
    expect(hasSafeWord("I agree")).toBe(false);
    expect(hasSafeWord("I agree", ["We use cookies to improve your experience."])).toBe(true);
    expect(hasSafeWord("Souhlasím", ["Tento web používá soubory cookie."])).toBe(true);
    expect(hasSafeWord("I agree to the terms", ["We use cookies."])).toBe(false);
  });
});
