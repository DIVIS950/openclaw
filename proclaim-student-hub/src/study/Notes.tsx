import { useRef, useState, type ReactNode } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { photoToImageInput } from "../lib/image.ts";
import { labHandoff, newId, notes, searchNotes, todos, type Note } from "../lib/study.ts";
import { readMaterial } from "../lib/studyAi.ts";
import { subjectVars } from "../lib/subjects.ts";

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
  const [open, setOpen] = useState<string | null>(openId);
  const [reading, setReading] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const shown = searchNotes(list, query);
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
      };
      save(note);
      setOpen(note.id);
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
        onBack={() => {
          // Leaving a note that was never written in: don't keep an empty one.
          const saved = notes.all();
          const empty = saved.find((n) => n.id === current.id && !n.title.trim() && !n.body.trim());
          if (empty) {
            notes.save(saved.filter((n) => n !== empty));
          }
          setList(notes.all());
          setOpen(null);
          onClose();
        }}
        onDelete={() => {
          const next = list.filter((n) => n.id !== current.id);
          notes.save(next);
          setList(next);
          setOpen(null);
          onClose();
        }}
      />
    );
  }

  return (
    <>
      {header}
      <div className="row">
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
            };
            save(note);
            setOpen(note.id);
          }}
        >
          <Icon name="plus" size={16} />
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
            size={16}
            className={reading ? "spin" : undefined}
          />
          {reading ? "Reading…" : "From a photo"}
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
      {list.length > 3 && (
        <input
          className="field"
          type="search"
          placeholder="Search notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search notes"
        />
      )}
      {shown.length === 0 ? (
        <div className="card empty">
          {list.length
            ? "No notes match."
            : "No notes yet. Write one, snap a photo of your notes, or make a revision pack (it saves its own notes)."}
        </div>
      ) : (
        <div className="stack">
          {shown.map((n) => (
            <button
              key={n.id}
              className="card stack subject-card note-card"
              style={subjectVars(n.subject || n.title)}
              onClick={() => setOpen(n.id)}
            >
              <div className="between">
                <strong style={{ fontSize: 16 }}>{n.title || "Untitled"}</strong>
                {n.packId && <span className="chip accent">Revision</span>}
              </div>
              <span className="muted note-preview">
                {n.body.split("\n").find((l) => l.trim()) ?? "Empty"}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
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
      <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
        ‹ Notes
      </button>
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
