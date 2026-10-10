import "./polyfills.ts";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { LinkConfirm } from "./components/LinkConfirm.tsx";
import { backups } from "./lib/backup.ts";
import { trackKeyboard } from "./lib/keyboard.ts";
import { damagedLink, linkInbox } from "./lib/linkInbox.ts";
import { applyLocalSeed } from "./lib/seed.ts";
import { applyAccent, applyTheme, watchTheme } from "./lib/theme.ts";
import { readTransferFromLocation, transferPreview } from "./lib/transfer.ts";
import { importReplyFromLocation } from "./lib/tutorLink.ts";
import { unlockSeed } from "./pages/lockedSeed.ts";
import { installPagesRuntime, PAGES } from "./pages/runtime.ts";
import "./styles.css";
import "./bento.css";
import "./fix-tutor.css";
import "./fix-flow.css";
import "./fix-polish.css";

async function start() {
  // Bento look, light unless the student chose otherwise in More › Look.
  applyTheme();
  applyAccent();
  watchTheme();
  trackKeyboard();
  if (PAGES) {
    // GitHub Pages version: Gemini + phone storage stand in for claude.ai, and
    // data sent from the claude.ai link arrives in the address.
    installPagesRuntime();
    // Keeps the app opening offline and lets Home Screen reminders work (public/sw.js).
    navigator.serviceWorker?.register("sw.js").catch(() => undefined);
    // The student's own timetable/classes/homework, if their private link unlocked it.
    await unlockSeed();
    // Data from the claude.ai link waits for the student's OK (LinkConfirm).
    const t = await readTransferFromLocation().catch(() => "damaged" as const);
    if (t === "damaged") {
      linkInbox.set(damagedLink("whoever sent it"));
    } else if (t) {
      linkInbox.set({ kind: "import", transfer: t, lines: transferPreview(t, localStorage) });
    }
  }
  // One snapshot a day of everything (before any link is brought in), so a
  // mistake can be undone (Apps › Automatic saves).
  try {
    backups.daily();
  } catch {
    // Storage blocked: no snapshot this time.
  }
  // A link from a tutor: checked here, brought in once the student says yes.
  await importReplyFromLocation().catch(() => linkInbox.set(damagedLink("your tutor")));

  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  const reactRoot = createRoot(root);
  const draw = () => {
    // The student's own timetable and classes, after any link was brought in.
    applyLocalSeed();
    reactRoot.render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    );
  };
  if (linkInbox.get()) {
    reactRoot.render(
      <StrictMode>
        <LinkGate onDone={draw} />
      </StrictMode>,
    );
  } else {
    draw();
  }
}

/** "Bring this in?" before the app draws, so the app opens with the result. */
function LinkGate({ onDone }: { onDone: () => void }) {
  const [done, setDone] = useState(false);
  if (done) {
    return null;
  }
  return (
    <div className="app">
      <LinkConfirm
        onDone={() => {
          setDone(true);
          // Next tick: leave the confirm's own handlers before swapping the tree.
          window.setTimeout(onDone, 0);
        }}
      />
    </div>
  );
}

void start();
