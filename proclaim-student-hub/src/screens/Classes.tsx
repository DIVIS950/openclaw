import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { courses, type Course, type CoursePost } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";

// The student's Classroom classes, as imported (Classroom itself is blocked for
// outside apps at school). Go through the posts, get help, add work to homework.

const KIND_LABEL: Record<CoursePost["kind"], string> = {
  assignment: "Assignment",
  material: "Material",
  announcement: "Post",
};

const dateLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return "Today";
  }
  const days = (today.getTime() - d.getTime()) / 86_400_000;
  if (days < 1.5) {
    return "Yesterday";
  }
  return days < 7
    ? d.toLocaleDateString("en-GB", { weekday: "short" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Two letters for the class mark: "Ma" for Maths, "Ar" for Art History. */
const markOf = (name: string) => {
  const word = name.trim().split(/\s+/)[0] ?? "";
  return word.slice(0, 2);
};

/** Posts from the last 7 days count as new. */
const newCount = (c: Course) => {
  const cutoff = Date.now() - 7 * 86_400_000;
  return c.posts.filter((p) => p.date && new Date(`${p.date}T12:00:00`).getTime() >= cutoff).length;
};

export function Classes() {
  const [list] = useState<Course[]>(courses.get);
  const [openName, setOpenName] = useState<string | null>(() => list[0]?.name ?? null);
  const open = list.find((c) => c.name === openName) ?? null;
  useAiContext(
    open
      ? `Class "${open.name}" (${open.subject}). Posts: ` +
          open.posts
            .map((p) => `${KIND_LABEL[p.kind]} "${p.title}" (${p.date || "no date"})`)
            .join("; ")
      : `Classes: ${list.map((c) => c.name).join(", ") || "none imported yet"}.`,
  );

  return (
    <main className="screen">
      <header className="between rise" style={{ alignItems: "center" }}>
        <h1 className="h1">Classes</h1>
        {list.length > 0 && (
          <span className="chip" style={{ height: 28 }}>
            {list.length} from Classroom
          </span>
        )}
      </header>

      {list.length === 0 ? (
        <section className="card stack empty-fun">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="classroom" size={26} />
          </span>
          <strong>No classes yet</strong>
          <span className="muted">
            Send screenshots of your Classroom classes to Claude and they'll appear here.
          </span>
        </section>
      ) : (
        <>
          {open && <ClassCard key={open.name} course={open} />}
          {list.filter((c) => c !== open).length > 0 && (
            <section className="card rows rise d2">
              {list
                .filter((c) => c !== open)
                .map((c) => {
                  const fresh = newCount(c);
                  const latest = c.posts.find((p) => p.date) ?? c.posts[0];
                  return (
                    <button
                      key={c.name}
                      className="crow"
                      style={subjectVars(c.subject)}
                      onClick={() => {
                        setOpenName(c.name);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      <span className="mark" aria-hidden="true">
                        {markOf(c.name)}
                      </span>
                      <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 700 }}>{c.name}</span>
                        <span className="s12 muted clip">
                          {latest ? latest.title : `${c.posts.length} posts`}
                        </span>
                      </span>
                      {fresh > 0 && <span className="chip subject">{fresh} new</span>}
                    </button>
                  );
                })}
            </section>
          )}
        </>
      )}
    </main>
  );
}

type Tab = "Posts" | "Materials" | "Assignments";
const TAB_KIND: Record<Tab, CoursePost["kind"] | null> = {
  Posts: null,
  Materials: "material",
  Assignments: "assignment",
};

/** The open class: its posts, with help and "add to homework" on each. */
function ClassCard({ course }: { course: Course }) {
  const { openAi, askTutor, data, homework, addHomeworkItem, handleError, toast } = useApp();
  const [tab, setTab] = useState<Tab>("Posts");
  const [adding, setAdding] = useState<string | null>(null);
  const titles = new Set((homework ?? []).map((h) => h.title.trim().toLowerCase()));
  const kind = TAB_KIND[tab];
  const posts = course.posts.filter((p) => !kind || p.kind === kind);
  const fresh = newCount(course);

  const add = async (post: CoursePost) => {
    setAdding(post.title);
    try {
      addHomeworkItem(
        await data.addHomework({ title: post.title, source: "Classroom", course: course.name }),
      );
      toast(`Added "${post.title}" to homework.`);
    } catch (err) {
      handleError(err);
    } finally {
      setAdding(null);
    }
  };

  return (
    <section
      className="card stack rise d1 class-open"
      style={{ ...subjectVars(course.subject), gap: 12, padding: 16 }}
    >
      <div className="row" style={{ gap: 12 }}>
        <span className="mark" aria-hidden="true">
          {markOf(course.name)}
        </span>
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <h2 className="h2">{course.name}</h2>
          <span className="s12 muted">
            {course.subject} · {course.posts.length} posts
          </span>
        </div>
        {fresh > 0 && <span className="chip subject">{fresh} new</span>}
      </div>
      <div className="seg" role="tablist" aria-label="Show">
        {(["Posts", "Materials", "Assignments"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            className={tab === t ? "on" : undefined}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: 0 }}>
        {posts.length === 0 && <span className="muted s12">Nothing here yet.</span>}
        {posts.map((p, i) => {
          const context =
            `${course.name} (${course.subject}): ${KIND_LABEL[p.kind]} "${p.title}"` +
            `${p.date ? `, posted ${p.date}` : ""}. ${p.text}`;
          const old = i > 1;
          return (
            <div
              key={`${p.date}-${p.title}`}
              className="post"
              style={old ? { opacity: 0.7 } : undefined}
            >
              <span className="post-dot" style={old ? { background: "var(--line)" } : undefined} />
              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <button
                  className="link-btn"
                  style={{ fontWeight: 600, textAlign: "left", color: "inherit" }}
                  onClick={() =>
                    p.kind === "material"
                      ? askTutor(
                          `Teach me the key points of "${p.title}" (${course.subject}, Year 9) simply, then quiz me with 3 questions.`,
                          "explain",
                        )
                      : openAi({ context, question: `Help me with "${p.title}".` })
                  }
                >
                  {p.title}
                </button>
                <span className="s12 muted">
                  {[
                    p.date ? dateLabel(p.date) : "",
                    KIND_LABEL[p.kind],
                    p.text ? p.text.slice(0, 60) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {p.kind === "assignment" &&
                (titles.has(p.title.toLowerCase()) ? (
                  <span className="chip lime">
                    <Icon name="check" size={12} />
                    Added
                  </span>
                ) : (
                  <button
                    className="btn sm"
                    disabled={adding === p.title}
                    onClick={() => void add(p)}
                  >
                    <Icon name="plus" size={14} />
                    Add
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
