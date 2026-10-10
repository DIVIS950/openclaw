import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { MessageThread } from "../components/MessageThread.tsx";
import { callName, joinLabel, newId, type TutorMessage, type TutorSession } from "../lib/study.ts";
import { subjectTone } from "../lib/subjects.ts";
import {
  allowedMeet,
  calendarInviteLink,
  hasUnsent,
  mergePacket,
  readPacketFromLocation,
  replyLink,
  tutorStore,
  unsentStore,
  type TutorHomework,
  type TutorPacket,
  type TutorReply,
} from "../lib/tutorLink.ts";
import { lessonLabel, nextLesson } from "../lib/tutorSchedule.ts";

// Tutor Hub: the tutor's own page. Opens from the link the student sends,
// shows that student's lessons, homework and materials, lets the tutor add
// a lesson write-up, homework (with due dates), materials and the lesson
// time, and makes the link that sends it all back to the student.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "just now", "5 min ago", "3 h ago" or the date. */
function agoLabel(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 1) {
    return "just now";
  }
  if (min < 60) {
    return `${min} min ago`;
  }
  if (min < 24 * 60) {
    return `${Math.round(min / 60)} h ago`;
  }
  return dateLabel(iso.slice(0, 10));
}

const dateLabel = (day: string) =>
  day
    ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "";

type Tab = "lessons" | "homework" | "materials" | "messages";

type Added = {
  sessions: TutorSession[];
  homework: TutorHomework[];
  materials: TutorPacket["materials"];
  messages: TutorMessage[];
};
const noneAdded = (): Added => ({ sessions: [], homework: [], materials: [], messages: [] });

/** The student's first name, or a stand-in when they haven't set one. */
const nameOf = (p: Pick<TutorPacket, "student">, fallback = "your student") =>
  p.student.trim() || fallback;

/** Shown when a student's link was cut short or edited. */
function DamagedNote({ onClose }: { onClose?: () => void }) {
  return (
    <div className="card stack tutor-damaged" role="alert" style={{ gap: 6 }}>
      <div className="between" style={{ alignItems: "center", gap: 10 }}>
        <strong>This link couldn't be read</strong>
        {onClose && (
          <button className="round" aria-label="Dismiss" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <span className="muted s13">
        It may have been cut short when it was copied. Ask your student to tap Share with my tutor
        again and send you the new link.
      </span>
    </div>
  );
}

export function TutorApp() {
  const [packet, setPacket] = useState<TutorPacket | null | "loading">("loading");
  const [students, setStudents] = useState<TutorPacket[]>([]);
  const [tab, setTab] = useState<Tab>("lessons");
  // Everything the tutor added and hasn't sent: this is what goes back. It is
  // saved per student on every change (unsentStore), so a reload loses nothing.
  const [added, setAdded] = useState<Added>(noneAdded);
  const [when, setWhen] = useState("");
  const [meet, setMeet] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [damaged, setDamaged] = useState(false);
  // Bumped by the quick actions so the right form opens.
  const [logging, setLogging] = useState(0);
  const [setting, setSetting] = useState(0);
  // "Message" in the quick actions opens the thread with the cursor in the box.
  const [writing, setWriting] = useState(false);

  /** Shows a student, with whatever the tutor hadn't sent to them yet. */
  const open = useCallback((next: TutorPacket | null) => {
    setPacket(next);
    const u = next ? unsentStore.get(next.tutor.id, next.student) : null;
    setAdded(
      u
        ? {
            sessions: u.sessions,
            homework: u.homework,
            materials: u.materials,
            messages: u.messages,
          }
        : noneAdded(),
    );
    setWhen(u?.when ?? next?.tutor.when ?? "");
    setMeet(u?.meet ?? next?.tutor.meet ?? "");
    setMessage(u?.message ?? "");
    setLink(null);
  }, []);

  // The student's link in the address (on opening, or tapped while already open).
  const load = useCallback(
    async (first: boolean) => {
      const fresh = await readPacketFromLocation();
      if (fresh === null && !first) {
        return;
      }
      if (fresh !== null) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      setDamaged(fresh === "damaged");
      let current: TutorPacket | null = null;
      if (fresh && fresh !== "damaged") {
        current = mergePacket(tutorStore.get(fresh.tutor.id, fresh.student), fresh);
        tutorStore.set(current);
      }
      // Read after saving, so a new student is in the list straight away.
      const saved = tutorStore.all();
      setStudents(saved);
      if (current) {
        open(current);
      } else if (first) {
        open(saved[0] ?? null);
      }
    },
    [open],
  );

  useEffect(() => {
    void load(true);
    const onHash = () => {
      if (window.location.hash.startsWith("#s=")) {
        void load(false);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [load]);

  // Save the unsent pile on every change.
  const live = packet && packet !== "loading" ? packet : null;
  const pile = useMemo(
    () =>
      live
        ? {
            ...added,
            when: when !== live.tutor.when ? when : null,
            meet: meet !== live.tutor.meet ? meet : null,
            message,
          }
        : null,
    [live, added, when, meet, message],
  );
  const unsent = live && pile ? hasUnsent(pile, live.tutor) : false;
  useEffect(() => {
    if (live && pile) {
      unsentStore.set(live.tutor.id, live.student, pile, live.tutor);
    }
  }, [live, pile]);

  // Warn before closing the tab with something not sent yet.
  useEffect(() => {
    if (!unsent) {
      return;
    }
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const say = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 3500);
  };

  const all = useMemo(() => {
    if (!packet || packet === "loading") {
      return null;
    }
    return {
      sessions: [...added.sessions, ...packet.sessions].toSorted((a, b) =>
        b.date.localeCompare(a.date),
      ),
      homework: [...added.homework, ...packet.homework],
      materials: [...added.materials, ...packet.materials],
    };
  }, [packet, added]);

  if (packet === "loading") {
    return <div className="app" aria-busy="true" />;
  }
  if (!packet || !all) {
    return (
      <div className="app tutor-hub">
        <main className="screen tutor-screen" style={{ gap: 16 }}>
          <header className="stack rise" style={{ gap: 4 }}>
            <span className="eyebrow">Tutor Hub</span>
            <h1 className="h1">No student yet</h1>
          </header>
          {damaged && <DamagedNote />}
          <div className="card stack">
            <p style={{ margin: 0 }}>
              Ask your student to open <strong>Tutoring</strong> in their Student Hub, pick your
              name and tap <strong>Share with my tutor</strong>. The link they send opens here with
              their lessons, homework and materials.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Everything stays in the link and on this device. No account needed.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const tutor = packet.tutor;
  const start = nextLesson({ when }, new Date());
  const changes =
    added.sessions.length + added.homework.length + added.materials.length + added.messages.length;

  const send = async () => {
    const reply: TutorReply = {
      v: 1,
      kind: "from-tutor",
      tutorId: tutor.id,
      tutorName: tutor.name,
      sessions: added.sessions,
      materials: added.materials,
      homework: added.homework,
      when,
      // Only a Meet, Zoom or Teams link is sent; the student's app checks again.
      meet: allowedMeet(meet),
      message: message.trim(),
      messages: [
        ...added.messages,
        ...(message.trim()
          ? [
              {
                id: newId("g"),
                tutorId: tutor.id,
                from: "tutor" as const,
                text: message.trim(),
                at: new Date().toISOString(),
              },
            ]
          : []),
      ],
      sentAt: new Date().toISOString(),
    };
    const url = await replyLink(reply);
    setLink(url);
    // Keep the tutor's copy up to date, and clear the "unsent" pile.
    const merged: TutorPacket = {
      ...packet,
      tutor: { ...tutor, when, meet },
      sessions: [...added.sessions, ...packet.sessions],
      homework: [...added.homework, ...packet.homework],
      materials: [...added.materials, ...packet.materials],
      messages: [...(packet.messages ?? []), ...reply.messages!],
    };
    tutorStore.set(merged);
    unsentStore.clear(tutor.id, packet.student);
    setPacket(merged);
    setStudents(tutorStore.all());
    setAdded(noneAdded());
    setMessage("");
  };

  const share = async (url: string) => {
    const hi = packet.student.trim() ? `Hi ${packet.student.trim()}` : "Hi";
    const text = `${hi}, here's today's lesson from ${tutor.name || "your tutor"}. Open this link in your Student Hub:\n${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(url);
      say("Link copied. Paste it to your student.");
    } catch {
      say("Copy the link below and send it to your student.");
    }
  };

  const tutorMessages = (packet.messages ?? []).filter((m) => m.tutorId === tutor.id);
  const thread = [...tutorMessages, ...added.messages].toSorted((a, b) => a.at.localeCompare(b.at));
  const studentEmail = packet.studentEmail ?? "";

  const who = nameOf(packet);
  const school = packet.school ?? [];
  const doneCount = all.homework.filter((h) => h.done).length;
  const questions = thread.filter((m) => m.from !== "tutor" && m.text.includes("?")).slice(-3);

  return (
    <div className="app tutor-hub">
      <main className="screen tutor-screen" style={{ gap: 14 }}>
        {students.length > 1 && (
          <nav className="stu-list rise" aria-label="Students">
            {students.map((s) => {
              const key = tutorStore.key(s.tutor.id, s.student);
              const on = key === tutorStore.key(tutor.id, packet.student);
              return (
                <button
                  key={key}
                  className={on ? "stu on" : "stu"}
                  aria-current={on ? "true" : undefined}
                  onClick={() => open(s)}
                >
                  <span className={`av tone-${subjectTone(s.tutor.subject)}`}>
                    {s.student.trim()[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                    <b>{nameOf(s, "Student")}</b>
                    <span className="muted s12">{s.tutor.subject}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        {damaged && <DamagedNote onClose={() => setDamaged(false)} />}

        <header className="between rise" style={{ alignItems: "flex-end", gap: 12 }}>
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <span className="eyebrow">Tutor Hub{tutor.name ? ` · ${tutor.name}` : ""}</span>
            <h1 className="h1" style={{ fontSize: 36 }}>
              {nameOf(packet, "Your student")}
            </h1>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <span className={`chip tone-${subjectTone(tutor.subject)}`}>{tutor.subject}</span>
              {packet.mastery !== null && (
                <span className="chip good">{packet.mastery}% mastered</span>
              )}
              {packet.nextTest && (
                <span className="chip magenta">
                  <Icon name="flag" size={13} />
                  Test {dateLabel(packet.nextTest.date)}
                </span>
              )}
            </div>
          </div>
          {unsent ? (
            <span className="chip warm sync-chip" title="Make the link below to send it">
              Not sent yet{changes ? ` · ${changes}` : ""}
            </span>
          ) : (
            <span
              className="chip sync-chip"
              title="What you see is from the last link the student sent"
            >
              From {packet.student.trim() ? `${packet.student.trim()}'s` : "their"} link
              {packet.sentAt ? ` · ${agoLabel(packet.sentAt)}` : ""}
            </span>
          )}
        </header>

        <div className="tutor-grid">
          <NextLessonCard
            student={who}
            studentEmail={studentEmail}
            subject={tutor.subject}
            when={when}
            meet={meet}
            start={start}
            onWhen={setWhen}
            onMeet={setMeet}
            onSay={say}
          />

          <nav className="qa3 rise d1" aria-label="Quick actions">
            <button
              onClick={() => {
                setTab("lessons");
                setLogging((n) => n + 1);
              }}
            >
              <span className="ic tone-violet">
                <Icon name="pen" size={20} />
              </span>
              Log lesson
            </button>
            <button
              onClick={() => {
                setTab("homework");
                setSetting((n) => n + 1);
              }}
            >
              <span className="ic tone-orange">
                <Icon name="bookClosed" size={20} />
              </span>
              Set work
            </button>
            <button
              onClick={() => {
                setWriting(true);
                setTab("messages");
              }}
            >
              <span className="ic tone-blue">
                <Icon name="mail" size={20} />
              </span>
              Message
            </button>
          </nav>

          <section className="card rows rise d2 work-card">
            <div className="between" style={{ padding: "14px 16px 6px" }}>
              <h2 className="h2">Their work</h2>
              <span className="muted s13">
                {doneCount} of {all.homework.length} done
              </span>
            </div>
            <div className="tbar" aria-hidden="true">
              <i
                style={{
                  transform: `scaleX(${all.homework.length ? doneCount / all.homework.length : 0})`,
                }}
              />
            </div>
            {all.homework.length === 0 && (
              <div className="li muted s13">Nothing set yet. Tap Set work.</div>
            )}
            {all.homework.slice(0, 5).map((h) => (
              <div key={h.id} className="li">
                <span className={h.done ? "tick done" : "tick"} aria-hidden="true">
                  <Icon name="check" size={15} />
                </span>
                <span className="li-main" style={h.done ? { color: "var(--muted)" } : undefined}>
                  {h.text}
                </span>
                <span className={h.done ? "chip good" : "chip"}>
                  {h.done ? "Done" : h.due ? dateLabel(h.due) : "Open"}
                </span>
              </div>
            ))}
          </section>

          {school.length > 0 && (
            <section className="card rows rise d3" aria-label="School work">
              <div className="between" style={{ padding: "14px 16px 6px" }}>
                <h2 className="h2">School work</h2>
                <span className="muted s13">{tutor.subject || "This subject"}</span>
              </div>
              {school.map((w, i) => (
                <div key={`${w.kind}${i}`} className="li">
                  <span className={w.kind === "test" ? "chip magenta" : "chip"}>
                    {w.kind === "test" ? "Test" : "Homework"}
                  </span>
                  <span className="li-main">{w.title}</span>
                  {w.due && <span className="muted s13">{dateLabel(w.due)}</span>}
                </div>
              ))}
            </section>
          )}

          {questions.length > 0 && (
            <section className="card rows rise d3">
              <div className="between" style={{ padding: "14px 16px 4px" }}>
                <h2 className="h2">Their questions</h2>
                <span className="chip lime">From their app</span>
              </div>
              {questions.map((q) => (
                <div key={q.id} className="li" style={{ alignItems: "flex-start" }}>
                  <span style={{ color: "var(--yellow)" }}>★</span>
                  <span style={{ fontSize: 14 }}>“{q.text}”</span>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="pills" role="tablist" aria-label="Section">
          {(["lessons", "homework", "materials", "messages"] as Tab[]).map((t) => (
            <button
              key={t}
              className="pill"
              role="tab"
              aria-selected={tab === t}
              aria-pressed={tab === t}
              onClick={() => {
                setWriting(false);
                setTab(t);
              }}
            >
              {t === "lessons"
                ? "Lessons"
                : t === "homework"
                  ? "Homework"
                  : t === "materials"
                    ? "Materials"
                    : `Messages${thread.length ? ` · ${thread.length}` : ""}`}
            </button>
          ))}
        </div>

        {tab === "lessons" && (
          <LessonsTab
            key={`log${logging}`}
            startOpen={logging > 0}
            sessions={all.sessions}
            tutorId={tutor.id}
            onAdd={(s, hw) =>
              setAdded((a) => ({
                ...a,
                sessions: [s, ...a.sessions],
                homework: [...hw, ...a.homework],
              }))
            }
          />
        )}
        {tab === "homework" && (
          <HomeworkTab
            key={`set${setting}`}
            startOpen={setting > 0}
            homework={all.homework}
            onAdd={(h) => setAdded((a) => ({ ...a, homework: [h, ...a.homework] }))}
          />
        )}
        {tab === "materials" && (
          <MaterialsTab
            materials={all.materials}
            tutorId={tutor.id}
            onAdd={(m) => setAdded((a) => ({ ...a, materials: [m, ...a.materials] }))}
          />
        )}
        {tab === "messages" && (
          <MessageThread
            messages={thread}
            me="tutor"
            otherName={who}
            placeholder={`Message ${who}…`}
            autoFocus={writing}
            pending={added.messages.length}
            onSend={(text) =>
              setAdded((a) => ({
                ...a,
                messages: [
                  ...a.messages,
                  {
                    id: newId("g"),
                    tutorId: tutor.id,
                    from: "tutor",
                    text,
                    at: new Date().toISOString(),
                  },
                ],
              }))
            }
          />
        )}

        <section className="card stack rise send-card" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 2 }}>
            <strong style={{ fontSize: 17 }}>
              {changes
                ? `${changes} new ${changes === 1 ? "thing" : "things"} to send`
                : "Send to student"}
            </strong>
            <span className="sub">
              Lessons, homework, materials, messages and the lesson time all go in one link.
            </span>
          </div>
          <textarea
            className="field"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="A short message for the student (optional)"
            aria-label="Short message for the student"
          />
          <button className="btn primary big" onClick={() => void send()}>
            <Icon name="send" size={18} />
            Make the link for {who}
          </button>
          {link && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row">
                <button className="btn" style={{ flex: 1 }} onClick={() => void share(link)}>
                  Share
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(
                      () => say("Link copied."),
                      () => say("Select the link below and copy it."),
                    );
                  }}
                >
                  Copy link
                </button>
              </div>
              <textarea
                className="field"
                readOnly
                rows={2}
                value={link}
                aria-label="Link for the student"
                style={{ fontSize: 11 }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <span className="sub">
                The student opens it on their phone; it drops straight into their Tutoring, To-do
                and Messages.
              </span>
            </div>
          )}
        </section>

        <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>
          Tutor Hub · build {__BUILD__}
        </p>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * The next lesson: countdown, Join Meet, and "Schedule" which opens the
 * tutor's Google Calendar with the student as a guest, so the invite (and
 * the Meet link Google adds) lands in the student's calendar and app.
 */
function NextLessonCard({
  student,
  studentEmail,
  subject,
  when,
  meet,
  start,
  onWhen,
  onMeet,
  onSay,
}: {
  student: string;
  studentEmail: string;
  subject: string;
  when: string;
  meet: string;
  start: Date | null;
  onWhen: (v: string) => void;
  onMeet: (v: string) => void;
  onSay: (text: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [date, setDate] = useState(() => (start ? start.toISOString().slice(0, 10) : today()));
  const [time, setTime] = useState(() => (start ? start.toTimeString().slice(0, 5) : "17:00"));
  const [minutes, setMinutes] = useState(60);
  const now = new Date();
  const link = allowedMeet(meet);
  const schedule = () => {
    const at = new Date(`${date}T${time}:00`);
    if (Number.isNaN(at.getTime())) {
      onSay("Pick a date and time first.");
      return;
    }
    const url = calendarInviteLink({
      title: `${subject} tutoring with ${student}`,
      start: at,
      minutes,
      guest: studentEmail,
      details: link ? `Google Meet: ${link}` : "Google adds a Meet link to this invite.",
    });
    window.open(url, "_blank", "noopener");
    onSay(
      studentEmail
        ? `Calendar opened with ${student} invited. Save it and the invite reaches them.`
        : "Calendar opened. Add the student's email as a guest, then save.",
    );
  };
  return (
    <section
      className="now-card tutor-next stack rise"
      style={{ gap: 14 }}
      aria-label="Next lesson"
    >
      <div className="between" style={{ alignItems: "center", gap: 12 }}>
        <div className="stack" style={{ gap: 5, minWidth: 0 }}>
          <span className="now-eyebrow">
            {start ? `Next lesson · ${lessonLabel(start, now)}` : "Next lesson"}
          </span>
          <strong className="now-title" style={{ fontSize: 30 }}>
            {when || "No regular time yet"}
          </strong>
          <span className="now-sub">
            {link ? callName(link).replace(/^the call$/, "Video call") : "No Meet link yet"}
          </span>
        </div>
        {start && (
          <span className="test-count">
            <span className="num" style={{ fontSize: 30 }}>
              {countdownLabel(start, now)}
            </span>
            <span className="now-eyebrow">to go</span>
          </span>
        )}
      </div>
      <div className="row" style={{ gap: 10 }}>
        {link ? (
          <a
            className="btn primary"
            style={{ flex: 1 }}
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="link" size={16} />
            {joinLabel(link)}
          </a>
        ) : (
          <button className="btn primary" style={{ flex: 1 }} onClick={() => setEdit(true)}>
            <Icon name="link" size={16} />
            Add Meet link
          </button>
        )}
        <button className="btn" style={{ flex: 1 }} onClick={() => setEdit((v) => !v)}>
          <Icon name="calendar" size={16} />
          {edit ? "Close" : "Schedule"}
        </button>
      </div>
      {edit && (
        <div
          className="stack"
          style={{ gap: 10, paddingTop: 4, borderTop: "1px solid var(--line)" }}
        >
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Lessons are usually</span>
            <input
              className="field"
              value={when}
              onChange={(e) => onWhen(e.target.value)}
              placeholder="e.g. Tuesdays 17:00"
            />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Lesson link (Meet, Zoom or Teams)</span>
            <input
              className="field"
              value={meet}
              onChange={(e) => onMeet(e.target.value)}
              placeholder="https://meet.google.com/…"
              inputMode="url"
            />
            {meet.trim() && !link && (
              <span className="warm-text s13">
                Use a Google Meet, Zoom or Teams link starting with https://. Other links aren't
                sent.
              </span>
            )}
          </label>
          <span className="eyebrow">Send a calendar invite</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="field"
              type="date"
              lang="en-GB"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Lesson date"
              style={{ flex: 1.2 }}
            />
            <input
              className="field"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Lesson time"
              style={{ flex: 1 }}
            />
            <select
              className="field"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              aria-label="Length"
              style={{ flex: 0.9 }}
            >
              {[30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
          <button className="btn block" onClick={schedule}>
            <Icon name="calendar" size={16} />
            Open in Google Calendar{studentEmail ? ` · invites ${student}` : ""}
          </button>
          <span className="sub">
            Google adds a Meet link to the invite; the student sees it in Today and Tutoring. The
            time and Meet link above go to the student with your next link.
          </span>
        </div>
      )}
    </section>
  );
}

/** "1d 5h", "3h 20m" or "now". */
function countdownLabel(start: Date, now: Date): string {
  const ms = start.getTime() - now.getTime();
  if (ms <= 0) {
    return "now";
  }
  const mins = Math.round(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const HOW = ["Hard", "Meh", "Okay", "Good", "Great"];

function LessonsTab({
  sessions,
  tutorId,
  onAdd,
  startOpen = false,
}: {
  sessions: TutorSession[];
  tutorId: string;
  onAdd: (s: TutorSession, homework: TutorHomework[]) => void;
  /** Opened from "Log lesson". */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [how, setHow] = useState(3);
  const [got, setGot] = useState("");
  const [tricky, setTricky] = useState("");
  const [date, setDate] = useState(today);
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [hw, setHw] = useState("");
  const [due, setDue] = useState("");
  return (
    <section className="stack rise" style={{ gap: 8 }}>
      {!open ? (
        <button className="btn block primary" onClick={() => setOpen(true)}>
          <Icon name="plus" size={16} />
          Write up today's lesson
        </button>
      ) : (
        <form
          className="card stack"
          style={{ gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!topic.trim()) {
              return;
            }
            const lines = hw
              .split("\n")
              .map((l) => l.replace(/^\s*(?:[•\-*]|\d+[.)])\s+/, "").trim())
              .filter(Boolean);
            // How it went, what clicked and what's still tricky go at the top of the notes.
            const summary = [
              `How it went: ${HOW[how]}`,
              got.trim() ? `Got it: ${got.trim()}` : "",
              tricky.trim() ? `Still tricky: ${tricky.trim()}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            onAdd(
              {
                id: newId("s"),
                tutorId,
                date,
                topic: topic.trim(),
                notes: [summary, notes.trim()].filter(Boolean).join("\n\n"),
              },
              lines.map((text) => ({ id: newId("t"), text, due, done: false })),
            );
            setOpen(false);
            setTopic("");
            setNotes("");
            setGot("");
            setTricky("");
            setHow(3);
            setHw("");
            setDue("");
          }}
        >
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Date</span>
            <input
              className="field"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">What we covered</span>
            <input
              className="field"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Past tense: regular verbs"
              autoFocus
            />
          </label>
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">How did it go?</span>
            <div className="how5" role="radiogroup" aria-label="How did it go">
              {HOW.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={how === i}
                  className={how === i ? "on" : undefined}
                  onClick={() => setHow(i)}
                >
                  <b>{i + 1}</b>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <span className="eyebrow">Got it</span>
              <input
                className="field"
                value={got}
                onChange={(e) => setGot(e.target.value)}
                placeholder="e.g. splitting the middle"
              />
            </label>
            <label className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <span className="eyebrow">Still tricky</span>
              <input
                className="field"
                value={tricky}
                onChange={(e) => setTricky(e.target.value)}
                placeholder="e.g. negative numbers"
              />
            </label>
          </div>
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Notes for the student</span>
            <textarea
              className="field"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What went well, what to watch out for, tips…"
            />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Homework (one per line)</span>
            <textarea
              className="field"
              rows={3}
              value={hw}
              onChange={(e) => setHw(e.target.value)}
              placeholder={"Workbook page 12, exercises 1-4\nLearn the 20 verbs"}
            />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Homework due</span>
            <input
              className="field"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="btn primary"
              type="submit"
              style={{ flex: 1 }}
              disabled={!topic.trim()}
            >
              Add lesson
            </button>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {sessions.length === 0 && <div className="card empty">No lessons written up yet.</div>}
      <div className="timeline">
        {sessions.map((s) => (
          <div key={s.id} className="timeline-item card stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {dateLabel(s.date)}
            </span>
            <strong>{s.topic}</strong>
            {s.notes && <span style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{s.notes}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function HomeworkTab({
  homework,
  onAdd,
  startOpen = false,
}: {
  homework: TutorHomework[];
  onAdd: (h: TutorHomework) => void;
  /** Opened from "Set work": the field gets the cursor. */
  startOpen?: boolean;
}) {
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const open = homework.filter((h) => !h.done);
  const done = homework.filter((h) => h.done);
  return (
    <section className="stack rise" style={{ gap: 8 }}>
      <form
        className="card stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            onAdd({ id: newId("t"), text: text.trim(), due, done: false });
            setText("");
            setDue("");
          }
        }}
      >
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New homework for the student"
          aria-label="New homework"
          autoFocus={startOpen}
        />
        <div className="row">
          <input
            className="field"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due"
            style={{ flex: 1 }}
          />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            Add
          </button>
        </div>
      </form>
      {open.length > 0 && (
        <>
          <h2 className="eyebrow">Still to do · {open.length}</h2>
          <div className="list">
            {open.map((h) => (
              <div key={h.id} className="hw-row">
                <span
                  className="subject-dot"
                  style={{ background: "var(--warm)" }}
                  aria-hidden="true"
                />
                <span style={{ flex: 1 }}>{h.text}</span>
                {h.due && <span className="chip">{dateLabel(h.due)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {done.length > 0 && (
        <>
          <h2 className="eyebrow">Done · {done.length}</h2>
          <div className="list">
            {done.map((h) => (
              <div key={h.id} className="hw-row hw-done">
                <Icon name="check" size={16} />
                <span className="hw-title" style={{ flex: 1 }}>
                  {h.text}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {homework.length === 0 && (
        <div className="card empty">No homework set yet. Add some above.</div>
      )}
    </section>
  );
}

function MaterialsTab({
  materials,
  tutorId,
  onAdd,
}: {
  materials: TutorPacket["materials"];
  tutorId: string;
  onAdd: (m: TutorPacket["materials"][number]) => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <section className="stack rise" style={{ gap: 8 }}>
      <form
        className="card stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            onAdd({
              id: newId("m"),
              tutorId,
              title: title.trim(),
              text: text.trim(),
              date: today(),
            });
            setTitle("");
            setText("");
          }
        }}
      >
        <input
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title, e.g. Verb list unit 3"
          aria-label="Material title"
        />
        <textarea
          className="field"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the vocab, explanation or a link. The student's app can turn a vocab list into flashcards."
        />
        <button className="btn primary" type="submit" disabled={!title.trim()}>
          Add material
        </button>
      </form>
      {materials.length === 0 && <div className="card empty">No materials yet.</div>}
      {materials.map((m) => (
        <div key={m.id} className="card stack" style={{ gap: 4 }}>
          <strong>{m.title}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {dateLabel(m.date)}
          </span>
          {m.text && (
            <span style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.text.slice(0, 600)}</span>
          )}
        </div>
      ))}
    </section>
  );
}
