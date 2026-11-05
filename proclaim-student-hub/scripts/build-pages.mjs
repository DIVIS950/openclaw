// Builds the GitHub Pages version: a normal website (no claude.ai around it)
// served from https://divis950.github.io/openclaw/hub/. The microphone works
// there; the AI runs through Gemini and everything is saved on the phone.
// Personal data (private/seed.json) only goes in encrypted: private.dat, with
// the key kept in private/pages-key.txt and given to the student as a link.
// Output: dist-pages/
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import fs from "node:fs";

// One stamp for the app and version.json, so "Update now" can compare them.
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
execFileSync("npx", ["vite", "build", "--base", "./", "--outDir", "dist-pages", "--emptyOutDir"], {
  stdio: "inherit",
  env: { ...process.env, VITE_WEB_PAGE: "1", VITE_PAGES: "1", BUILD_STAMP: stamp },
});
// Google sign-in is only for the server version; don't load Google's script here.
const index = "dist-pages/index.html";
fs.writeFileSync(
  index,
  fs
    .readFileSync(index, "utf8")
    .replace(/\s*<script src="https:\/\/accounts\.google\.com[^>]*><\/script>/, ""),
);
const seedFile = "private/seed.json";
if (fs.existsSync(seedFile)) {
  const keyFile = "private/pages-key.txt";
  // One key for good, so the private link keeps working across updates.
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(
      keyFile,
      Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
    );
  }
  const key = fs.readFileSync(keyFile, "utf8").trim();
  const aes = await crypto.subtle.importKey(
    "raw",
    Buffer.from(key, "base64url"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(
    JSON.stringify(JSON.parse(fs.readFileSync(seedFile, "utf8"))),
  );
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, plain));
  fs.writeFileSync("dist-pages/private.dat", Buffer.from([...iv, ...sealed]).toString("base64url"));
  console.log(
    "Encrypted your data into dist-pages/private.dat (private link key: private/pages-key.txt)",
  );
}
// The app compares this with its own build stamp to offer "Update now".
fs.writeFileSync(
  "dist-pages/version.json",
  JSON.stringify({ build: stamp, at: new Date().toISOString() }),
);
console.log(`Built dist-pages/ for GitHub Pages (build ${stamp})`);
