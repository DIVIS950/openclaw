import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { trackKeyboard } from "../lib/keyboard.ts";
import "../styles.css";

// The Tutor Hub is light by default (it follows the tutor's phone if they pick
// "auto" later) and uses the cyan accent, the tutoring colour in the design.
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
document.documentElement.dataset.accent = "cyan";
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f3f2fa");
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
