import { describe, expect, it } from "vitest";
import type { Homework } from "../src/lib/types.ts";
import { dueNext } from "../src/screens/Today.tsx";

const hw = (title: string, due?: string): Homework => ({
  id: title,
  source: "Classroom",
  title,
  course: "",
  description: "",
  due,
  link: "",
  done: false,
});

describe("dueNext", () => {
  it("puts dated work first and orders undated work by title on every device", () => {
    const a = [hw("Zebra"), hw("Apple"), hw("Maths", "2026-10-13T14:00:00.000Z"), hw("Kite")];
    const b = [hw("Kite"), hw("Maths", "2026-10-13T14:00:00.000Z"), hw("Zebra"), hw("Apple")];
    const titles = (l: Homework[]) => dueNext(l).map((h) => h.title);
    expect(titles(a)).toEqual(["Maths", "Apple", "Kite"]);
    expect(titles(b)).toEqual(titles(a));
  });
});
