import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The claude.ai page is published as one self-contained HTML file, so its
// build must not split code into extra chunks (the SDK loads a few lazily).
const singleFile = process.env.VITE_WEB_PAGE === "1" && process.env.VITE_PAGES !== "1";
// The website also ships the Tutor Hub as its own page.
const pages = process.env.VITE_PAGES === "1";

/**
 * Website only: the stylesheet and app script go to the end of <body>, so the
 * loading shell inline in the page paints before the 130 KB stylesheet arrives.
 * The script stays after the stylesheet, so the app still never draws unstyled.
 */
const shellFirst = (): Plugin => ({
  name: "shell-first",
  transformIndexHtml: {
    order: "post",
    handler(html) {
      const tags: string[] = [];
      const head = html.replace(
        /\s*<(?:link rel="stylesheet"[^>]*>|script type="module"[^>]*><\/script>)/g,
        (tag) => {
          tags.push(tag.trim());
          return "";
        },
      );
      // Stylesheets first, then scripts.
      tags.sort((a, b) => Number(a.startsWith("<script")) - Number(b.startsWith("<script")));
      // index.html only: the student's locked data downloads alongside the app script.
      const preload = /src="\.\/assets\/main-/.test(html)
        ? '<link rel="preload" href="./private.dat" as="fetch" crossorigin>\n    '
        : "";
      return head.replace("</body>", `    ${preload}${tags.join("\n    ")}\n  </body>`);
    },
  },
});

export default defineConfig({
  // Shown in Apps so it's easy to tell which build a phone has.
  define: {
    __BUILD__: JSON.stringify(
      process.env.BUILD_STAMP ?? new Date().toISOString().slice(0, 16).replace("T", " "),
    ),
  },
  plugins: pages ? [react(), shellFirst()] : [react()],
  server: {
    // In development the API server runs separately (npm run dev starts both).
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: "dist",
    // The one-file claude.ai page carries its fonts inline; the website keeps them as files.
    assetsInlineLimit: singleFile ? Number.MAX_SAFE_INTEGER : 4096,
    rollupOptions: singleFile
      ? { output: { inlineDynamicImports: true } }
      : pages
        ? { input: { main: "index.html", tutor: "tutor.html" } }
        : undefined,
  },
});
