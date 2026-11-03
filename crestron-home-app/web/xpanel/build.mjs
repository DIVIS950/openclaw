#!/usr/bin/env node
// Builds Home View as a Crestron HTML5 Web XPanel: a .ch5z file the installer loads onto the
// processor (Crestron Toolbox, or `npx ch5-cli deploy`). The processor then serves the app to
// the iPad's Safari over Wi‑Fi; no home server is needed.
//
//   cd crestron-home-app/web/xpanel
//   npm install
//   npm run build                 # -> dist/HomeView.ch5z  (+ dist/site/ to host anywhere)
//
// Options (environment variables):
//   JOINMAP=path/to/joinmap.json  bake the join map into the package (otherwise it is imported in the app)
//   HOST=192.168.1.20 IPID=0A     bake the processor address and IP ID in (otherwise asked for in the app)
//   NAME=HomeView                 project name (file name of the .ch5z)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const pub = path.join(webRoot, "public");
const dist = path.join(here, "dist");
const site = path.join(dist, "site");
const name = (process.env.NAME ?? "HomeView").replace(/[^A-Za-z0-9_-]/g, "");

const need = (p, what) => { if (!fs.existsSync(p)) throw new Error(`${what} not found at ${p}. Run "npm install" in ${here} first.`); };
const crcomlib = path.join(here, "node_modules/@crestron/ch5-crcomlib/build_bundles/umd/cr-com-lib.js");
const webxpanel = path.join(here, "node_modules/@crestron/ch5-webxpanel/dist/umd");
need(crcomlib, "CrComLib");
need(path.join(webxpanel, "index.js"), "WebXPanel");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });

// The app: the iPad screens, the shared model and the icons. The classic view and the
// manifest for the home-server version are not part of the panel.
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });
copy(path.join(pub, "ipad"), path.join(site, "ipad"));
copy(path.join(pub, "shared"), path.join(site, "shared"));
copy(path.join(pub, "icons.js"), path.join(site, "icons.js"));
for (const f of ["icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"]) copy(path.join(pub, f), path.join(site, f));
fs.rmSync(path.join(site, "ipad", "index.html"));

// Crestron's libraries, as published on npm (CrComLib is Apache-2.0; WebXPanel is Crestron's own
// license, which allows use in CH5 projects; neither is kept in this repository).
fs.mkdirSync(path.join(site, "vendor"), { recursive: true });
copy(crcomlib, path.join(site, "vendor/cr-com-lib.js"));
for (const f of fs.readdirSync(webxpanel)) copy(path.join(webxpanel, f), path.join(site, "vendor", f === "index.js" ? "webxpanel.js" : f));

// Baked-in settings (all optional; the app asks for what is missing).
const config = {};
if (process.env.HOST) config.host = process.env.HOST;
if (process.env.IPID) config.ipId = process.env.IPID;
if (process.env.JOINMAP) {
  const map = JSON.parse(fs.readFileSync(process.env.JOINMAP, "utf8"));
  fs.writeFileSync(path.join(site, "joinmap.json"), JSON.stringify(map, null, 2));
  config.joinMap = "joinmap.json";
}
fs.writeFileSync(path.join(site, "xpanel-config.json"), JSON.stringify(config, null, 2));

// The page. Same as public/ipad/index.html, but the Crestron libraries load first and the
// app starts in Web XPanel mode.
const template = fs.readFileSync(path.join(pub, "ipad", "index.html"), "utf8");
const page = template
  .replace(/href="\.\.\//g, 'href="')
  .replace(/src="\.\.\//g, 'src="')
  .replace('<link rel="manifest" href="manifest.webmanifest">', '<link rel="manifest" href="ipad/manifest.webmanifest">')
  .replace('href="homeview.css"', 'href="ipad/homeview.css"')
  .replace(
    '<script type="module" src="homeview.js"></script>',
    '<meta name="homeview-mode" content="xpanel">\n  <script src="vendor/cr-com-lib.js"></script>\n  <script src="vendor/webxpanel.js"></script>\n  <script type="module" src="ipad/homeview.js"></script>',
  );
if (!page.includes('name="homeview-mode"')) throw new Error("public/ipad/index.html changed; update build.mjs.");
fs.writeFileSync(path.join(site, "index.html"), page);
// The web-app manifest sits next to the app files now; the start URL is the site root.
const manifestPath = path.join(site, "ipad", "manifest.webmanifest");
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  m.start_url = "../"; m.scope = "../";
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
}

// Package with Crestron's own tool, so the processor accepts it.
const cli = path.join(here, "node_modules/.bin/ch5-cli");
execFileSync(cli, ["archive", "-p", name, "-d", site, "-o", dist, "-q"], { stdio: "inherit" });
const out = path.join(dist, `${name}.ch5z`);
need(out, "The .ch5z archive");
console.log(`\nBuilt ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
console.log(`Also usable from any web server: ${site}`);
console.log("Load it on the processor with Crestron Toolbox, or:");
console.log(`  npx ch5-cli deploy -H <processor-ip> -t controlsystem -p ${out}`);
