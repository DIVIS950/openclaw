import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { backups } from "./lib/backup.ts";
import { trackKeyboard } from "./lib/keyboard.ts";
import { applyLocalSeed } from "./lib/seed.ts";
import { dayOf } from "./lib/study.ts";
import { importFromLocation } from "./lib/transfer.ts";
import { tutorImport } from "./lib/tutorImport.ts";
import { appliedSummary, importReplyFromLocation } from "./lib/tutorLink.ts";
import { localDb } from "./pages/localDb.ts";
import { unlockSeed } from "./pages/lockedSeed.ts";
import { installPagesRuntime, pagesImport, PAGES } from "./pages/runtime.ts";
import "./styles.css";

async function start() {
  trackKeyboard();
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
  // One snapshot a day of everything, so a mistake can be undone (Apps › Automatic saves).
  try {
    backups.daily();
  } catch {
    // Storage blocked: no snapshot this time.
  }
  // A link from a tutor: lessons, homework and materials go straight in.
  const fromTutor = await importReplyFromLocation(dayOf(new Date())).catch(() => null);
  if (fromTutor) {
    tutorImport.set(appliedSummary(fromTutor));
  }

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
