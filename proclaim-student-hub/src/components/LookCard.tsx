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
import { Icon } from "./Icon.tsx";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

const SWATCH: Record<Accent, string> = {
  blue: "#2F5BFF",
  orange: "#C2410C",
  green: "#0B7F55",
  violet: "#6A45F0",
};

/** More › Look: follow the phone (default), light or dark, plus the accent colour. */
export function LookCard() {
  const [pref, setPref] = useState<ThemePref>(() => themePref());
  const [accent, setAccent] = useState<Accent>(() => accentPref());
  return (
    <>
      <div className="set">
        <span className="ic tone-grey" aria-hidden="true">
          <Icon name="sun" size={18} />
        </span>
        <span className="label">Look</span>
        <div className="seg3" role="radiogroup" aria-label="Theme">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              className={pref === o.value ? "on" : undefined}
              aria-checked={pref === o.value}
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
      <div className="set">
        <span className="ic tone-grey" aria-hidden="true">
          <Icon name="palette" size={18} />
        </span>
        <span className="label">Accent</span>
        <div className="row" style={{ gap: 16 }} role="radiogroup" aria-label="Accent colour">
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
