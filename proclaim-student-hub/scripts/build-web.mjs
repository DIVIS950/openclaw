// Builds the app as one self-contained HTML page to publish on claude.ai,
// where it reaches Gmail and Claude through the page runtime (no server).
// Output: dist-demo/proclaim-student-hub.html
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = "dist-demo";
execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir"], {
  stdio: "inherit",
  env: { ...process.env, VITE_WEB_PAGE: "1" },
});

const assets = path.join(out, "assets");
const files = fs.readdirSync(assets);
const read = (ext) =>
  files
    .filter((f) => f.endsWith(ext))
    .map((f) => fs.readFileSync(path.join(assets, f), "utf8"))
    .join("\n");
// Keep "</script>" inside the bundle from closing the inline tag early.
const js = read(".js").replace(/<\/script/gi, "<\\/script");
const css = read(".css");

// Optional private starter data (timetable, classes, homework). It lives in the
// gitignored private/ folder and only ever ends up in this private page.
const seedFile = "private/seed.json";
const seed = fs.existsSync(seedFile)
  ? `<script>window.__PSH_SEED__ = ${JSON.stringify(JSON.parse(fs.readFileSync(seedFile, "utf8"))).replace(/</g, "\\u003c")};</script>\n`
  : "";

const html = `<title>Proclaim Student Hub</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
${css}
</style>
<div id="root"></div>
${seed}<script type="module">
${js}
</script>
`;
fs.writeFileSync(path.join(out, "proclaim-student-hub.html"), html);
console.log(`Wrote ${out}/proclaim-student-hub.html (${Math.round(html.length / 1024)} KB)`);
