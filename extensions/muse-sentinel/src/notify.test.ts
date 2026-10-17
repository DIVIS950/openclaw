import { describe, expect, it } from "vitest";
import {
  approvalButtons,
  approvalKeyFromArgs,
  notifyChannels,
  telegramApprovalText,
  whatsappApprovalText,
} from "./notify.js";
import type { PendingEntry, SentinelConfig } from "./types.js";

const ID = "0b8f8a1e-4c1d-4f6e-9a57-2f1c3d4e5f60";

const ENTRY: PendingEntry = {
  id: ID,
  code: "482913",
  notifiedVia: ["telegram", "whatsapp"],
  sessionKey: "agent:main:main",
  tool: "browser",
  semanticKey: "key",
  summary: 'Click "Place order" on shop.example.com',
  detail: "Page: https://shop.example.com/checkout\nTotal 1 299 Kč",
  createdAt: 0,
  expiresAt: 30 * 60_000,
  status: "pending",
};

describe("approvalButtons", () => {
  it("sends the entry id, never the code, and fits Telegram's 64-byte callback data", () => {
    const [[allow] = [], [dont] = []] = approvalButtons(ENTRY.id, ENTRY.summary);
    expect(allow).toMatchObject({ callback_data: `/ok ${ID}`, style: "success" });
    expect(dont).toEqual({ text: "❌ Don't", callback_data: `/no ${ID}`, style: "danger" });
    for (const button of [allow, dont]) {
      expect(Buffer.byteLength(button?.callback_data ?? "", "utf8")).toBeLessThanOrEqual(64);
      expect(button?.callback_data).not.toContain(ENTRY.code);
    }
  });

  it("names the action on the Allow button, cut whole characters at a time", () => {
    const summary = `Click "${"😀".repeat(40)}" on shop.example.com`;
    const [[allow] = []] = approvalButtons(ID, summary);
    const label = allow?.text ?? "";
    expect(label.startsWith('✅ Allow: Click "😀')).toBe(true);
    expect(Array.from(label.slice("✅ Allow: ".length))).toHaveLength(40);
    expect(label.endsWith("😀…")).toBe(true);
    // No half of a surrogate pair is left behind.
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("approval texts", () => {
  it("keeps every approval key out of the Telegram text, which a quoted reply shows the model", () => {
    const text = telegramApprovalText(ENTRY, 30);
    expect(text).toContain('<b>Muse wants to:</b> Click "Place order" on shop.example.com');
    expect(text).toContain("Tap a button below to allow or stop it.");
    expect(text).toContain("This request expires in 30 minutes.");
    expect(text).not.toContain(ENTRY.code);
    expect(text).not.toContain(ENTRY.id);
    expect(text).not.toMatch(/\/ok|\/no/);
  });

  it("gives the 6-digit code on WhatsApp", () => {
    const text = whatsappApprovalText(ENTRY, 1);
    expect(text).toContain(`Reply /ok ${ENTRY.code} to allow or /no ${ENTRY.code} to stop.`);
    expect(text).toContain("This request expires in 1 minute.");
    expect(text).not.toContain(ENTRY.id);
  });
});

describe("approvalKeyFromArgs", () => {
  it("takes only an entry id on Telegram", () => {
    expect(approvalKeyFromArgs("telegram", ` ${ID} `)).toBe(ID);
    expect(approvalKeyFromArgs("telegram", `${ID} extra`)).toBe(ID);
    expect(approvalKeyFromArgs("telegram", ENTRY.code)).toBeUndefined();
    expect(approvalKeyFromArgs("telegram", "")).toBeUndefined();
    expect(approvalKeyFromArgs("telegram", undefined)).toBeUndefined();
    expect(approvalKeyFromArgs("telegram", ID.toUpperCase())).toBeUndefined();
    expect(approvalKeyFromArgs("telegram", `${ID}0`)).toBeUndefined();
  });

  it("takes only a 6-digit code on WhatsApp", () => {
    expect(approvalKeyFromArgs("whatsapp", ` ${ENTRY.code} `)).toBe(ENTRY.code);
    expect(approvalKeyFromArgs("whatsapp", ID)).toBeUndefined();
    expect(approvalKeyFromArgs("whatsapp", "48291")).toBeUndefined();
    expect(approvalKeyFromArgs("whatsapp", "4829130")).toBeUndefined();
    expect(approvalKeyFromArgs("whatsapp", "")).toBeUndefined();
  });
});

describe("notifyChannels", () => {
  const base: SentinelConfig = {
    owners: { telegram: [], whatsapp: [] },
    notify: {},
    guardModel: "claude-haiku-5-5",
    approvalTtlMinutes: 30,
    mode: "outbound",
  };

  it("lists the chats with a notify target", () => {
    expect(notifyChannels(base)).toEqual([]);
    expect(notifyChannels({ ...base, notify: { whatsapp: "+420123456789" } })).toEqual([
      "whatsapp",
    ]);
    expect(
      notifyChannels({ ...base, notify: { telegram: "123456789", whatsapp: "+420123456789" } }),
    ).toEqual(["telegram", "whatsapp"]);
  });
});
