// Packs extension/ into public/snapsell-extension.zip so the app can offer it as a download.
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

const root = path.resolve("extension");
const files = {};
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files[`snapsell-extension/${path.relative(root, full).split(path.sep).join("/")}`] = fs.readFileSync(full);
  }
})(root);
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/snapsell-extension.zip", zipSync(files, { level: 9 }));
console.log(`public/snapsell-extension.zip (${Object.keys(files).length} files)`);
