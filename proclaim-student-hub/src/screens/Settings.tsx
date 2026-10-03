import { useState } from "react";
import { SoundSwitch } from "../components/SoundSwitch.tsx";
import { useApp } from "../context.ts";
import { theme as themeStore, type Theme } from "../lib/theme.ts";
import { PAGES, studentName } from "../pages/runtime.ts";
import { AiKeyForm, CLAUDE_PAGE, SendToWeb } from "../pages/WebVersion.tsx";

// Settings: who you are, the AI, how the app looks and sounds.

export function Settings() {
  const { go, profile, data, signOut } = useApp();
  const [name, setName] = useState(studentName.get);
  const [theme, setTheme] = useState<Theme>(themeStore.get);

  return (
    <main className="screen ios">
      <header className="ios-header rise">
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => go("more")}>
          ‹ More
        </button>
        <h1 className="h1">Settings</h1>
      </header>

      <section className="stack rise" style={{ gap: 6 }}>
        <h2 className="eyebrow">You</h2>
        <div className="ios-list">
          {PAGES ? (
            <label className="ios-row plain">
              <span style={{ flex: 1 }}>First name</span>
              <input
                className="ios-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => studentName.set(name)}
                placeholder="For the greeting"
                autoComplete="given-name"
              />
            </label>
          ) : (
            <div className="ios-row plain">
              <span style={{ flex: 1 }}>Name</span>
              <span className="ios-value">{profile?.name ?? "…"}</span>
            </div>
          )}
          <div className="ios-row plain">
            <span style={{ flex: 1 }}>Account</span>
            <span className="ios-value clip" style={{ maxWidth: "55%" }}>
              {PAGES
                ? "This phone"
                : data.demo
                  ? "Demo"
                  : data.hasClassroom
                    ? profile?.email
                    : "Claude"}
            </span>
          </div>
          {signOut && (
            <button className="ios-row plain" onClick={signOut} style={{ color: "var(--warm)" }}>
              {data.demo ? "Sign in" : "Sign out"}
            </button>
          )}
        </div>
      </section>

      <section className="stack rise" style={{ gap: 6 }}>
        <h2 className="eyebrow">AI</h2>
        <div className="card">
          {PAGES ? (
            <AiKeyForm />
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {data.demo
                ? "Sample data. Sign in to use the AI."
                : "The AI runs through your Claude account here. No key needed."}
            </p>
          )}
        </div>
        {CLAUDE_PAGE && !data.demo && <SendToWeb />}
      </section>

      <section className="stack rise" style={{ gap: 6 }}>
        <h2 className="eyebrow">Appearance</h2>
        <div className="ios-list">
          <div className="ios-row plain" style={{ display: "block" }}>
            <div
              className="segmented"
              role="tablist"
              aria-label="Appearance"
              style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
            >
              {(["auto", "light", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={theme === t}
                  onClick={() => {
                    setTheme(t);
                    themeStore.set(t);
                  }}
                >
                  {t === "auto" ? "Automatic" : t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>
          <SoundSwitch row />
        </div>
      </section>

      <p className="muted" style={{ textAlign: "center", fontSize: 12 }}>
        Proclaim Student Hub · build {__BUILD__}
      </p>
    </main>
  );
}
