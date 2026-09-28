import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyLocalSeed } from "./lib/seed.ts";
import "./styles.css";

// Set up the student's own timetable and classes before the first screen draws.
applyLocalSeed();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
