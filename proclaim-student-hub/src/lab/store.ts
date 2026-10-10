import { SAMPLE_PACK, type RevisionPack } from "../../shared/pack.ts";
import { dayString, newItem, SUBJECTS, type LabPack, type Subject } from "./model.ts";

// Packs and settings live on this device (browser storage), so practice works
// offline. Photos are stored small; export/import moves packs between devices.

const PACKS_KEY = "psh.lab.packs";
const SETTINGS_KEY = "psh.lab.settings";
const OLD_PACK_KEY = "psh.pack";

export interface LabSettings {
  grade: number;
  /** Language for explanations; items keep their own language. */
  language: "English" | "Czech" | "Spanish";
}

const DEFAULT_SETTINGS: LabSettings = { grade: 9, language: "English" };

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

export const settings = {
  get: (): LabSettings => ({
    ...DEFAULT_SETTINGS,
    ...read<Partial<LabSettings>>(SETTINGS_KEY, {}),
  }),
  save: (value: LabSettings) => write(SETTINGS_KEY, value),
};

/** Turns a pack from the older single-pack revision screen into a Lab pack. */
export function fromRevisionPack(pack: RevisionPack, today = dayString(new Date())): LabPack {
  const subject = SUBJECTS.find((s) => s.toLowerCase() === pack.subject.toLowerCase()) ?? "Science";
  const items = [
    ...pack.match.map((m) => newItem({ prompt: m.term, answer: m.meaning, kind: "term" }, today)),
    ...pack.flashcards.map((c) => newItem({ prompt: c.q, answer: c.a, kind: "qa" }, today)),
    ...pack.quiz.map((q) =>
      newItem(
        {
          prompt: q.question,
          answer: q.options[q.answer] ?? "",
          kind: "qa",
          explanation: q.explanation,
        },
        today,
      ),
    ),
  ].filter((i) => i.answer);
  return {
    id: `p${Date.now().toString(36)}`,
    subject,
    topic: pack.topic,
    docType: "notes",
    createdAt: new Date().toISOString(),
    testScore: "",
    insight: pack.keyFact ? `Remember: ${pack.keyFact}` : "",
    items,
    steps: [],
    gaps: pack.gaps.map((g) => ({ before: g.before, answer: g.answer, after: g.after })),
    labels: [],
    photo: "",
  };
}

export function samplePack(): LabPack {
  return { ...fromRevisionPack(SAMPLE_PACK), id: "sample", topic: "Photosynthesis (sample)" };
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** A saved pack with every field the Lab reads in the right shape; bad cards are left out. */
function cleanPack(p: LabPack): LabPack {
  const today = dayString(new Date());
  const items = (p.items as unknown[])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) =>
      newItem(
        {
          ...(typeof i.id === "string" ? { id: i.id } : {}),
          prompt: text(i.prompt),
          answer: text(i.answer),
          kind: i.kind === "qa" ? "qa" : "term",
          origin: i.origin === "ai" ? "ai" : "photo",
          markedWrong: i.markedWrong === true,
          studentAnswer: text(i.studentAnswer),
          explanation: text(i.explanation),
          box: count(i.box),
          due: typeof i.due === "string" && i.due ? i.due : today,
          right: count(i.right),
          wrong: count(i.wrong),
        },
        today,
      ),
    )
    .filter((i) => i.prompt && i.answer);
  return {
    ...p,
    subject: SUBJECTS.includes(p.subject) ? p.subject : "Science",
    topic: text(p.topic),
    testScore: text(p.testScore),
    insight: text(p.insight),
    createdAt: text(p.createdAt),
    photo: text(p.photo),
    steps: Array.isArray(p.steps) ? p.steps.filter((s) => typeof s === "string") : [],
    labels: Array.isArray(p.labels)
      ? p.labels.filter(
          (l) =>
            !!l &&
            typeof l === "object" &&
            typeof l.text === "string" &&
            typeof l.x === "number" &&
            typeof l.y === "number",
        )
      : [],
    items,
  };
}

export const labPacks = {
  all(): LabPack[] {
    const packs = read<unknown>(PACKS_KEY, null);
    if (Array.isArray(packs)) {
      // Damaged entries (not a pack with cards) are left out.
      return packs
        .filter(
          (p): p is LabPack =>
            !!p && typeof p === "object" && typeof p.id === "string" && Array.isArray(p.items),
        )
        .map(cleanPack);
    }
    // First run: bring over the pack made on the old revision screen, if any.
    const old = read<{ pack: RevisionPack } | null>(OLD_PACK_KEY, null);
    let start: LabPack[] = [];
    try {
      start = old?.pack ? [fromRevisionPack(old.pack)] : [];
    } catch {
      // A damaged old pack: start with none rather than break Revise.
    }
    write(PACKS_KEY, start);
    return start;
  },
  /** Saves all packs; if storage is full, drops stored photos and tries again. */
  saveAll(packs: LabPack[]): boolean {
    if (write(PACKS_KEY, packs)) {
      return true;
    }
    return write(
      PACKS_KEY,
      packs.map((p) => ({ ...p, photo: "" })),
    );
  },
};

// ---------- Export / import ----------

export function exportJson(packs: LabPack[]): string {
  return JSON.stringify({ app: "proclaim-revision-lab", version: 1, packs }, null, 1);
}

function isPack(p: unknown): p is LabPack {
  const v = p as LabPack;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.topic === "string" &&
    Array.isArray(v.items) &&
    SUBJECTS.includes(v.subject as Subject)
  );
}

/** Adds imported packs; a pack with an id you already have replaces it. */
export function importJson(text: string, existing: LabPack[]): { packs: LabPack[]; added: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Revision Lab export.");
  }
  const incoming = (parsed as { packs?: unknown[] })?.packs;
  if (!Array.isArray(incoming)) {
    throw new Error("That file isn't a Revision Lab export.");
  }
  const valid = incoming.filter(isPack).map((p) => ({
    ...p,
    steps: Array.isArray(p.steps) ? p.steps : [],
    gaps: Array.isArray(p.gaps) ? p.gaps : [],
    labels: Array.isArray(p.labels) ? p.labels : [],
    photo: typeof p.photo === "string" ? p.photo : "",
  }));
  const ids = new Set(valid.map((p) => p.id));
  return { packs: [...existing.filter((p) => !ids.has(p.id)), ...valid], added: valid.length };
}

/** Tests › Exam mode: the pack whose timed exam the Lab starts on arrival. */
let examPack: string | null = null;
export const examHandoff = {
  set: (packId: string) => {
    examPack = packId;
  },
  take: (): string | null => {
    const id = examPack;
    examPack = null;
    return id;
  },
};
