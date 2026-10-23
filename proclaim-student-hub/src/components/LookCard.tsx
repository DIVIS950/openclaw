import { useState } from "react";
import {
  ACCENTS,
  accentPref,
  setAccentPref,
  setStylePref,
  setThemePref,
  STYLES,
  stylePref,
  themePref,
  type Accent,
  type Style,
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

/** Each style's name and a short line saying what it looks like. */
const STYLE_INFO: Record<Style, { name: string; sub: string }> = {
  classic: { name: "Classic", sub: "Colourful stickers" },
  calm: { name: "Calm", sub: "Clean, like iPhone" },
  dark: { name: "Dark", sub: "Game-like, always dark" },
  playful: { name: "Playful", sub: "Bright and bouncy" },
};

/**
 * More › Look: the style (Classic, Calm, Dark, Playful), then follow the phone
 * (default), light or dark, plus the accent colour.
 */
export function LookCard() {
  const [pref, setPref] = useState<ThemePref>(() => themePref());
  const [accent, setAccent] = useState<Accent>(() => accentPref());
  const [style, setStyle] = useState<Style>(() => stylePref());
  return (
    <>
      <div className="set style-set">
        <span className="ic tone-grey" aria-hidden="true">
          <Icon name="wand" size={18} />
        </span>
        <span className="label">Style</span>
        <div className="style-picker" role="radiogroup" aria-label="Style">
          {STYLES.map((st) => (
            <button
              key={st}
              role="radio"
              aria-checked={style === st}
              className={`style-opt style-${st}${style === st ? " on" : ""}`}
              onClick={() => {
                setStyle(st);
                setStylePref(st);
              }}
            >
              <span className="style-dot" aria-hidden="true" />
              <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                <strong>{STYLE_INFO[st].name}</strong>
                <span className="s11">{STYLE_INFO[st].sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
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
              className={pref === o.value && style !== "dark" ? "on" : undefined}
              aria-checked={pref === o.value && style !== "dark"}
              disabled={style === "dark"}
              title={style === "dark" ? "The Dark style is always dark" : undefined}
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
