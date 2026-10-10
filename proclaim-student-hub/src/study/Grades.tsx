import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { bySubject, grades, letter, parseScore, percent, type Grade } from "../lib/grades.ts";
import { dayOf, type PrepTest } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import { useEscape } from "../lib/useEscape.ts";

// Grades: real marks from tests, per subject, with the weakest subject first so
// it's obvious where the next revision should go.

/** `tests` are past tests: the ones with no grade yet get an "Add grade" row. */
export function GradesSection({ tests }: { tests: PrepTest[] }) {
  const [list, setList] = useState<Grade[]>(grades.all);
  const [adding, setAdding] = useState<Partial<Grade> | null>(null);
  const subjects = bySubject(list);
  const ungraded = tests.filter((t) => !list.some((g) => g.testId === t.id));

  return (
    <section className="stack rise" style={{ gap: 8 }}>
      <div className="between">
        <h2 className="h2">Grades</h2>
        <button className="link-btn" onClick={() => setAdding({})}>
          + Add grade
        </button>
      </div>
      {ungraded.slice(0, 2).map((t) => (
        <button
          key={t.id}
          className="card between grade-ask"
          onClick={() =>
            setAdding({ subject: t.subject, topic: t.topic, date: t.date, testId: t.id })
          }
        >
          <span style={{ minWidth: 0 }}>
            <strong className="clip" style={{ display: "block" }}>
              {t.topic}
            </strong>
            <span className="muted">{t.subject} · how did it go?</span>
          </span>
          <span className="chip accent">Add grade</span>
        </button>
      ))}
      {subjects.length > 0 && (
        <div className="grade-grid">
          {subjects.map((s) => (
            <div key={s.subject} className="card grade-cell" style={subjectVars(s.subject)}>
              <span className="subject-dot" />
              <strong className="grade-letter">{letter(s.average)}</strong>
              <span className="clip" style={{ fontWeight: 700 }}>
                {s.subject}
              </span>
              <span className="muted">
                {s.average}% avg · {s.count} {s.count === 1 ? "test" : "tests"}
                {s.trend === "up" ? " ↑" : s.trend === "down" ? " ↓" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <details className="card">
          <summary className="muted">All grades ({list.length})</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {list.map((g) => (
              <div key={g.id} className="between" style={{ gap: 10 }}>
                <span style={{ minWidth: 0 }}>
                  <strong className="clip" style={{ display: "block" }}>
                    {g.topic || g.subject}
                  </strong>
                  <span className="muted">
                    {g.subject} · {g.date}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="chip good">
                    {g.score}/{g.outOf} · {percent(g)}%
                  </span>
                  <button
                    className="link-btn"
                    style={{ minHeight: 32 }}
                    onClick={() => {
                      const next = list.filter((x) => x.id !== g.id);
                      grades.save(next);
                      setList(next);
                    }}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
      {list.length === 0 && ungraded.length === 0 && (
        <div className="card empty">
          After each test, add the mark here. You'll see each subject's average and which one to
          work on.
        </div>
      )}
      {adding && (
        <AddGrade
          start={adding}
          onClose={() => setAdding(null)}
          onAdd={(g) => {
            setList(grades.add(g));
            setAdding(null);
          }}
        />
      )}
    </section>
  );
}

function AddGrade({
  start,
  onAdd,
  onClose,
}: {
  start: Partial<Grade>;
  onAdd: (g: Omit<Grade, "id">) => void;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const [subject, setSubject] = useState(start.subject ?? "");
  const [topic, setTopic] = useState(start.topic ?? "");
  const [date, setDate] = useState(start.date ?? dayOf(new Date()));
  // Two number fields: a phone's number keypad has no "/" or "%".
  const [score, setScore] = useState("");
  const [outOf, setOutOf] = useState("100");
  useEscape(onClose);
  const parsed =
    score.trim() && outOf.trim() ? parseScore(`${score.trim()}/${outOf.trim()}`) : null;
  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label="Add a grade"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!subject.trim()) {
            toast("Add the subject first, e.g. Maths.");
            return;
          }
          if (!parsed) {
            toast("Type the score and what it was out of, e.g. 18 out of 20.");
            return;
          }
          onAdd({
            subject: subject.trim(),
            topic: topic.trim(),
            date,
            score: parsed.score,
            outOf: parsed.outOf,
            testId: start.testId ?? "",
          });
        }}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          Add a grade
        </h2>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Subject</span>
          <input
            className="field"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Maths"
          />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Test</span>
          <input
            className="field"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Fractions quiz"
          />
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 6, flex: 1 }}>
            <span className="h2">Score</span>
            <input
              className="field"
              value={score}
              onChange={(e) => setScore(e.target.value.replace(",", "."))}
              placeholder="18"
              inputMode="decimal"
              aria-label="Score"
            />
          </label>
          <label className="stack" style={{ gap: 6, flex: 1 }}>
            <span className="h2">Out of</span>
            <input
              className="field"
              value={outOf}
              onChange={(e) => setOutOf(e.target.value.replace(",", "."))}
              placeholder="20"
              inputMode="decimal"
              aria-label="Out of"
            />
          </label>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 6, flex: 1 }}>
            <span className="h2">Date</span>
            <input
              className="field"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        {parsed && (
          <span className="chip good" style={{ alignSelf: "flex-start" }}>
            {percent(parsed)}% · {letter(percent(parsed))}
            {parsed.score > parsed.outOf ? " · more than full marks?" : ""}
          </span>
        )}
        <button className="btn big primary" type="submit">
          <Icon name="check" size={18} />
          Save grade
        </button>
      </form>
    </div>
  );
}
