import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { collectStore, PAGES_URL, transferLink } from "../lib/transfer.ts";
import { isClaudeKey, testClaude } from "./claude.ts";
import { geminiSample } from "./gemini.ts";
import { gmailClientId, gmailLink, isClientId } from "./gmailLink.ts";
import { aiKey, PAGES, studentName } from "./runtime.ts";

// The two versions of the hub and the bridge between them:
// - claude.ai link: reads Gmail/Classroom; "Open the web version" carries the data over
// - GitHub Pages (divis950.github.io/openclaw/hub): microphone works, AI via a Claude (or Gemini) key

/** True on the claude.ai link (not on GitHub Pages or the hosted server version). */
export const CLAUDE_PAGE = import.meta.env.VITE_WEB_PAGE === "1" && !PAGES;

/** On the claude.ai link: a link that opens the web version with everything brought along. */
export function SendToWeb({ compact = false }: { compact?: boolean }) {
  const { homework, profile } = useApp();
  const [href, setHref] = useState(PAGES_URL);
  useEffect(() => {
    let live = true;
    void transferLink({
      v: 1,
      name: profile?.name ?? "",
      homework: homework ?? [],
      store: collectStore(localStorage),
    })
      .then((link) => live && setHref(link))
      .catch(() => {
        // Old browser without compression: the plain address still opens.
      });
    return () => {
      live = false;
    };
  }, [homework, profile]);

  if (compact) {
    return (
      <a className="link-btn" href={href} target="_blank" rel="noopener noreferrer">
        Use the real microphone: open the web version ›
      </a>
    );
  }
  return (
    <a
      className="card row rise"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ gap: 12, textDecoration: "none", color: "inherit" }}
    >
      <span className="lab-cta-icon" aria-hidden="true">
        <Icon name="mic" size={22} />
      </span>
      <span className="stack" style={{ gap: 2, flex: 1 }}>
        <strong>Open the web version</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          The microphone works there. Brings your new homework, timetable, notes and to-dos with it.
        </span>
      </span>
      <span className="muted" style={{ fontSize: 20 }}>
        ›
      </span>
    </a>
  );
}

/** The AI key box: a parent pastes a Claude key once; it stays on this phone. */
export function AiKeyForm({
  onSaved,
  compact,
}: {
  onSaved?: (hasKey: boolean) => void;
  compact?: boolean;
}) {
  const { toast } = useApp();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const hasKey = saved === undefined ? null : Boolean(saved);
  const [key, setKey] = useState("");
  const [test, setTest] = useState<{ ok: boolean; text: string } | "running" | null>(null);
  useEffect(() => {
    void aiKey.get().then(setSaved);
  }, []);

  // One real request, so the exact problem (wrong key, no credit, blocked) is shown.
  const runTest = async () => {
    const k = (await aiKey.get())?.trim();
    if (!k) {
      setTest({ ok: false, text: "No key saved on this phone yet." });
      return;
    }
    setTest("running");
    try {
      if (!isClaudeKey(k)) {
        // A Gemini key (the older stand-in): one small request too.
        const r = await geminiSample(async () => k)("Reply with exactly: OK", {
          modelTier: "quick",
        });
        setTest({ ok: true, text: `Gemini answered "${r.text.trim().slice(0, 20)}".` });
        return;
      }
      setTest({ ok: true, text: await testClaude(k) });
    } catch (err) {
      setTest({ ok: false, text: err instanceof Error ? err.message : "The test failed." });
    }
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      {!compact && <span className="eyebrow">AI key</span>}
      <span style={{ fontSize: 14 }} hidden={compact && !hasKey}>
        {hasKey === null
          ? "Checking…"
          : hasKey
            ? `✅ The AI is set up on this phone (${isClaudeKey(saved ?? "") ? "Claude" : "Gemini"}).`
            : "No AI key yet. A parent (18+) makes a Claude API key at console.anthropic.com (API keys, with some credit) and pastes it here once."}
      </span>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = key.trim();
          // Claude keys start with sk-ant-; Gemini keys (older stand-in) with AIza.
          if (clean && !clean.startsWith("sk-ant-") && !clean.startsWith("AIza")) {
            toast("That doesn't look like a Claude key: it should start with sk-ant-.");
            return;
          }
          if (!clean) {
            try {
              localStorage.removeItem("psh.ai.card");
            } catch {
              // Fine.
            }
          }
          aiKey.set(clean);
          setKey("");
          setSaved(clean || null);
          setTest(null);
          toast(clean ? "AI key saved on this phone. Tap Test the AI." : "Key removed.");
          onSaved?.(Boolean(clean));
        }}
      >
        <input
          className="field"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "Leave empty and save to remove" : "Paste a Claude key (sk-ant-…)"}
          aria-label="AI key"
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <button className="btn primary" type="submit">
          Save
        </button>
      </form>
      {hasKey && (
        <div className="stack" style={{ gap: 6 }}>
          <button
            className="btn"
            type="button"
            disabled={test === "running"}
            onClick={() => void runTest()}
          >
            <Icon
              name={test === "running" ? "loader" : "sparkle"}
              size={16}
              className={test === "running" ? "spin" : undefined}
            />
            {test === "running" ? "Asking Claude…" : "Test the AI"}
          </button>
          {test && test !== "running" && (
            <div className={`banner${test.ok ? " good" : ""}`} role="status">
              {test.ok ? "✅ " : "❌ "}
              {test.text}
            </div>
          )}
        </div>
      )}
      <span className="muted" style={{ fontSize: 11 }}>
        App build {__BUILD__}
      </span>
    </div>
  );
}

/** On Today (website only): a bright card until the AI key is in. */
export function AiKeyCard() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  // Stays open after saving so "Test the AI" is right there; "Done" hides it.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("psh.ai.card") === "done";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (PAGES) {
      void aiKey.get().then((k) => setHasKey(Boolean(k)));
    }
  }, []);
  if (!PAGES || hasKey === null || (hasKey && dismissed)) {
    return null;
  }
  return (
    <section className="card stack rise ai-key-card" style={{ gap: 10 }} aria-label="Set up the AI">
      <h2 className="h2 row" style={{ gap: 6 }}>
        <Icon name="sparkle" size={18} />
        Set up the AI on this phone
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        {hasKey
          ? "A key is saved. Tap Test the AI to check it really works, then Done."
          : "The AI needs a Claude API key (from console.anthropic.com › API keys, it starts with sk-ant-). Paste it below. It stays on this phone only."}
      </p>
      <AiKeyForm compact onSaved={(ok) => setHasKey(ok)} />
      {hasKey && (
        <button
          className="btn small ghost"
          style={{ alignSelf: "flex-end" }}
          onClick={() => {
            try {
              localStorage.setItem("psh.ai.card", "done");
            } catch {
              // Fine, it just shows again next time.
            }
            setDismissed(true);
          }}
        >
          Done, hide this
        </button>
      )}
    </section>
  );
}

/** Gmail on the website: paste the Google client ID once, then connect. */
export function GmailCard() {
  const { toast, handleError, reloadHomework } = useApp();
  const [id, setId] = useState(gmailClientId.get);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(() => gmailLink.connected);
  const [busy, setBusy] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      await gmailLink.connect();
      setConnected(true);
      toast("Gmail connected. Checking Classroom emails…");
      // The data source picks Gmail up on the next load; sync now needs a reload.
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <span
          className="tile-icon"
          style={{ "--tile": "#c5221f", width: 40, height: 40 } as React.CSSProperties}
          aria-hidden="true"
        >
          <Icon name="mail" size={20} />
        </span>
        <div className="stack" style={{ gap: 2, flex: 1 }}>
          <strong>Gmail on this website</strong>
          <span className="muted">
            {connected
              ? "Connected. Classroom emails become homework here, checked when the app opens."
              : gmailLink.granted
                ? "Signed in before; the sign-in lasts an hour. Tap Reconnect to check emails."
                : id
                  ? "Client ID saved. Connect your Google account (read-only)."
                  : "Needs a Google client ID, made once by a parent. Then Classroom emails sync here too."}
          </span>
        </div>
      </div>
      {id ? (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {connected ? (
            <>
              <button className="btn small" onClick={() => reloadHomework(true)}>
                <Icon name="sync" size={14} />
                Check Classroom now
              </button>
              <button
                className="btn small ghost"
                onClick={() => {
                  gmailLink.disconnect();
                  setConnected(false);
                  toast("Gmail disconnected.");
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn small primary" disabled={busy} onClick={() => void connect()}>
              <Icon
                name={busy ? "loader" : "mail"}
                size={14}
                className={busy ? "spin" : undefined}
              />
              {gmailLink.granted ? "Reconnect Gmail" : "Connect Gmail"}
            </button>
          )}
          <button
            className="btn small ghost"
            onClick={() => {
              gmailClientId.set("");
              gmailLink.disconnect();
              setId("");
              setConnected(false);
            }}
          >
            Remove ID
          </button>
        </div>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isClientId(draft)) {
              toast("That isn't a client ID: it ends with .apps.googleusercontent.com");
              return;
            }
            gmailClientId.set(draft);
            setId(draft.trim());
            setDraft("");
            toast("Client ID saved. Now tap Connect Gmail.");
          }}
        >
          <input
            className="field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste the client ID (…apps.googleusercontent.com)"
            aria-label="Google client ID"
            autoComplete="off"
            style={{ flex: 1 }}
          />
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>
      )}
      <button
        className="link-btn"
        style={{ alignSelf: "flex-start", minHeight: 32 }}
        onClick={() => setShowHow((v) => !v)}
      >
        {showHow ? "Hide the steps" : "How does a parent make the client ID?"}
      </button>
      {showHow && (
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
          <li>
            Go to console.cloud.google.com, signed in with the parent's Google account. Make a new
            project called Student Hub.
          </li>
          <li>APIs &amp; Services › Library: enable the Gmail API.</li>
          <li>
            APIs &amp; Services › OAuth consent screen: External, app name Student Hub, your email,
            then under Test users add the student's Gmail address (the one the school forwards to).
          </li>
          <li>
            APIs &amp; Services › Credentials › Create credentials › OAuth client ID › Web
            application. Under Authorised JavaScript origins add https://divis950.github.io. Create.
          </li>
          <li>Copy the client ID (ends with .apps.googleusercontent.com) and paste it above.</li>
        </ol>
      )}
    </section>
  );
}

/** On GitHub Pages: name and AI key, both kept only on this phone. */
export function PagesSettings() {
  const [name, setName] = useState(studentName.get);

  return (
    <section className="card stack rise" style={{ gap: 12 }}>
      <h2 className="h2">This phone</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Everything you add here is saved only on this phone. New homework from Classroom emails
        comes over from your claude.ai link: open it there and tap “Open the web version”.
      </p>
      <label className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">Your first name</span>
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => studentName.set(name)}
          placeholder="For the greeting"
          autoComplete="given-name"
        />
      </label>
      <AiKeyForm />
    </section>
  );
}
