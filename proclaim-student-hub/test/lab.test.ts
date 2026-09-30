import { describe, expect, it } from "vitest";
import {
  daysUntil,
  isWeak,
  levelFor,
  markAnswer,
  mastery,
  modeBlocked,
  newItem,
  quizOptions,
  review,
  scorePercent,
  sessionPercent,
  TOP_BOX,
  type LabPack,
} from "../src/lab/model.ts";
import { readScan } from "../src/lab/scan.ts";
import { exportJson, importJson } from "../src/lab/store.ts";

const TODAY = "2026-09-28";
const item = (prompt: string, answer: string, extra = {}) =>
  newItem({ prompt, answer, ...extra }, TODAY);

function pack(overrides: Partial<LabPack> = {}): LabPack {
  return {
    id: "p1",
    subject: "Spanish",
    topic: "Holidays",
    docType: "test",
    createdAt: "2026-09-28T10:00:00Z",
    testScore: "14/20",
    insight: "",
    items: [item("la playa", "the beach"), item("el tren", "the train"), item("ir", "to go")],
    steps: [],
    gaps: [],
    labels: [],
    photo: "",
    ...overrides,
  };
}

describe("spaced repetition", () => {
  it("moves up on correct, stays on almost, drops to 0 on wrong", () => {
    const a = review(item("a", "b"), "correct", TODAY);
    expect(a.box).toBe(1);
    expect(a.due).toBe("2026-09-29");
    const b = review({ ...a, box: 3 }, "almost", TODAY);
    expect(b.box).toBe(3);
    expect(b.due).toBe("2026-09-29");
    const c = review({ ...a, box: 4 }, "wrong", TODAY);
    expect(c.box).toBe(0);
    expect(c.due).toBe(TODAY);
    expect(c.wrong).toBe(1);
  });

  it("never goes past the top box", () => {
    expect(review({ ...item("a", "b"), box: TOP_BOX }, "correct", TODAY).box).toBe(TOP_BOX);
  });

  it("measures mastery and weak items", () => {
    expect(mastery([])).toBe(0);
    expect(mastery([{ ...item("a", "b"), box: TOP_BOX }, item("c", "d")])).toBe(50);
    expect(isWeak({ ...item("a", "b"), wrong: 2, box: 1 })).toBe(true);
    expect(isWeak({ ...item("a", "b"), markedWrong: true, box: 0 })).toBe(true);
    expect(isWeak({ ...item("a", "b"), markedWrong: true, box: 3 })).toBe(false);
  });
});

describe("markAnswer", () => {
  it("accepts exact answers ignoring case and punctuation", () => {
    expect(markAnswer("The Beach!", "the beach").verdict).toBe("correct");
    expect(markAnswer("¿Dónde está?", "dónde está").verdict).toBe("correct");
  });

  it("calls missing accents and small slips almost", () => {
    expect(markAnswer("donde esta", "dónde está")).toEqual({
      verdict: "almost",
      note: "Check your accents.",
    });
    expect(markAnswer("photosynthsis", "photosynthesis").verdict).toBe("almost");
  });

  it("accepts any listed alternative", () => {
    expect(markAnswer("to go", "to go / going").verdict).toBe("correct");
    expect(markAnswer("going", "to go; going").verdict).toBe("correct");
  });

  it("marks wrong and empty answers wrong", () => {
    expect(markAnswer("", "x").verdict).toBe("wrong");
    expect(markAnswer("cat", "dog").verdict).toBe("wrong");
  });
});

describe("questions and scores", () => {
  it("builds quiz options that include the answer once", () => {
    const p = pack();
    const opts = quizOptions(p.items[0], p.items);
    expect(opts).toContain("the beach");
    expect(new Set(opts).size).toBe(opts.length);
    expect(opts.length).toBe(3);
    expect(quizOptions(p.items[0], p.items)).toEqual(opts);
  });

  it("reads test scores", () => {
    expect(scorePercent("14/20")).toBe(70);
    expect(scorePercent("Score: 7 / 10")).toBe(70);
    expect(scorePercent("85%")).toBe(85);
    expect(scorePercent("")).toBeNull();
    expect(sessionPercent(["correct", "almost", "wrong", "correct"])).toBe(63);
  });

  it("works out levels and days", () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, span: 50 });
    expect(levelFor(60).level).toBe(2);
    expect(levelFor(200).level).toBe(3);
    expect(daysUntil("2026-10-01", TODAY)).toBe(3);
    expect(daysUntil("2026-09-27", TODAY)).toBe(-1);
  });

  it("only offers modes the pack can play", () => {
    const p = pack();
    expect(modeBlocked("quiz", p)).toBeNull();
    expect(modeBlocked("gap", p)).not.toBeNull();
    expect(modeBlocked("order", p)).not.toBeNull();
    expect(
      modeBlocked("label", {
        ...p,
        labels: [
          { text: "a", x: 1, y: 1 },
          { text: "b", x: 2, y: 2 },
        ],
      }),
    ).not.toBeNull();
    expect(
      modeBlocked("label", {
        ...p,
        photo: "data:x",
        labels: [
          { text: "a", x: 1, y: 1 },
          { text: "b", x: 2, y: 2 },
        ],
      }),
    ).toBeNull();
  });
});

describe("readScan", () => {
  it("cleans up the AI reply", () => {
    const r = readScan(
      {
        subject: "spanish",
        topic: "Verbs",
        docType: "test",
        testScore: "14/20",
        insight: "Use a after ir",
        items: [
          {
            prompt: "voy",
            answer: "I go",
            origin: "photo",
            markedWrong: true,
            studentAnswer: "I went",
          },
          { prompt: "voy", answer: "I go" },
          { prompt: "", answer: "empty" },
          "junk",
          { prompt: "vas", answer: "you go", origin: "ai" },
        ],
        steps: ["a", 2, ""],
        gaps: [{ before: "Yo", answer: "voy", after: "a la playa" }, { answer: "x" }],
        labels: [
          { text: "leaf", x: 20, y: "30" },
          { text: "bad", x: 200, y: 5 },
        ],
      },
      { docType: "auto" },
      TODAY,
    );
    expect(r.subject).toBe("Spanish");
    expect(r.docType).toBe("test");
    expect(r.items.map((i) => i.prompt)).toEqual(["voy", "vas"]);
    expect(r.items[0]).toMatchObject({
      markedWrong: true,
      studentAnswer: "I went",
      origin: "photo",
      box: 0,
    });
    expect(r.items[1].origin).toBe("ai");
    expect(r.steps).toEqual(["a", "2"]);
    expect(r.gaps).toHaveLength(1);
    expect(r.labels).toEqual([{ text: "leaf", x: 20, y: 30 }]);
  });

  it("uses the student's choices over the AI's guesses and survives garbage", () => {
    const r = readScan(
      { subject: "Maths", docType: "notes" },
      { subject: "Science", docType: "diagram" },
      TODAY,
    );
    expect(r.subject).toBe("Science");
    expect(r.docType).toBe("diagram");
    expect(readScan(null, { docType: "auto" }, TODAY)).toMatchObject({
      items: [],
      topic: "Untitled pack",
    });
  });
});

describe("export and import", () => {
  it("round-trips packs and replaces ones with the same id", () => {
    const a = pack();
    const b = pack({ id: "p2", topic: "Food" });
    const changed = { ...a, topic: "Holidays v2" };
    const { packs, added } = importJson(exportJson([changed]), [a, b]);
    expect(added).toBe(1);
    expect(packs.map((p) => p.topic).toSorted()).toEqual(["Food", "Holidays v2"]);
  });

  it("rejects files that aren't exports", () => {
    expect(() => importJson("not json", [])).toThrow();
    expect(() => importJson('{"hello": 1}', [])).toThrow();
    expect(importJson('{"packs": [{"id": 1}]}', []).added).toBe(0);
  });
});
