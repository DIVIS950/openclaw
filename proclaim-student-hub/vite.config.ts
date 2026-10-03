import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The claude.ai page is published as one self-contained HTML file, so its
// build must not split code into extra chunks (the SDK loads a few lazily).
const singleFile = process.env.VITE_WEB_PAGE === "1" && process.env.VITE_PAGES !== "1";
// The website also ships the Tutor Hub as its own page.
const pages = process.env.VITE_PAGES === "1";

export default defineConfig({
  // Shown in Apps so it's easy to tell which build a phone has.
  define: {
    __BUILD__: JSON.stringify(
      process.env.BUILD_STAMP ?? new Date().toISOString().slice(0, 16).replace("T", " "),
    ),
  },
  plugins: [react()],
  server: {
    // In development the API server runs separately (npm run dev starts both).
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: "dist",
    rollupOptions: singleFile
      ? { output: { inlineDynamicImports: true } }
      : pages
        ? { input: { main: "index.html", tutor: "tutor.html" } }
        : undefined,
  },
});
