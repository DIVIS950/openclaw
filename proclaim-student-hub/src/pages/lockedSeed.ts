// The student's own starter data (timetable, classes, homework) on the public
// GitHub Pages site: the build encrypts it (AES-GCM, random 256-bit key) into
// private.dat, and only the student's private link carries the key, in the
// #fragment that browsers never send to the server. The phone then remembers
// the key so the home-screen icon keeps working.

const KEY_STORE = "psh.seed.key";

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

/** Takes the key from the private link (or this phone) and unlocks the data. */
export async function unlockSeed(): Promise<boolean> {
  let key = "";
  const match = /^#k=([\w-]{40,})$/.exec(window.location.hash);
  if (match) {
    key = match[1];
    history.replaceState(null, "", window.location.pathname + window.location.search);
  } else {
    try {
      key = localStorage.getItem(KEY_STORE) ?? "";
    } catch {
      key = "";
    }
  }
  if (!key) {
    return false;
  }
  try {
    const res = await fetch("./private.dat", { cache: "no-cache" });
    if (!res.ok) {
      return false;
    }
    const seed = await decryptSeed(key, await res.text());
    (window as unknown as { __PSH_SEED__?: unknown }).__PSH_SEED__ = seed;
    localStorage.setItem(KEY_STORE, key);
    return true;
  } catch {
    // Wrong or old key: carry on without the starter data.
    return false;
  }
}
