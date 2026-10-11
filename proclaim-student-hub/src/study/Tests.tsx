import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import { Overlay } from "../components/Overlay.tsx";
import { useAiContext, useApp } from "../context.ts";
import { dayString } from "../lab/model.ts";
import { packFromTopic } from "../lab/scan.ts";
import { examHandoff, labPacks, settings } from "../lab/store.ts";
import { autoPackInBackground } from "../lib/autoPack.ts";
import { cleanTopic } from "../lib/daySummary.ts";
import { courses } from "../lib/store.ts";
import {
  daysBetween,
  dayOf,
  labHandoff,
  labSubject,
  newId,
  notes,
  packToNote,
  prepPlan,
  prepTests,
  suggestTests,
  testHandoff,
  type PrepDay,
  type PrepTest,
  type TestSuggestion,
} from "../lib/study.ts";
import { subjectTone, subjectVars } from "../lib/subjects.ts";
import { useEscape } from "../lib/useEscape.ts";
import { useOpenStep } from "../lib/useOpenStep.ts";
import { GradesSection } from "./Grades.tsx";

// Tests coming up, each with a plan for every day until the test: get the
// material, learn it, practise, a mock test the day before, a recap on the day.

const dayLabel = (day: string, today: string) =>
  day === today
    ? "Today"
    : new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });

const countdown = (date: string, today: string) => {
  const n = daysBetween(today, date);
  return n === 0 ? "Today!" : n === 1 ? "Tomorrow" : n < 0 ? "Done" : `In ${n} days`;
};

export function Tests({
  onOpenNote,
  header,
  view = "tests",
}: {
  onOpenNote: (id: string) => void;
  /** Shown above the list, but not over an open test. */
  header?: ReactNode;
  /** Tests list, or just the grades. */
  view?: "tests" | "grades";
}) {
  const { homework, ai, toast } = useApp();
  const today = dayOf(new Date());
  const [list, setList] = useState<PrepTest[]>(prepTests.all);
  // An open plan is its own history step, so phone Back returns to the list.
  const [open, openPlan, closePlan] = useOpenStep("pshPlan", testHandoff.take());
  const [adding, setAdding] = useState<TestSuggestion | null>(null);
  const suggestions = useMemo(
    () => suggestTests({ homework: homework ?? [], courses: courses.get(), existing: list }, today),
    [homework, list, today],
  );
  const upcoming = list
    .filter((t) => t.date >= today)
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const past = list.filter((t) => t.date < today);
  useAiContext(
    "Tests coming up: " + upcoming.map((t) => `${t.subject}: ${t.topic} on ${t.date}`).join("; "),
  );

  const save = (next: PrepTest[]) => {
    setList(next);
    prepTests.save(next);
  };

  const current = list.find((t) => t.id === open);
  if (current) {
    return (
      <TestPlan
        test={current}
        today={today}
        onOpenNote={onOpenNote}
        onBack={closePlan}
        onChange={(t) => save(list.map((x) => (x.id === t.id ? t : x)))}
        onDelete={() => {
          save(list.filter((x) => x.id !== current.id));
          closePlan();
        }}
      />
    );
  }

  return (
    <>
      {header}
      {suggestions.length > 0 && (
        <section className="card stack rise" style={{ gap: 10 }}>
          <span className="chip violet">
            <Icon name="sparkle" size={14} />
            Spotted in your classes
          </span>
          {suggestions.map((s) => (
            <div key={s.topic} className="between" style={{ gap: 10 }}>
              <span style={{ minWidth: 0 }}>
                <strong>{s.topic}</strong>
                <span className="muted s12" style={{ display: "block" }}>
                  {s.subject}
                  {s.date ? ` · ${dayLabel(s.date, today)}` : " · date unknown"}
                </span>
              </span>
              <button className="btn primary sm" onClick={() => setAdding(s)}>
                <Icon name="plus" size={16} />
                Plan it
              </button>
            </div>
          ))}
        </section>
      )}

      {view === "tests" && upcoming.length === 0 && suggestions.length === 0 && (
        <div className="card empty">
          No tests yet. Tap + and paste the test date, and you'll get a plan for every day until it.
        </div>
      )}

      {view === "tests" && upcoming.length > 0 && (
        <NextTest test={upcoming[0]} today={today} onOpen={() => openPlan(upcoming[0].id)} />
      )}

      {view === "tests" && upcoming.length > 1 && (
        <section className="card rows rise" aria-label="More tests">
          <div className="between" style={{ padding: "14px 16px 4px" }}>
            <h2 className="h2">Coming up</h2>
            <span className="muted s13">{upcoming.length - 1}</span>
          </div>
          {upcoming.slice(1).map((t) => (
            <button key={t.id} className="li test-li" onClick={() => openPlan(t.id)}>
              <span className="test-date num">
                {new Date(`${t.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}
                <br />
                {Number(t.date.slice(8, 10))}
              </span>
              <span className="stack" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <span className="li-main">{cleanTopic(t.subject, t.topic)}</span>
                <span className="muted s13">{t.subject}</span>
              </span>
              <span
                className={`chip ${daysBetween(today, t.date) <= 3 ? "magenta" : `tone-${subjectTone(t.subject)}`}`}
              >
                {daysBetween(today, t.date)} {daysBetween(today, t.date) === 1 ? "day" : "days"}
              </span>
            </button>
          ))}
        </section>
      )}

      {view === "tests" && (
        <button
          className="btn ghost"
          aria-label="Add a test"
          onClick={() => setAdding({ subject: "", topic: "", date: "", from: "" })}
        >
          <Icon name="plus" size={16} />
          Add a test
        </button>
      )}

      {view === "tests" && past.length > 0 && (
        <details className="card">
          <summary className="muted">Past tests ({past.length})</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {past.map((t) => (
              <div key={t.id} className="between">
                <span>
                  {t.subject}: {t.topic}
                </span>
                <button
                  className="link-btn"
                  onClick={() => save(list.filter((x) => x.id !== t.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {(view === "grades" || upcoming.length <= 2) && <GradesSection tests={past} />}

      {adding && (
        <AddTest
          start={adding}
          today={today}
          onClose={() => setAdding(null)}
          onAdd={(t) => {
            save([...list, t]);
            setAdding(null);
            openPlan(t.id);
            // The AI builds the pack while the plan opens.
            autoPackInBackground(ai, t, toast, () => setList(prepTests.all()));
          }}
        />
      )}
    </>
  );
}

/** The next test as the hero card: countdown, prep steps and today's step. */
function NextTest({ test, today, onOpen }: { test: PrepTest; today: string; onOpen: () => void }) {
  const { go, toast } = useApp();
  const plan = prepPlan(test, today);
  const todayStep = plan.find((d) => d.date === today);
  const days = daysBetween(today, test.date);
  const ready = plan.length ? Math.round((test.done.length / plan.length) * 100) : 0;
  const pack = labPacks.all().find((p) => p.id === test.packId) ?? null;
  const cards = pack?.items.length ?? 0;

  // Today's step straight away; without material yet, the plan says how to get it.
  const reviseNow = () => {
    const action = todayStep?.action ?? "flashcards";
    if (!pack || action === "material") {
      onOpen();
      return;
    }
    labHandoff.set({ kind: "open", packId: pack.id, action });
    go("revise");
  };
  // The Lab's timed exam on this test's pack, once there are enough items.
  const examMode = () => {
    if (!pack || cards < 3) {
      toast("Exam mode needs this test's material first. Add a photo or make it from the topic.");
      onOpen();
      return;
    }
    examHandoff.set(pack.id);
    go("revise");
  };

  return (
    <section className="card hero magenta test-hero test-card rise">
      <button
        className="test-open"
        onClick={onOpen}
        aria-label={`Open the plan for ${test.subject}`}
      >
        <div className="between" style={{ alignItems: "flex-start", gap: 12 }}>
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <span className="now-eyebrow">Next test · {dayLabel(test.date, today)}</span>
            <strong className="test-title">
              {test.subject} · {cleanTopic(test.subject, test.topic)}
            </strong>
          </div>
          <span className="test-days">
            <b>{days}</b>
            <span>{days === 1 ? "DAY" : "DAYS"}</span>
          </span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="between s13" style={{ fontWeight: 800 }}>
            <span>Ready</span>
            <span>{ready}%</span>
          </div>
          <div className="pbar" aria-hidden="true">
            <i style={{ transform: `scaleX(${ready / 100})` }} />
          </div>
          <span className="s13">
            {todayStep
              ? test.done.includes(today)
                ? "Done for today. Nice."
                : `Today: ${todayStep.title}${cards ? ` · ${cards} cards` : ""} · ${todayStep.minutes} min`
              : `Plan: 10 minutes a day, ${plan.length} ${plan.length === 1 ? "day" : "days"}.`}
          </span>
        </div>
      </button>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" style={{ flex: 1.4 }} onClick={reviseNow}>
          Revise now · {todayStep?.minutes ?? 10} min
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={examMode}>
          <Icon name="timer" size={18} />
          Exam mode
        </button>
      </div>
    </section>
  );
}

function AddTest({
  start,
  today,
  onAdd,
  onClose,
}: {
  start: TestSuggestion;
  today: string;
  onAdd: (t: PrepTest) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(start.subject);
  const [topic, setTopic] = useState(start.topic);
  const [date, setDate] = useState(start.date);
  const subjects = [...new Set(courses.get().map((c) => c.subject))];
  useEscape(onClose);
  return (
    <Overlay>
      <div className="backdrop" onClick={onClose}>
        <form
          className="sheet"
          role="dialog"
          aria-label="Add a test"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            if (subject.trim() && topic.trim() && date >= today) {
              onAdd({
                id: newId("x"),
                subject: subject.trim(),
                topic: topic.trim(),
                date,
                start: today,
                packId: "",
                done: [],
              });
            }
          }}
        >
          <h2 className="h1" style={{ fontSize: 24 }}>
            Plan a test
          </h2>
          <label className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">Subject</span>
            <input
              className="field"
              list="test-subjects"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Spanish"
            />
            <datalist id="test-subjects">
              {subjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">What's it on?</span>
            <input
              className="field"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Unit 1.1c vocab: ¿Qué haces en casa?"
            />
          </label>
          <label className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">Test date</span>
            <input
              className="field"
              type="date"
              lang="en-GB"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="btn big primary"
            type="submit"
            disabled={!subject.trim() || !topic.trim() || !date || date < today}
          >
            Make my prep plan
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </form>
      </div>
    </Overlay>
  );
}

function TestPlan({
  test,
  today,
  onOpenNote,
  onBack,
  onChange,
  onDelete,
}: {
  test: PrepTest;
  today: string;
  onOpenNote: (id: string) => void;
  onBack: () => void;
  onChange: (t: PrepTest) => void;
  onDelete: () => void;
}) {
  const { ai, go, handleError, toast } = useApp();
  const [making, setMaking] = useState(false);
  const pack = labPacks.all().find((p) => p.id === test.packId) ?? null;
  const plan = prepPlan(test, today);
  const note = pack ? notes.all().find((n) => n.packId === pack.id) : undefined;
  useAiContext(
    `Test prep: ${test.subject}, "${test.topic}" on ${test.date}. Plan: ` +
      plan.map((d) => `${d.date}: ${d.title}`).join("; ") +
      (pack
        ? `. Pack items: ${pack.items.map((i) => `${i.prompt} = ${i.answer}`).join("; ")}`
        : ""),
  );

  const toggleDay = (day: PrepDay) =>
    onChange({
      ...test,
      done: test.done.includes(day.date)
        ? test.done.filter((d) => d !== day.date)
        : [...test.done, day.date],
    });

  const takePhoto = () => {
    labHandoff.set({
      kind: "scan",
      subject: test.subject,
      topic: test.topic,
      text: "",
      photos: [],
      testId: test.id,
    });
    go("revise");
  };

  const makeFromTopic = async () => {
    if (!ai) {
      toast("The AI needs you on claude.ai.");
      return;
    }
    setMaking(true);
    try {
      const subject = labSubject(test.subject);
      const found = await packFromTopic(
        ai,
        { subject, topic: test.topic, extra: "" },
        settings.get(),
        dayString(new Date()),
      );
      if (found.items.length === 0) {
        throw new Error(
          "Couldn't make a pack for that topic. Try a photo of the material instead.",
        );
      }
      const made = {
        ...found,
        subject,
        topic: test.topic.slice(0, 80),
        id: `p${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        photo: "",
        labels: [],
      };
      labPacks.saveAll([...labPacks.all(), made]);
      notes.upsert(packToNote(made));
      onChange({ ...test, packId: made.id });
      toast("Pack, notes and vocab list ready. Check them against your class material.");
    } catch (err) {
      handleError(err);
    } finally {
      setMaking(false);
    }
  };

  const start = (day: PrepDay) => {
    if (day.action === "material" || !pack) {
      toast("First get your material: take a photo, or make it from the topic.");
      return;
    }
    labHandoff.set({ kind: "open", packId: pack.id, action: day.action });
    go("revise");
  };

  return (
    <>
      <header className="stack rise" style={{ gap: 4, ...subjectVars(test.subject) }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Tests
        </button>
        <span className="eyebrow row" style={{ gap: 6 }}>
          <span className="subject-dot" /> {test.subject} · {dayLabel(test.date, today)}
        </span>
        <h2 className="h1" style={{ fontSize: 24 }}>
          {test.topic}
        </h2>
        <span className="chip accent" style={{ alignSelf: "flex-start" }}>
          {countdown(test.date, today)}
        </span>
      </header>

      <section className="card stack">
        <h3 className="h2">Your material</h3>
        {pack ? (
          <>
            <span className="muted">
              {pack.items.length} items
              {pack.items.every((i) => i.origin === "ai")
                ? " · made by AI, check with your class material"
                : ""}
            </span>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button
                className="btn small primary"
                onClick={() => {
                  labHandoff.set({ kind: "open", packId: pack.id, action: "" });
                  go("revise");
                }}
              >
                <Icon name="game" size={14} />
                Flashcards, quiz & games
              </button>
              {note && (
                <button className="btn small" onClick={() => onOpenNote(note.id)}>
                  <Icon name="keep" size={14} />
                  Notes & vocab list
                </button>
              )}
              <button className="btn small ghost" onClick={takePhoto}>
                <Icon name="camera" size={14} />
                Add a photo
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="muted">
              Take a photo of the vocab list or notes, or let the AI make a pack from the topic.
            </span>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn small primary" onClick={takePhoto}>
                <Icon name="camera" size={14} />
                Take a photo
              </button>
              <button className="btn small" disabled={making} onClick={() => void makeFromTopic()}>
                <Icon
                  name={making ? "loader" : "sparkle"}
                  size={14}
                  className={making ? "spin" : undefined}
                />
                {making ? "Making it…" : "Make it from the topic"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h3 className="h2">Day by day</h3>
        {plan.map((d) => {
          const done = test.done.includes(d.date);
          return (
            <div
              key={d.date}
              className={`prep-day${d.date === today ? " today" : ""}${done ? " done" : ""}`}
            >
              <input
                type="checkbox"
                checked={done}
                onChange={() => toggleDay(d)}
                aria-label={`Mark ${dayLabel(d.date, today)} done`}
              />
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span className="eyebrow">
                  {dayLabel(d.date, today)} · {d.left === 0 ? "test day" : `${d.left} to go`}
                </span>
                <strong>{d.title}</strong>
                <span className="muted">
                  {d.detail} · {d.minutes} min
                </span>
              </div>
              {!done && (d.date <= today || pack) && (
                <button
                  className="btn small"
                  onClick={() => (d.action === "material" && !pack ? takePhoto() : start(d))}
                >
                  Start
                </button>
              )}
            </div>
          );
        })}
      </section>

      <button
        className="btn ghost"
        onClick={() => {
          if (window.confirm(`Delete the plan for "${test.topic}"?`)) {
            onDelete();
          }
        }}
      >
        Delete this test
      </button>
    </>
  );
}
