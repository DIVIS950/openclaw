import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTransfer,
  collectStore,
  decodeTransfer,
  encodeTransfer,
  mergeValue,
  type Transfer,
} from "../src/lib/transfer.ts";
import type { Homework } from "../src/lib/types.ts";
import { geminiSample, NoKeyError, parseJson, sseTexts, toContents } from "../src/pages/gemini.ts";
import { localDb } from "../src/pages/localDb.ts";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = (text: string, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { candidates: [{ content: { parts: [{ text }] } }] }
        : { error: { message: text } },
    ),
    {
      status,
    },
  );

describe("Gemini stand-in for the AI", () => {
  it("turns chat turns into alternating Gemini turns with the photo on the last one", async () => {
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const c = await toContents(
      [
        { role: "user", content: "rules" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "look" },
      ],
      [photo],
    );
    expect(c.map((x) => x.role)).toEqual(["user", "model", "user"]);
    expect(c[0].parts.map((p) => p.text)).toEqual(["rules", "hi"]);
    expect(c[2].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "AQID" } });
  });

  it("reads streamed chunks and JSON answers", () => {
    const a = sseTexts(
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\ndata: {"cand',
    );
    expect(a.texts).toEqual(["Hel"]);
    expect(a.rest).toBe('data: {"cand');
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here: {"a":[2]} done')).toEqual({ a: [2] });
    expect(() => parseJson("nope")).toThrow();
  });

  it("asks for a key when there is none, and sends the key in a header", async () => {
    await expect(geminiSample(async () => null)("hi")).rejects.toBeInstanceOf(NoKeyError);
    const fetcher = vi.fn(async () => reply("Hola"));
    const out = await geminiSample(async () => "k1", fetcher as unknown as typeof fetch)("hi");
    expect(out.text).toBe("Hola");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("gemini-flash-latest:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k1");
    expect(url).not.toContain("k1");
  });

  it("moves to the next model when one is busy, and explains a used-up limit", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply("busy", 503))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const s = geminiSample(async () => "k", fetcher as unknown as typeof fetch);
    await expect(s.json("q")).resolves.toEqual({ ok: true });
    expect(String(fetcher.mock.calls[1][0])).toContain("gemini-flash-lite-latest");
    const limited = geminiSample(async () => "k", (async () =>
      reply("quota", 429)) as unknown as typeof fetch);
    await expect(limited("q")).rejects.toThrow(/free limit/);
  });
});

describe("phone storage stand-in for the page database", () => {
  it("saves, updates and lists documents in a collection", async () => {
    const list = localDb.doc("data/users/me/state").collection("homework");
    await list.doc("a").set({ title: "A" });
    await list.doc("a").update({ done: true });
    await list.doc("b").collection("x").doc("deep").set({ n: 1 });
    const docs = (await list.get()).docs;
    expect(docs.map((d) => d.id)).toEqual(["a"]);
    expect(docs[0].data()).toEqual({ title: "A", done: true });
  });
});

describe("moving data from the claude.ai link to the web version", () => {
  const hw = (id: string, done = false): Homework => ({
    id,
    source: "Classroom",
    title: `Task ${id}`,
    course: "9A Maths",
    description: "",
    due: "2026-10-01T16:00:00.000Z",
    link: "",
    done,
  });

  it("round-trips through the link and leaves device-only keys behind", async () => {
    storage.setItem("psh.todos", JSON.stringify([{ id: "t1", text: "PE kit" }]));
    storage.setItem("psh.token", JSON.stringify("secret"));
    storage.setItem(
      "psh.lab.packs",
      JSON.stringify([{ id: "p", photo: `data:image/png;base64,${"A".repeat(5000)}` }]),
    );
    const t: Transfer = { v: 1, name: "Jan", homework: [hw("1")], store: collectStore(storage) };
    expect(Object.keys(t.store).toSorted()).toEqual(["psh.lab.packs", "psh.todos"]);
    expect((t.store["psh.lab.packs"] as { photo: string }[])[0].photo).toBe("");
    const code = await encodeTransfer(t);
    expect(code).toMatch(/^[\w-]+$/);
    expect(await decodeTransfer(code)).toEqual(t);
    expect(await decodeTransfer("garbage")).toBeNull();
  });

  it("merges lists by id and keeps the timetable from claude.ai", () => {
    expect(
      mergeValue("psh.todos", [{ id: "a", v: 1 }, { id: "web" }], [{ id: "a", v: 2 }, { id: "b" }]),
    ).toEqual([{ id: "a", v: 2 }, { id: "b" }, { id: "web" }]);
    expect(mergeValue("psh.timetable", { old: 1 }, { new: 1 })).toEqual({ new: 1 });
    expect(mergeValue("psh.lab.settings", { mine: 1 }, { theirs: 1 })).toEqual({ mine: 1 });
    expect(mergeValue("psh.progress", { xp: 50 }, { xp: 20 })).toEqual({ xp: 50 });
  });

  it("adds only new homework and keeps ticks", async () => {
    const list = localDb.doc("data/users/me/state").collection("homework");
    await list.doc("1").set({ title: "Task 1", done: false });
    const added = await applyTransfer(
      {
        v: 1,
        name: "Jan",
        homework: [hw("1", true), hw("2")],
        store: { "psh.token": "x", "psh.notes": [] },
      },
      storage,
      localDb,
    );
    expect(added).toBe(1);
    const docs = (await list.get()).docs;
    expect(docs.map((d) => [d.id, d.data()?.done])).toEqual([
      ["1", true],
      ["2", false],
    ]);
    expect(storage.getItem("psh.token")).toBeNull();
    expect(storage.getItem("psh.name")).toBe("Jan");
  });
});

describe("locked starter data on the public site", () => {
  it("only opens with the right key", async () => {
    const { decryptSeed } = await import("../src/pages/lockedSeed.ts");
    const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const aes = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aes,
        new TextEncoder().encode('{"version":"1"}'),
      ),
    );
    const data = b64(new Uint8Array([...iv, ...sealed]));
    await expect(decryptSeed(b64(keyBytes), data)).resolves.toEqual({ version: "1" });
    const wrong = b64(crypto.getRandomValues(new Uint8Array(32)));
    await expect(decryptSeed(wrong, data)).rejects.toBeDefined();
  });
});
