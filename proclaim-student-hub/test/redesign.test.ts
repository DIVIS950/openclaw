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
