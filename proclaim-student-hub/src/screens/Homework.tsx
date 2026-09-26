import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { dueLabel, isUrgent } from "../lib/format.ts";
import { OTHER_SOURCES, type Homework, type Source } from "../lib/types.ts";

type Filter = "All" | Source;

export function HomeworkScreen() {
  const { data, homework, reloadHomework } = useApp();
  const [filter, setFilter] = useState<Filter>("All");
  const [adding, setAdding] = useState(false);

  const list = (homework ?? []).filter((h) => !h.done && (filter === "All" || h.source === filter));
  const sources = new Set((homework ?? []).map((h) => h.source));
  const filters: Filter[] = ["All", "Classroom", ...OTHER_SOURCES.filter((s) => sources.has(s))];

  return (
    <main className="screen">
      <header className="between rise">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="h1">Homework</h1>
          <p className="sub">{data.labels.homeworkSub}</p>
        </div>
        <button className="round dark" aria-label="Add homework" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} />
        </button>
      </header>

      <div className="pills" role="group" aria-label="Filter by app">
        {filters.map((f) => (
          <button key={f} className="pill" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        <button className="pill" onClick={reloadHomework} aria-label="Refresh">
          <Icon name="sync" size={14} />
        </button>
      </div>

      {homework === null ? (
        <div className="card stack">
          <div className="skeleton light" />
          <div className="skeleton light" style={{ width: "60%" }} />
        </div>
      ) : list.length === 0 ? (
        <div className="card empty">
          Nothing here. Tap + to add homework from Dr Frost, Desmos or another app.
        </div>
      ) : (
        <div className="stack">
          {list.map((hw, i) => (
            <HomeworkCard key={hw.id} hw={hw} delay={i * 0.06} />
          ))}
        </div>
      )}

      {adding && <AddHomework onClose={() => setAdding(false)} />}
    </main>
  );
}

function HomeworkCard({ hw, delay }: { hw: Homework; delay: number }) {
  const { openAssignment, askTutor, data, replaceHomework, handleError, toast } = useApp();
  const inApp = hw.source === "Classroom";

  return (
    <article className="card stack rise" style={{ animationDelay: `${delay}s` }}>
      <div className="between">
        <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          {hw.course === hw.source ? hw.source : `${hw.course} · ${hw.source}`}
        </span>
        <span className={`chip${isUrgent(hw.due) ? " warm" : ""}`}>{dueLabel(hw.due)}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{hw.title}</div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          className="btn small dark"
          onClick={() =>
            askTutor(
              `Help me with my homework: "${hw.title}" (${hw.course}).${hw.description ? `\n\nInstructions: ${hw.description}` : ""}`,
            )
          }
        >
          <Icon name="sparkle" size={14} />
          Help me
        </button>
        {inApp ? (
          <button className="btn small primary" onClick={() => openAssignment(hw)}>
            Do it here
          </button>
        ) : (
          <>
            <a className="btn small" href={hw.link} target="_blank" rel="noopener noreferrer">
              Open in {hw.source}
            </a>
            <button
              className="btn small"
              onClick={async () => {
                replaceHomework({ ...hw, done: true });
                try {
                  await data.setDone(hw, true);
                  toast(data.labels.ticked);
                } catch (err) {
                  replaceHomework(hw);
                  handleError(err);
                }
              }}
            >
              <Icon name="check" size={14} />
              Done
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function AddHomework({ onClose }: { onClose: () => void }) {
  const { data, addHomeworkItem, handleError, toast } = useApp();
  const [title, setTitle] = useState("");
  // When Classroom doesn't sync by itself, Classroom work is added here too.
  const choices: Source[] = data.hasClassroom ? OTHER_SOURCES : ["Classroom", ...OTHER_SOURCES];
  const [source, setSource] = useState<Source>(choices[0]);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label="Add homework"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) {
            return;
          }
          setBusy(true);
          try {
            addHomeworkItem(
              await data.addHomework({ title: title.trim(), source, due: due || undefined }),
            );
            toast(data.labels.added);
            onClose();
          } catch (err) {
            handleError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          Add homework
        </h2>
        <p className="sub">{data.labels.addNote}</p>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">What is it?</span>
          <input
            className="field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Task 13: Simultaneous equations"
            autoFocus
          />
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Which app?</span>
          <select
            className="field"
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
          >
            {choices.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Due date</span>
          <input
            className="field"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <button className="btn big primary" type="submit" disabled={busy || !title.trim()}>
          {busy && <Icon name="loader" size={18} className="spin" />}
          Add
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
