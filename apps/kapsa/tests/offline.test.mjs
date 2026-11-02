// The service worker must precache every file the app loads, or it breaks offline.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const listed = new Set([...sw.matchAll(/^\s+"([^"]+)",$/gm)].map((m) => m[1]));

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

test("every app file is precached", () => {
  const needed = [...walk("js"), ...walk("vendor"), ...walk("fonts"), "css/app.css", "index.html", "manifest.webmanifest"];
  for (const file of needed) {
    assert.ok(listed.has(file), `sw.js is missing ${file}`);
  }
});

test("every precached file exists", () => {
  for (const file of listed) {
    assert.ok(fs.existsSync(path.join(root, file)), `sw.js lists ${file}, which does not exist`);
  }
});
