import { useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { courses, type Course, type CoursePost } from "../lib/store.ts";
import { subjectVars } from "../lib/subjects.ts";

// The student's Classroom classes, as imported (Classroom itself is blocked for
// outside apps at school). Go through the posts, get help, add work to homework.

type Filter = "All" | "Assignments" | "Materials" | "Posts";

const KIND_ICON: Record<CoursePost["kind"], IconName> = {
  assignment: "homework",
  material: "book",
  announcement: "mail",
};

const KIND_LABEL: Record<CoursePost["kind"], string> = {
  assignment: "Assignment",
  material: "Material",
  announcement: "Post",
};

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const matches = (post: CoursePost, filter: Filter) =>
  filter === "All" ||
  (filter === "Assignments" && post.kind === "assignment") ||
  (filter === "Materials" && post.kind === "material") ||
  (filter === "Posts" && post.kind === "announcement");

export function Classes() {
  const { go } = useApp();
  const [list] = useState<Course[]>(courses.get);
  const [open, setOpen] = useState<Course | null>(null);
  useAiContext(
    open
      ? `Class "${open.name}" (${open.subject}). Posts: ` +
          open.posts
            .map((p) => `${KIND_LABEL[p.kind]} "${p.title}" (${p.date || "no date"})`)
            .join("; ")
      : `Classes: ${list.map((c) => c.name).join(", ") || "none imported yet"}.`,
  );

  if (open) {
    return <ClassPage course={open} onBack={() => setOpen(null)} />;
  }

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button
          className="link-btn"
          style={{ alignSelf: "flex-start" }}
          onClick={() => go("homework")}
        >
          ‹ Homework
        </button>
        <h1 className="h1">Classes</h1>
        <p className="sub">Everything from your Classroom classes, in one place.</p>
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
        <div className="stack">
          {list.map((c, i) => {
            const work = c.posts.filter((p) => p.kind === "assignment").length;
            const latest = c.posts.find((p) => p.date)?.date;
            return (
              <button
                key={c.name}
                className="card subject-card class-row rise"
                style={{ ...subjectVars(c.subject), animationDelay: `${i * 0.03}s` }}
                onClick={() => setOpen(c)}
              >
                <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <strong className="class-name">{c.name}</strong>
                  <span className="muted">
                    {work > 0 ? `${work} assignments · ` : ""}
                    {c.posts.length} posts
                    {latest ? ` · latest ${dayLabel(latest)}` : ""}
                  </span>
                </span>
                <span className="muted" aria-hidden="true" style={{ fontSize: 20 }}>
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}

function ClassPage({ course, onBack }: { course: Course; onBack: () => void }) {
  const { openAi, askTutor, data, homework, addHomeworkItem, handleError, toast } = useApp();
  const [filter, setFilter] = useState<Filter>("All");
  const [adding, setAdding] = useState<string | null>(null);
  const titles = new Set((homework ?? []).map((h) => h.title.trim().toLowerCase()));
  const posts = course.posts.filter((p) => matches(p, filter));
  const filters: Filter[] = ["All", "Assignments", "Materials", "Posts"].filter(
    (f) => f === "All" || course.posts.some((p) => matches(p, f as Filter)),
  ) as Filter[];

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
    <main className="screen">
      <header className="stack rise" style={{ gap: 4, ...subjectVars(course.subject) }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Classes
        </button>
        <span className="eyebrow row" style={{ gap: 6 }}>
          <span className="subject-dot" /> {course.subject}
        </span>
        <h1 className="h1">{course.name}</h1>
      </header>

      {filters.length > 2 && (
        <div className="pills" role="group" aria-label="Show">
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

      <div className="stack">
        {posts.map((p, i) => {
          const context =
            `${course.name} (${course.subject}): ${KIND_LABEL[p.kind]} "${p.title}"` +
            `${p.date ? `, posted ${p.date}` : ""}. ${p.text}`;
          return (
            <article
              key={`${p.date}-${p.title}`}
              className="card stack rise"
              style={{ animationDelay: `${i * 0.03}s`, gap: 8 }}
            >
              <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <span className={`post-icon ${p.kind}`} aria-hidden="true">
                  <Icon name={KIND_ICON[p.kind]} size={18} />
                </span>
                <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <strong style={{ lineHeight: 1.3 }}>{p.title}</strong>
                  <span className="muted">
                    {KIND_LABEL[p.kind]}
                    {p.date ? ` · ${dayLabel(p.date)}` : ""}
                  </span>
                </div>
              </div>
              {p.text && <p style={{ margin: 0, lineHeight: 1.5 }}>{p.text}</p>}
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button
                  className="btn small"
                  onClick={() => openAi({ context, question: `Help me with "${p.title}".` })}
                >
                  <Icon name="sparkle" size={14} />
                  Help me
                </button>
                {p.kind === "material" && (
                  <button
                    className="btn small"
                    onClick={() =>
                      askTutor(
                        `Teach me the key points of "${p.title}" (${course.subject}, Year 9) simply, then quiz me with 3 questions.`,
                        "explain",
                      )
                    }
                  >
                    <Icon name="book" size={14} />
                    Revise this
                  </button>
                )}
                {p.kind === "assignment" &&
                  (titles.has(p.title.toLowerCase()) ? (
                    <span className="chip good">
                      <Icon name="check" size={12} />
                      In homework
                    </span>
                  ) : (
                    <button
                      className="btn small primary"
                      disabled={adding === p.title}
                      onClick={() => void add(p)}
                    >
                      <Icon name="plus" size={14} />
                      Add to homework
                    </button>
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
