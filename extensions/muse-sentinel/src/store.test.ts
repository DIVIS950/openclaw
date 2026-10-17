import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVED_USE_WINDOW_MS, ApprovalStore, MAX_ENTRIES, resolveStoreDir } from "./store.js";
import type { ActionDescriptor } from "./types.js";

const cryptoMock = vi.hoisted(() => ({ forcedCodes: [] as number[] }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    // Lets a test force code collisions; otherwise the real randomInt.
    randomInt: (min: number, max: number) =>
      cryptoMock.forcedCodes.shift() ?? actual.randomInt(min, max),
  };
});

const SESSION = "agent:main:main";

function action(key: string, extra: Partial<ActionDescriptor> = {}): ActionDescriptor {
  return {
    tool: "browser",
    verb: "click",
    summary: `Click "${key}" on shop.example.com`,
    detail: `Page: https://shop.example.com/\nElement: button "${key}"`,
    url: "https://shop.example.com/",
    semanticKey: `key-${key}`,
    ...extra,
  };
}

describe("ApprovalStore", () => {
  let dir: string;
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "muse-sentinel-")), "muse-sentinel");
    now = Date.UTC(2026, 9, 17, 8, 0, 0);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    cryptoMock.forcedCodes.length = 0;
  });

  it("puts the state under <stateDir>/muse-sentinel", () => {
    expect(resolveStoreDir("/home/node/.openclaw")).toBe("/home/node/.openclaw/muse-sentinel");
  });

  it("creates a pending entry with a 6-digit code and reuses it for the same action", () => {
    const store = new ApprovalStore(dir, clock);
    const first = store.create(action("Place order"), SESSION);
    expect(first.isNew).toBe(true);
    expect(first.entry).toMatchObject({
      status: "pending",
      sessionKey: SESSION,
      tool: "browser",
      semanticKey: "key-Place order",
      summary: 'Click "Place order" on shop.example.com',
      url: "https://shop.example.com/",
      createdAt: now,
      expiresAt: now + 30 * 60_000,
    });
    expect(first.entry.code).toMatch(/^\d{6}$/);

    const again = store.create(action("Place order"), SESSION);
    expect(again.isNew).toBe(false);
    expect(again.entry.id).toBe(first.entry.id);

    const otherSession = store.create(action("Place order"), "agent:main:other");
    expect(otherSession.isNew).toBe(true);
    expect(store.pending()).toHaveLength(2);
  });

  it("keeps codes unique among pending entries", () => {
    cryptoMock.forcedCodes.push(42, 42, 42, 777_777);
    const store = new ApprovalStore(dir, clock);
    const a = store.create(action("a"), SESSION).entry;
    const b = store.create(action("b"), SESSION).entry;
    expect(a.code).toBe("000042");
    expect(b.code).toBe("777777");
  });

  it("keeps codes unique among pending and approved entries", () => {
    cryptoMock.forcedCodes.push(42, 42, 777_777);
    const store = new ApprovalStore(dir, clock);
    const a = store.create(action("a"), SESSION).entry;
    store.decide(a.code, "approve", "x");
    const b = store.create(action("b"), SESSION).entry;
    expect(a.code).toBe("000042");
    expect(b.code).toBe("777777");
  });

  it("never reissues the code of a finished entry, so a stale /ok cannot match a new request", () => {
    cryptoMock.forcedCodes.push(42, 43, 42, 43, 777_777);
    const store = new ApprovalStore(dir, clock);
    const denied = store.create(action("a"), SESSION).entry;
    store.decide(denied.code, "deny", "x");
    const used = store.create(action("b"), SESSION).entry;
    store.decide(used.code, "approve", "x");
    store.consume(used.semanticKey, SESSION);
    const fresh = store.create(action("c"), SESSION).entry;
    expect([denied.code, used.code, fresh.code]).toEqual(["000042", "000043", "777777"]);
    expect(store.decide(denied.code, "approve", "x")).toMatchObject({ ok: false });
    expect(store.get(fresh.id)?.status).toBe("pending");
  });

  it("lets the owner take back an approval until it is used", () => {
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Send"), SESSION);
    store.decide(entry.code, "approve", "telegram");
    now += 60_000;
    expect(store.decide(entry.code, "deny", "telegram")).toMatchObject({
      ok: true,
      entry: { status: "denied", decidedAt: now, decidedVia: "telegram" },
    });
    expect(store.consume("key-Send", SESSION)).toBeUndefined();
    expect(store.recentDenial("key-Send", SESSION)?.id).toBe(entry.id);
    // A denial is final: it cannot be turned into an approval again.
    expect(store.decide(entry.id, "approve", "http")).toMatchObject({ reason: "not_pending" });

    // By id too (HTTP); once used, neither works and the entry says why.
    const other = store.create(action("Other"), SESSION).entry;
    store.decide(other.id, "approve", "http");
    expect(store.decide(other.id, "deny", "http")).toMatchObject({ ok: true });
    const used = store.create(action("Used"), SESSION).entry;
    store.decide(used.code, "approve", "telegram");
    store.consume("key-Used", SESSION);
    expect(store.decide(used.code, "deny", "telegram")).toMatchObject({
      ok: false,
      reason: "not_pending",
      entry: { status: "used" },
    });
    expect(store.decide(used.id, "deny", "http")).toMatchObject({ reason: "not_pending" });
  });

  it("counts a chat decision only from a chat the request was sent to", () => {
    const store = new ApprovalStore(dir, clock);
    const telegramOnly = store.create(action("Send"), SESSION, ["telegram"]).entry;
    expect(telegramOnly.notifiedVia).toEqual(["telegram"]);
    expect(store.decide(telegramOnly.code, "approve", "whatsapp", { channel: "whatsapp" })).toEqual(
      { ok: false, reason: "not_found" },
    );
    expect(store.get(telegramOnly.id)?.status).toBe("pending");
    expect(
      store.decide(telegramOnly.id, "approve", "telegram", { channel: "telegram" }),
    ).toMatchObject({ ok: true, entry: { status: "approved", decidedVia: "telegram" } });

    const both = store.create(action("Both"), SESSION, ["telegram", "whatsapp"]).entry;
    expect(store.decide(both.code, "deny", "whatsapp", { channel: "whatsapp" })).toMatchObject({
      ok: true,
      entry: { status: "denied" },
    });

    // An entry from an older state file names no chat: only the HTTP API can decide it.
    const legacy = store.create(action("Legacy"), SESSION).entry;
    const file = path.join(dir, "state.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    for (const entry of saved.entries) {
      delete entry.notifiedVia;
    }
    fs.writeFileSync(file, JSON.stringify(saved));
    const reloaded = new ApprovalStore(dir, clock);
    expect(reloaded.decide(legacy.id, "approve", "telegram", { channel: "telegram" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(reloaded.decide(legacy.id, "approve", "web").ok).toBe(true);
  });

  it("drops entries whose chat list is not valid when loading", () => {
    fs.mkdirSync(dir, { recursive: true });
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Send"), SESSION, ["whatsapp"]);
    const file = path.join(dir, "state.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...saved,
        entries: saved.entries.map((e) => ({ ...e, notifiedVia: ["sms"] })),
      }),
    );
    expect(new ApprovalStore(dir, clock).get(entry.id)).toBeUndefined();
  });

  it("approves by code, and the approval is used exactly once", () => {
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Send"), SESSION);
    now += 60_000;
    const decided = store.decide(entry.code, "approve", "telegram:123");
    expect(decided).toMatchObject({
      ok: true,
      entry: { status: "approved", decidedAt: now, decidedVia: "telegram:123" },
    });
    expect(decided.ok && decided.entry.expiresAt).toBe(now + APPROVED_USE_WINDOW_MS);

    expect(store.consume("key-Send", "agent:main:other")).toBeUndefined();
    expect(store.consume("key-other", SESSION)).toBeUndefined();
    expect(store.consume("key-Send", SESSION)?.status).toBe("used");
    expect(store.consume("key-Send", SESSION)).toBeUndefined();
    expect(store.get(entry.id)?.status).toBe("used");
  });

  it("rejects unknown codes and decisions on finished entries", () => {
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Send"), SESSION);
    expect(store.decide("000000", "approve", "x")).toEqual({ ok: false, reason: "not_found" });
    expect(store.decide(entry.id, "deny", "http").ok).toBe(true);
    expect(store.decide(entry.id, "approve", "http")).toMatchObject({
      ok: false,
      reason: "not_pending",
      entry: { status: "denied" },
    });
    // The code only works while the request is pending.
    expect(store.decide(entry.code, "approve", "x")).toEqual({ ok: false, reason: "not_found" });
  });

  it("expires unused approvals after 10 minutes", () => {
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Send"), SESSION);
    store.decide(entry.id, "approve", "http");
    now += APPROVED_USE_WINDOW_MS;
    expect(store.consume("key-Send", SESSION)).toBeUndefined();
    expect(store.get(entry.id)?.status).toBe("expired");
  });

  it("expires pending requests after the time limit", () => {
    const store = new ApprovalStore(dir, clock, { ttlMinutes: 5 });
    const { entry } = store.create(action("Send"), SESSION);
    now += 5 * 60_000 - 1;
    expect(store.pending()).toHaveLength(1);
    now += 1;
    expect(store.pending()).toHaveLength(0);
    expect(store.get(entry.id)?.status).toBe("expired");
    expect(store.decide(entry.id, "approve", "http")).toMatchObject({ reason: "not_pending" });
    expect(store.decide(entry.code, "approve", "x")).toEqual({ ok: false, reason: "not_found" });
    // A new attempt opens a fresh request.
    expect(store.create(action("Send"), SESSION).isNew).toBe(true);
  });

  it("remembers denials for the time limit", () => {
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Delete"), SESSION);
    store.decide(entry.code, "deny", "whatsapp:+420123456789");
    expect(store.recentDenial("key-Delete", SESSION)?.id).toBe(entry.id);
    expect(store.recentDenial("key-Delete", "agent:main:other")).toBeUndefined();
    expect(store.consume("key-Delete", SESSION)).toBeUndefined();
    now += 30 * 60_000 + 1;
    expect(store.recentDenial("key-Delete", SESSION)).toBeUndefined();
  });

  it("lists pending oldest first and recent decisions newest first", () => {
    const store = new ApprovalStore(dir, clock);
    const a = store.create(action("a"), SESSION).entry;
    now += 1000;
    const b = store.create(action("b"), SESSION).entry;
    now += 1000;
    const c = store.create(action("c"), SESSION).entry;
    expect(store.pending().map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    store.decide(a.id, "deny", "http");
    now += 1000;
    store.decide(b.id, "approve", "http");
    expect(store.recent().map((e) => e.id)).toEqual([b.id, a.id]);
    expect(store.recent(1).map((e) => e.id)).toEqual([b.id]);
  });

  it("persists entries and the paused flag atomically with mode 0600", () => {
    const store = new ApprovalStore(dir, clock);
    const { entry } = store.create(action("Send"), SESSION);
    store.setPaused(true);
    const file = path.join(dir, "state.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);

    const reloaded = new ApprovalStore(dir, clock);
    expect(reloaded.paused).toBe(true);
    expect(reloaded.pending().map((e) => e.id)).toEqual([entry.id]);
    expect(reloaded.decide(entry.code, "approve", "telegram:1").ok).toBe(true);

    const third = new ApprovalStore(dir, clock);
    expect(third.consume("key-Send", SESSION)?.id).toBe(entry.id);
    third.setPaused(false);
    expect(new ApprovalStore(dir, clock).paused).toBe(false);
    expect(new ApprovalStore(dir, clock).consume("key-Send", SESSION)).toBeUndefined();
  });

  it("starts empty from a corrupt file and keeps the file aside", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "state.json"), "{not json");
    const store = new ApprovalStore(dir, clock);
    expect(store.pending()).toEqual([]);
    expect(store.paused).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("state.json.corrupt-"))).toBe(true);
  });

  it("drops invalid entries when loading", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ version: 1, paused: false, entries: [{ id: "x" }, null] }),
    );
    expect(new ApprovalStore(dir, clock).recent()).toEqual([]);
  });

  it(`keeps at most ${MAX_ENTRIES} entries, dropping the oldest finished ones`, () => {
    const store = new ApprovalStore(dir, clock);
    const first = store.create(action("first"), SESSION).entry;
    const ids: string[] = [];
    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      const { entry } = store.create(action(`a${i}`), SESSION);
      store.decide(entry.id, "deny", "http");
      ids.push(entry.id);
    }
    const last = store.create(action("last"), SESSION).entry;
    expect([...store.pending(), ...store.recent(1000)]).toHaveLength(MAX_ENTRIES);
    expect(store.get(first.id)?.status).toBe("pending");
    expect(store.get(last.id)?.status).toBe("pending");
    expect(store.get(ids[11] ?? "")).toBeUndefined();
    expect(store.get(ids[12] ?? "")?.status).toBe("denied");
  });
});
