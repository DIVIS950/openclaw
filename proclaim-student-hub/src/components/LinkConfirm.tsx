import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Ctx } from "../context.ts";
import { linkInbox, type PendingLink } from "../lib/linkInbox.ts";
import { dayOf } from "../lib/study.ts";
import { applyTransfer } from "../lib/transfer.ts";
import { tutorImport } from "../lib/tutorImport.ts";
import { appliedSummary, applyReply } from "../lib/tutorLink.ts";
import { localDb } from "../pages/localDb.ts";
import { pagesImport } from "../pages/runtime.ts";
import { Icon } from "./Icon.tsx";

// "Bring this in?" for links that change the student's data (#import= from the
// claude.ai version, #tutor= from a tutor). Nothing is written until they tap
// "Bring it in". Works before the app has drawn (main.tsx shows it first) and
// inside the app (a tutor's link tapped while it's open), where it toasts.

export function LinkConfirm({ onDone }: { onDone?: () => void }) {
  const pending = useSyncExternalStore(linkInbox.subscribe, linkInbox.get, linkInbox.get);
  if (!pending) {
    return null;
  }
  // A new key per link, so a second link starts fresh.
  return <Sheet key={keyOf(pending)} pending={pending} onDone={onDone} />;
}

const keyOf = (p: PendingLink) =>
  p.kind === "import" ? "import" : p.kind === "tutor" ? `tutor-${p.reply.sentAt}` : p.title;

function Sheet({ pending, onDone }: { pending: PendingLink; onDone?: () => void }) {
  const app = useContext(Ctx);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  const close = (message: string | null) => {
    linkInbox.clear();
    if (message) {
      if (app) {
        app.toast(message);
      } else {
        // Before the app draws: it shows this once it's up.
        tutorImport.set(message);
      }
    }
    onDone?.();
  };

  const accept = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (pending.kind === "import") {
        const added = await applyTransfer(pending.transfer, localStorage, localDb);
        if (app) {
          app.reloadHomework();
          close(
            added > 0
              ? `Brought in: ${added} new homework, plus your timetable, notes and to-dos.`
              : "Brought in: timetable, notes and to-dos.",
          );
        } else {
          // App.tsx shows its usual "Brought over from claude.ai" message.
          pagesImport.added = added;
          close(null);
        }
      } else if (pending.kind === "tutor") {
        close(appliedSummary(applyReply(pending.reply, dayOf(new Date()))));
      } else {
        close(null);
      }
    } catch {
      close("Something went wrong bringing that link in. Try opening it again.");
    }
  };

  // Escape is "Not now"; the main button gets the focus.
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        linkInbox.clear();
        onDone?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const title =
    pending.kind === "error"
      ? pending.title
      : pending.kind === "import"
        ? "Bring this in?"
        : `${pending.title}: bring this in?`;

  return (
    <div className="backdrop link-confirm" onClick={busy ? undefined : () => close(null)}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between" style={{ alignItems: "center", gap: 12 }}>
          <h2 className="h1" style={{ fontSize: 26 }}>
            {title}
          </h2>
          <button className="round" aria-label="Close" disabled={busy} onClick={() => close(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {pending.kind === "error" ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              {pending.text}
            </p>
            <button ref={first} className="btn big primary" onClick={() => close(null)}>
              OK
            </button>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              {pending.kind === "import"
                ? "This link brings data from the claude.ai version. It's added next to what's already here; nothing of yours is replaced."
                : "Only open links your tutor sent you."}
            </p>
            <ul className="card rows link-lines">
              {pending.lines.map((line, i) => (
                <li key={i} className="li">
                  {line}
                </li>
              ))}
            </ul>
            <button
              ref={first}
              className="btn big primary"
              disabled={busy}
              onClick={() => void accept()}
            >
              <Icon name="check" size={18} />
              Bring it in
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => close(null)}>
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
