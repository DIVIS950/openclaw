// The student's own starter data (timetable, classes, homework) on the public
// GitHub Pages site: the build encrypts it (AES-GCM, random 256-bit key) into
// private.dat, and only the student's private link carries the key, in the
// #fragment that browsers never send to the server. The phone then remembers
// the key so the home-screen icon keeps working.

const KEY_STORE = "psh.seed.key";
/** The last decrypted data, so the app still opens with no signal. */
const SEED_CACHE = "psh.seed.cache";

const fromBase64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Decrypts private.dat's contents (base64url of iv + ciphertext). */
export async function decryptSeed(key: string, data: string): Promise<unknown> {
  const raw = fromBase64Url(data.trim());
  const aes = await crypto.subtle.importKey("raw", fromBase64Url(key), "AES-GCM", false, [
    "decrypt",
  ]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    aes,
    raw.slice(12),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Finds the key inside a pasted private link (or a bare key). */
export function keyFromText(text: string): string {
  const t = text.trim();
  return /[#&]k=([\w-]{40,})/.exec(t)?.[1] ?? (/^[\w-]{40,}$/.test(t) ? t : "");
}

/** Whether this site has locked starter data and this device hasn't unlocked it yet. */
export const lockState: { locked: boolean } = { locked: false };

/** Saves a pasted key; the app reloads to use it. */
export function rememberKey(key: string) {
  try {
    localStorage.setItem(KEY_STORE, key);
  } catch {
    // Can't remember it on this device.
  }
}

/** Takes the key from the private link (or this phone) and unlocks the data. */
export async function unlockSeed(): Promise<boolean> {
  let key = "";
  // The key stays in the address for now: "Add to Home Screen" saves the
  // current address, and on iPhone the home-screen app doesn't share Safari's
  // storage, so it needs the key in its own address.
  const match = /^#k=([\w-]{40,})$/.exec(window.location.hash);
  if (match) {
    key = match[1];
  } else {
    try {
      key = localStorage.getItem(KEY_STORE) ?? "";
    } catch {
      key = "";
    }
  }
  const w = window as unknown as { __PSH_SEED__?: unknown };
  let text: string;
  try {
    const res = await fetch("./private.dat", { cache: "no-cache" });
    if (!res.ok) {
      return false;
    }
    text = await res.text();
  } catch {
    // Offline (e.g. the home-screen app with no signal): use the last copy.
    try {
      const cached = localStorage.getItem(SEED_CACHE);
      if (cached && key) {
        w.__PSH_SEED__ = JSON.parse(cached);
        return true;
      }
    } catch {
      // No cached copy.
    }
    return false;
  }
  if (!key) {
    lockState.locked = true;
    return false;
  }
  try {
    const seed = await decryptSeed(key, text);
    w.__PSH_SEED__ = seed;
    localStorage.setItem(KEY_STORE, key);
    try {
      localStorage.setItem(SEED_CACHE, JSON.stringify(seed));
    } catch {
      // Cache is a bonus.
    }
    return true;
  } catch {
    // Wrong or old key: ask for the link again.
    lockState.locked = true;
    return false;
  }
}

/** This phone's private link (website address + its key), or "" when there's no key here. */
export function privateLink(): string {
  let key = /^#k=([\w-]{40,})$/.exec(window.location.hash)?.[1] ?? "";
  if (!key) {
    try {
      key = localStorage.getItem(KEY_STORE) ?? "";
    } catch {
      key = "";
    }
  }
  return key ? `${window.location.origin}${window.location.pathname}#k=${key}` : "";
}
