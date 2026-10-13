import { describe, expect, it } from "vitest";
import { joinBold } from "../src/components/Briefing.tsx";
import { courseName } from "../src/lib/subjects.ts";

describe("courseName", () => {
  it("turns school class codes into short names", () => {
    expect(courseName("9I Computer Science 26-27")).toBe("Computer Science");
    expect(courseName("Y9 Math 26/27")).toBe("Maths");
    expect(courseName("Y9 SPANISH-ACU")).toBe("Spanish");
    expect(courseName("Y9i Music")).toBe("Music");
    expect(courseName("Y9 P - Český jazyk a literatura 2026/2027")).toBe("Český jazyk");
  });

  it("leaves plain names alone", () => {
    expect(courseName("English")).toBe("English");
    expect(courseName("  ")).toBe("");
  });
});

describe("joinBold", () => {
  it("merges a run of bold words into one mark", () => {
    const out = joinBold([
      { text: "Hand", bold: false, space: false },
      { text: "Maths", bold: true, space: true },
      { text: "worksheet", bold: true, space: true },
      { text: ".", bold: false, space: false },
    ]);
    expect(out.map((w) => w.text)).toEqual(["Hand", "Maths worksheet", "."]);
  });

  it("keeps bold words apart when no space joins them", () => {
    const out = joinBold([
      { text: "A", bold: true, space: false },
      { text: "B", bold: true, space: false },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("courseName on hostile input", () => {
  it("stays fast and short for a huge course name", () => {
    const start = performance.now();
    const out = courseName(`a${" ".repeat(60000)}x`);
    expect(performance.now() - start).toBeLessThan(50);
    expect(out.length).toBeLessThanOrEqual(80);
  });
});

describe("courseName edge cases (jury r18)", () => {
  it("keeps acronyms and fixes only shouted words", () => {
    expect(courseName("9i PSHEE")).toBe("PSHEE");
    expect(courseName("IGCSE MATHS")).toBe("IGCSE Maths");
    expect(courseName("Y9 ART")).toBe("Art");
  });

  it("turns subject-part codes into words instead of dropping them", () => {
    expect(courseName("Y9 Science-BIO")).toBe("Biology");
    expect(courseName("Y9 Science-CHE")).toBe("Chemistry");
    expect(courseName("Y9 ENGLISH-LIT")).toBe("English Literature");
    expect(courseName("Y9 ENGLISH-LANG")).toBe("English Language");
    expect(courseName("Y9 SPANISH-ACU")).toBe("Spanish");
  });

  it("gives nothing for a blank class", () => {
    expect(courseName("   ")).toBe("");
  });
});

describe("subjectChips groups case-insensitively", () => {
  it("makes one chip for ART and Art", async () => {
    const { subjectChips } = await import("../src/lib/homeworkFilter.ts");
    const hw = (course: string) =>
      ({ id: course, title: "t", course, source: "Classroom", done: false }) as never;
    const { chips, active } = subjectChips([hw("Y9 ART"), hw("Y9 Art")], "art");
    expect(chips).toEqual(["Art"]);
    expect(active).toBe("Art");
  });
});
