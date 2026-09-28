// Builds the GitHub Pages version: a normal website (no claude.ai around it)
// served from https://divis950.github.io/openclaw/hub/. The microphone works
// there; the AI runs through Gemini and everything is saved on the phone.
// No personal data goes in: private/seed.json is never read here.
// Output: dist-pages/
import { execFileSync } from "node:child_process";
import fs from "node:fs";

execFileSync("npx", ["vite", "build", "--base", "./", "--outDir", "dist-pages", "--emptyOutDir"], {
  stdio: "inherit",
  env: { ...process.env, VITE_WEB_PAGE: "1", VITE_PAGES: "1" },
});
// Google sign-in is only for the server version; don't load Google's script here.
const index = "dist-pages/index.html";
fs.writeFileSync(
  index,
  fs
    .readFileSync(index, "utf8")
    .replace(/\s*<script src="https:\/\/accounts\.google\.com[^>]*><\/script>/, ""),
);
console.log("Built dist-pages/ for GitHub Pages");
