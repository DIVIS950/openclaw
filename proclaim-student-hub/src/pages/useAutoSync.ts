import { useEffect, useState } from "react";
import { accountSync } from "../lib/accountSync.ts";
import { driveSync } from "./driveSync.ts";
import { PAGES } from "./runtime.ts";

// Sync my devices: syncs when the app opens, when it comes back to the front,
// and when it's put away. On the website it goes through Google Drive, whose
// sign-in lasts an hour; after that the returned flag turns on so Today can
// ask for one tap. In the Claude app it goes through the student's account and
// needs no taps at all.

/** One sync; resolves how many values changed here, or null when it couldn't run. */
function syncOnce(onNeedTap: () => void): Promise<number | null> {
  if (!PAGES) {
    // No account here (not signed in, or outside the Claude app): nothing to do.
    return accountSync.sync().catch(() => null);
  }
  if (!driveSync.on) {
    return Promise.resolve(null);
  }
  if (!driveSync.signedIn) {
    onNeedTap();
    return Promise.resolve(null);
  }
  return driveSync.sync().catch(() => {
    if (!driveSync.signedIn) {
      onNeedTap();
    }
    return null;
  });
}

export function useAutoSync(toast: (message: string) => void): [boolean, (value: boolean) => void] {
  const [syncTap, setSyncTap] = useState(false);
  useEffect(() => {
    let reloadOnReturn = false;
    const run = (leaving: boolean) =>
      void syncOnce(() => setSyncTap(true)).then((changed) => {
        if (!changed) {
          return;
        }
        // Screens read their data when they open: reload to show what came in.
        if (leaving) {
          reloadOnReturn = true;
        } else {
          toast("Synced with your other devices. Updating…");
          window.setTimeout(() => window.location.reload(), 900);
        }
      });
    run(false);
    const onVisible = () => {
      const last = PAGES ? driveSync.lastSync : accountSync.lastSync;
      if (document.visibilityState === "hidden") {
        run(true);
      } else if (reloadOnReturn) {
        window.location.reload();
      } else if (Date.now() - (Date.parse(last) || 0) > 120_000) {
        run(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [toast]);
  return [syncTap, setSyncTap];
}
