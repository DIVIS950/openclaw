/**
 * Private-link lock for the no-server version. When the site is built with VITE_LOCK (the Gemini
 * key, encrypted with a random password), the app only opens with the private link
 * (…/#k=<password>). The password never ships with the site, so the public files only hold
 * scrambled text; once unlocked, the key is saved on this phone like a pasted key.
 */
import type { Settings } from "../../shared/types.ts";
import { idb } from "./idb.ts";

const LOCK = import.meta.env.VITE_LOCK as string | undefined;

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function decrypt(password: string) {
  try {
    const box = b64(LOCK!);
    const key = await crypto.subtle.importKey("raw", b64(password), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.slice(0, 12) }, key, box.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Accepts the whole private link or just the part after #k=. */
const passwordIn = (text: string) => /(?:^|[#&?]k=)([A-Za-z0-9_-]{16,})/.exec(text.trim())?.[1] ?? null;

async function open(password: string | null) {
  const apiKey = password && (await decrypt(password));
  if (!apiKey) return false;
  const saved = (await idb.get<Settings>("settings").catch(() => undefined)) ?? {};
  await idb.set("settings", { ...saved, geminiApiKey: apiKey, aiProvider: "gemini" }).catch(() => {});
  await idb.set("unlocked", true).catch(() => {});
  return true;
}

function lockScreen(onTry: (text: string) => Promise<boolean>) {
  const root = document.getElementById("root")!;
  root.innerHTML = `
    <div style="min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f3efe6;color:#17150f;font-family:system-ui,sans-serif">
      <div style="max-width:360px;width:100%;text-align:center">
        <div style="font-size:44px">🔒</div>
        <h1 style="font-size:26px;margin:8px 0 6px">SnapSell is private</h1>
        <p style="color:#6b6456;margin:0 0 18px">Open it with your private link. If you added it to the Home Screen, paste the link here once.</p>
        <input id="lock-in" placeholder="Paste your private link" autocomplete="off" style="width:100%;box-sizing:border-box;height:50px;border-radius:14px;border:1.5px solid #d8d0c0;padding:0 14px;font-size:16px;background:#fff">
        <button id="lock-go" style="margin-top:10px;width:100%;height:50px;border:0;border-radius:999px;background:#17150f;color:#fff;font-size:16px;font-weight:700">Open</button>
        <p id="lock-err" style="color:#b42318;min-height:20px;margin:10px 0 0"></p>
      </div>
    </div>`;
  const input = document.getElementById("lock-in") as HTMLInputElement;
  const go = async () => {
    if (await onTry(input.value)) return;
    document.getElementById("lock-err")!.textContent = "That link doesn't open this SnapSell.";
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
