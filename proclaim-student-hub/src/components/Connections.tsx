import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { accountSync } from "../lib/accountSync.ts";
import { type SyncStatus, syncStatus } from "../lib/classroomSync.ts";
import { driveSync } from "../pages/driveSync.ts";
import { PAGES } from "../pages/runtime.ts";
import { whenLabel } from "../pages/SyncCard.tsx";

// Today's status line under the greeting: is Gmail bringing Classroom work
// in, and when did this device last sync with the others. A tap fixes the
// part that isn't working: Gmail asks to connect, and sync runs straight away.

export interface Connections {
  gmail: boolean;
  /** Last sync with the other devices (ISO), or "" for not yet / sync off. */
  synced: string;
  label: string;
}

/** What the line says, from the last Classroom check and the last sync. */
export function connections(
  status: SyncStatus | null,
  synced: string,
  now = Date.now(),
): Connections {
  const gmail = !!status && !status.error;
  const sync = synced ? `synced ${whenLabel(synced, now)}` : "";
  const label = gmail
    ? ["Gmail on", sync].filter(Boolean).join(" · ")
    : ["Connect Gmail", sync].filter(Boolean).join(" · ");
  return { gmail, synced, label };
}

function lastSync(): string {
  return PAGES ? (driveSync.on ? driveSync.lastSync : "") : accountSync.lastSync;
}

export function ConnectionLine() {
  const { data, reloadHomework, go, toast } = useApp();
  const [state, setState] = useState(() => connections(syncStatus.get(), lastSync()));
  const [busy, setBusy] = useState(false);

  // The first Gmail check and sync run when the app opens: show them as they land.
  useEffect(() => {
    const refresh = () => setState(connections(syncStatus.get(), lastSync()));
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (data.demo) {
    return null;
  }

  const fix = async () => {
    if (!state.gmail && PAGES) {
      // The website signs in to Google from More (set up once by a parent).
      go("apps");
      return;
    }
    setBusy(true);
    const before = syncStatus.get()?.at ?? "";
    if (!state.gmail) {
      // Checking Classroom now asks for Gmail if this page doesn't have it yet.
      reloadHomework(true);
    }
    if (!PAGES) {
      await accountSync.sync().catch(() => 0);
    } else if (driveSync.on && driveSync.signedIn) {
      await driveSync.sync().catch(() => 0);
    }
    // The Gmail check runs on its own; wait a little for its answer.
    for (let i = 0; i < 15 && !state.gmail && (syncStatus.get()?.at ?? "") === before; i++) {
      await new Promise((r) => window.setTimeout(r, 1000));
    }
    const next = connections(syncStatus.get(), lastSync());
    setState(next);
    setBusy(false);
    if (!next.gmail) {
      toast(syncStatus.get()?.error || "Gmail didn't answer. Try again in a minute.");
    }
  };

  return (
    <button
      className={`conn-line${state.gmail ? " on" : ""}`}
      onClick={() => void fix()}
      disabled={busy}
      aria-label={state.gmail ? `${state.label}. Sync now` : `${state.label}. Connect Gmail now`}
    >
      <span className="conn-dot" aria-hidden="true" />
      {busy ? "Checking…" : state.label}
    </button>
  );
}
