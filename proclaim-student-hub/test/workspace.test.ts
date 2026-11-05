import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRef, DocRef, Mcp } from "../src/lib/claudeRuntime.ts";
import {
  ErrorReporter,
  isBug,
  isNoise,
  reportId,
  reportMessage,
  scrub,
} from "../src/lib/errorReports.ts";
import {
  EVENING_BEFORE,
  eventInput,
  MADE_HERE,
  readEvents,
  TWO_EVENINGS_BEFORE,
} from "../src/lib/googleCalendar.ts";
import { fileText, googleFile } from "../src/lib/googleFiles.ts";

// Google Calendar, Docs and Slides through the Claude app's connectors, and
// the bug reports that go to Claude by themselves.

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage & { map: Map<string, string> };
}

function memoryList() {
  const docs = new Map<string, Record<string, unknown>>();
  const ref = (id: string): DocRef => ({
    id,
    get: async () => ({ id, exists: docs.has(id), data: () => docs.get(id) }),
    set: async (d) => void docs.set(id, structuredClone(d)),
    update: async (d) => void docs.set(id, { ...docs.get(id), ...d }),
    delete: async () => void docs.delete(id),
    collection: () => {
      throw new Error("not used");
    },
  });
  const list: CollectionRef = {
    doc: (id) => ref(id ?? "x"),
    get: async () => ({
      docs: [...docs.keys()].map((id) => ({ id, exists: true, data: () => docs.get(id) })),
    }),
  };
  return { list, docs };
}

describe("Google Calendar", () => {
  it("adds a test as an all-day event with phone reminders the evenings before", () => {
    const input = eventInput({
      key: "test:t1",
      title: "Test: Geography – Rivers",
      date: "2026-10-31",
      details: "Revise with Student Hub › Tests.",
      reminders: [EVENING_BEFORE, TWO_EVENINGS_BEFORE],
    });
    expect(input).toMatchObject({
      summary: "Test: Geography – Rivers",
      allDay: true,
      startTime: "2026-10-31T00:00:00",
      // The next day, across the month end.
      endTime: "2026-11-01T00:00:00",
      overrideReminders: [
        { method: "popup", minutes: 360 },
        { method: "popup", minutes: 1800 },
      ],
    });
    expect(input.description).toContain(MADE_HERE);
    // 18:00 the evening before a midnight start, and 18:00 two evenings before.
    expect(EVENING_BEFORE / 60).toBe(6);
    expect(TWO_EVENINGS_BEFORE / 60).toBe(30);
  });

  it("reads events whatever the list is called, and skips cancelled ones", () => {
    const google = {
      items: [
        {
          id: "a",
          summary: "Dentist",
          start: { dateTime: "2026-10-21T16:00:00+02:00" },
          htmlLink: "https://calendar.google.com/event?eid=a",
        },
        { id: "b", summary: "Cancelled", status: "cancelled", start: { date: "2026-10-21" } },
        { id: "c", summary: "Grandma's birthday", start: { date: "2026-10-22" } },
        {
          id: "d",
          summary: "Test: Maths",
          start: { date: "2026-10-23" },
          description: `Revise.\n\n${MADE_HERE}`,
        },
      ],
    };
    const events = readEvents({ content: google });
    expect(events.map((e) => e.title)).toEqual(["Dentist", "Grandma's birthday", "Test: Maths"]);
    expect(events[0]).toMatchObject({ allDay: false, link: google.items[0].htmlLink });
    expect(events[0].start).toMatch(/^2026-10-21T\d\d:00$/);
    expect(events[1]).toMatchObject({ allDay: true, start: "2026-10-22" });
    expect(events[2].madeHere).toBe(true);
    // Another connector's shape: "events" with plain strings.
    expect(
      readEvents({ events: [{ summary: "Football", start: "2026-10-24" }] }).map((e) => e.title),
    ).toEqual(["Football"]);
    // An empty calendar has no list at all.
    expect(readEvents({ accessRole: "owner", summary: "me@example.com" })).toEqual([]);
  });
});

describe("Google Docs and Slides into Revise", () => {
  it("only takes Docs and Slides links", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(googleFile(`https://docs.google.com/document/d/${id}/edit?tab=t.0`)).toEqual({
      kind: "doc",
      id,
    });
    expect(googleFile(`https://docs.google.com/presentation/u/0/d/${id}/edit`)).toEqual({
      kind: "slides",
      id,
    });
    expect(googleFile(`https://docs.google.com/forms/d/${id}/edit`)).toBeNull();
    expect(googleFile(`https://example.com/document/d/${id}`)).toBeNull();
  });

  it("reads the words of a document, without styles", () => {
    const run = (content: string) => ({ textRun: { content, textStyle: { bold: true } } });
    const payload = {
      content: {
        documentId: "d1",
        title: "Photosynthesis notes",
        tabs: [
          {
            documentTab: {
              body: {
                content: [
                  { sectionBreak: {} },
                  { paragraph: { elements: [run("Photosynthesis\n")] } },
                  { paragraph: { elements: [run("Plants make "), run("glucose")] } },
                  { paragraph: { elements: [run(" from light.\n")] } },
                  { paragraph: { elements: [run("\n")] } },
                  { paragraph: { elements: [run("\n")] } },
                  { paragraph: { elements: [run("\n")] } },
                  { paragraph: { elements: [run("Chlorophyll is green.\n")] } },
                ],
              },
            },
          },
        ],
        namedStyles: { styles: [{ textStyle: { weightedFontFamily: { fontFamily: "Arial" } } }] },
      },
    };
    expect(fileText(payload)).toEqual({
      title: "Photosynthesis notes",
      text: "Photosynthesis\nPlants make glucose from light.\n\nChlorophyll is green.",
    });
  });

  it("reads the words of slides, tables included", () => {
    const text = (s: string) => ({ textElements: [{ textRun: { content: s } }] });
    const payload = {
      title: "Rivers",
      slides: [
        { pageElements: [{ shape: { text: text("The water cycle\n") } }] },
        {
          pageElements: [
            { shape: { text: text("Evaporation\u000bCondensation\n") } },
            { table: { tableRows: [{ tableCells: [{ text: text("Source\n") }] }] } },
          ],
        },
      ],
    };
    expect(fileText(payload)).toEqual({
      title: "Rivers",
      text: "The water cycle\nEvaporation\nCondensation\nSource",
    });
  });
});

describe("reading Google files and adding events through the connectors", () => {
  let calls: { server: string; tool: string; input: unknown }[];
  beforeEach(() => {
    vi.resetModules();
    calls = [];
    const mcp: Mcp = {
      async callTool(server, tool, input) {
        calls.push({ server, tool, input });
        if (tool === "read_doc") {
          return {
            payload: {
              content: {
                title: "Vocab",
                tabs: [
                  {
                    body: {
                      content: [
                        {
                          paragraph: { elements: [{ textRun: { content: "la comida = food\n" } }] },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          };
        }
        if (tool === "create_event") {
          return { payload: { id: "ev1", htmlLink: "https://calendar.google.com/event?eid=ev1" } };
        }
        throw { code: "tool_error", message: "nope" };
      },
    };
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", { claude: { use: async (n: string) => (n === "mcp" ? mcp : null) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("brings a Google Doc in as text", async () => {
    const { readGoogleFile } = await import("../src/lib/googleFiles.ts");
    const read = await readGoogleFile(
      "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit",
    );
    expect(read).toEqual({ title: "Vocab", text: "la comida = food" });
    expect(calls[0]).toMatchObject({ server: "Google Docs", tool: "read_doc" });
    await expect(
      readGoogleFile("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit"),
    ).rejects.toThrow(/Google Slides connector/);
  });

  it("remembers what went into the calendar", async () => {
    const cal = await import("../src/lib/googleCalendar.ts");
    expect(cal.calendarAdded.has("hw:h1")).toBe(false);
    const link = await cal.addToCalendar({
      key: "hw:h1",
      title: "Due: Essay",
      date: "2026-10-22",
      reminders: [cal.EVENING_BEFORE],
    });
    expect(link).toBe("https://calendar.google.com/event?eid=ev1");
    expect(calls[0]).toMatchObject({ server: "Google Calendar", tool: "create_event" });
    expect(cal.calendarAdded.has("hw:h1")).toBe(true);
    expect(cal.calendarAdded.link("hw:h1")).toBe(link);
  });
});

describe("bug reports to Claude", () => {
  it("never sends keys, tokens or email addresses", () => {
    expect(
      scrub(
        "Failed with sk-ant-api03-abc_DEF-123 for jan@example.com, token ya29.a0Af-xyz and AIzaSyA1234567890abcdefghijk",
      ),
    ).toBe("Failed with <key> for <email>, token <token> and <key>");
  });

  it("knows a bug from a friendly message, and noise from a bug", () => {
    expect(isBug(new TypeError("x is undefined"))).toBe(true);
    expect(isBug(new Error("Couldn't reach Gmail."))).toBe(false);
    expect(isNoise("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isNoise("TypeError: Failed to fetch")).toBe(true);
    expect(isNoise("TypeError: Cannot read properties of undefined (reading 'title')")).toBe(false);
    // The same bug with other numbers is one report.
    expect(reportId("RangeError: index 4 out of 3", "today · crash")).toBe(
      reportId("RangeError: index 9 out of 7", "today · crash"),
    );
    expect(reportId("RangeError: x", "today · crash")).not.toBe(
      reportId("RangeError: x", "revise · crash"),
    );
  });

  it("one bug is one report: repeats count up, a little at a time", async () => {
    const { list, docs } = memoryList();
    const storage = memoryStorage();
    let now = Date.parse("2026-10-20T15:00:00Z");
    const told: string[] = [];
    const rep = new ErrorReporter(
      async () => list,
      () => storage,
      "1.4.0",
      () => now,
    );
    rep.onReport((r) => told.push(r.id));

    const bug = new TypeError("Cannot read properties of undefined (reading 'due')");
    expect(rep.capture(bug, "homework · crash")).toBe(true);
    await rep.flush();
    expect(rep.canReach).toBe(true);
    expect(docs.size).toBe(1);
    const [id, first] = [...docs.entries()][0];
    expect(first).toMatchObject({
      message: "TypeError: Cannot read properties of undefined (reading 'due')",
      where: "homework · crash",
      version: "1.4.0",
      count: 1,
      status: "new",
    });

    // Twice more within a few minutes: counted, written once the gap has passed.
    rep.capture(bug, "homework · crash");
    rep.capture(bug, "homework · crash");
    await rep.flush();
    expect(docs.get(id)?.count).toBe(1);
    now += 11 * 60_000;
    await rep.flush();
    expect(docs.get(id)?.count).toBe(3);
    // The app was told once about this bug this run.
    expect(told).toEqual([id]);
    // Noise never becomes a report.
    expect(rep.capture(new TypeError("Failed to fetch"), "today · handled")).toBe(false);
    expect(docs.size).toBe(1);
    expect(reportMessage((await rep.list())[0])).toContain("seen 3×");
  });

  it("a bug that comes back after its fix is opened again", async () => {
    const { list, docs } = memoryList();
    const bug = new RangeError("Invalid time value");
    const id = reportId("RangeError: Invalid time value", "tests · crash");
    docs.set(id, {
      message: "RangeError: Invalid time value",
      where: "tests · crash",
      version: "1.4.0",
      count: 2,
      status: "fixed",
      fixedIn: "1.4.1",
      reply: "Fixed dates without a day.",
      at: "2026-10-20T10:00:00Z",
    });
    // Still on the old version: just counted.
    const oldPhone = memoryStorage();
    const old = new ErrorReporter(
      async () => list,
      () => oldPhone,
      "1.4.0",
    );
    old.capture(bug, "tests · crash");
    await old.flush();
    expect(docs.get(id)).toMatchObject({ status: "fixed", count: 3 });
    // On the version with the fix: back to Claude.
    const newPhone = memoryStorage();
    const fixed = new ErrorReporter(
      async () => list,
      () => newPhone,
      "1.4.1",
    );
    fixed.capture(bug, "tests · crash");
    await fixed.flush();
    expect(docs.get(id)).toMatchObject({ status: "new", count: 4, version: "1.4.1" });
    expect(String(docs.get(id)?.reply)).toContain("Came back in 1.4.1");
  });

  it("without an account (the website) reports wait on the device", async () => {
    const storage = memoryStorage();
    const rep = new ErrorReporter(
      async () => null,
      () => storage,
      "1.4.0",
    );
    expect(rep.capture(new TypeError("boom"), "today · uncaught")).toBe(true);
    await rep.flush();
    expect(rep.canReach).toBe(false);
    expect(storage.getItem("psh.errors.pending")).toContain("boom");
    expect(await rep.list()).toEqual([]);
  });
});
