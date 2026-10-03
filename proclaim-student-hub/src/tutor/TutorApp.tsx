import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { newId, type TutorSession } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import {
  mergePacket,
  readPacketFromLocation,
  replyLink,
  tutorStore,
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

const dateLabel = (day: string) =>
  day
    ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "";

type Tab = "lessons" | "homework" | "materials" | "settings";

export function TutorApp() {
  const [packet, setPacket] = useState<TutorPacket | null | "loading">("loading");
  const [students, setStudents] = useState<TutorPacket[]>([]);
  const [tab, setTab] = useState<Tab>("lessons");
  // Everything the tutor added since opening: this is what goes back.
  const [added, setAdded] = useState<{
    sessions: TutorSession[];
    homework: TutorHomework[];
    materials: TutorPacket["materials"];
  }>({ sessions: [], homework: [], materials: [] });
  const [when, setWhen] = useState("");
  const [meet, setMeet] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void readPacketFromLocation().then((fresh) => {
      const saved = tutorStore.all();
      setStudents(saved);
      if (fresh) {
        const merged = mergePacket(tutorStore.get(fresh.tutor.id, fresh.student), fresh);
        tutorStore.set(merged);
        history.replaceState(null, "", window.location.pathname);
        setPacket(merged);
        setWhen(merged.tutor.when);
        setMeet(merged.tutor.meet);
      } else {
        setPacket(saved[0] ?? null);
        setWhen(saved[0]?.tutor.when ?? "");
        setMeet(saved[0]?.tutor.meet ?? "");
      }
    });
  }, []);

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
      <div className="app">
        <main className="screen" style={{ gap: 16 }}>
          <header className="stack rise" style={{ gap: 4 }}>
            <span className="eyebrow">Tutor Hub</span>
            <h1 className="h1">No student yet</h1>
          </header>
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
  const open = all.homework.filter((h) => !h.done);
  const changes = added.sessions.length + added.homework.length + added.materials.length;

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
      meet,
      message: message.trim(),
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
    };
    tutorStore.set(merged);
    setPacket(merged);
    setAdded({ sessions: [], homework: [], materials: [] });
    setMessage("");
  };

  const share = async (url: string) => {
    const text = `Hi ${packet.student}, here's today's lesson from ${tutor.name}. Open this link in your Student Hub:\n${url}`;
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

  return (
    <div className="app">
      <main className="screen" style={{ gap: 16 }}>
        <header className="stack rise" style={{ gap: 6 }}>
          <div className="between">
            <span className="eyebrow">Tutor Hub · {tutor.name}</span>
            {students.length > 1 && (
              <select
                className="field"
                style={{ width: "auto", minHeight: 34 }}
                value={tutorStore.key(tutor.id, packet.student)}
                onChange={(e) => {
                  const next = students.find(
                    (s) => tutorStore.key(s.tutor.id, s.student) === e.target.value,
                  );
                  if (next) {
                    setPacket(next);
                    setWhen(next.tutor.when);
                    setMeet(next.tutor.meet);
                    setAdded({ sessions: [], homework: [], materials: [] });
                  }
                }}
                aria-label="Student"
              >
                {students.map((s) => (
                  <option
                    key={tutorStore.key(s.tutor.id, s.student)}
                    value={tutorStore.key(s.tutor.id, s.student)}
                  >
                    {s.student} · {s.tutor.subject}
                  </option>
                ))}
              </select>
            )}
          </div>
          <h1 className="h1">{packet.student}</h1>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <span className="chip accent" style={subjectVars(tutor.subject)}>
              <span className="subject-dot" aria-hidden="true" /> {tutor.subject}
            </span>
            <span className="chip">
              <Icon name="calendar" size={12} />
              {start ? `Next lesson ${lessonLabel(start, new Date())}` : when || "No lesson time"}
            </span>
            {packet.mastery !== null && (
              <span className="chip good">{packet.mastery}% mastered in the Lab</span>
            )}
            {packet.nextTest && (
              <span className="chip warm">
                Test: {packet.nextTest.topic} · {dateLabel(packet.nextTest.date)}
              </span>
            )}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            Student's data as of {new Date(packet.sentAt).toLocaleString("en-GB")}
          </span>
        </header>

        <div className="hw-stats rise">
          <div className="hw-stat">
            <strong>{all.sessions.length}</strong>
            <span>lessons</span>
          </div>
          <div className={`hw-stat${open.length ? " warm" : ""}`}>
            <strong>{open.length}</strong>
            <span>homework open</span>
          </div>
          <div className="hw-stat">
            <strong>{all.homework.filter((h) => h.done).length}</strong>
            <span>homework done</span>
          </div>
        </div>

        <div className="segmented" role="tablist" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {(["lessons", "homework", "materials", "settings"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "lessons"
                ? "Lessons"
                : t === "homework"
                  ? "Homework"
                  : t === "materials"
                    ? "Materials"
                    : "Settings"}
            </button>
          ))}
        </div>

        {tab === "lessons" && (
          <LessonsTab
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
        {tab === "settings" && (
          <section className="card stack rise" style={{ gap: 10 }}>
            <label className="stack" style={{ gap: 4 }}>
              <span className="eyebrow">Lessons are usually</span>
              <input
                className="field"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                placeholder="e.g. Tuesdays 17:00"
              />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="eyebrow">Google Meet link</span>
              <input
                className="field"
                value={meet}
                onChange={(e) => setMeet(e.target.value)}
                placeholder="https://meet.google.com/…"
                inputMode="url"
              />
            </label>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              These go to the student with your next send.
            </p>
          </section>
        )}

        <section className="card-dark stack rise" style={{ gap: 10 }}>
          <strong style={{ fontSize: 17 }}>
            {changes
              ? `${changes} new ${changes === 1 ? "thing" : "things"} to send`
              : "Send to student"}
          </strong>
          <textarea
            className="field"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="A short message for the student (optional)"
            style={{ color: "var(--ink)" }}
          />
          <button className="btn primary big" onClick={() => void send()}>
            <Icon name="send" size={18} />
            Make the link for {packet.student}
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
                style={{ fontSize: 11, color: "var(--ink)" }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <span style={{ fontSize: 13, opacity: 0.8 }}>
                The student opens it on their phone; it drops straight into their Tutoring and
                To-do.
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

function LessonsTab({
  sessions,
  tutorId,
  onAdd,
}: {
  sessions: TutorSession[];
  tutorId: string;
  onAdd: (s: TutorSession, homework: TutorHomework[]) => void;
}) {
  const [open, setOpen] = useState(false);
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
            onAdd(
              { id: newId("s"), tutorId, date, topic: topic.trim(), notes: notes.trim() },
              lines.map((text) => ({ id: newId("t"), text, due, done: false })),
            );
            setOpen(false);
            setTopic("");
            setNotes("");
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
}: {
  homework: TutorHomework[];
  onAdd: (h: TutorHomework) => void;
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
