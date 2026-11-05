import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two devices syncing through a pretend Google Drive: each has its own
// storage; the Drive file is shared.

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
  };
}

let driveFile: string | null = null;
const fakeFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.includes("/drive/v3/files?spaces=appDataFolder")) {
    return json({ files: driveFile === null ? [] : [{ id: "f1" }] });
  }
  if (url.includes("/drive/v3/files/f1?alt=media")) {
    return new Response(driveFile ?? "{}", { status: 200 });
  }
  if (url.includes("/upload/drive/v3/files/f1") && init.method === "PATCH") {
    driveFile = String(init.body);
    return json({ id: "f1" });
  }
  if (url.includes("/upload/drive/v3/files?uploadType=multipart") && init.method === "POST") {
    const form = init.body as FormData;
    driveFile = await (form.get("file") as Blob).text();
    return json({ id: "f1" });
  }
  return new Response("not found", { status: 404 });
});

const HW = "psh.db/data/users/me/state/homework/";
const token = JSON.stringify({ token: "t", expiresAt: Date.now() + 3_600_000 });

function device(seed: Record<string, string>) {
  return {
    local: memoryStorage({ "psh.google.client": "123-abc.apps.googleusercontent.com", ...seed }),
    session: memoryStorage({ "psh.sync.token": token }),
  };
}

async function syncOn(d: ReturnType<typeof device>) {
  vi.stubGlobal("localStorage", d.local);
  vi.stubGlobal("sessionStorage", d.session);
  const { driveSync } = await import("../src/pages/driveSync.ts");
  return driveSync.sync();
}

beforeEach(() => {
  driveFile = null;
  vi.resetModules();
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubGlobal("window", { dispatchEvent: () => true });
});
afterEach(() => vi.unstubAllGlobals());

describe("sync through Google Drive", () => {
  it("phone and iPad end up with the same data, and the AI key never leaves", async () => {
    const phone = device({
      "psh.notes": JSON.stringify([{ id: "n1", title: "Phone note" }]),
      [`${HW}a`]: JSON.stringify({ title: "Essay", done: false }),
      "psh.ai.key": JSON.stringify("sk-secret"),
    });
    const ipad = device({
      "psh.notes": JSON.stringify([{ id: "n2", title: "iPad note" }]),
    });

    expect(await syncOn(phone)).toBe(0);
    expect(driveFile).not.toContain("sk-secret");
    // The iPad gets the phone's homework and note; its own note goes up.
    expect(await syncOn(ipad)).toBe(2);
    expect(JSON.parse(ipad.local.getItem(`${HW}a`) ?? "null")).toEqual({
      title: "Essay",
      done: false,
    });
    // Back on the phone: the iPad's note arrives.
    expect(await syncOn(phone)).toBe(1);
    const notes = JSON.parse(phone.local.getItem("psh.notes") ?? "[]") as { id: string }[];
    expect(notes.map((n) => n.id).toSorted()).toEqual(["n1", "n2"]);
    expect(ipad.local.getItem("psh.ai.key")).toBeNull();

    // Ticked on the iPad: ticked on the phone after the next syncs.
    ipad.local.setItem(`${HW}a`, JSON.stringify({ title: "Essay", done: true }));
    await syncOn(ipad);
    await syncOn(phone);
    expect(JSON.parse(phone.local.getItem(`${HW}a`) ?? "null").done).toBe(true);

    // Nothing new: nothing changes and nothing is uploaded again.
    const before = driveFile;
    const calls = fakeFetch.mock.calls.length;
    expect(await syncOn(phone)).toBe(0);
    expect(driveFile).toBe(before);
    expect(fakeFetch.mock.calls.slice(calls).some((c) => (c[1] as RequestInit)?.method)).toBe(
      false,
    );
  });

  it("asks for a sign-in when Google's hour is up", async () => {
    const d = device({});
    d.session.removeItem("psh.sync.token");
    await expect(syncOn(d)).rejects.toThrow(/Sign in to Google/);
  });
});
