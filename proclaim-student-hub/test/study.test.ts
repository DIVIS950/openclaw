import { describe, expect, it } from "vitest";
import { newItem, type LabPack } from "../src/lab/model.ts";
import type { Course } from "../src/lib/store.ts";
import {
  dateInTitle,
  groupTodos,
  labSubject,
  packToNote,
  prepPlan,
  safeLink,
  sameTopic,
  suggestTests,
  whatsappLink,
  type Todo,
} from "../src/lib/study.ts";
import { readMaterialReply } from "../src/lib/studyAi.ts";
import type { Homework } from "../src/lib/types.ts";

const TODAY = "2026-09-28";

describe("prepPlan", () => {
  it("plans every day from today to the test", () => {
    const plan = prepPlan({ date: "2026-10-06", start: TODAY, packId: "" }, TODAY);
    expect(plan).toHaveLength(9);
    expect(plan[0]).toMatchObject({ date: TODAY, action: "material", left: 8 });
    expect(plan[1].action).toBe("learn");
    expect(plan.at(-2)).toMatchObject({ date: "2026-10-05", action: "mock", left: 1 });
    expect(plan.at(-1)).toMatchObject({ date: "2026-10-06", action: "weak", left: 0 });
  });

  it("skips getting material when there's already a pack, and handles short notice", () => {
    expect(
      prepPlan({ date: "2026-09-30", start: TODAY, packId: "p1" }, TODAY).map((d) => d.action),
    ).toEqual(["learn", "mock", "weak"]);
    expect(
      prepPlan({ date: TODAY, start: TODAY, packId: "p1" }, TODAY).map((d) => d.action),
    ).toEqual(["weak"]);
    expect(prepPlan({ date: "2026-09-27", start: TODAY, packId: "" }, TODAY)).toEqual([]);
  });

  it("keeps days already started so ticks stay in place", () => {
    const plan = prepPlan({ date: "2026-10-01", start: "2026-09-26", packId: "p" }, TODAY);
    expect(plan[0].date).toBe("2026-09-26");
  });
});

describe("to-dos", () => {
  it("groups by when they're due", () => {
    const t = (id: string, due: string, done = false): Todo => ({
      id,
      text: id,
      due,
      done,
      subject: "",
      from: "",
    });
    const g = groupTodos(
      [t("a", "2026-09-27"), t("b", TODAY), t("c", "2026-10-02"), t("d", ""), t("e", TODAY, true)],
      TODAY,
    );
    expect(g.overdue.map((x) => x.id)).toEqual(["a"]);
    expect(g.today.map((x) => x.id)).toEqual(["b"]);
    expect(g.later.map((x) => x.id)).toEqual(["c"]);
    expect(g.someday.map((x) => x.id)).toEqual(["d"]);
    expect(g.done.map((x) => x.id)).toEqual(["e"]);
  });
});

describe("spotting tests", () => {
  it("reads Czech and US dates from titles", () => {
    expect(dateInTitle("PŘÍPRAVA K TESTU 6. 10.", TODAY)).toBe("2026-10-06");
    expect(dateInTitle("HW due Thursday 10/1", TODAY)).toBe("2026-10-01");
    expect(dateInTitle("No date", TODAY)).toBe("");
  });

  it("suggests tests from homework and class posts, once", () => {
    const homework = [
      { title: "Spanish vocab test", course: "Y9 Spanish", done: false } as Homework,
      { title: "Essay", course: "English", done: false } as Homework,
    ];
    const courses: Course[] = [
      {
        name: "Y8X Český jazyk",
        subject: "Czech",
        posts: [
          { kind: "material", title: "PŘÍPRAVA K TESTU 6. 10.", date: "2026-09-24", text: "" },
          { kind: "assignment", title: "Old test", date: "2026-06-01", text: "" },
          { kind: "assignment", title: "Spanish vocab test", date: "2026-09-25", text: "" },
        ],
      },
    ];
    const s = suggestTests({ homework, courses, existing: [] }, TODAY);
    expect(s.map((x) => [x.subject, x.topic, x.date])).toEqual([
      ["Y9 Spanish", "Spanish vocab test", ""],
      ["Czech", "PŘÍPRAVA K TESTU 6. 10.", "2026-10-06"],
    ]);
    expect(
      suggestTests(
        { homework, courses: [], existing: [{ topic: "Spanish vocab test" } as never] },
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe("sameTopic", () => {
  it("treats differently worded titles of one test as the same", () => {
    expect(
      sameTopic(
        "Spanish U2.4a vocabulary test: ¿Qué comes hoy?",
        "Y9 U2.4a Vocabulary TEST: ¿Qué comes hoy?",
      ),
    ).toBe(true);
    expect(sameTopic("Y9 M2.4b Vocab TEST: Mi barrio", "Y9 2.4c Vocab TEST: Los deportes")).toBe(
      false,
    );
  });
});

describe("links and subjects", () => {
  it("builds WhatsApp links and only allows https links", () => {
    expect(whatsappLink("+420 777 123 456")).toBe("https://wa.me/420777123456");
    expect(whatsappLink("12")).toBe("");
    expect(safeLink(" https://meet.google.com/abc-defg-hij ")).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(safeLink("javascript:alert(1)")).toBe("");
  });

  it("maps class subjects to Revision Lab subjects", () => {
    expect(labSubject("Y8 Český dějepis")).toBe("History");
    expect(labSubject("Czech Geography")).toBe("Geography");
    expect(labSubject("Y8X Český jazyk a literatura")).toBe("Czech");
    expect(labSubject("9I Computer Science 26-27")).toBe("Computer Science");
    expect(labSubject("Y9 Spanish")).toBe("Spanish");
    expect(labSubject("Tutoring")).toBe("Other");
  });
});

describe("notes from packs and material", () => {
  it("writes a pack out as a vocab list note", () => {
    const pack: LabPack = {
      id: "p1",
      subject: "Spanish",
      topic: "En casa",
      docType: "notes",
      createdAt: "",
      testScore: "",
      insight: "Use hacer for chores",
      items: [newItem({ prompt: "barrer", answer: "to sweep" }, TODAY)],
      steps: [],
      gaps: [],
      labels: [],
      photo: "",
    };
    const note = packToNote(pack);
    expect(note).toMatchObject({ title: "En casa", subject: "Spanish", packId: "p1" });
    expect(note.body).toContain("Vocab / key terms");
    expect(note.body).toContain("• barrer — to sweep");
    expect(packToNote(pack, note).id).toBe(note.id);
  });

  it("reads the AI's reply for a material photo safely", () => {
    expect(
      readMaterialReply({ title: "Kahoot words", subject: "Spanish", text: "• la casa — house" }),
    ).toEqual({
      title: "Kahoot words",
      subject: "Spanish",
      text: "• la casa — house",
    });
    expect(readMaterialReply(null)).toEqual({ title: "Notes", subject: "", text: "" });
  });
});
