import { useEffect, useState } from "react";
import { driveSync } from "./driveSync.ts";
import { PAGES } from "./runtime.ts";

// Sync my devices (website): syncs when the app opens, when it comes back to
// the front, and when it's put away. Google's sign-in lasts an hour; after that
// the returned flag turns on so Today can ask for one tap.

export function useAutoSync(toast: (message: string) => void): [boolean, (value: boolean) => void] {
  const [syncTap, setSyncTap] = useState(false);
  useEffect(() => {
    if (!PAGES) {
      return;
    }
    let reloadOnReturn = false;
    const run = (leaving: boolean) => {
      if (!driveSync.on) {
        return;
      }
      if (!driveSync.signedIn) {
        setSyncTap(true);
        return;
      }
      void driveSync.sync().then(
        (changed) => {
          if (changed === 0) {
            return;
          }
          // Screens read their data when they open: reload to show what came in.
          if (leaving) {
            reloadOnReturn = true;
          } else {
            toast("Synced with your other devices. Updating…");
            window.setTimeout(() => window.location.reload(), 900);
          }
        },
        () => setSyncTap(!driveSync.signedIn),
      );
    };
    run(false);
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        run(true);
      } else if (reloadOnReturn) {
        window.location.reload();
      } else if (Date.now() - (Date.parse(driveSync.lastSync) || 0) > 120_000) {
        run(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [toast]);
  return [syncTap, setSyncTap];
}
