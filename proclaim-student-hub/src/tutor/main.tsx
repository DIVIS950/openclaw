import "../polyfills.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { trackKeyboard } from "../lib/keyboard.ts";
import "../styles.css";
import "../bento.css";

// The Tutor Hub is light by default (it follows the tutor's phone if they pick
// "auto" later) and uses the green accent, so it never looks like the student's app.
try {
  const pref = localStorage.getItem("tutorhub.theme");
  const light =
    pref === "auto"
      ? !(typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches)
      : pref !== "dark";
  document.documentElement.dataset.theme = light ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "light";
}
document.documentElement.dataset.accent = "green";
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#EEF0F4");
import { TutorApp } from "./TutorApp.tsx";

trackKeyboard();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <TutorApp />
    </StrictMode>,
  );
}
