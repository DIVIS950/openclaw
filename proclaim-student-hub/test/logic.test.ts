import { describe, expect, it } from "vitest";
import { isAllowed } from "../server/auth.ts";
import { normalizePack, SAMPLE_PACK, type RevisionPack } from "../shared/pack.ts";
import { dueLabel, isUrgent } from "../src/lib/format.ts";
import { classroomDue } from "../src/lib/googleData.ts";
import { encodeReply, parseAddress, replySubject } from "../src/lib/mail.ts";
import { nextProgress } from "../src/lib/store.ts";

function decode(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

describe("normalizePack", () => {
  const messy: RevisionPack = {
    ...SAMPLE_PACK,
    topic: "  ",
    quiz: [
      { question: "Q1", options: ["a", "b"], answer: 5, explanation: "" },
      { question: "Q2", options: ["a", " ", "b"], answer: 1, explanation: "" },
    ],
    match: [
      { term: "A", meaning: "x" },
      { term: "a", meaning: "dup" },
      { term: "B", meaning: "y" },
      { term: "C", meaning: "z" },
      { term: "D", meaning: "w" },
      { term: "E", meaning: "v" },
    ],
    gaps: [
      { before: "x", answer: "cat", after: "", options: ["dog", "cow"] },
      { before: "x", answer: "sun", after: "", options: ["a", "b", "c", "d", "e"] },
    ],
  };
  const out = normalizePack(messy);

  it("drops quiz questions whose answer index is out of range", () => {
    expect(out.quiz.map((q) => q.question)).toEqual(["Q2"]);
    expect(out.quiz[0].options).toEqual(["a", "b"]);
  });

  it("dedupes match terms and keeps four", () => {
    expect(out.match.map((m) => m.term)).toEqual(["A", "B", "C", "D"]);
  });

  it("makes sure each gap offers its answer", () => {
    expect(out.gaps[0].options).toContain("cat");
    // Answer appended as a 6th option would be cut to 4, so that item is dropped.
    expect(out.gaps).toHaveLength(1);
  });

  it("falls back to a topic name", () => {
    expect(out.topic).toBe("Your notes");
  });

  it("leaves the sample pack playable", () => {
    const sample = normalizePack(SAMPLE_PACK);
    expect(sample.match).toHaveLength(4);
    expect(sample.gaps).toHaveLength(3);
  });
});

describe("streaks", () => {
  it("adds XP on the same day without changing the streak", () => {
    expect(nextProgress({ xp: 10, streak: 3, lastDay: "2026-09-28" }, 5, "2026-09-28")).toEqual({
      xp: 15,
      streak: 3,
      lastDay: "2026-09-28",
    });
  });
  it("continues the streak the next day", () => {
    expect(nextProgress({ xp: 0, streak: 3, lastDay: "2026-09-27" }, 5, "2026-09-28").streak).toBe(
      4,
    );
  });
  it("restarts after a missed day", () => {
    expect(nextProgress({ xp: 0, streak: 9, lastDay: "2026-09-20" }, 5, "2026-09-28").streak).toBe(
      1,
    );
  });
  it("handles month boundaries", () => {
    expect(nextProgress({ xp: 0, streak: 1, lastDay: "2026-09-30" }, 1, "2026-10-01").streak).toBe(
      2,
    );
  });
});

describe("email replies", () => {
  it("parses display names", () => {
    expect(parseAddress('"Mr Smith" <smith@school.org>')).toEqual({
      name: "Mr Smith",
      email: "smith@school.org",
    });
    expect(parseAddress("smith@school.org")).toEqual({
      name: "smith@school.org",
      email: "smith@school.org",
    });
  });

  it("does not stack Re: prefixes", () => {
    expect(replySubject("Re: Trip")).toBe("Re: Trip");
    expect(replySubject("Trip")).toBe("Re: Trip");
  });

  it("builds a threaded UTF-8 reply and blocks header injection", () => {
    const raw = decode(
      encodeReply({
        from: "me@school.org",
        to: "tutor@school.org\r\nBcc: evil@x.com",
        subject: "Café trip",
        body: "Thanks — I'll bring it",
        inReplyTo: "<abc@mail>",
      }),
    );
    expect(raw).toContain("In-Reply-To: <abc@mail>");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).not.toMatch(/\r\nBcc:/);
    const body = raw.split("\r\n\r\n")[1];
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Thanks — I'll bring it");
  });
});

describe("dates", () => {
  const now = new Date(2026, 8, 28, 9, 0); // Mon 28 Sep 2026, local time

  it("labels due dates", () => {
    expect(dueLabel(undefined, now)).toBe("No due date");
    expect(dueLabel(new Date(2026, 8, 27, 12).toISOString(), now)).toBe("Overdue");
    expect(dueLabel(new Date(2026, 8, 28, 23).toISOString(), now)).toBe("Today");
    expect(dueLabel(new Date(2026, 8, 29, 8).toISOString(), now)).toBe("Tomorrow");
    expect(isUrgent(new Date(2026, 8, 29, 8).toISOString(), now)).toBe(true);
    expect(isUrgent(new Date(2026, 9, 2).toISOString(), now)).toBe(false);
  });

  it("reads Classroom's UTC due dates", () => {
    expect(classroomDue({ year: 2026, month: 10, day: 2 }, { hours: 15, minutes: 30 })).toBe(
      "2026-10-02T15:30:00.000Z",
    );
    expect(classroomDue({ year: 2026, month: 10, day: 2 })).toBe("2026-10-02T23:59:00.000Z");
    expect(classroomDue(undefined)).toBeUndefined();
  });
});

describe("AI allow-list", () => {
  it("allows everyone when empty", () => {
    expect(isAllowed("a@b.com", [])).toBe(true);
  });
  it("matches whole emails and domains", () => {
    expect(isAllowed("Kid@School.org", ["@school.org"])).toBe(true);
    expect(isAllowed("kid@evilschool.org", ["@school.org"])).toBe(false);
    expect(isAllowed("me@gmail.com", ["me@gmail.com"])).toBe(true);
    expect(isAllowed("you@gmail.com", ["me@gmail.com"])).toBe(false);
  });
});
