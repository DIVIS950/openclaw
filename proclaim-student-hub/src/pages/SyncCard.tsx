import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../context.ts";
import { driveSync, SyncSignInError } from "./driveSync.ts";

// More › Sync my devices (website): the same homework, notes, tests and ticks
// on the phone and the iPad, kept in the student's own Google Drive.

/** "2 min ago", "at 14:05", "on 3 Oct". */
function whenLabel(iso: string): string {
  const at = new Date(iso);
  const min = Math.round((Date.now() - at.getTime()) / 60_000);
  if (min < 1) {
    return "just now";
  }
  if (min < 60) {
    return `${min} min ago`;
  }
  return at.toDateString() === new Date().toDateString()
    ? `at ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : `on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** Syncs (signing in first when needed), then reloads if anything new arrived. */
export async function syncNow(toast: (m: string) => void): Promise<void> {
  const changed =
    driveSync.on && driveSync.signedIn ? await driveSync.sync() : await driveSync.connect();
  if (changed > 0) {
    toast("Synced. Updating with your other devices' changes…");
    // Every screen reads its data when it opens: a reload shows the new data everywhere.
    window.setTimeout(() => window.location.reload(), 900);
  } else {
    toast("Synced. Everything was already up to date.");
  }
}

export function SyncRow() {
  const { toast, handleError } = useApp();
  const [busy, setBusy] = useState(false);
  const [, redraw] = useState(0);
  const on = driveSync.on;

  const run = async () => {
    setBusy(true);
    try {
      await syncNow(toast);
    } catch (err) {
      handleError(err instanceof SyncSignInError ? new Error(err.message) : err);
    } finally {
      setBusy(false);
      redraw((n) => n + 1);
    }
  };

  const status = !driveSync.ready
    ? "Needs the Google client ID in For parents"
    : !on
      ? "Off · same data on phone and iPad"
      : driveSync.lastSync
        ? `Synced ${whenLabel(driveSync.lastSync)}`
        : "On";

  return (
    <div className="crow sync-row" style={{ flexWrap: "wrap" }}>
      <span className="ico cyan r40" aria-hidden="true">
        <Icon name="sync" size={18} />
      </span>
      <span className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>Sync my devices</span>
        <span className="s11 muted">{status}</span>
      </span>
      {driveSync.ready && (
        <button className="btn sm primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Syncing…" : on ? "Sync now" : "Turn on"}
        </button>
      )}
      {on && (
        <button
          className="btn sm"
          disabled={busy}
          onClick={() => {
            driveSync.turnOff();
            toast("Sync is off on this device. Your other devices keep their data.");
            redraw((n) => n + 1);
          }}
        >
          Turn off
        </button>
      )}
      {driveSync.ready && !on && (
        <span className="s11 muted" style={{ flexBasis: "100%" }}>
          Sign in with the same Google account (your personal Gmail) on every device. Your data goes
          in a hidden app folder in your own Google Drive.
        </span>
      )}
    </div>
  );
}
