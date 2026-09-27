// Makes the lock for a private build: encrypts the Gemini key with a key derived from a private code.
// Usage: GEMINI_KEY=... LOCK_CODE=... node scripts/private-link.mjs  ->  prints VITE_LOCK=...
// Build with that VITE_LOCK; open with the code, or the link <site>/#k=<code>. Keep both out of the repo.
import { webcrypto as crypto } from "node:crypto";

const key = process.env.GEMINI_KEY;
const code = process.env.LOCK_CODE?.trim().toLowerCase();
if (!key || !code) throw new Error("Set GEMINI_KEY and LOCK_CODE");
const ITERATIONS = 600_000; // must match src/local/lock.ts
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(key)));
console.log(`VITE_LOCK=${Buffer.from(new Uint8Array([...salt, ...iv, ...ct])).toString("base64url")}`);
