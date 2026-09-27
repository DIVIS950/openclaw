// Builds a single self-contained HTML page of the demo (no server needed).
// Usage: node static/build.mjs  ->  static/dist/orbit.html
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "static/dist");
mkdirSync(out, { recursive: true });

const shims = {
  "next/link": "static/shims/link.tsx",
  "next/navigation": "static/shims/navigation.ts",
  "@/app/actions": "static/shims/actions.ts",
};

const result = await esbuild.build({
  entryPoints: [path.join(root, "static/entry.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  write: false,
  logLevel: "warning",
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_ORBIT_STATIC": '"1"',
  },
  plugins: [
    {
      name: "orbit-static",
      setup(build) {
        build.onResolve({ filter: /^(next\/link|next\/navigation|@\/app\/actions)$/ }, (a) => ({ path: path.join(root, shims[a.path]) }));
      },
    },
  ],
});
// Keep an inline script from closing its own tag early.
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const cssFile = path.join(out, "app.css");
execFileSync("npx", ["@tailwindcss/cli", "-i", "src/app/globals.css", "-o", cssFile, "--minify"], { cwd: root, stdio: "inherit" });
const css = readFileSync(cssFile, "utf8");

const html = `<title>Orbit</title>
<meta name="description" content="Shop everything, safely: compare shops, dodge scams, track parcels.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap">
<style>:root{--font-inter:"Inter";--font-serif-display:"Source Serif 4"}${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
writeFileSync(path.join(out, "orbit.html"), html);
console.log(`static/dist/orbit.html ${(html.length / 1024).toFixed(0)} KB`);
