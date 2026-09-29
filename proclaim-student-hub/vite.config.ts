import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The claude.ai page is published as one self-contained HTML file, so its
// build must not split code into extra chunks (the SDK loads a few lazily).
const singleFile = process.env.VITE_WEB_PAGE === "1" && process.env.VITE_PAGES !== "1";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API server runs separately (npm run dev starts both).
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: "dist",
    rollupOptions: singleFile ? { output: { inlineDynamicImports: true } } : undefined,
  },
});
