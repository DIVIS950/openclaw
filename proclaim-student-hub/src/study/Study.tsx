import { useEffect, useState } from "react";
import { BackButton } from "../components/BackButton.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { todoXp } from "../lib/store.ts";
import {
  dayOf,
  groupTodos,
  newId,
  noteHandoff,
  realDay,
  todos,
  TODOS_CHANGED,
  type Todo,
} from "../lib/study.ts";
import { Notes } from "./Notes.tsx";
import { Tests } from "./Tests.tsx";
import { Tutoring } from "./Tutoring.tsx";

// The four study screens: To-do, Tests (day-by-day prep) and Notes sit in the
// taskbar; Tutoring opens from Today. They hand work to each other (a note
// opened from a test or a tutor goes through noteHandoff) and to the Revision Lab.

function ScreenHead({
  title,
  right,
}: {
  title: string;
  /** Whatever sits at the right of the title: a chip, a segmented control. */
  right?: React.ReactNode;
}) {
  return (
    <header className="between rise" style={{ alignItems: "center", gap: 10 }}>
      <h1 className="h1">{title}</h1>
      {right}
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
  return (
    <main className="screen">
      <BackButton />
      <TodoList />
    </main>
  );
}

export function TestsScreen() {
  const openNote = useOpenNote();
  const [view, setView] = useState<"tests" | "grades">("tests");
  return (
    <main className="screen">
      <Tests
        onOpenNote={openNote}
        view={view}
        header={
          // Only over the list: an open test plan has its own "‹ Tests".
          <>
            <BackButton />
            <ScreenHead
              title="Tests"
              right={
                <div className="segmented" role="tablist" style={{ width: 170 }}>
                  <button
                    role="tab"
                    aria-selected={view === "tests"}
                    onClick={() => setView("tests")}
                  >
                    Tests
                  </button>
                  <button
                    role="tab"
                    aria-selected={view === "grades"}
                    onClick={() => setView("grades")}
                  >
                    Grades
                  </button>
                </div>
              }
            />
          </>
        }
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
        header={
          // Only over the list: an open note has its own way back to it.
          <>
            <BackButton />
            <h1 className="h1 rise">Notes</h1>
          </>
        }
      />
    </main>
  );
}

export function TutoringScreen() {
  const openNote = useOpenNote();
  return (
    <main className="screen">
      <BackButton />
      <Tutoring onOpenNote={openNote} />
    </main>
  );
}

function dueText(due: string, today: string): string {
  if (!realDay(due)) {
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
  useEffect(() => {
    const reload = () => setList(todos.all());
    window.addEventListener(TODOS_CHANGED, reload);
    return () => window.removeEventListener(TODOS_CHANGED, reload);
  }, []);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  void setDue;
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
    if (t.done) {
      todoXp.undo(t.id);
    } else {
      todoXp.tick(t.id);
    }
    save(list.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
  };

  const sourceChip = (t: Todo) => {
    const from = t.from.toLowerCase();
    const cls = from.startsWith("tutoring")
      ? "magenta"
      : from.includes("inbox") || from.includes("email")
        ? "cyan"
        : from.includes("note")
          ? "violet"
          : "";
    const label = from.startsWith("tutoring")
      ? "Tutor"
      : from.includes("inbox") || from.includes("email")
        ? "Inbox"
        : from.includes("note")
          ? "Note"
          : t.from || "Me";
    return <span className={`chip ${cls}`.trim()}>{label}</span>;
  };

  const section = (title: string, items: Todo[], warm = false) =>
    items.length > 0 && (
      <section className="stack" style={{ gap: 8 }}>
        <h2 className={`eyebrow${warm ? " fix-text" : ""}`} style={{ paddingLeft: 4 }}>
          {title}
        </h2>
        <div className="card rows">
          {items.map((t) => (
            <label key={t.id} className="item">
              <input
                className="cb"
                type="checkbox"
                checked={t.done}
                onChange={() => toggle(t)}
                aria-label={`Mark "${t.text}" done`}
              />
              <span className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                <span
                  className={t.done ? "todo-text done" : "todo-text"}
                  style={{ fontWeight: 600 }}
                >
                  {t.text}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {sourceChip(t)}
                  {(t.from || t.due) && (
                    <span className="s11 muted">
                      {[
                        t.from && !t.from.toLowerCase().startsWith("tutoring") && t.from !== "Me"
                          ? ""
                          : t.from.toLowerCase().startsWith("tutoring")
                            ? `from ${t.from.replace(/^Tutoring with /i, "")}`
                            : "",
                        t.due ? dueText(t.due, today) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </span>
              {!t.done && (
                <button
                  type="button"
                  className="round"
                  style={{ width: 32, height: 32 }}
                  aria-label={`Delete "${t.text}"`}
                  onClick={() => {
                    const at = list.findIndex((x) => x.id === t.id);
                    save(list.filter((x) => x.id !== t.id));
                    // Undo puts back only this to-do, into the list as it is now.
                    toast("To-do deleted.", {
                      label: "Undo",
                      run: () => {
                        const now = todos.all();
                        if (!now.some((x) => x.id === t.id)) {
                          save([...now.slice(0, at), t, ...now.slice(at)]);
                        }
                      },
                    });
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </label>
          ))}
        </div>
      </section>
    );

  const openCount = list.filter((t) => !t.done).length;
  const [todayDue, setTodayDue] = useState(false);

  return (
    <>
      <header className="between rise" style={{ alignItems: "center" }}>
        <h1 className="h1">To-do</h1>
        <span className="chip">
          <span className="num" style={{ color: "var(--accent-t)" }}>
            {openCount}
          </span>
          open
        </span>
      </header>
      <form
        className="row rise todo-form"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            save([
              ...list,
              {
                id: newId("t"),
                text: text.trim(),
                due: todayDue ? today : due,
                subject: "",
                from: "",
                done: false,
              },
            ]);
            setText("");
            setDue("");
            setTodayDue(false);
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
        <button
          type="button"
          className={`btn${todayDue ? " primary" : ""}`}
          aria-pressed={todayDue}
          onClick={() => setTodayDue((v) => !v)}
        >
          <Icon name="calendar" size={18} />
          Today
        </button>
        <button
          className="round r48 primary"
          type="submit"
          aria-label="Add"
          disabled={!text.trim()}
        >
          <Icon name="plus" size={20} />
        </button>
      </form>

      {list.length === 0 && (
        <div className="card empty">
          Nothing to do yet. Add things here; tutoring homework and notes can add to-dos too.
        </div>
      )}
      {section("Overdue", groups.overdue, true)}
      {section("Today", groups.today)}
      {section("This week", groups.later)}
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
