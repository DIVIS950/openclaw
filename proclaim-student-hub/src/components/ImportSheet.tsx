import { useRef, useState } from "react";
import type { ImageInput } from "../../shared/api.ts";
import { useApp } from "../context.ts";
import {
  readHomeworkList,
  readTimetablePhoto,
  type ImportedTask,
  type Lesson,
} from "../lib/aiFeatures.ts";
import { imageSrc, photoToImageInput } from "../lib/image.ts";
import { timetable } from "../lib/store.ts";
import { useEscape } from "../lib/useEscape.ts";
import { videoToFrames } from "../lib/video.ts";
import { Icon } from "./Icon.tsx";
import { Overlay } from "./Overlay.tsx";

type Mode = "homework" | "timetable";

const COPY: Record<Mode, { title: string; help: string[]; paste: string; action: string }> = {
  homework: {
    title: "Import homework",
    help: [
      "Start your phone's screen recording (or take screenshots).",
      "Tap Open Classroom below, go to To-do and scroll slowly through all your work.",
      "Stop recording, come back here and add the video. Screenshots or pasted text work too.",
    ],
    paste: "Or paste your to-do list here…",
    action: "Find my homework",
  },
  timetable: {
    title: "Add your timetable",
    help: [
      "Take a photo or screenshot of your school timetable.",
      "Add it here. You only need to do this once.",
    ],
    paste: "Or type/paste your timetable…",
    action: "Read my timetable",
  },
};

/** Brings in data the school won't let apps read directly: the student adds a
 *  screenshot or pasted text and the AI turns it into homework or lessons. */
export function ImportSheet({
  mode,
  onClose,
  onLessons,
}: {
  mode: Mode;
  onClose: () => void;
  onLessons?: (lessons: Lesson[]) => void;
}) {
  const { ai, data, homework, addHomeworkItem, handleError, toast } = useApp();
  const [images, setImages] = useState<ImageInput[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEscape(onClose, !busy);
  const [tasks, setTasks] = useState<(ImportedTask & { pick: boolean })[] | null>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const copy = COPY[mode];
  // A video becomes many frames; photos are capped at four.
  const maxImages = mode === "homework" ? 16 : 4;
  const [videoProgress, setVideoProgress] = useState<string | null>(null);

  const add = async (files: FileList | null) => {
    if (!files) {
      return;
    }
    try {
      const list = [...files];
      const video = list.find((f) => f.type.startsWith("video/"));
      if (video) {
        setVideoProgress("Watching your video…");
        const frames = await videoToFrames(video, (done, total) =>
          setVideoProgress(`Watching your video… ${Math.round((done / total) * 100)}%`),
        );
        setImages((prev) => [...prev, ...frames].slice(0, maxImages));
        toast(
          `Found ${frames.length} different ${frames.length === 1 ? "screen" : "screens"} in your video.`,
        );
        return;
      }
      const picked = await Promise.all(
        list
          .filter((f) => f.type.startsWith("image/"))
          .slice(0, maxImages - images.length)
          .map(photoToImageInput),
      );
      setImages((prev) => [...prev, ...picked].slice(0, maxImages));
    } catch (err) {
      handleError(err);
    } finally {
      setVideoProgress(null);
    }
  };

  const read = async () => {
    if (!ai) {
      return;
    }
    setBusy(true);
    try {
      if (mode === "homework") {
        // Four images per AI call; later batches skip what earlier ones found.
        const found: ImportedTask[] = [];
        const batches = Math.max(1, Math.ceil(images.length / 4));
        for (let b = 0; b < batches; b++) {
          const batch = images.slice(b * 4, b * 4 + 4);
          const known = [...(homework ?? []), ...found];
          found.push(
            ...(await readHomeworkList(ai, { images: batch, text: b === 0 ? text : "" }, known)),
          );
        }
        setTasks(found.map((t) => ({ ...t, pick: true })));
      } else {
        setLessons(await readTimetablePhoto(ai, { images, text }));
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveTasks = async () => {
    if (!tasks) {
      return;
    }
    setBusy(true);
    let added = 0;
    try {
      for (const t of tasks.filter((x) => x.pick)) {
        const hw = await data.addHomework({
          title: t.subject ? `${t.subject}: ${t.title}` : t.title,
          source: t.source,
          due: t.due || undefined,
        });
        addHomeworkItem(hw);
        added++;
      }
      toast(`Added ${added} ${added === 1 ? "task" : "tasks"}.`);
      onClose();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveLessons = () => {
    if (!lessons) {
      return;
    }
    timetable.save(lessons);
    onLessons?.(lessons);
    toast("Timetable saved.");
    onClose();
  };

  return (
    <Overlay>
      <div className="backdrop" onClick={onClose}>
        <div
          className="sheet"
          role="dialog"
          aria-label={copy.title}
          onClick={(e) => e.stopPropagation()}
          onPaste={(e) => {
            // A copied screenshot pastes straight in (Ctrl+V / long-press Paste).
            const files = e.clipboardData.files;
            if ([...files].some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void add(files);
            }
          }}
        >
          <div className="between">
            <h2 className="h1" style={{ fontSize: 24 }}>
              {copy.title}
            </h2>
            <button className="round" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>

          {tasks === null && lessons === null && (
            <>
              <ol className="ai-list" style={{ color: "var(--muted)" }}>
                {copy.help.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
              <input
                ref={picker}
                type="file"
                accept={mode === "homework" ? "image/*,video/*" : "image/*"}
                multiple
                hidden
                onChange={(e) => void add(e.target.files)}
              />
              {mode === "homework" && (
                <a
                  className="btn big"
                  href="https://classroom.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="classroom" size={20} />
                  Open Classroom To-do
                </a>
              )}
              <button
                className="btn big dark"
                disabled={images.length >= maxImages || videoProgress !== null}
                onClick={() => picker.current?.click()}
              >
                <Icon
                  name={videoProgress ? "loader" : "image"}
                  size={20}
                  className={videoProgress ? "spin" : undefined}
                />
                {videoProgress ??
                  (mode === "homework"
                    ? "Add screen recording or screenshots"
                    : "Add screenshot or photo")}
              </button>
              {images.length > 0 && (
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {images.map((img, i) => (
                    <img
                      key={i}
                      src={imageSrc(img)}
                      alt={`Added image ${i + 1}`}
                      className="pop"
                      style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 12 }}
                    />
                  ))}
                </div>
              )}
              <label htmlFor={`import-${mode}`} className="sr-only">
                {copy.paste}
              </label>
              <textarea
                id={`import-${mode}`}
                className="field"
                rows={4}
                placeholder={copy.paste}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {ai ? (
                <button
                  className="btn big primary"
                  disabled={busy || (images.length === 0 && !text.trim())}
                  onClick={() => void read()}
                >
                  <Icon
                    name={busy ? "loader" : "sparkle"}
                    size={18}
                    className={busy ? "spin" : undefined}
                  />
                  {busy ? "Reading…" : copy.action}
                </button>
              ) : (
                <div className="banner">The AI needs you signed in to read screenshots.</div>
              )}
            </>
          )}

          {tasks !== null && (
            <>
              {tasks.length === 0 ? (
                <p className="sub">
                  No new homework found. Try a clearer screenshot of the To-do page.
                </p>
              ) : (
                <div className="list">
                  {tasks.map((t, i) => (
                    <label
                      key={i}
                      className="hw-row rise"
                      style={{ animationDelay: `${i * 0.04}s` }}
                    >
                      <input
                        type="checkbox"
                        checked={t.pick}
                        onChange={() =>
                          setTasks(tasks.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)))
                        }
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="hw-title" style={{ display: "block" }}>
                          {t.title}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {[t.subject, t.source, t.due && `due ${t.due}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="row">
                <button className="btn" style={{ flex: 1 }} onClick={() => setTasks(null)}>
                  Back
                </button>
                <button
                  className="btn primary"
                  style={{ flex: 1 }}
                  disabled={busy || !tasks.some((t) => t.pick)}
                  onClick={() => void saveTasks()}
                >
                  Add {tasks.filter((t) => t.pick).length}
                </button>
              </div>
            </>
          )}

          {lessons !== null && (
            <>
              {lessons.length === 0 ? (
                <p className="sub">Couldn't read any lessons. Try a clearer photo.</p>
              ) : (
                <div className="list" style={{ maxHeight: 320, overflowY: "auto" }}>
                  {lessons.map((l, i) => (
                    <div key={i} className="hw-row" style={{ padding: "10px 16px" }}>
                      <span className="chip" style={{ minWidth: 44, justifyContent: "center" }}>
                        {l.day}
                      </span>
                      <span className="muted" style={{ width: 44 }}>
                        {l.start}
                      </span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{l.subject}</span>
                      <span className="muted">{l.room}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="row">
                <button className="btn" style={{ flex: 1 }} onClick={() => setLessons(null)}>
                  Back
                </button>
                <button
                  className="btn primary"
                  style={{ flex: 1 }}
                  disabled={lessons.length === 0}
                  onClick={saveLessons}
                >
                  Save timetable
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
