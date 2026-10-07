import { useState } from "react";
import {
  ACCENTS,
  accentPref,
  setAccentPref,
  setThemePref,
  themePref,
  type Accent,
  type ThemePref,
} from "../lib/theme.ts";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto" },
];

const SWATCH: Record<Accent, string> = {
  lime: "#c8ff2e",
  cyan: "#3df2ff",
  magenta: "#ff3dae",
  violet: "#9d6bff",
};

/** More › Look: dark (default), light or follow the phone, plus the accent colour. */
export function LookCard() {
  const [pref, setPref] = useState<ThemePref>(() => themePref());
  const [accent, setAccent] = useState<Accent>(() => accentPref());
  return (
    <>
      <div className="crow" aria-label="Look">
        <span style={{ flex: 1, fontWeight: 700 }}>Look</span>
        <div className="seg sm accent" role="tablist" aria-label="Theme">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="tab"
              className={pref === o.value ? "on" : undefined}
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
      </div>
      <div className="crow">
        <span style={{ flex: 1, fontWeight: 700 }}>Accent</span>
        <div className="row" style={{ gap: 10 }} role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={accent === a}
              aria-label={a}
              className="accent-swatch"
              style={{ background: SWATCH[a] }}
              onClick={() => {
                setAccent(a);
                setAccentPref(a);
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
