import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_TTL_MINUTES,
  DEFAULT_GUARD_MODEL,
  normalizeTelegramId,
  normalizeWhatsAppNumber,
  resolveSentinelConfig,
} from "./types.js";

describe("resolveSentinelConfig", () => {
  it("applies every default to a missing config", () => {
    expect(resolveSentinelConfig(undefined)).toEqual({
      owners: { telegram: [], whatsapp: [] },
      notify: {},
      guardModel: DEFAULT_GUARD_MODEL,
      approvalTtlMinutes: DEFAULT_APPROVAL_TTL_MINUTES,
      mode: "outbound",
    });
    expect(DEFAULT_GUARD_MODEL).toBe("claude-haiku-5-5");
    expect(DEFAULT_APPROVAL_TTL_MINUTES).toBe(30);
  });

  it("normalizes owners and defaults notify to the first owner", () => {
    const cfg = resolveSentinelConfig({
      owners: {
        telegram: ["telegram:123456789", " 987 ", "123456789"],
        whatsapp: ["+420 123 456 789"],
      },
    });
    expect(cfg.owners.telegram).toEqual(["123456789", "987"]);
    expect(cfg.owners.whatsapp).toEqual(["+420123456789"]);
    expect(cfg.notify).toEqual({ telegram: "123456789", whatsapp: "+420123456789" });
  });

  it("keeps explicit notify targets, model, ttl and mode", () => {
    const cfg = resolveSentinelConfig({
      owners: { telegram: ["1"] },
      notify: { telegram: "tg:555", whatsapp: "whatsapp:+420 777 000 111" },
      guardModel: " claude-sonnet-5-5 ",
      approvalTtlMinutes: 5,
      mode: "money",
    });
    expect(cfg.notify).toEqual({ telegram: "555", whatsapp: "+420777000111" });
    expect(cfg.guardModel).toBe("claude-sonnet-5-5");
    expect(cfg.approvalTtlMinutes).toBe(5);
    expect(cfg.mode).toBe("money");
  });

  it("falls back to safe values for invalid input", () => {
    const cfg = resolveSentinelConfig({
      owners: "nope",
      guardModel: "",
      approvalTtlMinutes: Number.NaN,
      mode: "yolo",
    });
    expect(cfg.owners).toEqual({ telegram: [], whatsapp: [] });
    expect(cfg.guardModel).toBe(DEFAULT_GUARD_MODEL);
    expect(cfg.approvalTtlMinutes).toBe(30);
    expect(cfg.mode).toBe("outbound");
    expect(resolveSentinelConfig({ approvalTtlMinutes: 0 }).approvalTtlMinutes).toBe(1);
    expect(resolveSentinelConfig({ approvalTtlMinutes: 1e9 }).approvalTtlMinutes).toBe(1440);
  });
});

describe("owner id normalizers", () => {
  it("normalizes Telegram ids", () => {
    expect(normalizeTelegramId("telegram:123")).toBe("123");
    expect(normalizeTelegramId("TG:123")).toBe("123");
    expect(normalizeTelegramId(123)).toBe("123");
    expect(normalizeTelegramId("telegram:group:-100")).toBe("group:-100");
    expect(normalizeTelegramId(undefined)).toBe("");
  });

  it("normalizes WhatsApp numbers to E.164", () => {
    expect(normalizeWhatsAppNumber("whatsapp:+420 123-456 (789)")).toBe("+420123456789");
    expect(normalizeWhatsAppNumber("420123456789")).toBe("+420123456789");
    expect(normalizeWhatsAppNumber("420123456789:12@s.whatsapp.net")).toBe("+420123456789");
    expect(normalizeWhatsAppNumber("12036302@g.us")).toBe("12036302@g.us");
    expect(normalizeWhatsAppNumber(null)).toBe("");
  });
});
