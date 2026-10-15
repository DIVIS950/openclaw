// The website version: GitHub Pages caches pages for a while and a home-screen
// app keeps the old copy running, so the app checks version.json itself and
// offers a reload when a newer build is up.

const CHECK_EVERY = 5 * 60_000;
let lastCheck = 0;

export async function newerBuildAvailable(current: string): Promise<boolean> {
  if (Date.now() - lastCheck < CHECK_EVERY || !navigator.onLine) {
    return false;
  }
  lastCheck = Date.now();
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      return false;
    }
    const { build } = (await res.json()) as { build?: string };
    return typeof build === "string" && build !== "" && build !== current;
  } catch {
    return false;
  }
}

/** Calls back once a newer build is seen: on load and whenever the app comes back to the front. */
export function watchForUpdates(current: string, onUpdate: () => void) {
  let told = false;
  const check = () => {
    if (told || document.visibilityState !== "visible") {
      return;
    }
    void newerBuildAvailable(current).then((yes) => {
      if (yes && !told) {
        told = true;
        onUpdate();
      }
    });
  };
  window.setTimeout(check, 3000);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
}

/** Reloads past every cache so the new build really loads. */
export function reloadToUpdate() {
  const url = new URL(window.location.href);
  url.searchParams.set("v", String(Date.now()));
  window.location.replace(url.toString());
}
