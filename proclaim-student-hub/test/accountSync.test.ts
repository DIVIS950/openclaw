import { describe, expect, it } from "vitest";
import { AccountSync, cutText, NoAccountError, readRemote } from "../src/lib/accountSync.ts";
import type { CollectionRef, Db, DocRef, DocSnapshot } from "../src/lib/claudeRuntime.ts";

// Two devices syncing through a pretend account database: each has its own
// storage; the database is shared.

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage & { map: Map<string, string> };
}

/** An in-memory database with the doc/collection shape the app uses. */
function memoryDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const snap = (path: string): DocSnapshot => ({
    id: path.slice(path.lastIndexOf("/") + 1),
    exists: docs.has(path),
    data: () => docs.get(path),
  });
  const docRef = (path: string): DocRef => ({
    id: path.slice(path.lastIndexOf("/") + 1),
    get: async () => snap(path),
    set: async (data) => {
      // Like the real store: a document's body must be small.
      expect(JSON.stringify(data).length).toBeLessThan(256 * 1024);
      docs.set(path, structuredClone(data));
    },
    update: async (data) => void docs.set(path, { ...docs.get(path), ...data }),
    delete: async () => void docs.delete(path),
    collection: (sub) => collectionRef(`${path}/${sub}`),
  });
  const collectionRef = (path: string): CollectionRef => ({
    doc: (id) => docRef(`${path}/${id ?? Math.random().toString(36).slice(2)}`),
    get: async () => ({
      docs: [...docs.keys()]
        .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes("/"))
        .toSorted()
        .map(snap),
    }),
  });
  const db: Db = { doc: docRef };
  return { db, docs };
}

function device(shared: ReturnType<typeof memoryDb>, seed: Record<string, unknown>) {
  const storage = memoryStorage(
    Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)])),
  );
  const sync = new AccountSync(
    async () => shared.db.doc("data/users/u1/state").collection("sync"),
    () => storage,
  );
  const read = (key: string) => JSON.parse(storage.getItem(key) ?? "null") as unknown;
  return { storage, sync, read };
}

const SYNC = "data/users/u1/state/sync/";

describe("sync through the Claude account", () => {
  it("phone and iPad end up with the same notes, to-dos and levels; keys never travel", async () => {
    const shared = memoryDb();
    const phone = device(shared, {
      "psh.notes": [{ id: "n1", title: "Phone note" }],
      "psh.todos": [{ id: "t1", text: "Buy a ruler" }],
      "psh.ai.key": "sk-secret",
    });
    const ipad = device(shared, {
      "psh.notes": [{ id: "n2", title: "iPad note" }],
      "psh.progress": { xp: 120 },
    });

    expect(await phone.sync.sync()).toBe(0);
    const stored = JSON.stringify([...shared.docs.values()]);
    expect(stored).not.toContain("sk-secret");
    expect(stored).toContain("Phone note");

    // The iPad gets the phone's to-do and note; its own note and XP go up.
    expect(await ipad.sync.sync()).toBe(2);
    expect(ipad.read("psh.notes")).toEqual([
      { id: "n2", title: "iPad note" },
      { id: "n1", title: "Phone note" },
    ]);
    expect(ipad.read("psh.todos")).toEqual([{ id: "t1", text: "Buy a ruler" }]);

    // Back on the phone: the iPad's note and XP arrive.
    expect(await phone.sync.sync()).toBe(2);
    expect(phone.read("psh.notes")).toHaveLength(2);
    expect(phone.read("psh.progress")).toEqual({ xp: 120 });
    expect(phone.storage.getItem("psh.ai.key")).toBe(JSON.stringify("sk-secret"));

    // Nothing new on either side: nothing changes, nothing is written.
    const before = JSON.stringify([...shared.docs.entries()]);
    expect(await ipad.sync.sync()).toBe(0);
    expect(await phone.sync.sync()).toBe(0);
    expect(JSON.stringify([...shared.docs.entries()])).toBe(before);
  });

  it("a to-do deleted on one device goes from the other too", async () => {
    const shared = memoryDb();
    const phone = device(shared, { "psh.todos": [{ id: "t1", text: "Ruler" }] });
    const ipad = device(shared, {});
    await phone.sync.sync();
    await ipad.sync.sync();
    expect(ipad.read("psh.todos")).toEqual([{ id: "t1", text: "Ruler" }]);

    phone.storage.removeItem("psh.todos");
    await phone.sync.sync();
    expect(await ipad.sync.sync()).toBe(1);
    expect(ipad.storage.getItem("psh.todos")).toBeNull();
  });

  it("big revision packs with photos are cut into parts and come back whole", async () => {
    const shared = memoryDb();
    const photo = `data:image/jpeg;base64,${"A".repeat(400_000)}`;
    const packs = [{ id: "p1", topic: "Čeština – vyjmenovaná slova 🦊", photo }];
    const phone = device(shared, { "psh.lab.packs": packs });
    const ipad = device(shared, {});
    await phone.sync.sync();
    const parts = [...shared.docs.keys()].filter((k) => k.startsWith(`${SYNC}p-`));
    expect(parts.length).toBeGreaterThan(5);
    expect(await ipad.sync.sync()).toBe(1);
    expect(ipad.read("psh.lab.packs")).toEqual(packs);
  });

  it("old parts are cleared after a newer copy is written", async () => {
    const shared = memoryDb();
    const phone = device(shared, { "psh.notes": [{ id: "n1", title: "One" }] });
    await phone.sync.sync();
    // Pretend that copy was written a while ago.
    for (const [k, v] of shared.docs) {
      if (k.startsWith(`${SYNC}p-`)) {
        shared.docs.set(k, { ...v, at: "2026-01-01T00:00:00.000Z" });
      }
    }
    phone.storage.setItem("psh.notes", JSON.stringify([{ id: "n1", title: "Two" }]));
    await phone.sync.sync();
    const parts = [...shared.docs.values()].filter((d) => typeof d.text === "string");
    expect(new Set(parts.map((d) => d.ver)).size).toBe(1);
    expect(JSON.stringify(parts)).toContain("Two");
  });

  it("a copy with missing parts never deletes anything here", async () => {
    const shared = memoryDb();
    const phone = device(shared, { "psh.notes": [{ id: "n1", title: "Keep me" }] });
    await phone.sync.sync();
    // Two devices wrote at once and a part went missing.
    for (const k of shared.docs.keys()) {
      if (k.startsWith(`${SYNC}p-`)) {
        shared.docs.delete(k);
      }
    }
    expect(await phone.sync.sync()).toBe(0);
    expect(phone.read("psh.notes")).toEqual([{ id: "n1", title: "Keep me" }]);
    // The phone's copy went back up whole.
    const ipad = device(shared, {});
    expect(await ipad.sync.sync()).toBe(1);
    expect(ipad.read("psh.notes")).toEqual([{ id: "n1", title: "Keep me" }]);
  });

  it("an emptied copy is filled again instead of wiping the device", async () => {
    const shared = memoryDb();
    const phone = device(shared, { "psh.todos": [{ id: "t1", text: "Ruler" }] });
    await phone.sync.sync();
    shared.docs.clear();
    expect(await phone.sync.sync()).toBe(0);
    expect(phone.read("psh.todos")).toEqual([{ id: "t1", text: "Ruler" }]);
    expect(JSON.stringify([...shared.docs.values()])).toContain("Ruler");
  });

  it("two devices saving at the same moment keep both changes", async () => {
    const shared = memoryDb();
    const phone = device(shared, { "psh.notes": [{ id: "n1", title: "Phone note" }] });
    const ipad = device(shared, { "psh.todos": [{ id: "t1", text: "iPad to-do" }] });
    await phone.sync.sync();
    // The iPad saves its copy just as the phone is about to save its own.
    const list = shared.db.doc("data/users/u1/state").collection("sync");
    let raced = false;
    const racing = new AccountSync(
      async () => ({
        ...list,
        get: list.get,
        doc: (id?: string) => {
          const ref = list.doc(id);
          if (id !== "head") {
            return ref;
          }
          return {
            ...ref,
            get: async () => {
              if (!raced) {
                raced = true;
                await ipad.sync.sync();
              }
              return ref.get();
            },
          };
        },
      }),
      () => phone.storage,
    );
    phone.storage.setItem("psh.notes", JSON.stringify([{ id: "n1", title: "Phone note, edited" }]));
    await racing.sync();
    expect(raced).toBe(true);
    // Both changes are in the account; the phone has the iPad's to-do too.
    const fresh = device(shared, {});
    await fresh.sync.sync();
    expect(fresh.read("psh.notes")).toEqual([{ id: "n1", title: "Phone note, edited" }]);
    expect(fresh.read("psh.todos")).toEqual([{ id: "t1", text: "iPad to-do" }]);
    expect(phone.read("psh.todos")).toEqual([{ id: "t1", text: "iPad to-do" }]);
  });

  it("says so when there's no account to sync with", async () => {
    const storage = memoryStorage();
    const sync = new AccountSync(
      async () => null,
      () => storage,
    );
    await expect(sync.sync()).rejects.toBeInstanceOf(NoAccountError);
  });
});

describe("cutting the copy into parts", () => {
  it("never splits an emoji in two", () => {
    const text = `${"a".repeat(9)}🦊${"b".repeat(9)}`;
    const parts = cutText(text, 10);
    expect(parts.join("")).toBe(text);
    for (const p of parts) {
      // No half emoji at either end of a part.
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p)).toBe(false);
    }
  });

  it("reads the head's copy, or the newest whole one when the head's is incomplete", () => {
    const doc = (id: string, data: Record<string, unknown>): DocSnapshot => ({
      id,
      exists: true,
      data: () => data,
    });
    const file = (n: number) => JSON.stringify({ v: 1, data: { "psh.todos": [n] } });
    const docs = [
      doc("head", { ver: "new", n: 2, at: "2026-10-19T10:00:00Z" }),
      doc("p-new-0", { ver: "new", i: 0, n: 2, at: "2026-10-19T10:00:00Z", text: "{" }),
      doc("p-old-0", { ver: "old", i: 0, n: 1, at: "2026-10-19T09:00:00Z", text: file(1) }),
    ];
    expect(readRemote(docs)).toEqual({ kind: "ok", data: { "psh.todos": [1] } });
    expect(readRemote([])).toEqual({ kind: "empty" });
    expect(readRemote(docs.slice(0, 2))).toEqual({ kind: "broken" });
  });
});
