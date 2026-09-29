import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { imageSrc, photoToImageInput, smallCopy } from "../lib/image.ts";
import {
  dayOf,
  labHandoff,
  newId,
  notes,
  prepTests,
  safeLink,
  todos,
  tutoring,
  whatsappLink,
  type Tutor,
  type TutorMaterial,
  type TutorSession,
} from "../lib/study.ts";
import { readMaterial } from "../lib/studyAi.ts";
import { subjectVars } from "../lib/subjects.ts";
import { lessonPrep, lessonRecap, tutorContext, type LessonPrep } from "../lib/tutorAi.ts";
import { lessonLabel, nextLesson, parseWhen, upcomingTutoring } from "../lib/tutorSchedule.ts";

// Tutoring: the student's tutors, when the next lesson is (with one tap to
// join the Meet), the AI getting them ready for it and writing it up after,
// and the materials the tutor sends (usually on WhatsApp).

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Re-renders every 30 s so countdowns stay right. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function Avatar({ tutor, size = 44 }: { tutor: Tutor; size?: number }) {
  return (
    <span
      className="tutor-avatar"
      style={{ ...subjectVars(tutor.subject), width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {(tutor.name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function JoinButtons({ tutor, onDark = false }: { tutor: Tutor; onDark?: boolean }) {
  const meet = safeLink(tutor.meet);
  const wa = whatsappLink(tutor.whatsapp);
  return (
    <>
      {meet && (
        <a className="btn small primary" href={meet} target="_blank" rel="noopener noreferrer">
          <Icon name="link" size={14} />
          Join Meet
        </a>
      )}
      {wa && (
        <a
          className={`btn small${onDark ? " ghost-on-dark" : ""}`}
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
      )}
    </>
  );
}

export function Tutoring({
  onOpenNote,
  header,
}: {
  onOpenNote: (id: string) => void;
  /** Shown above the list, but not over an open tutor. */
  header?: ReactNode;
}) {
  const [tutors, setTutors] = useState<Tutor[]>(tutoring.tutors);
  const [open, setOpen] = useState<{ id: string; prep: boolean } | null>(null);
  const [editing, setEditing] = useState<Tutor | null>(null);
  const now = useNow();
  const upcoming = upcomingTutoring(tutors, now);
  const soon = upcoming.find((u) => u.start.getTime() - now.getTime() < 24 * 3600_000);
  useAiContext(
    `Tutors: ${tutors.map((t) => `${t.name} (${t.subject}, ${t.when})`).join("; ") || "none yet"}.` +
      (upcoming[0]
        ? ` Next lesson: ${upcoming[0].tutor.name} ${lessonLabel(upcoming[0].start, now)}.`
        : ""),
  );

  const saveTutor = (t: Tutor) => {
    const next = tutors.some((x) => x.id === t.id)
      ? tutors.map((x) => (x.id === t.id ? t : x))
      : [...tutors, t];
    setTutors(next);
    tutoring.saveTutors(next);
  };

  const current = tutors.find((t) => t.id === open?.id);
  if (current) {
    return (
      <>
        <TutorPage
          key={current.id}
          tutor={current}
          autoPrep={open?.prep ?? false}
          onBack={() => setOpen(null)}
          onEdit={() => setEditing(current)}
          onOpenNote={onOpenNote}
        />
        {editing && (
          <TutorForm
            tutor={editing}
            onClose={() => setEditing(null)}
            onSave={(t) => {
              saveTutor(t);
              setEditing(null);
            }}
            onDelete={() => {
              const next = tutors.filter((x) => x.id !== current.id);
              setTutors(next);
              tutoring.saveTutors(next);
              setEditing(null);
              setOpen(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {soon && (
        <section className="card-dark stack pop" style={{ gap: 10 }} aria-label="Next lesson">
          <div
            className="between"
            style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}
          >
            <span className="row" style={{ gap: 6 }}>
              {lessonLabel(soon.start, now) === "on now" && <span className="live-dot" />}
              Next up
            </span>
            <span>{lessonLabel(soon.start, now)}</span>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Avatar tutor={soon.tutor} size={48} />
            <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 19 }}>
                {soon.tutor.subject || "Lesson"} with {soon.tutor.name}
              </strong>
              <span style={{ opacity: 0.75, fontSize: 13 }}>
                {DAY_SHORT[soon.start.getDay()]}{" "}
                {soon.start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <JoinButtons tutor={soon.tutor} onDark />
            <button
              className="btn small ghost-on-dark"
              onClick={() => setOpen({ id: soon.tutor.id, prep: true })}
            >
              <Icon name="sparkle" size={14} />
              Prep me
            </button>
          </div>
        </section>
      )}
      {tutors.length === 0 ? (
        <section className="card stack empty-fun">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="book" size={26} />
          </span>
          <strong>Your tutoring, in one place</strong>
          <span className="muted">
            Add your tutor with the day and time of lessons. You'll see a countdown, join the Meet
            in one tap, get the AI to prep you before each lesson and write it up after.
          </span>
        </section>
      ) : (
        <div className="stack">
          {tutors.map((t, i) => {
            const start = nextLesson(t, now);
            const sessions = tutoring.sessions().filter((x) => x.tutorId === t.id).length;
            return (
              <article
                key={t.id}
                className="card stack tutor-card rise"
                style={{ ...subjectVars(t.subject), animationDelay: `${i * 0.05}s` }}
              >
                <button className="tutor-head" onClick={() => setOpen({ id: t.id, prep: false })}>
                  <Avatar tutor={t} />
                  <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 16 }}>{t.name}</strong>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {[
                        t.subject,
                        sessions ? `${sessions} lesson${sessions === 1 ? "" : "s"} logged` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span
                    className={`chip${start && lessonLabel(start, now) === "on now" ? " warm" : ""}`}
                  >
                    {start ? lessonLabel(start, now) : t.when || "No time set"}
                  </span>
                </button>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <JoinButtons tutor={t} />
                  <button className="btn small" onClick={() => setOpen({ id: t.id, prep: false })}>
                    Open ›
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <button
        className="btn block"
        onClick={() =>
          setEditing({ id: newId("u"), name: "", subject: "", meet: "", whatsapp: "", when: "" })
        }
      >
        <Icon name="plus" size={16} />
        Add a tutor
      </button>
      {editing && (
        <TutorForm
          tutor={editing}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            saveTutor(t);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function TutorForm({
  tutor,
  onSave,
  onClose,
  onDelete,
}: {
  tutor: Tutor;
  onSave: (t: Tutor) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(tutor);
  const parsed = parseWhen(draft.when);
  const next = parsed ? nextLesson(draft) : null;
  const field = (key: keyof Tutor, label: string, placeholder: string, type = "text") => (
    <label className="stack" style={{ gap: 6 }}>
      <span className="h2">{label}</span>
      <input
        className="field"
        type={type}
        value={draft[key]}
        placeholder={placeholder}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label="Tutor"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.name.trim()) {
            onSave({ ...draft, name: draft.name.trim(), meet: safeLink(draft.meet) });
          }
        }}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          {onDelete ? "Edit tutor" : "Add a tutor"}
        </h2>
        {field("name", "Name", "e.g. Anna")}
        {field("subject", "Subject", "e.g. Maths")}
        {field("when", "When are lessons?", "e.g. Tuesdays 17:00, or Mon & Thu 16:30")}
        {draft.when.trim() && (
          <span className={parsed ? "muted" : "warm-text"} style={{ fontSize: 13, marginTop: -6 }}>
            {parsed && next
              ? `✓ Every ${parsed.days.map((d) => DAY_SHORT[d]).join(" & ")} at ${parsed.time}. Next: ${lessonLabel(next)}`
              : "I can't read that time. Try e.g. “Tuesdays 17:00” or “po a čt 16:30”."}
          </span>
        )}
        {field("meet", "Google Meet link", "https://meet.google.com/…", "url")}
        {field("whatsapp", "WhatsApp number (optional)", "+420 …", "tel")}
        <span className="muted">Saved only on this device.</span>
        <button className="btn big primary" type="submit" disabled={!draft.name.trim()}>
          Save
        </button>
        {onDelete && (
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              if (window.confirm(`Remove ${draft.name}?`)) {
                onDelete();
              }
            }}
          >
            Remove tutor
          </button>
        )}
      </form>
    </div>
  );
}

function PrepCard({
  tutor,
  sessions,
  materials,
  auto,
}: {
  tutor: Tutor;
  sessions: TutorSession[];
  materials: TutorMaterial[];
  auto: boolean;
}) {
  const { ai, homework, handleError, toast } = useApp();
  const [prep, setPrep] = useState<LessonPrep | "loading" | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    if (!ai) {
      return;
    }
    setPrep("loading");
    try {
      const subject = tutor.subject.toLowerCase().slice(0, 5);
      const school = [
        ...(homework ?? [])
          .filter((h) => !h.done && subject && h.course.toLowerCase().includes(subject))
          .map((h) => `Homework: ${h.title}${h.due ? ` (due ${h.due.slice(0, 10)})` : ""}`),
        ...prepTests
          .all()
          .filter(
            (t) =>
              subject && t.subject.toLowerCase().includes(subject) && t.date >= dayOf(new Date()),
          )
          .map((t) => `Test: ${t.topic} on ${t.date}`),
      ];
      setPrep(
        await lessonPrep(
          ai,
          tutorContext({ tutor, sessions, materials, todos: todos.all(), schoolWork: school }),
        ),
      );
    } catch (err) {
      setPrep(null);
      handleError(err);
    }
  };

  useEffect(() => {
    if (auto) {
      void run();
    }
  }, []);

  if (!ai) {
    return null;
  }
  if (prep === null || prep === "loading") {
    return (
      <button className="lab-cta rise" disabled={prep === "loading"} onClick={() => void run()}>
        <span className="lab-cta-icon" aria-hidden="true">
          <Icon
            name={prep === "loading" ? "loader" : "sparkle"}
            size={22}
            className={prep === "loading" ? "spin" : undefined}
          />
        </span>
        <span className="stack" style={{ gap: 2, flex: 1, textAlign: "left" }}>
          <strong style={{ fontSize: 16 }}>
            {prep === "loading" ? "Getting you ready…" : "Prep me for the lesson"}
          </strong>
          <span className="muted">What to ask, what to look over, what to have ready</span>
        </span>
      </button>
    );
  }
  const block = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <ul className="ai-list">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="ai-card pop" aria-label="Lesson prep">
      <div className="between">
        <h3>
          <Icon name="sparkle" size={16} />
          Ready for {tutor.name}
        </h3>
        <button className="link-btn" style={{ minHeight: 32 }} onClick={() => setPrep(null)}>
          Hide
        </button>
      </div>
      {prep.focus && <p style={{ margin: 0, fontWeight: 600 }}>{prep.focus}</p>}
      {block("Ask your tutor", prep.ask)}
      {block("Look over (5 min)", prep.review)}
      {block("Have ready", prep.bring)}
      {prep.ask.length > 0 && (
        <button
          className="btn small"
          disabled={saved}
          onClick={() => {
            notes.upsert({
              id: newId("n"),
              title: `Questions for ${tutor.name} (${dayOf(new Date())})`,
              subject: tutor.subject,
              body: prep.ask.map((q) => `• ${q}`).join("\n"),
              updatedAt: new Date().toISOString(),
              packId: "",
            });
            setSaved(true);
            toast("Questions saved in Notes.");
          }}
        >
          <Icon name="note" size={14} />
          {saved ? "Saved in Notes" : "Save questions to Notes"}
        </button>
      )}
    </section>
  );
}

function TutorPage({
  tutor,
  autoPrep,
  onBack,
  onEdit,
  onOpenNote,
}: {
  tutor: Tutor;
  autoPrep: boolean;
  onBack: () => void;
  onEdit: () => void;
  onOpenNote: (id: string) => void;
}) {
  const { ai, go, openAi, handleError, toast } = useApp();
  const now = useNow();
  const [materials, setMaterials] = useState<TutorMaterial[]>(() =>
    tutoring.materials().filter((m) => m.tutorId === tutor.id),
  );
  const [sessions, setSessions] = useState<TutorSession[]>(() =>
    tutoring.sessions().filter((s) => s.tutorId === tutor.id),
  );
  const [tab, setTab] = useState<"lessons" | "materials">("lessons");
  const [adding, setAdding] = useState<"material" | "session" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const start = nextLesson(tutor, now);
  useAiContext(
    `Tutor ${tutor.name} (${tutor.subject}). Lessons: ` +
      sessions.map((s) => `${s.date}: ${s.topic}`).join("; ") +
      `. Materials: ${materials.map((m) => m.title).join("; ")}`,
  );

  const saveMaterials = (mine: TutorMaterial[]) => {
    setMaterials(mine);
    const others = tutoring.materials().filter((m) => m.tutorId !== tutor.id);
    if (!tutoring.saveMaterials([...others, ...mine])) {
      toast("This device is out of space; photos weren't kept, the text was.");
    }
  };

  const saveSessions = (mine: TutorSession[]) => {
    setSessions(mine);
    tutoring.saveSessions([...tutoring.sessions().filter((s) => s.tutorId !== tutor.id), ...mine]);
  };

  return (
    <>
      <div className="between rise">
        <button className="link-btn" onClick={onBack}>
          ‹ Tutoring
        </button>
        <button className="link-btn" onClick={onEdit}>
          Edit
        </button>
      </div>
      <header
        className="card stack rise tutor-card"
        style={{ gap: 10, ...subjectVars(tutor.subject) }}
      >
        <div className="row" style={{ gap: 12 }}>
          <Avatar tutor={tutor} size={56} />
          <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
            <h2 className="h1" style={{ fontSize: 24 }}>
              {tutor.name}
            </h2>
            <span className="muted">{tutor.subject}</span>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className={`chip${start && lessonLabel(start, now) === "on now" ? " warm" : ""}`}>
            <Icon name="calendar" size={12} />
            {start ? `Next lesson ${lessonLabel(start, now)}` : tutor.when || "No lesson time set"}
          </span>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <JoinButtons tutor={tutor} />
        </div>
      </header>

      <PrepCard tutor={tutor} sessions={sessions} materials={materials} auto={autoPrep} />

      <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr" }} role="tablist">
        <button role="tab" aria-selected={tab === "lessons"} onClick={() => setTab("lessons")}>
          Lessons · {sessions.length}
        </button>
        <button role="tab" aria-selected={tab === "materials"} onClick={() => setTab("materials")}>
          Materials · {materials.length}
        </button>
      </div>

      {tab === "lessons" ? (
        <section className="stack" style={{ gap: 8 }}>
          <button className="btn block primary" onClick={() => setAdding("session")}>
            <Icon name="plus" size={16} />
            Log a lesson
          </button>
          {sessions.length === 0 && (
            <div className="card muted" style={{ fontSize: 14 }}>
              After each lesson, type a few rough notes. The AI tidies them up and puts the homework
              in your to-do list.
            </div>
          )}
          <div className="timeline">
            {sessions
              .toSorted((a, b) => b.date.localeCompare(a.date))
              .map((s) => (
                <div key={s.id} className="timeline-item card stack" style={{ gap: 4 }}>
                  <div className="between">
                    <strong>{s.topic || "Lesson"}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {new Date(`${s.date}T12:00:00`).toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                  {s.notes && (
                    <p
                      style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.45 }}
                    >
                      {s.notes}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </section>
      ) : (
        <section className="stack" style={{ gap: 8 }}>
          <button className="btn block primary" onClick={() => setAdding("material")}>
            <Icon name="plus" size={16} />
            Add material
          </button>
          {materials.length === 0 && (
            <div className="card muted" style={{ fontSize: 14 }}>
              When your tutor sends something on WhatsApp: screenshot it (or save the photo), then
              tap Add material. You can also copy a message and paste it.
            </div>
          )}
          {materials
            .toSorted((a, b) => b.date.localeCompare(a.date))
            .map((m) => (
              <article key={m.id} className="card stack" style={{ gap: 8 }}>
                <button
                  className="review-text"
                  onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                >
                  <strong>{m.title}</strong>
                  <span className="muted">{m.date}</span>
                </button>
                {expanded === m.id && (
                  <>
                    {m.photo && <img src={m.photo} alt={m.title} className="material-photo" />}
                    <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.text}</p>
                  </>
                )}
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <button
                    className="btn small primary"
                    onClick={() => {
                      labHandoff.set({
                        kind: "scan",
                        subject: tutor.subject,
                        topic: m.title,
                        text: m.text,
                        photos: m.photo ? [m.photo] : [],
                        testId: "",
                      });
                      go("revise");
                    }}
                  >
                    <Icon name="game" size={14} />
                    Make revision
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      const id = newId("n");
                      notes.upsert({
                        id,
                        title: m.title,
                        subject: tutor.subject,
                        body: m.text,
                        updatedAt: new Date().toISOString(),
                        packId: "",
                      });
                      onOpenNote(id);
                    }}
                  >
                    <Icon name="keep" size={14} />
                    Save as note
                  </button>
                  <button
                    className="btn small"
                    onClick={() =>
                      openAi({
                        context: `Material from my ${tutor.subject} tutor: "${m.title}". ${m.text.slice(0, 4000)}`,
                        question: `Help me understand "${m.title}".`,
                      })
                    }
                  >
                    <Icon name="sparkle" size={14} />
                    Ask AI
                  </button>
                  <button
                    className="btn small ghost"
                    aria-label={`Delete ${m.title}`}
                    onClick={() => saveMaterials(materials.filter((x) => x.id !== m.id))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </article>
            ))}
        </section>
      )}

      {adding === "material" && (
        <AddMaterial
          tutor={tutor}
          canRead={Boolean(ai)}
          onClose={() => setAdding(null)}
          onAdd={async (images, pasted) => {
            try {
              const read = ai
                ? await readMaterial(ai, {
                    images,
                    text: pasted,
                    hint: `From my ${tutor.subject} tutor`,
                  })
                : { title: "Material", subject: tutor.subject, text: pasted };
              const photo = images[0] ? await smallCopy(images[0], 900).catch(() => "") : "";
              saveMaterials([
                ...materials,
                {
                  id: newId("m"),
                  tutorId: tutor.id,
                  title: read.title,
                  text: read.text,
                  photo,
                  date: dayOf(new Date()),
                },
              ]);
              setTab("materials");
              setAdding(null);
              toast("Material saved.");
            } catch (err) {
              handleError(err);
            }
          }}
        />
      )}
      {adding === "session" && (
        <LogSession
          tutor={tutor}
          onClose={() => setAdding(null)}
          onAdd={(s, homework) => {
            saveSessions([...sessions, { ...s, tutorId: tutor.id }]);
            setTab("lessons");
            for (const task of homework) {
              todos.add({
                text: task,
                due: "",
                subject: tutor.subject,
                from: `Tutoring with ${tutor.name}`,
              });
            }
            toast(
              homework.length
                ? `Lesson saved, ${homework.length} homework task${homework.length === 1 ? "" : "s"} added to your to-do list.`
                : "Lesson saved.",
            );
            setAdding(null);
          }}
        />
      )}
    </>
  );
}

function AddMaterial({
  tutor,
  canRead,
  onAdd,
  onClose,
}: {
  tutor: Tutor;
  canRead: boolean;
  onAdd: (images: ImageInput[], text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [images, setImages] = useState<ImageInput[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Add material"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          Material from {tutor.name}
        </h2>
        <p className="sub">Screenshots or photos from WhatsApp, and/or a copied message.</p>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, 4 - images.length);
            setImages(
              [...images, ...(await Promise.all(files.map(photoToImageInput)))].slice(0, 4),
            );
          }}
        />
        <div className="thumbs">
          {images.map((img, i) => (
            <img key={i} src={imageSrc(img)} alt={`Picture ${i + 1}`} />
          ))}
          {images.length < 4 && (
            <button className="thumb add" onClick={() => input.current?.click()}>
              <Icon name="image" size={22} />
              Photos
            </button>
          )}
        </div>
        <textarea
          className="field"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a message from WhatsApp…"
          aria-label="Pasted message"
        />
        {!canRead && images.length > 0 && (
          <div className="banner">
            Reading photos needs the AI (open the app on claude.ai). Pasted text still works.
          </div>
        )}
        <button
          className="btn big primary"
          disabled={busy || (images.length === 0 && !text.trim()) || (!canRead && !text.trim())}
          onClick={async () => {
            setBusy(true);
            await onAdd(images, text);
            setBusy(false);
          }}
        >
          {busy && <Icon name="loader" size={18} className="spin" />}
          {busy ? "Reading it…" : "Save material"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function LogSession({
  tutor,
  onAdd,
  onClose,
}: {
  tutor: Tutor;
  onAdd: (s: TutorSession, homework: string[]) => void;
  onClose: () => void;
}) {
  const { ai, handleError } = useApp();
  const [date, setDate] = useState(dayOf(new Date()));
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [homework, setHomework] = useState("");
  const [busy, setBusy] = useState(false);

  const writeUp = async () => {
    if (!ai || !text.trim()) {
      return;
    }
    setBusy(true);
    try {
      const recap = await lessonRecap(
        ai,
        tutor,
        `${topic ? `Topic: ${topic}\n` : ""}${text}\n${homework}`,
      );
      if (recap.topic) {
        setTopic(recap.topic);
      }
      if (recap.notes) {
        setText(recap.notes);
      }
      setHomework(recap.homework.join("\n"));
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label="Log a lesson"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(
            { id: newId("s"), tutorId: "", date, topic: topic.trim(), notes: text.trim() },
            homework
              .split("\n")
              .map((h) => h.replace(/^[•\-*\d.)\s]+/, "").trim())
              .filter(Boolean),
          );
        }}
      >
        <h2 className="h1" style={{ fontSize: 24 }}>
          Log a lesson
        </h2>
        <input
          className="field"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
        />
        <input
          className="field"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What did you cover?"
          aria-label="Topic"
        />
        <textarea
          className="field"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Rough notes are fine: what you did, what was hard, what the tutor set…"
          aria-label="Notes"
        />
        {ai && (
          <button
            className="btn"
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void writeUp()}
          >
            <Icon name={busy ? "loader" : "wand"} size={16} className={busy ? "spin" : undefined} />
            {busy ? "Writing it up…" : "Write it up for me"}
          </button>
        )}
        <textarea
          className="field"
          rows={2}
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
          placeholder="Homework from the tutor, one per line (goes to your to-do)"
          aria-label="Homework"
        />
        <button className="btn big primary" type="submit" disabled={busy}>
          Save lesson
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
