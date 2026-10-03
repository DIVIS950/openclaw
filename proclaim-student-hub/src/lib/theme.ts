// Appearance: follow the phone, or force light or dark. Applied as
// html[data-theme], which the colour tokens in styles.css read.

export type Theme = "auto" | "light" | "dark";
const KEY = "psh.theme";

export const theme = {
  get(): Theme {
    try {
      const t = localStorage.getItem(KEY);
      return t === "light" || t === "dark" ? t : "auto";
    } catch {
      return "auto";
    }
  },
  set(t: Theme) {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // Not remembered.
    }
    applyTheme(t);
  },
};

export function applyTheme(t: Theme = theme.get()) {
  const root = document.documentElement;
  if (t === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", t);
  }
}
