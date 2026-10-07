// Puts new Classroom tasks on the student's website too.
//
//   node scripts/classroom-to-web.mjs tasks.json [--no-deploy]
//
// tasks.json: [{ "title": "...", "course": "...", "due": "YYYY-MM-DD" }, ...]
// New titles are added to private/seed.json (never duplicated), the seed
// version is bumped so every phone imports them once, then the website is
// rebuilt and deployed. The hourly Classroom routine runs this after it has
// added the same tasks to the claude.ai app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/classroom-to-web.mjs tasks.json [--no-deploy]");
  process.exit(2);
}
const seedFile = process.env.PSH_SEED_FILE || path.join(root, "private", "seed.json");
const deploy = !flags.includes("--no-deploy");

const norm = (s) =>
  String(s ?? "")
    .trim()
    .replace(/…$/, "")
    .toLowerCase();
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));

const incoming = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(incoming)) {
  console.error("tasks.json must be an array");
  process.exit(2);
}
const seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
seed.homework = Array.isArray(seed.homework) ? seed.homework : [];
const have = new Set(seed.homework.map((h) => norm(h.title)));
const added = [];
for (const t of incoming) {
  const title = String(t.title ?? "").trim();
  if (!title || have.has(norm(title))) {
    continue;
  }
  const task = { title, course: String(t.course ?? "Classroom").trim() || "Classroom" };
  if (isDay(t.due)) {
    task.due = t.due;
  }
  seed.homework.push(task);
  have.add(norm(title));
  added.push(title);
}
if (added.length === 0) {
  console.log("Nothing new for the website.");
  process.exit(0);
}
// A new version makes every phone import the new tasks once (see lib/seed.ts).
seed.version = new Date().toISOString().slice(0, 16).replace("T", " ");
fs.writeFileSync(seedFile, `${JSON.stringify(seed, null, 2)}\n`);
console.log(`Added to the website seed: ${added.join(" | ")}`);

if (deploy) {
  execFileSync("npm", ["run", "build:pages"], { cwd: root, stdio: "inherit" });
  execFileSync(
    "bash",
    ["scripts/deploy-pages.sh", `Student hub: Classroom update (${added.length} new)`],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}
