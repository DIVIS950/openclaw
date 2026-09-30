import { useState } from "react";
import { AddAnythingButton } from "../components/AddAnything.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { progress, weekLog } from "../lib/store.ts";
import { dayOf, groupTodos, newId, noteHandoff, todos, type Todo } from "../lib/study.ts";
import { Notes } from "./Notes.tsx";
import { Tests } from "./Tests.tsx";
import { Tutoring } from "./Tutoring.tsx";

// The four study screens: To-do, Tests (day-by-day prep) and Notes sit in the
// taskbar; Tutoring opens from Today. They hand work to each other (a note
// opened from a test or a tutor goes through noteHandoff) and to the Revision Lab.

function ScreenHead({ title, sub, back }: { title: string; sub: string; back?: boolean }) {
  const { go } = useApp();
  return (
    <header className="stack rise" style={{ gap: 4 }}>
      {back && (
        <button
          className="link-btn"
          style={{ alignSelf: "flex-start" }}
          onClick={() => go("today")}
        >
          ‹ Today
        </button>
      )}
      <h1 className="h1">{title}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {sub}
      </p>
    </header>
  );
}

/** Opens a note on the Notes screen from anywhere. */
function useOpenNote() {
  const { go } = useApp();
  return (id: string) => {
    noteHandoff.set(id);
    go("notes");
  };
}

export function TodoScreen() {
  const [version, setVersion] = useState(0);
  return (
    <main className="screen">
      <ScreenHead title="To-do" sub="Everything you need to get done, by when it's due." />
      <AddAnythingButton
        big
        label="Add anything: paste or photo, the AI sorts it"
        onSaved={() => setVersion((v) => v + 1)}
      />
      <TodoList key={version} />
    </main>
  );
}

export function TestsScreen() {
  const openNote = useOpenNote();
  return (
    <main className="screen">
      <Tests
        onOpenNote={openNote}
        header={<ScreenHead title="Tests" sub="A little preparation every day until the test." />}
      />
    </main>
  );
}

export function NotesScreen() {
  const [noteId, setNoteId] = useState<string | null>(() => noteHandoff.take());
  return (
    <main className="screen">
      <Notes
        key={noteId ?? "list"}
        openId={noteId}
        onClose={() => setNoteId(null)}
        header={<ScreenHead title="Notes" sub="Your notes, vocab lists and class material." />}
      />
    </main>
  );
}

export function TutoringScreen() {
  const openNote = useOpenNote();
  return (
    <main className="screen">
      <Tutoring
        onOpenNote={openNote}
        header={
          <ScreenHead
            back
            title="Tutoring"
            sub="Your tutors, their material and lesson homework."
          />
        }
      />
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
      weekLog.add("todo", 1);
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
