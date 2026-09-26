import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { draftReply } from "../lib/aiFeatures.ts";
import { shortDate } from "../lib/format.ts";
import type { Email } from "../lib/types.ts";

type Filter = "All" | "Gmail" | "Classroom";

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

  const list = (emails ?? []).filter((e) => filter === "All" || e.kind === filter);
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
      <header className="stack rise" style={{ gap: 4 }}>
        <h1 className="h1">Inbox</h1>
        <p className="sub">Gmail and Classroom posts, with an AI one-liner on each.</p>
      </header>

      <div className="pills" role="group" aria-label="Filter">
        {(["All", "Gmail", "Classroom"] as Filter[]).map((f) => (
          <button key={f} className="pill" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {emails === null ? (
        <div className="card stack">
          <div className="skeleton light" />
          <div className="skeleton light" style={{ width: "70%" }} />
          <div className="skeleton light" style={{ width: "50%" }} />
        </div>
      ) : list.length === 0 ? (
        <div className="card empty">No messages here.</div>
      ) : (
        <div className="list">
          {list.map((m, k) => (
            <Message
              key={m.id}
              email={m}
              summary={summaries.get(m.id)}
              delay={k * 0.05}
              expanded={open === m.id}
              onToggle={() => setOpen(open === m.id ? null : m.id)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function Message({
  email,
  summary,
  delay,
  expanded,
  onToggle,
}: {
  email: Email;
  summary?: string;
  delay: number;
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

  return (
    <article
      className="rise"
      style={{ padding: "14px 16px", display: "flex", gap: 12, animationDelay: `${delay}s` }}
    >
      <span
        aria-label={email.unread ? "Unread" : undefined}
        style={{
          width: 8,
          height: 8,
          flexShrink: 0,
          marginTop: 6,
          borderRadius: 4,
          background: email.unread ? "var(--accent)" : "transparent",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }} className="stack">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          style={{ border: "none", background: "none", padding: 0, textAlign: "left" }}
          className="stack"
        >
          <span className="between" style={{ gap: 8 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {email.from} · {email.kind}
            </span>
            <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
              {shortDate(email.date)}
            </span>
          </span>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{email.subject}</span>
          {summary && (
            <span
              className="row pop"
              style={{
                alignItems: "flex-start",
                gap: 6,
                fontSize: 13,
                lineHeight: 1.4,
                color: "var(--accent-ink)",
                background: "#eef1fc",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            >
              <Icon name="sparkle" size={14} />
              <span>{summary}</span>
            </span>
          )}
        </button>

        {expanded && (
          <div className="stack rise" style={{ gap: 10 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--muted)" }}>
              {email.snippet}
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
    </article>
  );
}
