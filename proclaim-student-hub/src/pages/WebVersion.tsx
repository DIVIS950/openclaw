import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { collectStore, PAGES_URL, transferLink } from "../lib/transfer.ts";
import { aiKey, PAGES, studentName } from "./runtime.ts";

// The two versions of the hub and the bridge between them:
// - claude.ai link: reads Gmail/Classroom; "Open the web version" carries the data over
// - GitHub Pages (divis950.github.io/openclaw/hub): microphone works, AI via Gemini

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

/** On GitHub Pages: name and AI key, both kept only on this phone. */
export function PagesSettings() {
  const { toast } = useApp();
  const [name, setName] = useState(studentName.get);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    void aiKey.get().then((k) => setHasKey(Boolean(k)));
  }, []);

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
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">AI key</span>
        <span style={{ fontSize: 14 }}>
          {hasKey === null
            ? "Checking…"
            : hasKey
              ? "✅ The AI is set up on this phone."
              : "No AI key yet. A parent makes a free Gemini key at aistudio.google.com (Google only allows 18+) and pastes it here once."}
        </span>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            aiKey.set(key);
            setKey("");
            setHasKey(Boolean(key.trim()));
            toast(key.trim() ? "AI key saved on this phone." : "Key removed.");
          }}
        >
          <input
            className="field"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? "Leave empty and save to remove" : "Paste a Gemini key"}
            aria-label="Gemini API key"
            autoComplete="off"
            style={{ flex: 1 }}
          />
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>
      </div>
    </section>
  );
}
