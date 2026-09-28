import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { progress } from "../lib/store.ts";
import {
  dayOf,
  groupTodos,
  newId,
  studyTab,
  todos,
  type StudyTab,
  type Todo,
} from "../lib/study.ts";
import { Notes } from "./Notes.tsx";
import { Tests } from "./Tests.tsx";
import { Tutoring } from "./Tutoring.tsx";

// The Study hub: To-do, Tests (day-by-day prep), Notes and Tutoring. Each is
// its own tab, and they hand work to each other and to the Revision Lab.

const TABS: { id: StudyTab; label: string }[] = [
  { id: "todo", label: "To-do" },
  { id: "tests", label: "Tests" },
  { id: "notes", label: "Notes" },
  { id: "tutoring", label: "Tutoring" },
];

export function Study() {
  const [tab, setTab] = useState<StudyTab>(() => studyTab.take() ?? "todo");
  const [noteId, setNoteId] = useState<string | null>(null);
  const openNote = (id: string) => {
    setNoteId(id);
    setTab("notes");
  };
  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 12 }}>
        <h1 className="h1">Study</h1>
        <div className="segmented" style={{ gridTemplateColumns: "repeat(4, 1fr)" }} role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>
      {tab === "todo" && <TodoList />}
      {tab === "tests" && <Tests onOpenNote={openNote} />}
      {tab === "notes" && (
        <Notes key={noteId ?? "list"} openId={noteId} onClose={() => setNoteId(null)} />
      )}
      {tab === "tutoring" && <Tutoring onOpenNote={openNote} />}
    </main>
  );
}

function dueText(due: string, today: string): string {
  if (!due) {
    return "";
  }
  if (due === today) {
    return "Today";
  }
  const d = new Date(`${due}T12:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function TodoList() {
  const { toast } = useApp();
  const [list, setList] = useState<Todo[]>(todos.all);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const today = dayOf(new Date());
  const groups = groupTodos(list, today);
  useAiContext(
    "To-do list: " +
      list
        .filter((t) => !t.done)
        .map((t) => `${t.text}${t.due ? ` (due ${t.due})` : ""}`)
        .join("; "),
  );

  const save = (next: Todo[]) => {
    setList(next);
    if (!todos.save(next)) {
      toast("This device is out of space, so the change wasn't saved.");
    }
  };

  const toggle = (t: Todo) => {
    if (!t.done) {
      progress.add(2);
    }
    save(list.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
  };

  const section = (title: string, items: Todo[], warm = false) =>
    items.length > 0 && (
      <section className="stack" style={{ gap: 6 }}>
        <h2 className={`eyebrow${warm ? " warm-text" : ""}`}>{title}</h2>
        <div className="list">
          {items.map((t) => (
            <div key={t.id} className={`hw-row${t.done ? " hw-done" : ""}`}>
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => toggle(t)}
                aria-label={`Mark "${t.text}" done`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hw-title">{t.text}</div>
                {(t.from || t.subject) && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[t.subject, t.from].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              {t.due && (
                <span className={`chip${t.due < today && !t.done ? " warm" : ""}`}>
                  {dueText(t.due, today)}
                </span>
              )}
              <button
                className="round"
                style={{ width: 32, height: 32 }}
                aria-label={`Delete "${t.text}"`}
                onClick={() => save(list.filter((x) => x.id !== t.id))}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    );

  return (
    <>
      <form
        className="card stack rise"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            save([
              ...list,
              { id: newId("t"), text: text.trim(), due, subject: "", from: "", done: false },
            ]);
            setText("");
            setDue("");
          }
        }}
      >
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a to-do…"
          aria-label="New to-do"
        />
        <div className="row">
          <input
            className="field"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date (optional)"
            style={{ flex: 1 }}
          />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            <Icon name="plus" size={16} />
            Add
          </button>
        </div>
      </form>

      {list.length === 0 && (
        <div className="card empty">
          Nothing to do yet. Add things here; tutoring homework and notes can add to-dos too.
        </div>
      )}
      {section("Overdue", groups.overdue, true)}
      {section("Today", groups.today)}
      {section("Coming up", groups.later)}
      {section("Any time", groups.someday)}
      {groups.done.length > 0 && (
        <>
          {section("Done", groups.done)}
          <button className="btn ghost" onClick={() => save(list.filter((t) => !t.done))}>
            Clear done
          </button>
        </>
      )}
    </>
  );
}
