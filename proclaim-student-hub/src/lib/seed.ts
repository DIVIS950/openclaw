import { readTimetable } from "./aiFeatures.ts";
import { courses, schedule, timetable, type Course, type CoursePost } from "./store.ts";
import type { DataSource, Homework } from "./types.ts";

// Starter data the student gave us (timetable, their classes, current homework),
// baked into their private web page by the build (window.__PSH_SEED__). It is
// imported once per version, and never overwrites anything the student made.

interface SeedHomework {
  title: string;
  course: string;
  due?: string;
}

export interface Seed {
  version: string;
  timetable: ReturnType<typeof readTimetable>;
  tests: { topic: string; date: string }[];
  homework: SeedHomework[];
  courses: Course[];
  /** Link to the student's ElevenLabs voice study buddy, if they set one up. */
  voiceUrl: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const KINDS: CoursePost["kind"][] = ["assignment", "material", "announcement"];

/** Checks the seed's shape; anything malformed is dropped rather than trusted. */
export function readSeed(value: unknown): Seed | null {
  if (!isObj(value) || !str(value.version)) {
    return null;
  }
  return {
    version: str(value.version),
    timetable: readTimetable({ lessons: value.timetable }),
    tests: objs(value.tests)
      .map((t) => ({ topic: str(t.topic), date: str(t.date) }))
      .filter((t) => t.topic && isDay(t.date)),
    homework: objs(value.homework)
      .map((h) => ({
        title: str(h.title),
        course: str(h.course),
        due: isDay(str(h.due)) ? str(h.due) : undefined,
      }))
      .filter((h) => h.title),
    courses: objs(value.courses)
      .map((c) => ({
        name: str(c.name),
        subject: str(c.subject) || str(c.name),
        posts: objs(c.posts)
          .map((p) => ({
            kind: KINDS.find((k) => k === p.kind) ?? "material",
            title: str(p.title),
            date: isDay(str(p.date)) ? str(p.date) : "",
            text: str(p.text),
          }))
          .filter((p) => p.title)
          .toSorted((a, b) => b.date.localeCompare(a.date)),
      }))
      .filter((c) => c.name),
    voiceUrl: str(value.voiceUrl).startsWith("https://elevenlabs.io/") ? str(value.voiceUrl) : "",
  };
}

/** The voice study buddy link baked into this page, or "". */
export const voiceUrl = (): string => pageSeed()?.voiceUrl ?? "";

function pageSeed(): Seed | null {
  return readSeed((window as unknown as { __PSH_SEED__?: unknown }).__PSH_SEED__);
}

function done(key: string, version: string): boolean {
  try {
    return localStorage.getItem(key) === version;
  } catch {
    return true;
  }
}

function mark(key: string, version: string) {
  try {
    localStorage.setItem(key, version);
  } catch {
    // Not remembered; importing again is harmless because it never overwrites.
  }
}

/** Timetable, test dates and classes: device-local, so they're set up before the first screen draws. */
export function applyLocalSeed(seed = pageSeed()): void {
  if (!seed || done("psh.seed.local", seed.version)) {
    return;
  }
  if (timetable.get().length === 0 && seed.timetable.length > 0) {
    timetable.save(seed.timetable);
  }
  const plan = schedule.get();
  const have = new Set(plan.tests.map((t) => `${t.topic}|${t.date}`));
  const tests = seed.tests.filter((t) => !have.has(`${t.topic}|${t.date}`));
  if (tests.length > 0) {
    schedule.save({ ...plan, tests: [...plan.tests, ...tests] });
  }
  if (seed.courses.length > 0) {
    courses.save(seed.courses);
  }
  mark("psh.seed.local", seed.version);
}

/** Current homework goes into the student's own list (once), skipping anything already there. */
let running = false;

export async function applyHomeworkSeed(
  data: DataSource,
  known: Homework[],
  seed = pageSeed(),
): Promise<Homework[]> {
  // One import at a time: a second reload while the first runs would add doubles.
  if (!seed || data.demo || running || done("psh.seed.homework", seed.version)) {
    return [];
  }
  running = true;
  try {
    return await addSeedHomework(data, known, seed);
  } finally {
    running = false;
  }
}

async function addSeedHomework(
  data: DataSource,
  known: Homework[],
  seed: Seed,
): Promise<Homework[]> {
  const titles = new Set(known.map((h) => h.title.trim().toLowerCase()));
  const added: Homework[] = [];
  for (const h of seed.homework) {
    if (!titles.has(h.title.toLowerCase())) {
      added.push(
        await data.addHomework({
          title: h.title,
          source: "Classroom",
          due: h.due,
          course: h.course,
        }),
      );
    }
  }
  mark("psh.seed.homework", seed.version);
  return added;
}
