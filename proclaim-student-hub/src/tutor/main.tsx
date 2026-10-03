import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { trackKeyboard } from "../lib/keyboard.ts";
import "../styles.css";
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
