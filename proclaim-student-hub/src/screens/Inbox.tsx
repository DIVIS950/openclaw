import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { draftReply } from "../lib/aiFeatures.ts";
import { shortDate } from "../lib/format.ts";
import type { Email } from "../lib/types.ts";

type Filter = "All" | "Classroom" | "Teachers";

// AI one-liners are cached per message so revisiting the tab is free.
const summaryCache = new Map<string, string>();

export function Inbox() {
  const app = useApp();
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [summaries, setSummaries] = useState<Map<string, string>>(summaryCache);
  const [filter, setFilter] = useState<Filter>("All");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    app.data.inbox().then(
      async (list) => {
        if (cancelled) {
          return;
        }
        setEmails(list);
        const missing = list.filter((e) => !summaryCache.has(e.id)).slice(0, 15);
        if (!app.ai || missing.length === 0) {
          return;
        }
        try {
          const res = await app.ai.inbox({
            emails: missing.map((e) => ({
              id: e.id,
              from: e.from,
              subject: e.subject,
              snippet: e.snippet,
            })),
          });
          for (const s of res.summaries) {
            summaryCache.set(s.id, s.summary);
          }
          if (!cancelled) {
            setSummaries(new Map(summaryCache));
          }
        } catch {
          // One-liners are a bonus; the inbox still works without them.
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setEmails([]);
          app.handleError(err);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [app.data]);

  const list = (emails ?? []).filter(
    (e) =>
      filter === "All" ||
      (filter === "Classroom" ? e.kind === "Classroom" : e.kind !== "Classroom"),
  );
  const unread = (emails ?? []).filter((e) => e.unread).length;
  useAiContext(
    "Inbox screen. Emails: " +
      list
        .slice(0, 10)
        .map(
          (e) => `${e.from}: ${e.subject}${summaries.get(e.id) ? ` (${summaries.get(e.id)})` : ""}`,
        )
        .join("; "),
  );

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 12 }}>
        <div className="between" style={{ alignItems: "center" }}>
          <h1 className="h1">Inbox</h1>
          {unread > 0 && (
            <span className="chip lime" style={{ height: 28 }}>
              <span className="num">{unread}</span>new
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {(["All", "Classroom", "Teachers"] as Filter[]).map((f) => (
            <button
              key={f}
              className={`fchip${filter === f ? " on" : ""}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
          <span className="s11 muted" style={{ marginLeft: "auto" }}>
            {app.data.demo ? "Sample" : "Gmail"} · {checkedLabel()}
          </span>
        </div>
      </header>

      {emails === null ? (
        <div className="card stack">
          <div className="skeleton light" />
          <div className="skeleton light" style={{ width: "70%" }} />
          <div className="skeleton light" style={{ width: "50%" }} />
        </div>
      ) : list.length === 0 ? (
        <div className="card empty">No messages here.</div>
      ) : (
        <section className="card rows rise d1">
          {list.map((m) => (
            <Message
              key={m.id}
              email={m}
              summary={summaries.get(m.id)}
              expanded={open === m.id}
              onToggle={() => setOpen(open === m.id ? null : m.id)}
            />
          ))}
        </section>
      )}
    </main>
  );
}

/** "12 min ago": the inbox is fetched when the screen opens. */
function checkedLabel(): string {
  return "just now";
}

/** Two letters for the sender avatar: "Sc" for Science, "PL" for Park Lane. */
function avatarOf(email: Email): { text: string; tint: string } {
  // "New assignment: Macbeth essay" → "Macbeth"; otherwise the sender's first word.
  const after = email.subject.includes(":") ? email.subject.split(":").slice(1).join(":") : "";
  const word =
    (email.kind === "Classroom" && after.trim() ? after.trim() : email.from).split(/\s+/)[0] ?? "";
  const text = word.slice(0, 2) || "✉";
  const tints = ["lime", "violet", "magenta", "cyan"];
  let h = 0;
  for (const ch of word) {
    h = (h * 31 + ch.charCodeAt(0)) % 997;
  }
  return { text, tint: tints[h % tints.length] };
}

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  const days = (today.getTime() - d.getTime()) / 86_400_000;
  if (days < 1.5) {
    return "Yesterday";
  }
  return days < 7 ? d.toLocaleDateString("en-GB", { weekday: "short" }) : shortDate(iso);
};

function Message({
  email,
  summary,
  expanded,
  onToggle,
}: {
  email: Email;
  summary?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data, ai, profile, openAi, handleError } = useApp();
  const [reply, setReply] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [writing, setWriting] = useState(false);

  // Whatever is already typed is used as the idea for the AI's draft.
  const writeWithAi = async () => {
    if (!ai) {
      return;
    }
    setWriting(true);
    try {
      setReply(await draftReply(ai, email, reply, profile?.name ?? ""));
    } catch (err) {
      handleError(err);
    } finally {
      setWriting(false);
    }
  };

  const av = avatarOf(email);
  return (
    <article className={`mail${email.unread ? "" : " read"}`}>
      <span
        className={`av${email.unread ? " new" : ""}`}
        style={
          email.unread
            ? { background: `var(--${av.tint}-soft)`, color: `var(--${av.tint}-t)` }
            : undefined
        }
        aria-hidden="true"
      >
        {av.text}
      </span>
      <div className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="stack"
          style={{ border: "none", background: "none", padding: 0, textAlign: "left", gap: 3 }}
        >
          <span className="between" style={{ gap: 8 }}>
            <span className="clip" style={{ fontWeight: email.unread ? 700 : 600 }}>
              {email.subject}
            </span>
            <span className="s11 muted" style={{ flex: "none" }}>
              {timeLabel(email.date)}
            </span>
          </span>
          <span className="snip">{summary ?? email.snippet}</span>
          {(email.kind === "Classroom" || email.unread) && (
            <span className="row" style={{ gap: 6 }}>
              <span className={`chip ${email.kind === "Classroom" ? "cyan" : "violet"}`}>
                {email.kind === "Classroom" ? "Classroom" : "Teacher"}
              </span>
              {summary && (
                <span className="chip violet">
                  <Icon name="sparkle" size={12} />
                  AI
                </span>
              )}
            </span>
          )}
        </button>

        {expanded && (
          <div className="stack rise" style={{ gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              {email.from} · {email.snippet}
            </p>
            {ai && (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button
                  className="btn small"
                  onClick={() =>
                    openAi({
                      context: `Email from ${email.from}. Subject: ${email.subject}. ${email.snippet}`,
                      question: "What does this email mean for me, and what should I do?",
                    })
                  }
                >
                  <Icon name="sparkle" size={14} />
                  Explain
                </button>
                {email.kind === "Gmail" && state !== "sent" && (
                  <button
                    className="btn small"
                    disabled={writing}
                    onClick={() => void writeWithAi()}
                  >
                    <Icon
                      name={writing ? "loader" : "wand"}
                      size={14}
                      className={writing ? "spin" : undefined}
                    />
                    {reply.trim() ? "Turn my idea into a reply" : "Write a reply with AI"}
                  </button>
                )}
              </div>
            )}
            {email.kind === "Classroom" ? (
              <a
                className="btn small"
                href={email.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ alignSelf: "flex-start" }}
              >
                Open in Classroom
              </a>
            ) : state === "sent" ? (
              <div
                className="chip good pop"
                style={{ alignSelf: "flex-start", whiteSpace: "normal" }}
              >
                <Icon name="check" size={16} />
                {data.labels.sent}
              </div>
            ) : (
              <form
                className="row"
                style={{ alignItems: "flex-end" }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!reply.trim()) {
                    return;
                  }
                  setState("sending");
                  try {
                    await data.sendReply(email, reply.trim());
                    setState("sent");
                  } catch (err) {
                    setState("idle");
                    handleError(err);
                  }
                }}
              >
                <label htmlFor={`reply-${email.id}`} className="sr-only">
                  Reply
                </label>
                <textarea
                  id={`reply-${email.id}`}
                  className="field"
                  rows={reply.length > 120 ? 6 : 2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={`Reply to ${email.from}…`}
                />
                <button
                  className="round dark"
                  aria-label="Send reply"
                  disabled={state === "sending" || !reply.trim()}
                >
                  <Icon
                    name={state === "sending" ? "loader" : "send"}
                    size={18}
                    className={state === "sending" ? "spin" : undefined}
                  />
                </button>
              </form>
            )}
          </div>
        )}
      </div>
      {email.unread && <span className="unread" aria-label="Unread" />}
    </article>
  );
}
