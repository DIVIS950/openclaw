// Look: follows the phone ("auto") until the student picks light or dark in
// More › Look, so the loading shell (index.html) and the app always match.
// Stored on this device only.
export type ThemePref = "dark" | "light" | "auto";

const KEY = "psh.theme";

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "auto";
  } catch {
    return "auto";
  }
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref !== "auto") {
    return pref;
  }
  const light =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  return light ? "light" : "dark";
}

/** Writes data-theme on <html> so the CSS tokens switch. */
export function applyTheme(pref: ThemePref = themePref()): "dark" | "light" {
  const mode = resolve(pref);
  document.documentElement.dataset.theme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", mode === "dark" ? "#0B0D12" : "#EEF0F4");
  return mode;
}

export type Accent = "blue" | "orange" | "green" | "violet";
export const ACCENTS: Accent[] = ["blue", "orange", "green", "violet"];
// Names saved by the previous look, mapped to the nearest Bento colour.
const OLD: Record<string, Accent> = { lime: "blue", cyan: "green", magenta: "orange" };
const ACCENT_KEY = "psh.accent";

export function accentPref(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY) ?? "";
    return ACCENTS.find((a) => a === v) ?? OLD[v] ?? "blue";
  } catch {
    return "blue";
  }
}

/** Writes data-accent on <html>; blue needs no attribute. */
export function applyAccent(accent: Accent = accentPref()): void {
  if (accent === "blue") {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
}

export function setAccentPref(accent: Accent): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Private mode: lasts until the tab closes.
  }
  applyAccent(accent);
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Private mode: the choice lasts until the tab closes.
  }
  applyTheme(pref);
}

/** Keeps "auto" in step when the phone switches between day and night. */
export function watchTheme(): void {
  if (typeof matchMedia !== "function") {
    return;
  }
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (themePref() === "auto") {
      applyTheme("auto");
    }
  });
}
