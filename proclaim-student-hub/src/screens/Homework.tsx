import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { ImportSheet } from "../components/ImportSheet.tsx";
import { Overlay } from "../components/Overlay.tsx";
import { SwipeDone } from "../components/SwipeDone.tsx";
import { useAiContext, useApp } from "../context.ts";
import { findHomeworkInEmails, type FoundTask } from "../lib/aiFeatures.ts";
import { syncStatus } from "../lib/classroomSync.ts";
import { dueLabel, groupByDue, isUrgent } from "../lib/format.ts";
import { subjectChips } from "../lib/homeworkFilter.ts";
import { courses, homeworkXp } from "../lib/store.ts";
import { subjectTone } from "../lib/subjects.ts";
import { OTHER_SOURCES, type Homework, type Source } from "../lib/types.ts";
import { useEscape } from "../lib/useEscape.ts";
import { gmailLink } from "../pages/gmailLink.ts";
import { PAGES } from "../pages/runtime.ts";
import { GmailCard } from "../pages/WebVersion.tsx";

type Filter = "All" | Source;

export function HomeworkScreen() {
  const { data, homework, reloadHomework, go } = useApp();
  const [classCount] = useState(() => courses.get().length);
  const [filter, setFilter] = useState<Filter>("All");
  const [subject, setSubject] = useState("All");
  const [view, setView] = useState<"todo" | "done">("todo");
  const [adding, setAdding] = useState(false);
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

  const viewList = view === "todo" ? list : doneList;
  // Chips come from the list being shown; a subject with nothing left falls back to All.
  const { chips: subjects, active } = subjectChips(viewList, subject);
  useEffect(() => {
    if (active !== subject) {
      setSubject(active);
    }
  }, [active, subject]);
  const shown = viewList.filter((h) => active === "All" || h.course === active);
  // Only a check that really read emails earns "just now"; with no Gmail it would be a fake.
  const checkedEmails = Boolean(sync && !sync.error && sync.checked > 0);
  const syncLabel = data.demo
    ? "Sample data"
    : checking
      ? "Checking…"
      : sync && checkedEmails
        ? `Classroom · ${agoLabel(sync.at)}`
        : PAGES
          ? "Classroom: via claude.ai"
          : "Classroom";

  // A tick moves the next row under the finger: ignore taps on the list for a moment.
  const tickedAt = useRef(0);
  const guardTaps = (e: React.MouseEvent) => {
    if (Date.now() - tickedAt.current < 400) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 14 }}>
        <div className="between" style={{ alignItems: "flex-end" }}>
          <h1 className="h1" style={{ fontSize: 36 }}>
            Homework
          </h1>
          {data.demo || PAGES ? (
            // Nothing to check from here: Classroom arrives through claude.ai.
            <span className="chip cyan">{syncLabel}</span>
          ) : (
            <button
              className="chip cyan"
              style={{ border: 0 }}
              onClick={checkNow}
              disabled={checking}
              aria-label="Check Classroom now"
            >
              {syncLabel}
            </button>
          )}
        </div>
        <div className="seg2" role="tablist" aria-label="Show">
          <button
            role="tab"
            aria-selected={view === "todo"}
            className={view === "todo" ? "on" : undefined}
            onClick={() => setView("todo")}
          >
            To do · {list.length}
          </button>
          <button
            role="tab"
            aria-selected={view === "done"}
            className={view === "done" ? "on" : undefined}
            onClick={() => setView("done")}
          >
            Done · {doneList.length}
          </button>
        </div>
        {(subjects.length > 1 || active !== "All" || filters.length > 2) && (
          <div className="fchips" role="group" aria-label="Filter">
            {["All", ...subjects].map((f) => (
              <button
                key={f}
                className={active === f ? "fchip on" : "fchip"}
                aria-pressed={active === f}
                onClick={() => setSubject(f)}
              >
                {f}
              </button>
            ))}
            {filters.length > 2 &&
              filters
                .filter((f) => f !== "All")
                .map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "fchip on" : "fchip"}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(filter === f ? "All" : f)}
                  >
                    {f}
                  </button>
                ))}
          </div>
        )}
      </header>

      {homework === null ? (
        <div className="card stack" style={{ padding: 16 }}>
          <div className="skeleton light" />
          <div className="skeleton light" style={{ width: "60%" }} />
        </div>
      ) : shown.length === 0 ? (
        <div className="card empty">
          {view === "done" ? "Nothing ticked off yet." : "All done! Tap + to add new homework."}
        </div>
      ) : (
        (view === "done"
          ? ([["Ticked off", shown]] as [string, Homework[]][])
          : weekGroups(shown)
        ).map(
          ([title, items], g) =>
            items.length > 0 && (
              <section
                key={title}
                className={`stack rise d${Math.min(g + 1, 5)}`}
                style={{ gap: 8 }}
              >
                <h2 className={`sec${title === "Overdue" ? " late" : ""}`}>{title}</h2>
                <div className="card rows" onClickCapture={guardTaps}>
                  {items.map((hw) => (
                    <HomeworkItem
                      key={hw.id}
                      hw={hw}
                      onTicked={() => {
                        tickedAt.current = Date.now();
                      }}
                    />
                  ))}
                </div>
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
        <button
          className="btn block"
          style={{ justifyContent: "flex-start" }}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={18} />
          <span style={{ flex: 1, textAlign: "left" }}>Add homework yourself</span>
        </button>
        <EmailScan />
      </section>
      {importing && <ImportSheet mode="homework" onClose={() => setImporting(false)} />}

      {adding && <AddHomework onClose={() => setAdding(false)} />}
    </main>
  );
}

/** Overdue, Due today, This week, Later, then No date (as on the canvas). */
function weekGroups(list: Homework[]): [string, Homework[]][] {
  const groups = groupByDue(list);
  const today = groups.week.filter((h) => dueLabel(h.due) === "Today");
  const week = groups.week.filter((h) => dueLabel(h.due) !== "Today");
  return [
    ["Overdue", groups.overdue],
    ["Due today", today],
    ["This week", week],
    ["Later", groups.later],
    ["No date", groups.noDate],
  ];
}

/** "2 min ago", "1 h ago", or the time. */
function agoLabel(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) {
    return "just now";
  }
  if (min < 60) {
    return `${min} min ago`;
  }
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "Today 16:00", "Tue 13 Oct", "Was due 8 Oct" or "No date". */
function dueText(hw: Homework): string {
  if (!hw.due || Number.isNaN(new Date(hw.due).getTime())) {
    return "No date";
  }
  const d = new Date(hw.due);
  const label = dueLabel(hw.due);
  const time =
    /T\d{2}:\d{2}/.test(hw.due) && (d.getHours() !== 0 || d.getMinutes() !== 0)
      ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "";
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (d.getTime() < new Date().setHours(0, 0, 0, 0)) {
    return `Was due ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  }
  if (label === "Today" || label === "Tomorrow") {
    return time ? `${label} ${time}` : label;
  }
  return date;
}

function HomeworkItem({ hw, onTicked }: { hw: Homework; onTicked: () => void }) {
  const { openAssignment, data, replaceHomework, handleError, toast, screen, assignment } =
    useApp();
  // The task open beside the list (iPad) is marked in the list.
  const open = screen === "assignment" && assignment?.id === hw.id;

  const setDone = async (done: boolean) => {
    if (done) {
      onTicked();
    }
    replaceHomework({ ...hw, done });
    try {
      await data.setDone(hw, done);
      if (!done) {
        // Unticked (Undo or the Done list): the XP and report-card count go too.
        homeworkXp.undo(hw.id);
      }
      if (done) {
        // XP once per homework: untick and tick again doesn't earn more.
        const xp = homeworkXp.tick(hw.id);
        toast(xp ? `${data.labels.ticked} +5 XP` : data.labels.ticked, {
          label: "Undo",
          run: () => void setDone(false),
        });
      }
    } catch (err) {
      replaceHomework(hw);
      handleError(err);
    }
  };

  const urgent = isUrgent(hw.due) && !hw.done;
  const body = (
    <article className={open ? "hw is-open" : "hw"}>
      <button
        className={hw.done ? "tick done" : "tick"}
        aria-label={hw.done ? `Mark not done: ${hw.title}` : `Tick off ${hw.title}`}
        onClick={() => void setDone(!hw.done)}
      >
        <Icon name="check" size={15} />
      </button>
      <button
        className="hw-main"
        aria-label={`Do it here: ${hw.title}`}
        aria-current={open ? "true" : undefined}
        onClick={() => openAssignment(hw)}
      >
        <span className={hw.done ? "hw-title done" : "hw-title"}>{hw.title}</span>
        <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {hw.course && <span className={`chip tone-${subjectTone(hw.course)}`}>{hw.course}</span>}
          <span className={urgent ? "chip due" : "chip"}>{dueText(hw)}</span>
          {hw.source !== "Classroom" && hw.source !== "Other" && (
            <span className="chip">{hw.source}</span>
          )}
        </span>
      </button>
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
  useEscape(onClose, !busy);

  return (
    <Overlay>
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
    </Overlay>
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
