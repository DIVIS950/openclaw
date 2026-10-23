import { describe, expect, it } from "vitest";
import { findDesignLink, findKey } from "../src/lib/canva.ts";
import { applyEdits, readPolish } from "../src/lib/polish.ts";

const WORK = "The CPU are the brain of the computer. It do calculations very fast and stuff.";

describe("readPolish", () => {
  it("keeps edits that match the work and the allowed areas", () => {
    const r = readPolish(
      {
        edits: [
          { area: "spelling", before: "The CPU are", after: "The CPU is", why: "singular subject" },
          { area: "spelling", before: "It do", after: "It does", why: "" },
          { area: "vocabulary", before: "and stuff", after: "and accurately", why: "vaguer" },
          { area: "spelling", before: "not in the text", after: "x", why: "" },
          { area: "spelling", before: "It do", after: "It does", why: "duplicate" },
          { area: "spelling", before: "fast", after: "fast", why: "no change" },
        ],
        tips: ["Add a conclusion"],
        visuals: [{ idea: "Diagram of the CPU parts", format: "Infographic" }],
      },
      WORK,
      ["spelling"],
    );
    expect(r.edits.map((e) => e.after)).toEqual(["The CPU is", "It does"]);
    expect(r.tips).toEqual([]);
    expect(r.visuals).toEqual([]);
  });

  it("returns tips and visuals only when asked for", () => {
    const r = readPolish({ tips: ["Add a conclusion"], visuals: [{ idea: "CPU diagram" }] }, WORK, [
      "structure",
      "visuals",
    ]);
    expect(r.tips).toEqual(["Add a conclusion"]);
    expect(r.visuals).toEqual([{ idea: "CPU diagram", format: "Poster" }]);
    expect(readPolish(null, WORK, ["spelling"]).edits).toEqual([]);
  });

  it("applies only the accepted edits", () => {
    const edits = readPolish(
      {
        edits: [
          { area: "spelling", before: "The CPU are", after: "The CPU is" },
          { area: "spelling", before: "It do", after: "It does" },
        ],
      },
      WORK,
      ["spelling"],
    ).edits;
    expect(applyEdits(WORK, edits)).toBe(
      "The CPU is the brain of the computer. It does calculations very fast and stuff.",
    );
    expect(applyEdits(WORK, [edits[1]])).toContain("The CPU are");
  });
});

describe("Canva reply reading", () => {
  it("finds job fields and design links anywhere in a reply", () => {
    const reply = {
      job: { job_id: "j1", polling_policy: { wait_seconds: 4 } },
      continuation_token: "t1",
    };
    expect(findKey(reply, "job_id")).toBe("j1");
    expect(findKey(reply, "wait_seconds")).toBe(4);
    expect(findDesignLink(reply)).toBeNull();
    expect(
      findDesignLink({
        design: {
          urls: {
            view_url: "https://www.canva.com/design/DAF1/view",
            edit_url: "https://www.canva.com/design/DAF1/edit",
          },
        },
        other: "https://example.com/design/x",
      }),
    ).toBe("https://www.canva.com/design/DAF1/edit");
  });
});
