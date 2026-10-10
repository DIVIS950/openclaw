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
    expect(cleanImported("psh.todos", [null, 3, "x", [1], { id: "t1" }])).toEqual([{ id: "t1" }]);
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
    expect(cleanImported("psh.grades", [null])).toBeUndefined();
    expect(cleanImported("psh.lab.packs", [null])).toBeUndefined();
    expect(cleanImported("psh.schedule", 7)).toBeUndefined();
  });

  it("reads damaged saved progress as no progress", () => {
    localStorage.setItem("psh.progress", "null");
    expect(progress.get()).toEqual({ xp: 0, streak: 0, lastDay: "" });
    localStorage.setItem("psh.progress", JSON.stringify({ xp: "a", streak: -3 }));
    expect(progress.get()).toEqual({ xp: 0, streak: 0, lastDay: "" });
  });
});
