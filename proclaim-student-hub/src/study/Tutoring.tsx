import { useRef, useState, type ReactNode } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { imageSrc, photoToImageInput, smallCopy } from "../lib/image.ts";
import {
  dayOf,
  labHandoff,
  newId,
  notes,
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

// Tutoring: the student's tutors, their lessons (Google Meet) and the materials
// the tutor sends (usually on WhatsApp). Materials come in as photos,
// screenshots or pasted text; the AI turns them into notes and revision.

export function Tutoring({
  onOpenNote,
  header,
}: {
  onOpenNote: (id: string) => void;
  /** Shown above the list, but not over an open tutor. */
  header?: ReactNode;
}) {
  const [tutors, setTutors] = useState<Tutor[]>(tutoring.tutors);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tutor | null>(null);
  useAiContext(
    `Tutors: ${tutors.map((t) => `${t.name} (${t.subject}, ${t.when})`).join("; ") || "none yet"}.`,
  );

  const saveTutor = (t: Tutor) => {
    const next = tutors.some((x) => x.id === t.id)
      ? tutors.map((x) => (x.id === t.id ? t : x))
      : [...tutors, t];
    setTutors(next);
    tutoring.saveTutors(next);
  };

  const current = tutors.find((t) => t.id === open);
  if (current) {
    return (
      <>
        <TutorPage
          tutor={current}
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
      {tutors.length === 0 ? (
        <section className="card stack empty-fun">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="book" size={26} />
          </span>
          <strong>Your tutoring, in one place</strong>
          <span className="muted">
            Add your tutor to keep their Google Meet link, lesson notes and the materials they send
            you on WhatsApp. The AI turns materials into notes, flashcards and quizzes.
          </span>
        </section>
      ) : (
        <div className="stack">
          {tutors.map((t) => {
            const meet = safeLink(t.meet);
            const wa = whatsappLink(t.whatsapp);
            return (
              <div key={t.id} className="card stack subject-card" style={subjectVars(t.subject)}>
                <button className="review-text" onClick={() => setOpen(t.id)}>
                  <strong style={{ fontSize: 16 }}>{t.name}</strong>
                  <span className="muted">
                    {t.subject}
                    {t.when ? ` · ${t.when}` : ""}
                  </span>
                </button>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {meet && (
                    <a
                      className="btn small primary"
                      href={meet}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon name="link" size={14} />
                      Join Meet
                    </a>
                  )}
                  {wa && (
                    <a className="btn small" href={wa} target="_blank" rel="noopener noreferrer">
                      WhatsApp
                    </a>
                  )}
                  <button className="btn small" onClick={() => setOpen(t.id)}>
                    Materials & lessons ›
                  </button>
                </div>
              </div>
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
        {field("when", "When are lessons?", "e.g. Tuesdays 17:00")}
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

function TutorPage({
  tutor,
  onBack,
  onEdit,
  onOpenNote,
}: {
  tutor: Tutor;
  onBack: () => void;
  onEdit: () => void;
  onOpenNote: (id: string) => void;
}) {
  const { ai, go, openAi, handleError, toast } = useApp();
  const [materials, setMaterials] = useState<TutorMaterial[]>(() =>
    tutoring.materials().filter((m) => m.tutorId === tutor.id),
  );
  const [sessions, setSessions] = useState<TutorSession[]>(() =>
    tutoring.sessions().filter((s) => s.tutorId === tutor.id),
  );
  const [adding, setAdding] = useState<"material" | "session" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const meet = safeLink(tutor.meet);
  const wa = whatsappLink(tutor.whatsapp);
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
      <header className="stack rise" style={{ gap: 4, ...subjectVars(tutor.subject) }}>
        <div className="between">
          <button className="link-btn" onClick={onBack}>
            ‹ Tutoring
          </button>
          <button className="link-btn" onClick={onEdit}>
            Edit
          </button>
        </div>
        <span className="eyebrow row" style={{ gap: 6 }}>
          <span className="subject-dot" /> {tutor.subject}
          {tutor.when ? ` · ${tutor.when}` : ""}
        </span>
        <h2 className="h1" style={{ fontSize: 24 }}>
          {tutor.name}
        </h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {meet && (
            <a className="btn small primary" href={meet} target="_blank" rel="noopener noreferrer">
              <Icon name="link" size={14} />
              Join Meet
            </a>
          )}
          {wa && (
            <a className="btn small" href={wa} target="_blank" rel="noopener noreferrer">
              Open WhatsApp chat
            </a>
          )}
        </div>
      </header>

      <section className="stack" style={{ gap: 8 }}>
        <div className="between">
          <h3 className="h2">Materials</h3>
          <button className="btn small" onClick={() => setAdding("material")}>
            <Icon name="plus" size={14} />
            Add
          </button>
        </div>
        {materials.length === 0 && (
          <div className="card muted" style={{ fontSize: 14 }}>
            When your tutor sends something on WhatsApp: screenshot it (or save the photo), then tap
            Add. You can also copy a message and paste it.
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

      <section className="stack" style={{ gap: 8 }}>
        <div className="between">
          <h3 className="h2">Lessons</h3>
          <button className="btn small" onClick={() => setAdding("session")}>
            <Icon name="plus" size={14} />
            Log a lesson
          </button>
        </div>
        {sessions.length === 0 && <div className="card muted">No lessons logged yet.</div>}
        {sessions
          .toSorted((a, b) => b.date.localeCompare(a.date))
          .map((s) => (
            <div key={s.id} className="card stack" style={{ gap: 4 }}>
              <div className="between">
                <strong>{s.topic || "Lesson"}</strong>
                <span className="muted">{s.date}</span>
              </div>
              {s.notes && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{s.notes}</p>}
            </div>
          ))}
      </section>

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
          onClose={() => setAdding(null)}
          onAdd={(s, homework) => {
            saveSessions([...sessions, { ...s, tutorId: tutor.id }]);
            if (homework.trim()) {
              todos.add({
                text: homework.trim(),
                due: "",
                subject: tutor.subject,
                from: `Tutoring with ${tutor.name}`,
              });
              toast("Lesson saved, homework added to your to-do list.");
            }
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
  onAdd,
  onClose,
}: {
  onAdd: (s: TutorSession, homework: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(dayOf(new Date()));
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [homework, setHomework] = useState("");
  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-label="Log a lesson"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(
            { id: newId("s"), tutorId: "", date, topic: topic.trim(), notes: text.trim() },
            homework,
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
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Notes from the lesson"
          aria-label="Notes"
        />
        <input
          className="field"
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
          placeholder="Homework from the tutor (goes to your to-do)"
          aria-label="Homework"
        />
        <button className="btn big primary" type="submit">
          Save lesson
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
