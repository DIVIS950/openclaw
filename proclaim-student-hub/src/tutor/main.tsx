import "../polyfills.ts";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { trackKeyboard } from "../lib/keyboard.ts";
import "../styles.css";
import "../bento.css";
import "../fix-tutor.css";
import "../fix-flow.css";
import "../fix-polish.css";

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
// The student app's background glow is not for the Tutor Hub.
document.body.classList.add("tutor-page");
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#EEF0F4");
import { TutorApp } from "./TutorApp.tsx";

/** One bad link or saved copy must never leave the tutor with a blank page. */
class TutorErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("Tutor Hub crashed", err);
  }
  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div className="app tutor-hub">
        <main className="screen tutor-screen" style={{ gap: 16 }}>
          <header className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Tutor Hub</span>
            <h1 className="h1">Something went wrong</h1>
          </header>
          <div className="card stack" role="alert">
            <p style={{ margin: 0 }}>
              This page hit a problem. Your saved students are still on this device. Reload to try
              again, or ask your student to send their link again.
            </p>
            <button
              className="btn primary"
              onClick={() => window.location.replace(window.location.pathname)}
            >
              Reload
            </button>
          </div>
        </main>
      </div>
    );
  }
}

trackKeyboard();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <TutorErrorBoundary>
        <TutorApp />
      </TutorErrorBoundary>
    </StrictMode>,
  );
}
