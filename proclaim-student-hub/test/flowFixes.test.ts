import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftCopy, pickDraft } from "../src/lib/draftCopy.ts";
import { subjectChips } from "../src/lib/homeworkFilter.ts";
import { manualItem } from "../src/lib/manualAdd.ts";
import { awardOnce, homeworkXp, progress, weekLog } from "../src/lib/store.ts";
import type { Homework } from "../src/lib/types.ts";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const hw = (id: string, course: string, done = false): Homework => ({
  id,
  source: "Classroom",
  title: `Task ${id}`,
  course,
  description: "",
  link: "",
  done,
});

describe("homework XP", () => {
  it("is awarded once per homework, however often it's ticked", () => {
    expect(homeworkXp.tick("a")).toBe(true);
    expect(homeworkXp.tick("a")).toBe(false);
    expect(homeworkXp.tick("b")).toBe(true);
    expect(progress.get().xp).toBe(10);
    const hwDone = weekLog
      .all()
      .filter((e) => e.kind === "hw")
      .reduce((n, e) => n + e.n, 0);
    expect(hwDone).toBe(2);
  });

  it("keeps the awarded list bounded", () => {
    let list: string[] = [];
    for (let i = 0; i < 1005; i++) {
      list = awardOnce(list, `id${i}`).awarded;
    }
    expect(list).toHaveLength(1000);
    expect(awardOnce(list, "id1004").fresh).toBe(false);
  });
});

describe("answer copy on this device", () => {
  it("wins over the saved draft when it holds unsaved typing", () => {
    draftCopy.set("h1", "my longer answer");
    expect(pickDraft("my long", draftCopy.get("h1"))).toEqual({
      text: "my longer answer",
      unsaved: true,
    });
  });

  it("is dropped once the real save has the same text", () => {
    draftCopy.set("h1", "done");
    draftCopy.saved("h1", "done");
    expect(draftCopy.get("h1")).toBeNull();
    expect(pickDraft("done", null)).toEqual({ text: "done", unsaved: false });
  });

  it("is kept when newer typing came after the save started", () => {
    draftCopy.set("h1", "abc");
    draftCopy.saved("h1", "ab");
    expect(draftCopy.get("h1")?.text).toBe("abc");
  });
});

describe("subject filter", () => {
  it("falls back to All when the chosen subject has nothing left", () => {
    const list = [hw("1", "Maths"), hw("2", "Science")];
    expect(subjectChips(list, "Spanish")).toEqual({ chips: ["Maths", "Science"], active: "All" });
    expect(subjectChips(list, "Maths").active).toBe("Maths");
  });

  it("keeps the active chip even past the first six", () => {
    const list = ["A", "B", "C", "D", "E", "F", "G"].map((c, i) => hw(String(i), c));
    const { chips, active } = subjectChips(list, "G");
    expect(active).toBe("G");
    expect(chips).toContain("G");
  });
});

describe("Add anything without the AI", () => {
  it("uses the first line as the title and keeps the rest", () => {
    const item = manualItem("homework", "Science: Qs 1-8\nfrom the sheet", "2026-10-15");
    expect(item).toMatchObject({
      kind: "homework",
      title: "Science: Qs 1-8",
      date: "2026-10-15",
      details: "Science: Qs 1-8\nfrom the sheet",
    });
    expect(manualItem("note", "idea", "2026-10-15").date).toBe("");
  });
});
