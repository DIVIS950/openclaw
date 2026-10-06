import { useState } from "react";
import { setThemePref, themePref, type ThemePref } from "../lib/theme.ts";
import { Icon } from "./Icon.tsx";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto" },
];

/** Apps › Look: dark (default), light, or follow the phone. */
export function LookCard() {
  const [pref, setPref] = useState<ThemePref>(() => themePref());
  return (
    <section className="card stack rise" aria-label="Look" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <span style={{ color: "var(--accent-ink)" }}>
          <Icon name="sparkle" size={20} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Look</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Night Studio: dark by default. Auto follows your phone.
          </div>
        </div>
      </div>
      <div className="segmented" role="tablist" aria-label="Theme">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={pref === o.value}
            onClick={() => {
              setPref(o.value);
              setThemePref(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
