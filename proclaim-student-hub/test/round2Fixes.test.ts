import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progress, todoXp } from "../src/lib/store.ts";
import { callName, joinLabel } from "../src/lib/study.ts";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("to-do XP", () => {
  it("is awarded once per to-do, however often it's ticked", () => {
    const start = progress.get().xp;
    expect(todoXp.tick("t1")).toBe(true);
    expect(todoXp.tick("t1")).toBe(false);
    expect(todoXp.tick("t2")).toBe(true);
    expect(progress.get().xp - start).toBe(4);
  });
});

describe("lesson link label", () => {
  it("names the call by its host", () => {
    expect(joinLabel("https://meet.google.com/abc-defg-hij")).toBe("Join Meet");
    expect(joinLabel("https://us02web.zoom.us/j/123")).toBe("Join Zoom");
    expect(joinLabel("https://teams.microsoft.com/l/meetup-join/x")).toBe("Join Teams");
    expect(joinLabel("https://example.com/call")).toBe("Join call");
  });
  it("is not fooled by a look-alike host", () => {
    expect(callName("https://meet.google.com.evil.example/x")).toBe("the call");
    expect(callName("https://notzoom.us/j/1")).toBe("the call");
  });
});

describe("import cleaning", () => {
  it("drops non-records and keeps tutors safe", async () => {
    const { cleanImported } = await import("../src/lib/transfer.ts");
    expect(cleanImported("psh.todos", [null, 3, "x", [1], { id: "t1" }])).toEqual([
      { id: "t1", text: "", due: "", subject: "", from: "", done: false },
    ]);
    const tutors = cleanImported("psh.tutors", [
      null,
      { name: "No id" },
      { id: "u1", name: "Ana", meet: "https://evil.example/login" },
    ]) as { id: string; meet: string; when: string }[];
    expect(tutors).toHaveLength(1);
    expect(tutors[0].meet).toBe("");
    expect(tutors[0].when).toBe("");
    expect(
      cleanImported("psh.courses", [{ name: "Maths", posts: [null, { title: "a" }] }]),
    ).toEqual([{ name: "Maths", subject: "", posts: [{ title: "a" }] }]);
    expect(cleanImported("psh.theme", "dark")).toBe("dark");
  });
});

describe("to-do XP undo", () => {
  it("takes the XP back once", () => {
    const start = progress.get().xp;
    todoXp.tick("a");
    todoXp.undo("a");
    todoXp.undo("a");
    expect(progress.get().xp).toBe(start);
    expect(todoXp.tick("a")).toBe(true);
  });
});

describe("damaged import values", () => {
  it("drops values of the wrong shape instead of saving them", async () => {
    const { cleanImported } = await import("../src/lib/transfer.ts");
    expect(cleanImported("psh.progress", null)).toBeUndefined();
    expect(cleanImported("psh.progress", "x")).toBeUndefined();
    expect(cleanImported("psh.progress", { xp: 5, streak: 1, lastDay: "" })).toEqual({
      xp: 5,
      streak: 1,
      lastDay: "",
    });
    expect(cleanImported("psh.grades", [null])).toEqual([]);
    expect(cleanImported("psh.lab.packs", [null])).toEqual([]);
    expect(cleanImported("psh.schedule", 7)).toBeUndefined();
  });

  it("reads damaged saved progress as no progress", () => {
    localStorage.setItem("psh.progress", "null");
    expect(progress.get()).toEqual({ xp: 0, streak: 0, lastDay: "" });
    localStorage.setItem("psh.progress", JSON.stringify({ xp: "a", streak: -3 }));
    expect(progress.get()).toEqual({ xp: 0, streak: 0, lastDay: "" });
  });
});

describe("round-6 link checks", () => {
  it("keeps good records next to bad ones and refuses absurd values", async () => {
    const { cleanImported } = await import("../src/lib/transfer.ts");
    expect(cleanImported("psh.progress", { xp: 1e308, streak: 1 })).toBeUndefined();
    expect(cleanImported("psh.progress", { xp: 10, streak: 1e9 })).toBeUndefined();
    const grades = cleanImported("psh.grades", [
      null,
      { id: "g1", subject: "Maths", score: 7, outOf: 10 },
      { id: "g2", score: "x", outOf: 10 },
    ]) as { id: string }[];
    expect(grades.map((g) => g.id)).toEqual(["g1"]);
    const todos = cleanImported("psh.todos", [{ id: "t", text: { a: 1 }, done: "yes" }]) as {
      text: string;
      done: boolean;
    }[];
    expect(todos[0].text).toBe("");
    expect(todos[0].done).toBe(false);
    expect(cleanImported("psh.pack", { pack: 5 })).toBeUndefined();
  });

  it("keeps this morning's save when a link is brought in", async () => {
    const { backups } = await import("../src/lib/backup.ts");
    const map = new Map<string, string>();
    const storage = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    } as Storage;
    storage.setItem("psh.todos", JSON.stringify([{ id: "a" }]));
    backups.beforeLink(storage);
    storage.setItem("psh.todos", JSON.stringify([{ id: "a" }, { id: "bad" }]));
    backups.beforeLink(storage);
    expect(backups.list(storage)).toHaveLength(1);
    expect(backups.get(backups.list(storage)[0].day, storage)?.data["psh.todos"]).toEqual([
      { id: "a" },
    ]);
    expect(backups.undoLink(storage)).toBe(true);
    expect(JSON.parse(storage.getItem("psh.todos") ?? "[]")).toHaveLength(2);
  });
});

describe("round-7 link checks", () => {
  it("knows a real day", async () => {
    const { realDay } = await import("../src/lib/study.ts");
    expect(realDay("2026-10-12")).toBe(true);
    expect(realDay("2026-99-99")).toBe(false);
    expect(realDay("2026-02-30")).toBe(false);
    expect(realDay(5)).toBe(false);
  });
  it("keeps only real marks and packs with a card", async () => {
    const { cleanImported } = await import("../src/lib/transfer.ts");
    const grades = cleanImported("psh.grades", [
      { id: "a", score: 1e300, outOf: 1 },
      { id: "b", score: -50, outOf: 10 },
      { id: "c", score: 7, outOf: 10 },
    ]) as { id: string }[];
    expect(grades.map((g) => g.id)).toEqual(["c"]);
    const packs = cleanImported("psh.lab.packs", [
      { id: "e", items: [] },
      { id: "f", items: [{ prompt: "q", answer: "a" }] },
    ]) as { id: string }[];
    expect(packs.map((p) => p.id)).toEqual(["f"]);
  });
});

describe("typed grades", () => {
  it("refuses marks out of 0 and keeps bonus marks", async () => {
    const { parseScore } = await import("../src/lib/grades.ts");
    expect(parseScore("18/0")).toBeNull();
    expect(parseScore("0/0")).toBeNull();
    expect(parseScore("45/40")).toEqual({ score: 45, outOf: 40 });
    expect(parseScore("18/20")).toEqual({ score: 18, outOf: 20 });
    expect(parseScore("85%")).toEqual({ score: 85, outOf: 100 });
  });
});

describe("recovery after midnight", () => {
  it("offers the save from before a link brought in late yesterday", async () => {
    const { backups } = await import("../src/lib/backup.ts");
    const map = new Map<string, string>();
    const storage = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    } as Storage;
    storage.setItem("psh.todos", JSON.stringify([{ id: "good" }]));
    backups.daily(storage, new Date("2026-10-09T08:00:00"));
    backups.beforeLink(storage, new Date("2026-10-09T23:58:00"));
    storage.setItem("psh.todos", JSON.stringify([{ id: "bad" }]));
    backups.daily(storage, new Date("2026-10-10T00:02:00"));
    expect(backups.lastLink(storage, new Date("2026-10-10T00:03:00"))).toBeNull();
    expect(backups.safeSave(storage)?.day).toBe("2026-10-09");
  });
});

describe("round-10 grade input", () => {
  it("reads 18., .5 and 18,5", async () => {
    const { parseScore } = await import("../src/lib/grades.ts");
    expect(parseScore("18./20")).toEqual({ score: 18, outOf: 20 });
    expect(parseScore(".5/1")).toEqual({ score: 0.5, outOf: 1 });
    expect(parseScore("18,5/20")).toEqual({ score: 18.5, outOf: 20 });
    expect(parseScore("81/40")).toBeNull();
  });
});
