import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { keyFromText, lockState, rememberKey } from "./lockedSeed.ts";
import { PAGES } from "./runtime.ts";

// Shown on Today when this device hasn't unlocked the student's own data yet
// (e.g. the iPhone home-screen app, which has separate storage from Safari).

export function UnlockCard() {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  if (!PAGES || !lockState.locked) {
    return null;
  }
  return (
    <form
      className="card stack rise"
      style={{ gap: 10, borderColor: "color-mix(in oklab, var(--cyan) 40%, transparent)" }}
      onSubmit={(e) => {
        e.preventDefault();
        const key = keyFromText(text);
        if (!key) {
          setBad(true);
          return;
        }
        rememberKey(key);
        window.location.replace(`${window.location.pathname}#k=${key}`);
        window.location.reload();
      }}
    >
      <div className="row" style={{ gap: 12 }}>
        <span className="ico cyan r40" aria-hidden="true">
          <Icon name="lock" size={18} />
        </span>
        <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <strong>Your private website</strong>
          <span className="s12 muted">Paste your private link once to unlock your data here</span>
        </span>
      </div>
      <input
        className="field"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        placeholder="https://divis950.github.io/openclaw/hub/#k=…"
        aria-label="Private link"
        autoComplete="off"
      />
      {bad && (
        <span className="warm-text" style={{ fontSize: 13, fontWeight: 600 }}>
          That isn't the private link. Copy the whole link, including the part after #k=.
        </span>
      )}
      <button className="btn primary" type="submit" disabled={!text.trim()}>
        Unlock
      </button>
    </form>
  );
}
