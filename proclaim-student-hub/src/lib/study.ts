import type { LabPack, Subject as LabSubject } from "../lab/model.ts";
import { schedule, type Course } from "./store.ts";
import type { Homework } from "./types.ts";

// The Study hub's data: to-dos, notes, tests with a day-by-day prep plan, and
// tutoring (tutors, sessions, materials). Kept on this device, like revision packs.

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Returns false when the browser refused (storage full or blocked). */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const newId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000);
}

// ---------- To-do ----------

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  /** YYYY-MM-DD, or "" for no date. */
  due: string;
  subject: string;
  /** Where it came from, e.g. "Tutoring: Maths with Anna". */
  from: string;
}

/** Fired on window whenever the to-do list is saved. */
export const TODOS_CHANGED = "psh:todos";

export const todos = {
  all: (): Todo[] => read<Todo[]>("psh.todos", []),
  save(list: Todo[]): boolean {
    const ok = write("psh.todos", list);
    // An open To-do screen redraws when the + sheet or a tutor link adds one.
    try {
      window.dispatchEvent(new Event(TODOS_CHANGED));
    } catch {
      // No window (tests): nothing on screen to redraw.
    }
    return ok;
  },
  add(fields: Omit<Todo, "id" | "done">): Todo[] {
    const next = [...todos.all(), { ...fields, id: newId("t"), done: false }];
    todos.save(next);
    return next;
  },
};

/** Overdue, today, later, no date, then done — each sorted by date. */
export function groupTodos(list: Todo[], today: string) {
  const open = list
    .filter((t) => !t.done)
    .toSorted((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  return {
    overdue: open.filter((t) => t.due && t.due < today),
    today: open.filter((t) => t.due === today),
    later: open.filter((t) => t.due > today),
    someday: open.filter((t) => !t.due),
    done: list.filter((t) => t.done),
  };
}

// ---------- Notes ----------

export interface Note {
  id: string;
  title: string;
  subject: string;
  body: string;
  updatedAt: string;
  /** The revision pack this note belongs to, if any. */
  packId: string;
  /** Where it came from; missing on older notes (treated as written, or pack when packId is set). */
  kind?: NoteKind;
}

export type NoteKind = "written" | "ai" | "pack" | "photo";

/** The chip on a note card: what made it. */
export function noteKind(n: Note): NoteKind {
  return n.kind ?? (n.packId ? "pack" : "written");
}

export const notes = {
  all: (): Note[] => read<Note[]>("psh.notes", []),
  save: (list: Note[]) => write("psh.notes", list),
  upsert(note: Note): Note[] {
    const list = notes.all();
    const next = list.some((n) => n.id === note.id)
      ? list.map((n) => (n.id === note.id ? note : n))
      : [note, ...list];
    notes.save(next);
    return next;
  },
};

export function searchNotes(list: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  return list
    .filter((n) => !q || `${n.title} ${n.subject} ${n.body}`.toLowerCase().includes(q))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- Tests and the day-by-day prep plan ----------

export interface PrepTest {
  id: string;
  subject: string;
  topic: string;
  /** YYYY-MM-DD */
  date: string;
  /** Day the plan started, so it can spread over the days between. */
  start: string;
  /** Revision pack made for it, if any. */
  packId: string;
  /** Days (YYYY-MM-DD) whose prep is ticked off. */
  done: string[];
}

/** Keeps the older revision-plan test list in step (the Revision Lab counts down from it). */
function syncSchedule(list: PrepTest[]) {
  const plan = schedule.get();
  schedule.save({
    ...plan,
    tests: list.map((t) => ({
      // Seeded topics already start with the subject; don't say it twice.
      topic: t.topic.toLowerCase().startsWith(`${t.subject.toLowerCase()}:`)
        ? t.topic
        : `${t.subject}: ${t.topic}`,
      date: t.date,
    })),
  });
}

export const prepTests = {
  all(): PrepTest[] {
    const saved = read<PrepTest[] | null>("psh.prep", null);
    if (Array.isArray(saved)) {
      // Damaged or older entries get the lists they're missing instead of crashing the app.
      return saved
        .filter((t) => t && typeof t.id === "string")
        .map((t) => ({
          ...t,
          subject: t.subject ?? "",
          topic: t.topic ?? "",
          start: t.start ?? t.date ?? "",
          packId: t.packId ?? "",
          done: Array.isArray(t.done) ? t.done : [],
        }));
    }
    // First run: bring over test dates added before the prep planner existed.
    const today = dayOf(new Date());
    const start = schedule.get().tests.map((t) => ({
      id: newId("x"),
      subject: t.topic.split(/[:(]/)[0].trim(),
      topic: t.topic,
      date: t.date,
      start: today,
      packId: "",
      done: [],
    }));
    write("psh.prep", start);
    return start;
  },
  save(list: PrepTest[]) {
    write("psh.prep", list);
    syncSchedule(list);
  },
};

export type PrepAction =
  | "material"
  | "learn"
  | "flashcards"
  | "quiz"
  | "write"
  | "match"
  | "speed"
  | "weak"
  | "mock";

export interface PrepDay {
  date: string;
  /** Days left until the test (0 = test day). */
  left: number;
  title: string;
  detail: string;
  action: PrepAction;
  minutes: number;
}

const STEPS: Omit<PrepDay, "date" | "left">[] = [
  {
    title: "Learn it",
    detail: "Read the whole learn list once, slowly",
    action: "learn",
    minutes: 15,
  },
  {
    title: "Flashcards",
    detail: "Go through every card; mark what you don't know",
    action: "flashcards",
    minutes: 15,
  },
  {
    title: "Quiz",
    detail: "Take the quiz; read the explanation for every miss",
    action: "quiz",
    minutes: 15,
  },
  {
    title: "Write it",
    detail: "Type the answers from memory (spelling counts)",
    action: "write",
    minutes: 15,
  },
  {
    title: "Match & gaps",
    detail: "Match game, then fix your weak spots",
    action: "match",
    minutes: 10,
  },
  { title: "Speed round", detail: "60 seconds, beat your score", action: "speed", minutes: 10 },
  { title: "Weak spots", detail: "Only the ones you keep missing", action: "weak", minutes: 15 },
];

/**
 * The plan from the start day to the test: get the material, learn, practise,
 * a mock test the day before, and a short recap on the day. Long gaps repeat
 * the practice steps; short ones squeeze them.
 */
export function prepPlan(
  test: Pick<PrepTest, "date" | "start" | "packId">,
  today: string,
): PrepDay[] {
  const first = test.start && test.start < today ? test.start : today;
  const total = daysBetween(first, test.date);
  if (total < 0) {
    return [];
  }
  const days: PrepDay[] = [];
  for (let i = 0; i <= total; i++) {
    const date = addDays(first, i);
    const left = total - i;
    let step: Omit<PrepDay, "date" | "left">;
    if (left === 0) {
      step = {
        title: "Test day: quick recap",
        detail: "Flashcards of your weak spots only, then stop. You've got this.",
        action: "weak",
        minutes: 10,
      };
    } else if (left === 1 && total >= 2) {
      step = {
        title: "Mock test",
        detail: "Like the real test, no hints until the end",
        action: "mock",
        minutes: 20,
      };
    } else if (i === 0 && !test.packId) {
      step = {
        title: "Get your material",
        detail: "Photo of the vocab list or notes, or make it from the topic",
        action: "material",
        minutes: 10,
      };
    } else {
      // Practice steps in order; long gaps start again from flashcards.
      const n = test.packId ? i : i - 1;
      step = STEPS[n < STEPS.length ? n : 1 + ((n - 1) % (STEPS.length - 1))];
    }
    days.push({ date, left, ...step });
  }
  return days;
}

// ---------- Tests spotted in homework and classes ----------

export interface TestSuggestion {
  subject: string;
  topic: string;
  /** YYYY-MM-DD when the text says, else "". */
  date: string;
  from: string;
}

const TEST_WORDS = /\b(test|exam|assessment)\b|písemk|příprava k testu|testu/i;

/** The words that identify a topic ("Y9 U1.1c Vocabulary TEST: ¿Qué haces?" → u11c, qué, haces). */
function topicWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 && !/^(y9p?|test|testu|vocab|vocabulary|the|and|for|prep|homework)$/.test(w),
      ),
  );
}

/** Two titles about the same test (most identifying words shared). */
export function sameTopic(a: string, b: string): boolean {
  const x = topicWords(a);
  const y = topicWords(b);
  if (x.size === 0 || y.size === 0) {
    return a.toLowerCase() === b.toLowerCase();
  }
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/** Reads a date like "6. 10." (Czech day.month) or "10/1" (US month/day) out of a title. */
export function dateInTitle(title: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const fix = (m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      return "";
    }
    let day = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (daysBetween(today, day) < -60) {
      day = `${year + 1}${day.slice(4)}`;
    }
    return day;
  };
  const cz = title.match(/\b(\d{1,2})\.\s?(\d{1,2})\./);
  if (cz) {
    return fix(Number(cz[2]), Number(cz[1]));
  }
  const us = title.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (us) {
    return fix(Number(us[1]), Number(us[2]));
  }
  // "September 15th", "15 October"
  const named = title.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\b/,
  );
  if (named) {
    const month = MONTHS.indexOf((named[1] ?? named[4]).slice(0, 3).toLowerCase()) + 1;
    return month > 0 ? fix(month, Number(named[2] ?? named[3])) : "";
  }
  return "";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function suggestTests(
  input: { homework: Homework[]; courses: Course[]; existing: PrepTest[] },
  today: string,
): TestSuggestion[] {
  const known = new Set(input.existing.map((t) => t.topic.toLowerCase()));
  const out: TestSuggestion[] = [];
  // Same subject on the same day is the same test, however it's worded.
  const sameTest = (s: TestSuggestion) =>
    s.date !== "" &&
    input.existing.some(
      (t) => t.date === s.date && labSubject(t.subject) === labSubject(s.subject),
    );
  const add = (s: TestSuggestion) => {
    const key = s.topic.toLowerCase();
    const seen =
      [...known].some((k) => sameTopic(k, key)) || out.some((o) => sameTopic(o.topic, s.topic));
    if (!seen && !sameTest(s)) {
      out.push(s);
    }
  };
  for (const h of input.homework) {
    if (!h.done && TEST_WORDS.test(h.title)) {
      const due = h.due?.slice(0, 10) ?? "";
      add({
        subject: h.course,
        topic: h.title,
        date: due && due >= today ? due : dateInTitle(h.title, today),
        from: "Homework",
      });
    }
  }
  for (const c of input.courses) {
    for (const p of c.posts) {
      // Only recent posts: older tests have been and gone.
      if (TEST_WORDS.test(p.title) && p.date && daysBetween(p.date, today) <= 7) {
        const date = dateInTitle(p.title, today);
        if (!date || date >= today) {
          add({ subject: c.subject, topic: p.title, date, from: c.name });
        }
      }
    }
  }
  return out.slice(0, 6);
}

// ---------- Tutoring ----------

export interface Tutor {
  id: string;
  name: string;
  subject: string;
  /** Google Meet (or other) link for lessons. */
  meet: string;
  /** Phone number for WhatsApp, digits with country code, or "". */
  whatsapp: string;
  /** When lessons usually are, e.g. "Tuesdays 17:00". */
  when: string;
}

export interface TutorSession {
  id: string;
  tutorId: string;
  date: string;
  topic: string;
  notes: string;
}

export interface TutorMaterial {
  id: string;
  tutorId: string;
  title: string;
  /** What the AI read from the photo, or text pasted from WhatsApp. */
  text: string;
  /** Small copy of the photo (data URL), or "". */
  photo: string;
  date: string;
}

/** A short message between the student and a tutor, carried in the shared links. */
export interface TutorMessage {
  id: string;
  tutorId: string;
  from: "student" | "tutor";
  text: string;
  /** ISO time. */
  at: string;
}

export const tutoring = {
  messages: (): TutorMessage[] => read<TutorMessage[]>("psh.tutor.messages", []),
  saveMessages: (list: TutorMessage[]) => write("psh.tutor.messages", list),
  /** When this tutor last got a link (ISO), so unsent messages can be counted. */
  lastShared: (tutorId: string): string =>
    read<Record<string, string>>("psh.tutor.shared", {})[tutorId] ?? "",
  markShared: (tutorId: string) =>
    write("psh.tutor.shared", {
      ...read<Record<string, string>>("psh.tutor.shared", {}),
      [tutorId]: new Date().toISOString(),
    }),
  tutors: (): Tutor[] => read<Tutor[]>("psh.tutors", []),
  saveTutors: (list: Tutor[]) => write("psh.tutors", list),
  sessions: (): TutorSession[] => read<TutorSession[]>("psh.tutor.sessions", []),
  saveSessions: (list: TutorSession[]) => write("psh.tutor.sessions", list),
  materials: (): TutorMaterial[] => read<TutorMaterial[]>("psh.tutor.materials", []),
  /** Drops photos (keeping the text) if the device runs out of space. */
  saveMaterials(list: TutorMaterial[]): boolean {
    return (
      write("psh.tutor.materials", list) ||
      write(
        "psh.tutor.materials",
        list.map((m) => ({ ...m, photo: "" })),
      )
    );
  },
};

/** wa.me link for a number typed any way ("+420 777 123 456" → digits only). */
export function whatsappLink(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : "";
}

/** Only real web links are opened. */
export function safeLink(url: string): string {
  return /^https:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : "";
}

/** "Google Meet", "Zoom" or "Teams" for a lesson link; "the call" for anything else. */
export function callName(url: string): string {
  const host = /^https:\/\/([^/?#]+)/i.exec(url.trim())?.[1]?.toLowerCase() ?? "";
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  return is("meet.google.com")
    ? "Google Meet"
    : is("zoom.us")
      ? "Zoom"
      : is("teams.microsoft.com") || is("teams.live.com")
        ? "Teams"
        : "the call";
}

/** The button text for a lesson link: "Join Meet", "Join Zoom", "Join Teams" or "Join call". */
export function joinLabel(url: string): string {
  const name = callName(url);
  return name === "Google Meet" ? "Join Meet" : name === "the call" ? "Join call" : `Join ${name}`;
}

// ---------- Handing work to the Revision Lab ----------

export type LabRequest =
  | { kind: "scan"; subject: string; topic: string; text: string; photos: string[]; testId: string }
  | { kind: "open"; packId: string; action: PrepAction | "" };

let pending: LabRequest | null = null;

/** Other screens ask the Lab to open something; the Lab takes it once on arrival. */
export const labHandoff = {
  set: (req: LabRequest) => {
    pending = req;
  },
  take: (): LabRequest | null => {
    const req = pending;
    pending = null;
    return req;
  },
};

/** A test whose plan should open when the Tests screen appears. */
let nextTest: string | null = null;
export const testHandoff = {
  set: (id: string) => {
    nextTest = id;
  },
  take: (): string | null => {
    const id = nextTest;
    nextTest = null;
    return id;
  },
};

/** A note to open when the Notes screen appears (set by other screens before going there). */
let nextNote: string | null = null;
export const noteHandoff = {
  set: (id: string) => {
    nextNote = id;
  },
  take: (): string | null => {
    const id = nextNote;
    nextNote = null;
    return id;
  },
};

/** A revision pack written out as a note and vocab list the student can read and keep. */
export function packToNote(pack: LabPack, existing?: Note): Note {
  const lines = [
    ...(pack.insight ? [`The big fix: ${pack.insight}`, ""] : []),
    pack.items.some((i) => i.kind === "term") ? "Vocab / key terms" : "Key facts",
    ...pack.items.map((i) => `• ${i.prompt} — ${i.answer}`),
    ...(pack.steps.length ? ["", "In order", ...pack.steps.map((s, i) => `${i + 1}. ${s}`)] : []),
  ];
  return {
    id: existing?.id ?? newId("n"),
    title: `${pack.topic}`,
    subject: pack.subject,
    body: lines.join("\n"),
    updatedAt: new Date().toISOString(),
    packId: pack.id,
    kind: "pack",
  };
}

/** Maps a class subject ("Y9 Český dějepis", "Computer Science") to a Revision Lab subject. */
export function labSubject(name: string): LabSubject {
  const n = name.toLowerCase();
  if (/art hist/.test(n)) {
    return "Art History";
  }
  if (/hist|dějep/.test(n)) {
    return "History";
  }
  if (/geo|zeměp/.test(n)) {
    return "Geography";
  }
  if (/czech|česk|češ|cest/.test(n)) {
    return "Czech";
  }
  if (/comput|coding|\bict\b/.test(n)) {
    return "Computer Science";
  }
  if (/math/.test(n)) {
    return "Maths";
  }
  if (/span|españ/.test(n)) {
    return "Spanish";
  }
  if (/eng|lit/.test(n)) {
    return "English";
  }
  if (/sci|bio|chem|phys/.test(n)) {
    return "Science";
  }
  if (/music/.test(n)) {
    return "Music";
  }
  return "Other";
}
