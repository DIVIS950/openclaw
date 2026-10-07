import { useState } from "react";
import { CountUp } from "../components/CountUp.tsx";
import { Icon } from "../components/Icon.tsx";
import { ImportSheet } from "../components/ImportSheet.tsx";
import { SwipeDone } from "../components/SwipeDone.tsx";
import { useAiContext, useApp } from "../context.ts";
import { findHomeworkInEmails, type FoundTask } from "../lib/aiFeatures.ts";
import { syncStatus } from "../lib/classroomSync.ts";
import { dueLabel, groupByDue, isUrgent } from "../lib/format.ts";
import { courses, progress, weekLog } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";
import { OTHER_SOURCES, type Homework, type Source } from "../lib/types.ts";
import { gmailLink } from "../pages/gmailLink.ts";
import { PAGES } from "../pages/runtime.ts";
import { GmailCard } from "../pages/WebVersion.tsx";

type Filter = "All" | Source;

export function HomeworkScreen() {
  const { data, homework, reloadHomework, go } = useApp();
  const [classCount] = useState(() => courses.get().length);
  const [filter, setFilter] = useState<Filter>("All");
  const [view, setView] = useState<"todo" | "done">("todo");
  const [adding, setAdding] = useState(false);
  void setAdding;
  const [importing, setImporting] = useState(false);
  const [sync, setSync] = useState(syncStatus.get);
  const [checking, setChecking] = useState(false);
  const checkNow = () => {
    setChecking(true);
    reloadHomework(true);
    // The sync runs in the background; read its result when it's likely done.
    window.setTimeout(() => {
      setSync(syncStatus.get());
      setChecking(false);
    }, 6000);
  };

  const inFilter = (homework ?? []).filter((h) => filter === "All" || h.source === filter);
  const list = inFilter.filter((h) => !h.done);
  const doneList = inFilter.filter((h) => h.done);
  const groups = groupByDue(list);
  const thisWeek = groups.overdue.length + groups.week.length;
  const sources = new Set((homework ?? []).map((h) => h.source));
  const filters: Filter[] = ["All", "Classroom", ...OTHER_SOURCES.filter((s) => sources.has(s))];
  useAiContext(
    "Homework screen. To do: " +
      list
        .map(
          (h) => `${h.title} (${h.course}, ${h.source}, due ${h.due?.slice(0, 10) ?? "no date"})`,
        )
        .join("; "),
  );

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 6 }}>
        <h1 className="h1">Homework</h1>
        <div className="row sync-line" style={{ gap: 8 }}>
          <span
            className="dot-ok"
            style={data.demo ? { background: "var(--muted)" } : undefined}
            aria-hidden="true"
          />
          <span style={{ flex: 1 }}>
            {data.demo
              ? "Sample data"
              : sync && !sync.error
                ? `Synced from Classroom ${new Date(sync.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                : "Synced from Classroom"}
            {list.length > 0 && view === "todo" ? " · swipe right to tick off" : ""}
          </span>
          {!data.demo && (
            <button
              className="btn link s12"
              style={{ minHeight: 44, padding: "0 10px" }}
              onClick={checkNow}
              disabled={checking}
              aria-label="Check Classroom emails now"
            >
              {checking ? "Checking…" : "Check now"}
            </button>
          )}
        </div>
      </header>

      <div className="hw-stats rise d1">
        <div className="hw-stat">
          <strong>
            <CountUp n={list.length} />
          </strong>
          <span>to do</span>
        </div>
        <div className={`hw-stat${groups.overdue.length ? " warm" : ""}`}>
          <strong>
            <CountUp n={thisWeek} />
          </strong>
          <span>{groups.overdue.length ? `${groups.overdue.length} late` : "this week"}</span>
        </div>
        <div className="hw-stat">
          <strong>
            <CountUp n={doneList.length} />
          </strong>
          <span>done</span>
        </div>
      </div>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={view === "todo"} onClick={() => setView("todo")}>
          To do
        </button>
        <button role="tab" aria-selected={view === "done"} onClick={() => setView("done")}>
          Done
        </button>
      </div>

      {filters.length > 2 && (
        <div className="pills" role="group" aria-label="Filter by app">
          {filters.map((f) => (
            <button
              key={f}
              className="pill"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {homework === null ? (
        <div className="card stack">
          <div className="skeleton light" />
          <div className="skeleton light" style={{ width: "60%" }} />
        </div>
      ) : view === "done" ? (
        doneList.length === 0 ? (
          <div className="card empty">Nothing ticked off yet.</div>
        ) : (
          <div className="stack">
            {doneList.map((hw) => (
              <HomeworkCard key={hw.id} hw={hw} />
            ))}
          </div>
        )
      ) : list.length === 0 ? (
        <div className="card empty">All done! Tap + to add new homework.</div>
      ) : (
        dayGroups(list).map(
          ([title, items], g) =>
            items.length > 0 && (
              <section
                key={title}
                className={`stack rise d${Math.min(g + 3, 5)}`}
                style={{ gap: 8 }}
              >
                <h2
                  className={`eyebrow${title === "Overdue" ? " fix-text" : ""}`}
                  style={{ paddingLeft: 4 }}
                >
                  {title}
                </h2>
                {items.map((hw) => (
                  <HomeworkCard key={hw.id} hw={hw} />
                ))}
              </section>
            ),
        )
      )}

      <section className="stack" style={{ gap: 10, marginTop: 8 }}>
        <h2 className="eyebrow">Get homework in</h2>
        <button
          className="btn block"
          style={{ justifyContent: "flex-start" }}
          onClick={() => go("classes")}
        >
          <Icon name="classroom" size={18} />
          <span style={{ flex: 1, textAlign: "left" }}>Your classes</span>
          <span className="muted">{classCount ? `${classCount} ›` : "›"}</span>
        </button>
        {PAGES && !gmailLink.granted && <GmailCard />}
        {!data.hasClassroom && (!PAGES || gmailLink.granted) && (
          <section className="card stack">
            <div className="row" style={{ gap: 10 }}>
              <span
                className="tile-icon"
                style={{ "--tile": "#15803d", width: 40, height: 40 } as React.CSSProperties}
                aria-hidden="true"
              >
                <Icon name="classroom" size={20} />
              </span>
              <div className="stack" style={{ gap: 2, flex: 1 }}>
                <strong>Classroom auto-sync {data.demo ? "(off in demo)" : "is on"}</strong>
                <span className="muted">
                  {sync
                    ? sync.error
                      ? `Last check failed: ${sync.error}`
                      : `Last check ${new Date(sync.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · ${sync.checked} Classroom ${sync.checked === 1 ? "email" : "emails"} · ${sync.added} new`
                    : "New Classroom emails in your Gmail are added here by themselves."}
                </span>
              </div>
              <button
                className="round"
                onClick={checkNow}
                disabled={checking}
                aria-label="Check Classroom emails now"
              >
                <Icon
                  name={checking ? "loader" : "sync"}
                  size={16}
                  className={checking ? "spin" : undefined}
                />
              </button>
            </div>
            <button className="btn small" onClick={() => setImporting(true)}>
              <Icon name="camera" size={14} />
              Or import a screenshot / video
            </button>
          </section>
        )}
        <EmailScan />
      </section>
      {importing && <ImportSheet mode="homework" onClose={() => setImporting(false)} />}

      {adding && <AddHomework onClose={() => setAdding(false)} />}
    </main>
  );
}

/** Overdue, Due today, Tomorrow, then one group per day ("Fri 9 Oct"), then No date. */
function dayGroups(list: Homework[]): [string, Homework[]][] {
  const groups = groupByDue(list);
  const byDay = new Map<string, Homework[]>();
  for (const hw of [...groups.week, ...groups.later]) {
    const label = dueLabel(hw.due);
    const key =
      label === "Today"
        ? "Due today"
        : label === "Tomorrow"
          ? "Tomorrow"
          : new Date(hw.due ?? "").toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
    byDay.set(key, [...(byDay.get(key) ?? []), hw]);
  }
  return [["Overdue", groups.overdue], ...byDay.entries(), ["No date", groups.noDate]];
}

/** "16:00" when the due date has a time, otherwise "Today", "Tomorrow", "Fri" or the date. */
function dueChip(hw: Homework): string {
  if (hw.due && /T\d{2}:\d{2}/.test(hw.due)) {
    const d = new Date(hw.due);
    if (d.getHours() !== 0 || d.getMinutes() !== 0) {
      return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }
  }
  return dueLabel(hw.due);
}

function HomeworkCard({ hw }: { hw: Homework }) {
  const { openAssignment, openAi, data, replaceHomework, handleError, toast } = useApp();
  // Classroom and "Other" work (e.g. added with Add anything) is done here.
  const inApp = hw.source === "Classroom" || hw.source === "Other";

  const setDone = async (done: boolean) => {
    replaceHomework({ ...hw, done });
    try {
      await data.setDone(hw, done);
      if (done) {
        progress.add(5);
        weekLog.add("hw", 1);
        toast(`${data.labels.ticked} +5 XP`);
      }
    } catch (err) {
      replaceHomework(hw);
      handleError(err);
    }
  };

  const body = (
    <article className="card task subject-card" style={subjectVars(hw.course)}>
      <div className="between" style={{ gap: 8 }}>
        <span className="chip subject" title={hw.course}>
          {hw.course}
        </span>
        <span className={`chip${isUrgent(hw.due) && !hw.done ? " magenta" : ""}`}>
          {isUrgent(hw.due) && !hw.done && <Icon name="clock" size={14} />}
          {dueChip(hw)}
        </span>
      </div>
      <div className="task-title">{hw.title}</div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn violet"
          onClick={() =>
            openAi({
              context: `Homework: "${hw.title}" (${hw.course}, ${hw.source}). ${hw.description}`,
              question: `Help me get started with "${hw.title}".`,
            })
          }
        >
          <Icon name="sparkle" size={18} />
          Help me
        </button>
        {!inApp && (
          <a className="btn" href={hw.link} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={18} />
            {hw.source}
          </a>
        )}
        {inApp && !hw.done && (
          <button
            className="btn"
            style={{ marginLeft: "auto", color: "var(--accent-t)" }}
            onClick={() => openAssignment(hw)}
          >
            Do it here
          </button>
        )}
        {hw.done && (
          <button
            className="btn"
            style={{ marginLeft: "auto" }}
            aria-label="Mark not done"
            onClick={() => void setDone(false)}
          >
            <Icon name="again" size={18} />
            Undo
          </button>
        )}
      </div>
    </article>
  );
  return hw.done ? body : <SwipeDone onDone={() => void setDone(true)}>{body}</SwipeDone>;
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
            lang="en-GB"
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

/** AI reads recent emails and suggests homework to add, one tap each. */
function EmailScan() {
  const { ai, data, homework, addHomeworkItem, handleError, toast } = useApp();
  const [found, setFound] = useState<FoundTask[] | "loading" | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  if (!ai || data.demo) {
    return null;
  }

  const scan = async () => {
    setFound("loading");
    try {
      const emails = await data.inbox();
      const tasks = await findHomeworkInEmails(ai, emails, homework ?? []);
      setFound(tasks);
    } catch (err) {
      setFound(null);
      handleError(err);
    }
  };

  const add = async (task: FoundTask) => {
    setAdding(task.title);
    try {
      addHomeworkItem(
        await data.addHomework({
          title: task.title,
          source: task.source,
          due: task.due || undefined,
        }),
      );
      toast(data.labels.added);
      setFound((f) => (Array.isArray(f) ? f.filter((x) => x !== task) : f));
    } catch (err) {
      handleError(err);
    } finally {
      setAdding(null);
    }
  };

  if (found === null) {
    return (
      <button
        className="btn block rise"
        style={{ justifyContent: "flex-start", color: "var(--accent-ink)" }}
        onClick={() => void scan()}
      >
        <Icon name="mail" size={18} />
        <span style={{ flex: 1, textAlign: "left" }}>Find homework in my emails</span>
        <Icon name="sparkle" size={16} />
      </button>
    );
  }
  return (
    <section className="ai-card pop" aria-label="Homework found in your emails">
      <div className="between">
        <h3>
          <Icon name="sparkle" size={16} />
          Found in your emails
        </h3>
        <button className="link-btn" style={{ minHeight: 32 }} onClick={() => setFound(null)}>
          Hide
        </button>
      </div>
      {found === "loading" ? (
        <div className="row muted">
          <Icon name="loader" size={16} className="spin" />
          Reading your emails…
        </div>
      ) : found.length === 0 ? (
        <div className="muted">No new homework in your recent emails.</div>
      ) : (
        found.map((task) => (
          <div key={task.title} className="between rise">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{task.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {task.source}
                {task.due ? ` · due ${task.due}` : ""}
              </div>
            </div>
            <button
              className="btn small primary"
              disabled={adding === task.title}
              onClick={() => void add(task)}
            >
              <Icon name="plus" size={14} />
              Add
            </button>
          </div>
        ))
      )}
    </section>
  );
}
