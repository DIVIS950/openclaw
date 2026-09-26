// Makes the lock for a private build: encrypts the Gemini key with a new random password.
// Usage: GEMINI_KEY=... node scripts/private-link.mjs  ->  prints VITE_LOCK=... and the password.
// Build with that VITE_LOCK; the private link is <site>/#k=<password>. Keep both out of the repo.
import { webcrypto as crypto } from "node:crypto";

const key = process.env.GEMINI_KEY;
if (!key) throw new Error("Set GEMINI_KEY");
const b64 = (u8) => Buffer.from(u8).toString("base64url");
const password = process.env.LOCK_PASSWORD ?? b64(crypto.getRandomValues(new Uint8Array(16)));
const aes = await crypto.subtle.importKey("raw", Buffer.from(password, "base64url"), "AES-GCM", false, ["encrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(key)));
console.log(`VITE_LOCK=${b64(new Uint8Array([...iv, ...ct]))}`);
console.log(`PASSWORD=${password}`);
