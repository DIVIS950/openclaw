// Revision Lab: the rules behind packs, marking and spaced repetition.
// Pure functions only, so they can be tested without a browser.

export const SUBJECTS = [
  "Science",
  "Maths",
  "Spanish",
  "English",
  "History",
  "Geography",
  "Czech",
  "Art History",
  "Computer Science",
  "Music",
  "Other",
] as const;
export type Subject = (typeof SUBJECTS)[number];

export const DOC_TYPES = ["auto", "test", "notes", "worksheet", "textbook", "diagram"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Letters a keyboard might not make easily, per subject. */
export const ACCENT_KEYS: Partial<Record<Subject, string[]>> = {
  Spanish: ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"],
  Czech: ["á", "č", "ď", "é", "ě", "í", "ň", "ó", "ř", "š", "ť", "ú", "ů", "ý", "ž"],
};

export interface Item {
  id: string;
  /** The term or question shown to the student. */
  prompt: string;
  /** The meaning or correct answer. Alternatives can be separated by " / ". */
  answer: string;
  kind: "term" | "qa";
  /** Read from the student's photo, or added by the AI as related practice. */
  origin: "photo" | "ai";
  /** The teacher marked this wrong on the original test. */
  markedWrong: boolean;
  /** What the student wrote on the test, when it was wrong. */
  studentAnswer: string;
  explanation: string;
  // Spaced repetition
  box: number;
  due: string;
  right: number;
  wrong: number;
}

export interface Gap {
  before: string;
  answer: string;
  after: string;
}

/** A pin on the pack's photo: x and y are 0-100 percent of the image. */
export interface DiagramLabel {
  text: string;
  x: number;
  y: number;
}

export interface LabPack {
  id: string;
  subject: Subject;
  topic: string;
  docType: DocType;
  createdAt: string;
  /** The original test score, e.g. "14/20", when the photo was a marked test. */
  testScore: string;
  /** The one pattern behind the mistakes ("most wrong answers started with en"). */
  insight: string;
  items: Item[];
  /** Steps or events in their correct order, for "Order the steps". */
  steps: string[];
  gaps: Gap[];
  labels: DiagramLabel[];
  /** A small copy of the first photo (data URL), for Label the diagram and Mock test. */
  photo: string;
}

// ---------- Days ----------

export function dayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayString(d);
}

// ---------- Spaced repetition (Leitner boxes) ----------

/** Days until an item in each box comes back. Box 0 = due again today. */
export const BOX_DAYS = [0, 1, 2, 4, 7, 14, 30];
export const TOP_BOX = BOX_DAYS.length - 1;

export type Verdict = "correct" | "almost" | "wrong";

/** Moves an item between boxes after an answer. */
export function review(item: Item, verdict: Verdict, today: string): Item {
  if (verdict === "correct") {
    const box = Math.min(TOP_BOX, item.box + 1);
    return { ...item, box, due: addDays(today, BOX_DAYS[box]), right: item.right + 1 };
  }
  if (verdict === "almost") {
    // Nearly there: stay in the same box, see it again tomorrow.
    return { ...item, due: addDays(today, 1) };
  }
  return { ...item, box: 0, due: today, wrong: item.wrong + 1 };
}

/** Whole days from today to a YYYY-MM-DD date (negative when it's past). */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86_400_000);
}

export const isDue = (item: Item, today: string): boolean => item.due <= today;

/** 0-100: how far up the boxes this pack's items are. */
export function mastery(items: Item[]): number {
  if (items.length === 0) {
    return 0;
  }
  const total = items.reduce((n, i) => n + i.box, 0);
  return Math.round((total / (items.length * TOP_BOX)) * 100);
}

/** Items the student keeps missing, or got wrong on the real test and hasn't fixed yet. */
export function isWeak(item: Item): boolean {
  return (item.wrong >= 2 && item.box < 3) || (item.markedWrong && item.box < 2);
}

// ---------- Marking typed answers ----------

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[¿¡!?.,;:"'()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export interface Marking {
  verdict: Verdict;
  /** Why it was "almost", in words for the student. */
  note: string;
}

/** Marks a typed answer: exact, a small slip (accents or one letter), or wrong. */
export function markAnswer(given: string, answer: string): Marking {
  const g = normalise(given);
  if (!g) {
    return { verdict: "wrong", note: "" };
  }
  const options = answer
    .split(/\s[/;]\s|;|\//)
    .map(normalise)
    .filter(Boolean);
  let best: Marking = { verdict: "wrong", note: "" };
  for (const option of options) {
    if (g === option) {
      return { verdict: "correct", note: "" };
    }
    if (stripAccents(g) === stripAccents(option)) {
      best = { verdict: "almost", note: "Check your accents." };
      continue;
    }
    const allowed = option.length >= 10 ? 2 : option.length >= 5 ? 1 : 0;
    if (
      allowed > 0 &&
      editDistance(stripAccents(g), stripAccents(option)) <= allowed &&
      best.verdict === "wrong"
    ) {
      best = { verdict: "almost", note: "Nearly: check your spelling." };
    }
  }
  return best;
}

// ---------- Building questions ----------

/** Stable shuffle so options don't jump around on re-render. */
export function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hash(s: string): number {
  let h = 7;
  for (const ch of s) {
    h = (h * 31 + ch.charCodeAt(0)) % 100003;
  }
  return h;
}

/** Four choices: the answer plus three other answers from the same pack. */
export function quizOptions(item: Item, pool: Item[]): string[] {
  const distractors = [
    ...new Set(
      pool
        .filter((i) => i.id !== item.id && i.kind === item.kind)
        .map((i) => i.answer)
        .filter((a) => normalise(a) !== normalise(item.answer)),
    ),
  ];
  const picked = shuffle(distractors, hash(item.id)).slice(0, 3);
  return shuffle([item.answer, ...picked], hash(item.prompt));
}

/** Which way round to ask: term → meaning, or meaning → term. */
export function asked(item: Item, reverse: boolean): { question: string; answer: string } {
  return reverse && item.kind === "term"
    ? { question: item.answer, answer: item.prompt }
    : { question: item.prompt, answer: item.answer };
}

// ---------- Scores ----------

/** "14/20" or "70%" → 70. Null when there's no usable score. */
export function scorePercent(score: string): number | null {
  const frac = score.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac && Number(frac[2]) > 0) {
    return Math.round((Number(frac[1]) / Number(frac[2])) * 100);
  }
  const pct = score.match(/(\d+(?:\.\d+)?)\s*%/);
  return pct ? Math.round(Number(pct[1])) : null;
}

/** Correct answers count 1, "almost" counts half. */
export function sessionPercent(verdicts: Verdict[]): number {
  if (verdicts.length === 0) {
    return 0;
  }
  const points = verdicts.reduce((n, v) => n + (v === "correct" ? 1 : v === "almost" ? 0.5 : 0), 0);
  return Math.round((points / verdicts.length) * 100);
}

// ---------- XP ----------

/** Levels get slowly further apart: level 2 at 50 XP, 3 at 200, 4 at 450… */
export function levelFor(xp: number): { level: number; into: number; span: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
  const start = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, into: xp - start, span: next - start };
}

// ---------- Making items ----------

export function newItem(
  fields: Partial<Item> & { prompt: string; answer: string },
  today: string,
): Item {
  return {
    id: fields.id ?? `i${Math.random().toString(36).slice(2, 10)}`,
    kind: "term",
    origin: "photo",
    markedWrong: false,
    studentAnswer: "",
    explanation: "",
    box: 0,
    due: today,
    right: 0,
    wrong: 0,
    ...fields,
  };
}

// ---------- Modes ----------

export const MODES = [
  { id: "learn", title: "Learn list", blurb: "Read everything first" },
  { id: "flashcards", title: "Flashcards", blurb: "Flip and rate yourself" },
  { id: "quiz", title: "Quiz", blurb: "Pick from 4 answers" },
  { id: "write", title: "Write it", blurb: "Type the answer" },
  { id: "match", title: "Match", blurb: "Pair terms and meanings" },
  { id: "gap", title: "Gap-fill", blurb: "Finish the sentences" },
  { id: "order", title: "Order the steps", blurb: "Put them in sequence" },
  { id: "label", title: "Label the diagram", blurb: "Pin labels on the photo" },
  { id: "boss", title: "Boss battle", blurb: "3 lives, beat the boss" },
  { id: "speed", title: "Speed round", blurb: "60 seconds, go fast" },
  { id: "mock", title: "Mock test", blurb: "No hints until the end" },
] as const;
export type ModeId = (typeof MODES)[number]["id"];

/** Items short enough to sit on a Match card. */
export const matchable = (items: Item[]): Item[] =>
  items.filter((i) => i.prompt.length <= 60 && i.answer.length <= 60);

/** Why a mode can't be played with this pack, or null when it can. */
export function modeBlocked(mode: ModeId, pack: LabPack): string | null {
  const n = pack.items.length;
  switch (mode) {
    case "match":
      return matchable(pack.items).length >= 3 ? null : "Needs 3 short items";
    case "gap":
      return pack.gaps.length > 0 ? null : "No sentences in this pack";
    case "order":
      return pack.steps.length >= 3 ? null : "No steps or timeline in this pack";
    case "label":
      return pack.labels.length >= 2 && pack.photo ? null : "Only for diagram photos";
    case "quiz":
    case "speed":
    case "boss":
    case "mock":
      return n >= 3 ? null : "Needs at least 3 items";
    default:
      return n > 0 ? null : "Add some items first";
  }
}
