// Installs `gog` (the Gmail + Google Calendar CLI used by OpenClaw's gog skill) into
// /usr/local/bin during the image build. Runs with the image's own Node; no curl needed.
// Usage: node install-gog.mjs [latest|vX.Y.Z]
// Exits 0 on success and 1 on any failure; the Dockerfile treats failure as "Gmail stays off".
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPOS = ["openclaw/gogcli", "steipete/gogcli"];
const wanted = process.argv[2] || "latest";
const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
if (!arch) throw new Error(`unsupported CPU: ${process.arch}`);

async function json(url) {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "pina-setup" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
async function bytes(url) {
  const res = await fetch(url, { headers: { "User-Agent": "pina-setup" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let release;
for (const repo of REPOS) {
  try {
    release = await json(`https://api.github.com/repos/${repo}/releases/${wanted === "latest" ? "latest" : `tags/${wanted}`}`);
    break;
  } catch (err) {
    console.warn(`gog: ${repo}: ${err.message}`);
  }
}
if (!release) throw new Error("no gog release found");

const assets = release.assets || [];
const archive = assets.find((a) => new RegExp(`linux[_-]${arch}\\.tar\\.gz$`, "i").test(a.name));
if (!archive) throw new Error(`release ${release.tag_name} has no linux_${arch} archive`);
const data = await bytes(archive.browser_download_url);

// Verify against the release's checksum list when it publishes one.
const sums = assets.find((a) => /checksums?\.txt$/i.test(a.name));
if (sums) {
  const list = (await bytes(sums.browser_download_url)).toString("utf8");
  const line = list.split("\n").find((l) => l.trim().endsWith(archive.name));
  const expected = line && line.trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(data).digest("hex");
  if (!expected || expected !== actual) throw new Error(`checksum mismatch for ${archive.name}`);
  console.log(`gog: checksum ok (${actual.slice(0, 12)}…)`);
} else {
  console.warn("gog: release has no checksums file; installing without verification");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gog-"));
const file = path.join(dir, archive.name);
fs.writeFileSync(file, data);
execFileSync("tar", ["-xzf", file, "-C", dir]);
const find = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const hit = find(p); if (hit) return hit; }
    else if (e.name === "gog") return p;
  }
  return null;
};
const bin = find(dir);
if (!bin) throw new Error(`no gog binary inside ${archive.name}`);
fs.copyFileSync(bin, "/usr/local/bin/gog");
fs.chmodSync("/usr/local/bin/gog", 0o755);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`gog: installed ${release.tag_name} (${arch}) to /usr/local/bin/gog`);
