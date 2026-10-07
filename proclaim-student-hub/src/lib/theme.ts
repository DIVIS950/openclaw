// Look: Night Studio is dark by default; the student can pick light, or
// "auto" to follow the phone. Stored on this device only.
export type ThemePref = "dark" | "light" | "auto";

const KEY = "psh.theme";

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "auto" ? v : "dark";
  } catch {
    return "dark";
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
  meta?.setAttribute("content", mode === "dark" ? "#07070f" : "#f3f2fa");
  return mode;
}

export type Accent = "lime" | "cyan" | "magenta" | "violet";
export const ACCENTS: Accent[] = ["lime", "cyan", "magenta", "violet"];
const ACCENT_KEY = "psh.accent";

export function accentPref(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.find((a) => a === v) ?? "lime";
  } catch {
    return "lime";
  }
}

/** Writes data-accent on <html>; lime needs no attribute. */
export function applyAccent(accent: Accent = accentPref()): void {
  if (accent === "lime") {
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
