import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { trackKeyboard } from "./lib/keyboard.ts";
import { applyLocalSeed } from "./lib/seed.ts";
import { applyTheme } from "./lib/theme.ts";
import { importFromLocation } from "./lib/transfer.ts";
import { localDb } from "./pages/localDb.ts";
import { unlockSeed } from "./pages/lockedSeed.ts";
import { installPagesRuntime, pagesImport, PAGES } from "./pages/runtime.ts";
import "./styles.css";

async function start() {
  trackKeyboard();
  applyTheme();
  if (PAGES) {
    // GitHub Pages version: Gemini + phone storage stand in for claude.ai, and
    // data sent from the claude.ai link arrives in the address.
    installPagesRuntime();
    // The student's own timetable/classes/homework, if their private link unlocked it.
    await unlockSeed();
    pagesImport.added = await importFromLocation(localDb).catch(() => null);
  }
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
}

void start();
