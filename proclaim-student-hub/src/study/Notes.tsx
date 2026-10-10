import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { photoToImageInput } from "../lib/image.ts";
import {
  labHandoff,
  newId,
  noteKind,
  notes,
  searchNotes,
  todos,
  type Note,
  type NoteKind,
} from "../lib/study.ts";
import { readMaterial } from "../lib/studyAi.ts";
import { useOpenStep } from "../lib/useOpenStep.ts";

// Notes: typed, or read from a photo by the AI. Any note can become a revision
// pack, and every revision pack writes its own note with the vocab list.

export function Notes({
  openId,
  onClose,
  header,
}: {
  openId: string | null;
  onClose: () => void;
  /** Shown above the list, but not over an open note. */
  header?: ReactNode;
}) {
  const { ai, handleError, toast } = useApp();
  const [list, setList] = useState<Note[]>(notes.all);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  // An open note is its own history step, so phone Back returns to the list.
  const [open, openNote, closeNote] = useOpenStep("pshNote", openId);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      // Leaving a note that was never written in: don't keep an empty one.
      const saved = notes.all();
      const kept = saved.filter((n) => n.id !== wasOpen.current || n.title.trim() || n.body.trim());
      if (kept.length !== saved.length) {
        notes.save(kept);
      }
      setList(notes.all());
      onClose();
    }
    wasOpen.current = open;
  }, [open, onClose]);
  const [reading, setReading] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const shown = searchNotes(list, query).filter((n) => matches(n, filter));
  useAiContext(`Notes: ${shown.map((n) => n.title).join("; ")}`);

  const save = (note: Note) => {
    setList(notes.upsert(note));
  };

  const fromPhotos = async (files: FileList | null) => {
    if (!files?.length || !ai) {
      return;
    }
    setReading(true);
    try {
      const images: ImageInput[] = await Promise.all([...files].slice(0, 4).map(photoToImageInput));
      const read = await readMaterial(ai, { images, text: "", hint: "" });
      const note: Note = {
        id: newId("n"),
        title: read.title,
        subject: read.subject,
        body: read.text,
        updatedAt: new Date().toISOString(),
        packId: "",
        kind: "photo",
      };
      save(note);
      openNote(note.id);
      toast("Note made from your photo. Check it looks right.");
    } catch (err) {
      handleError(err);
    } finally {
      setReading(false);
    }
  };

  const current = list.find((n) => n.id === open);
  if (current) {
    return (
      <NoteEditor
        note={current}
        onSave={save}
        onBack={closeNote}
        onDelete={() => {
          const next = list.filter((n) => n.id !== current.id);
          notes.save(next);
          setList(next);
          closeNote();
        }}
      />
    );
  }

  return (
    <>
      <header className="stack rise" style={{ gap: 12 }}>
        {header}
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search notes"
          />
        </label>
        <div className="fchips" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`fchip${filter === f ? " on" : ""}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {shown.length === 0 ? (
        <div className="card empty">
          {list.length
            ? "No notes match."
            : "No notes yet. Write one, snap a photo of your notes, or make a revision pack (it saves its own notes)."}
        </div>
      ) : (
        <section className="note-grid">
          {shown.map((n, i) => {
            const kind = noteKind(n);
            return (
              <button
                key={n.id}
                className="card note rise"
                style={{ animationDelay: `${Math.min(i, 5) * 0.05}s` }}
                onClick={() => openNote(n.id)}
              >
                <span className={`chip ${KIND_CHIP[kind].cls}`}>
                  {kind === "ai" && <Icon name="sparkle" size={12} />}
                  {KIND_CHIP[kind].label}
                </span>
                {kind === "photo" && (
                  <span className="photo-ph" aria-hidden="true">
                    <Icon name="camera" size={14} />
                    photo
                  </span>
                )}
                <h3>{n.title || "Untitled"}</h3>
                {kind !== "photo" && <p>{n.body.split("\n").find((l) => l.trim()) ?? "Empty"}</p>}
                <span className="s11 muted">{noteMeta(n)}</span>
              </button>
            );
          })}
        </section>
      )}
      {/* Room for the floating New note / From photo bar. */}
      <div style={{ height: 56 }} aria-hidden="true" />

      <div className="notes-actions">
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={() => {
            const note: Note = {
              id: newId("n"),
              title: "",
              subject: "",
              body: "",
              updatedAt: new Date().toISOString(),
              packId: "",
              kind: "written",
            };
            save(note);
            openNote(note.id);
          }}
        >
          <Icon name="plus" size={18} />
          New note
        </button>
        <button
          className="btn"
          style={{ flex: 1 }}
          disabled={!ai || reading}
          onClick={() => camera.current?.click()}
        >
          <Icon
            name={reading ? "loader" : "camera"}
            size={18}
            className={reading ? "spin" : undefined}
          />
          {reading ? "Reading…" : "From photo"}
        </button>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void fromPhotos(e.target.files)}
        />
      </div>
    </>
  );
}

type Filter = "All" | "Written" | "From AI" | "From packs" | "Photos";
const FILTERS: Filter[] = ["All", "Written", "From AI", "From packs", "Photos"];
const FILTER_KIND: Record<Exclude<Filter, "All">, NoteKind> = {
  Written: "written",
  "From AI": "ai",
  "From packs": "pack",
  Photos: "photo",
};
const KIND_CHIP: Record<NoteKind, { label: string; cls: string }> = {
  written: { label: "Written", cls: "lime" },
  ai: { label: "From AI", cls: "violet" },
  pack: { label: "From pack", cls: "cyan" },
  photo: { label: "Photo", cls: "magenta" },
};

const matches = (n: Note, f: Filter) => f === "All" || noteKind(n) === FILTER_KIND[f];

/** "Today · Maths" under a note card. */
function noteMeta(n: Note): string {
  const d = new Date(n.updatedAt);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const days = (today.getTime() - d.getTime()) / 86_400_000;
  const when = sameDay
    ? "Today"
    : days < 7
      ? d.toLocaleDateString("en-GB", { weekday: "short" })
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return n.subject ? `${when} · ${n.subject}` : when;
}

function NoteEditor({
  note,
  onSave,
  onBack,
  onDelete,
}: {
  note: Note;
  onSave: (note: Note) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const { go, toast, openAi } = useApp();
  const [draft, setDraft] = useState(note);
  useAiContext(`Note "${draft.title}" (${draft.subject}): ${draft.body.slice(0, 3000)}`);

  const change = (patch: Partial<Note>) => {
    const next = { ...draft, ...patch, updatedAt: new Date().toISOString() };
    setDraft(next);
    onSave(next);
  };

  return (
    <>
      <header className="row rise" style={{ gap: 12 }}>
        <button className="round" aria-label="Back to notes" onClick={onBack}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <h1 className="h1">Note</h1>
      </header>
      <input
        className="field note-title"
        value={draft.title}
        onChange={(e) => change({ title: e.target.value })}
        placeholder="Title"
        aria-label="Title"
      />
      <input
        className="field"
        value={draft.subject}
        onChange={(e) => change({ subject: e.target.value })}
        placeholder="Subject (e.g. Spanish)"
        aria-label="Subject"
      />
      <textarea
        className="field"
        rows={14}
        value={draft.body}
        onChange={(e) => change({ body: e.target.value })}
        placeholder="Write your notes… (vocab as 'word — meaning' works best for flashcards)"
        aria-label="Note"
      />
      <div className="row" style={{ flexWrap: "wrap" }}>
        {draft.packId ? (
          <button
            className="btn small primary"
            onClick={() => {
              labHandoff.set({ kind: "open", packId: draft.packId, action: "" });
              go("revise");
            }}
          >
            <Icon name="game" size={14} />
            Flashcards & quiz
          </button>
        ) : (
          <button
            className="btn small primary"
            disabled={draft.body.trim().length < 20}
            onClick={() => {
              labHandoff.set({
                kind: "scan",
                subject: draft.subject,
                topic: draft.title,
                text: draft.body,
                photos: [],
                testId: "",
              });
              go("revise");
            }}
          >
            <Icon name="game" size={14} />
            Make revision from this
          </button>
        )}
        <button
          className="btn small"
          onClick={() =>
            openAi({
              context: `My note "${draft.title}": ${draft.body.slice(0, 4000)}`,
              question: "Explain the hardest part of this note simply.",
            })
          }
        >
          <Icon name="sparkle" size={14} />
          Ask AI
        </button>
        <button
          className="btn small"
          onClick={() => {
            todos.add({
              text: `Review notes: ${draft.title || "note"}`,
              due: "",
              subject: draft.subject,
              from: "Notes",
            });
            toast("Added to your to-do list.");
          }}
        >
          <Icon name="check" size={14} />
          Add to-do
        </button>
        <button
          className="btn small"
          onClick={() =>
            navigator.clipboard.writeText(`${draft.title}\n\n${draft.body}`).then(
              () => toast("Copied."),
              () => toast("Couldn't copy here."),
            )
          }
        >
          Copy
        </button>
      </div>
      <button
        className="btn ghost"
        onClick={() => {
          if (window.confirm(`Delete "${draft.title || "this note"}"?`)) {
            onDelete();
          }
        }}
      >
        Delete note
      </button>
    </>
  );
}
