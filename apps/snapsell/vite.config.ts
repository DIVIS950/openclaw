import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { transformSync } from "esbuild";
import { defineConfig, type Plugin, type UserConfig } from "vite";

/**
 * `virtual:vinted-bookmarklet`: the Vinted bot (public/snapsell-vinted.user.js) minified into a
 * `javascript:` bookmark, for iPhones without the Userscripts app.
 */
function vintedBookmarklet(): Plugin {
  const id = "virtual:vinted-bookmarklet";
  return {
    name: "vinted-bookmarklet",
    resolveId: (s) => (s === id ? `\0${id}` : null),
    load(s) {
      if (s !== `\0${id}`) return null;
      const src = fs.readFileSync(path.resolve("public/snapsell-vinted.user.js"), "utf8");
      this.addWatchFile(path.resolve("public/snapsell-vinted.user.js"));
      const { code } = transformSync(`window.__snapsellBookmark=true;${src}`, { minify: true, target: "es2020" });
      return `export default ${JSON.stringify(`javascript:${encodeURIComponent(code.trim())}`)};`;
    },
  };
}

/**
 * Build modes:
 * - default: the app served by SnapSell's server (npm run build)
 * - preview: static web preview with sample data, one inlinable bundle (npm run build:preview)
 * - standalone: SnapSell without a server for GitHub Pages; data stays on the device (npm run build:standalone)
 */
const MODES: Record<string, UserConfig> = {
  preview: {
    base: "./",
    // One JS file and one CSS file, so the preview page can inline both. No 24 MB cut-out model.
    build: { target: "es2022", outDir: "dist-preview", cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
    resolve: { alias: { "@imgly/background-removal": path.resolve("src/preview/bg-removal-stub.ts") } },
  },
  hosted: {
    // Claude page: one inlinable bundle like the preview; the cut-out model can't be downloaded there.
    base: "./",
    build: { target: "es2022", outDir: "dist-hosted", cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
    resolve: { alias: { "@imgly/background-removal": path.resolve("src/preview/bg-removal-stub.ts") } },
  },
  standalone: {
    // Relative asset paths so it works under https://<user>.github.io/<repo>/.
    base: "./",
    build: { target: "es2022", outDir: "dist-standalone" },
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), vintedBookmarklet()],
  server: {
    host: true,
    port: 5173,
    proxy: Object.fromEntries(["/api", "/photos", "/auth", "/p/"].map((p) => [p, "http://localhost:8787"])),
  },
  // Background removal ships its own WASM/ONNX workers; keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ["@imgly/background-removal"] },
  build: { target: "es2022" },
  ...MODES[mode],
}));
