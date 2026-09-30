// A "revision pack" is what the AI makes from a student's notes: a summary
// plus the content for flashcards, the quiz and the three games.

export interface Flashcard {
  q: string;
  a: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}

export interface MatchPair {
  term: string;
  meaning: string;
}

export interface TrueFalse {
  statement: string;
  answer: boolean;
  why: string;
}

export interface Gap {
  before: string;
  answer: string;
  after: string;
  options: string[];
}

export interface RevisionPack {
  topic: string;
  subject: string;
  summary: string[];
  keyFact: string;
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  match: MatchPair[];
  trueFalse: TrueFalse[];
  gaps: Gap[];
}

const clean = (s: string) => s.trim();

/**
 * The model's output is schema-shaped but not guaranteed to respect counts or
 * cross-field rules (a quiz answer index in range, a gap's answer among its
 * options). Fix those up so the games never break on a bad item.
 */
export function normalizePack(pack: RevisionPack): RevisionPack {
  const quiz = pack.quiz
    .map((q) => ({ ...q, options: q.options.map(clean).filter(Boolean) }))
    .filter(
      (q) =>
        q.question.trim() && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length,
    );

  const seenTerms = new Set<string>();
  const match = pack.match
    .filter((m) => {
      const key = m.term.trim().toLowerCase();
      if (!key || !m.meaning.trim() || seenTerms.has(key)) {
        return false;
      }
      seenTerms.add(key);
      return true;
    })
    .slice(0, 4);

  const gaps = pack.gaps
    .filter((g) => g.answer.trim())
    .map((g) => {
      const options = [...new Set(g.options.map(clean).filter(Boolean))];
      if (!options.some((o) => o.toLowerCase() === g.answer.trim().toLowerCase())) {
        options.push(g.answer.trim());
      }
      return { ...g, answer: g.answer.trim(), options: options.slice(0, 4) };
    })
    // Trimming to four options can drop the answer; skip those items.
    .filter((g) => g.options.some((o) => o.toLowerCase() === g.answer.toLowerCase()));

  return {
    topic: pack.topic.trim() || "Your notes",
    subject: pack.subject.trim(),
    summary: pack.summary.map(clean).filter(Boolean).slice(0, 8),
    keyFact: pack.keyFact.trim(),
    flashcards: pack.flashcards.filter((c) => c.q.trim() && c.a.trim()).slice(0, 12),
    quiz: quiz.slice(0, 8),
    match,
    trueFalse: pack.trueFalse.filter((t) => t.statement.trim()).slice(0, 8),
    gaps: gaps.slice(0, 6),
  };
}

/** Example pack so the games and revision screens work before any notes are posted. */
export const SAMPLE_PACK: RevisionPack = {
  topic: "Photosynthesis",
  subject: "Science",
  summary: [
    "Plants make their own food (glucose) using light energy.",
    "It happens in the chloroplasts. Green chlorophyll absorbs the light.",
    "Oxygen is released as a by-product.",
  ],
  keyFact: "carbon dioxide + water → glucose + oxygen",
  flashcards: [
    { q: "Where does photosynthesis happen?", a: "In the chloroplasts of plant cells." },
    { q: "What is the word equation?", a: "Carbon dioxide + water → glucose + oxygen" },
    { q: "What absorbs the light energy?", a: "Chlorophyll, the green pigment." },
  ],
  quiz: [
    {
      question: "Which gas do plants release during photosynthesis?",
      options: ["Carbon dioxide", "Oxygen", "Nitrogen"],
      answer: 1,
      explanation: "Plants take in carbon dioxide and give out oxygen.",
    },
    {
      question: "What does chlorophyll do?",
      options: ["Stores water", "Absorbs light", "Makes oxygen gas into sugar"],
      answer: 1,
      explanation: "Chlorophyll is the green pigment that absorbs light energy.",
    },
  ],
  match: [
    { term: "Chloroplast", meaning: "Where photosynthesis happens" },
    { term: "Chlorophyll", meaning: "Green pigment that absorbs light" },
    { term: "Glucose", meaning: "Sugar the plant makes" },
    { term: "Oxygen", meaning: "Gas released as a by-product" },
  ],
  trueFalse: [
    {
      statement: "Plants take in oxygen to do photosynthesis.",
      answer: false,
      why: "They take in carbon dioxide and give out oxygen.",
    },
    {
      statement: "Chlorophyll is the green pigment in leaves.",
      answer: true,
      why: "Chlorophyll absorbs the light.",
    },
    { statement: "Photosynthesis needs light energy.", answer: true, why: "No light, no glucose." },
    {
      statement: "Glucose is a gas the plant releases.",
      answer: false,
      why: "Glucose is a sugar the plant keeps.",
    },
  ],
  gaps: [
    {
      before: "Photosynthesis takes place in the",
      answer: "chloroplasts",
      after: ".",
      options: ["nucleus", "chloroplasts", "roots"],
    },
    {
      before: "Plants release",
      answer: "oxygen",
      after: " as a by-product.",
      options: ["oxygen", "glucose", "water"],
    },
    {
      before: "Green",
      answer: "chlorophyll",
      after: " absorbs the light energy.",
      options: ["starch", "cytoplasm", "chlorophyll"],
    },
  ],
};

// ---------- Reading an unchecked AI reply ----------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objs = (v: unknown): Obj[] => list(v).filter(isObj);

/**
 * Builds a pack from JSON whose shape was only requested, not enforced
 * (the web version asks Claude for JSON in plain text). Missing or
 * wrong-typed fields become empty, then normalizePack drops bad items.
 */
export function coercePack(value: unknown): RevisionPack {
  if (!isObj(value)) {
    throw new Error("The AI reply wasn't a revision pack. Please try again.");
  }
  return normalizePack({
    topic: str(value.topic),
    subject: str(value.subject),
    summary: list(value.summary).map(str),
    keyFact: str(value.keyFact),
    flashcards: objs(value.flashcards).map((c) => ({ q: str(c.q), a: str(c.a) })),
    quiz: objs(value.quiz).map((q) => ({
      question: str(q.question),
      options: list(q.options).map(str),
      answer: typeof q.answer === "number" ? q.answer : Number(str(q.answer)),
      explanation: str(q.explanation),
    })),
    match: objs(value.match).map((m) => ({ term: str(m.term), meaning: str(m.meaning) })),
    trueFalse: objs(value.trueFalse).map((t) => ({
      statement: str(t.statement),
      answer: t.answer === true || t.answer === "true",
      why: str(t.why),
    })),
    gaps: objs(value.gaps).map((g) => ({
      before: str(g.before),
      answer: str(g.answer),
      after: str(g.after),
      options: list(g.options).map(str),
    })),
  });
}
