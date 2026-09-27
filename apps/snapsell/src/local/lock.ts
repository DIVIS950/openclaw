/**
 * Private lock for the no-server version. When the site is built with VITE_LOCK (the Gemini key,
 * encrypted with a key derived from a private code), the app only opens with that code: typed on
 * the lock screen or in the link (…/#k=<code>). The code never ships with the site, so the public
 * files only hold scrambled text; once unlocked, the Gemini key is saved on this phone.
 */
import type { Settings } from "../../shared/types.ts";
import { idb } from "./idb.ts";

const LOCK = import.meta.env.VITE_LOCK as string | undefined;
/** Slow on purpose: each guess of a short code costs real work. Must match scripts/private-link.mjs. */
const ITERATIONS = 600_000;

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function decrypt(code: string) {
  try {
    const box = b64(LOCK!); // salt (16) | iv (12) | ciphertext
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code.trim().toLowerCase()), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: box.slice(0, 16), iterations: ITERATIONS },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.slice(16, 28) }, key, box.slice(28));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Accepts the whole private link, or just the code typed in. */
function passwordIn(text: string) {
  const t = decodeURIComponent(text.trim());
  const m = /[#&?]k=([^&#\s]+)/.exec(t);
  if (m) return m[1];
  return t && !t.includes("/") && !t.startsWith("#") ? t : null;
}

async function open(password: string | null) {
  const apiKey = password && (await decrypt(password));
  if (!apiKey) return false;
  const saved = (await idb.get<Settings>("settings").catch(() => undefined)) ?? {};
  await idb.set("settings", { ...saved, geminiApiKey: apiKey, aiProvider: "gemini" }).catch(() => {});
  await idb.set("unlocked", true).catch(() => {});
  // Kept on this phone only, so "Share SnapSell" can send the same private link to family.
  await idb.set("shareCode", password!.trim().toLowerCase()).catch(() => {});
  return true;
}

function lockScreen(onTry: (text: string) => Promise<boolean>) {
  const root = document.getElementById("root")!;
  root.innerHTML = `
    <div style="min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f3efe6;color:#17150f;font-family:system-ui,sans-serif">
      <div style="max-width:360px;width:100%;text-align:center">
        <div style="font-size:44px">🔒</div>
        <h1 style="font-size:26px;margin:8px 0 6px">SnapSell is private</h1>
        <p style="color:#6b6456;margin:0 0 18px">Type your private code (or paste your private link).</p>
        <input id="lock-in" placeholder="Private code" autocomplete="off" autocapitalize="none" autocorrect="off" style="width:100%;box-sizing:border-box;height:50px;border-radius:14px;border:1.5px solid #d8d0c0;padding:0 14px;font-size:16px;background:#fff">
        <button id="lock-go" style="margin-top:10px;width:100%;height:50px;border:0;border-radius:999px;background:#17150f;color:#fff;font-size:16px;font-weight:700">Open</button>
        <p id="lock-err" style="color:#b42318;min-height:20px;margin:10px 0 0"></p>
      </div>
    </div>`;
  const input = document.getElementById("lock-in") as HTMLInputElement;
  const go = async () => {
    if (await onTry(input.value)) return;
    document.getElementById("lock-err")!.textContent = "That code doesn't open this SnapSell.";
  };
  document.getElementById("lock-go")!.addEventListener("click", go);
  input.addEventListener("keydown", (e) => e.key === "Enter" && void go());
  // The private link opened while this screen shows (only the #part changes, no reload).
  const onHash = () => {
    const pass = passwordIn(location.hash);
    if (!pass) return;
    history.replaceState(null, "", `${location.pathname}${location.search}#/`);
    void onTry(pass).then((ok) => ok && removeEventListener("hashchange", onHash));
  };
  addEventListener("hashchange", onHash);
}

/** Resolves once the app may start: no lock built in, already unlocked here, or unlocked now. */
export async function gate() {
  if (!LOCK) return;
  const fromLink = passwordIn(location.hash);
  if (fromLink) history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  if (await open(fromLink)) return;
  if (await idb.get<boolean>("unlocked").catch(() => false)) return;
  await new Promise<void>((resolve) =>
    lockScreen(async (text) => {
      if (!(await open(passwordIn(text)))) return false;
      document.getElementById("root")!.innerHTML = "";
      resolve();
      return true;
    }),
  );
}
