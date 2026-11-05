import { useEffect, useRef, useState } from "react";
import { RELEASES } from "../changelog.ts";
import { BackButton } from "../components/BackButton.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import {
  canSendNow,
  connectChanges,
  listRequests,
  MAX_REQUEST,
  sendRequest,
  STATUS_LABEL,
  type ChangeLink,
  type ChangeRequest,
} from "../lib/appChanges.ts";
import { errorReports, REPORT_LABEL, sendReport, type ErrorReport } from "../lib/errorReports.ts";
import { PAGES } from "../pages/runtime.ts";

// More › Change the app: write a wish, send it to Claude, watch it go live.

/** The app on claude.ai, where requests can reach Claude (the website has no line to it). */
export const CLAUDE_APP_URL = "https://claude.ai/artifact/95juorCMkc4Gz9fsZdjgeo";

const IDEAS = [
  "Add a lunch menu card to Today",
  "Make the daily brief shorter",
  "Add a Spanish verb game to Revise",
  "Undo the last change",
];

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export function Change() {
  const { toast, handleError } = useApp();
  const [link, setLink] = useState<ChangeLink | null | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [reports, setReports] = useState<ErrorReport[]>([]);
  const [sentNow, setSentNow] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const card = useRef<HTMLElement>(null);
  useAiContext(
    "Change the app: the student asks Claude for changes to this app, and sees past versions.",
  );

  useEffect(() => {
    let live = true;
    // The website keeps its data on the phone, where Claude can't see it: requests go via claude.ai.
    void (PAGES ? Promise.resolve(null) : connectChanges()).then(async (l) => {
      if (!live) {
        return;
      }
      setLink(l);
      if (l) {
        setReady(await canSendNow(l));
        setRequests(await listRequests(l).catch(() => []));
        setReports(await errorReports.list().catch(() => []));
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // While open, statuses Claude updates (building → live) show up by themselves.
  useEffect(() => {
    if (!link) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void listRequests(link)
          .then(setRequests)
          .catch(() => {});
        void errorReports
          .list()
          .then(setReports)
          .catch(() => {});
        void canSendNow(link).then(setReady);
      }
    };
    const t = window.setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [link]);

  const send = async () => {
    if (!link || !card.current || !text.trim() || sending) {
      return;
    }
    setSending(true);
    try {
      const r = await sendRequest(link, text, card.current);
      setRequests((list) => [r, ...list]);
      setText("");
      toast(
        r.status === "sent"
          ? "Sent to Claude. The new version will open by itself when it's ready."
          : "Saved. Claude picks it up at the next hourly check.",
      );
    } catch (err) {
      handleError(err);
    } finally {
      setSending(false);
    }
  };

  const sendNow = async (r: ErrorReport, el: HTMLElement) => {
    if (!link?.comments) {
      return;
    }
    const ok = await sendReport(link.comments, r, el);
    if (ok) {
      setSentNow((ids) => [...ids, r.id]);
    }
    toast(
      ok ? "Sent. Claude starts on it now." : "Couldn't send now; it goes at the hourly check.",
    );
  };

  const openClaudeApp = async () => {
    if (text.trim()) {
      try {
        await navigator.clipboard.writeText(text.trim());
        toast("Copied your request: paste it in Change the app there.");
      } catch {
        // Not copied: they can type it again there.
      }
    }
    window.open(CLAUDE_APP_URL, "_blank", "noopener");
  };

  return (
    <main className="screen change-screen">
      <BackButton />
      <header className="rise">
        <h1 className="h1">Change the app</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Tell Claude what to add or change. It builds it, tests it and the new version opens by
          itself.
        </p>
      </header>

      <section ref={card} className="card change-card rise d1" aria-label="New request">
        <label className="eyebrow" htmlFor="change-text">
          What should change?
        </label>
        <textarea
          id="change-text"
          className="field"
          rows={4}
          maxLength={MAX_REQUEST}
          placeholder="For example: show my next test on the Now card"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row change-ideas" style={{ gap: 6, flexWrap: "wrap" }}>
          {IDEAS.map((idea) => (
            <button key={idea} type="button" className="chip" onClick={() => setText(idea)}>
              {idea}
            </button>
          ))}
        </div>
        {link === undefined ? (
          <div className="skeleton" style={{ height: 48 }} />
        ) : link ? (
          <>
            <button
              className="btn primary"
              disabled={!text.trim() || sending}
              onClick={() => void send()}
            >
              <Icon name="sparkle" size={18} />
              {sending ? "Sending…" : ready ? "Send to Claude" : "Save request"}
            </button>
            <p className="s12 muted" style={{ margin: 0 }}>
              {ready
                ? "Claude is watching this app: it starts right away."
                : "Claude isn't watching right now: it picks this up at the next hourly check."}
            </p>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => void openClaudeApp()}>
              <Icon name="external" size={18} />
              Open the app on claude.ai
            </button>
            <p className="s12 muted" style={{ margin: 0 }}>
              Requests go to Claude from the claude.ai app. Your text is copied so you can paste it
              there.
            </p>
          </>
        )}
      </section>

      {requests.length > 0 && (
        <section className="stack rise d2" style={{ gap: 8 }}>
          <h2 className="eyebrow" style={{ paddingLeft: 4, margin: 0 }}>
            Your requests
          </h2>
          <div className="card rows">
            {requests.map((r) => (
              <div key={r.id} className="item change-req">
                <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 650 }}>{r.text}</span>
                  {r.reply && <span className="s13 muted">{r.reply}</span>}
                  <span className="s11 muted">
                    {when(r.createdAt)}
                    {r.version ? ` · version ${r.version}` : ""}
                  </span>
                </span>
                <span className={`chip req-${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {reports.length > 0 && (
        <section className="stack rise d2" style={{ gap: 8 }} aria-label="Problems">
          <h2 className="eyebrow" style={{ paddingLeft: 4, margin: 0 }}>
            Problems Claude is fixing
          </h2>
          <p className="s12 muted" style={{ margin: "0 4px" }}>
            When something breaks, the app tells Claude by itself. You don't need to do anything.
          </p>
          <div className="card rows">
            {reports.slice(0, 8).map((r) => (
              <div key={r.id} className="item change-req">
                <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 650, overflowWrap: "anywhere" }}>
                    {r.message.replace(/^\w*Error: /, "")}
                  </span>
                  {r.reply && <span className="s13 muted">{r.reply}</span>}
                  <span className="s11 muted">
                    {when(r.at)} · {r.where.split(" · ")[0]}
                    {r.count > 1 ? ` · ${r.count} times` : ""}
                    {r.fixedIn ? ` · fixed in ${r.fixedIn}` : ""}
                  </span>
                  {r.status === "new" && ready && !sentNow.includes(r.id) && (
                    <button
                      className="btn small"
                      style={{ alignSelf: "flex-start" }}
                      onClick={(e) => void sendNow(r, e.currentTarget)}
                    >
                      <Icon name="send" size={14} /> Send to Claude now
                    </button>
                  )}
                </span>
                <span className={`chip rep-${r.status}`}>{REPORT_LABEL[r.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack rise d3" style={{ gap: 8 }}>
        <div className="between" style={{ paddingLeft: 4 }}>
          <h2 className="eyebrow" style={{ margin: 0 }}>
            What's new
          </h2>
          <span className="chip violet">You have {__VERSION__}</span>
        </div>
        {RELEASES.map((r, i) => (
          <article key={r.version} className={`card release${i === 0 ? " latest" : ""}`}>
            <div className="between" style={{ gap: 8 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="ic tone-violet" aria-hidden="true">
                  <Icon name="rocket" size={18} />
                </span>
                <strong>Version {r.version}</strong>
              </span>
              <span className="s12 muted">
                {new Date(`${r.date}T12:00:00`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <p style={{ margin: "8px 0 6px", fontWeight: 650 }}>{r.title}</p>
            <ul className="release-list">
              {r.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
