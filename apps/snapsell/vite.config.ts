import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

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
  standalone: {
    // Relative asset paths so it works under https://<user>.github.io/<repo>/.
    base: "./",
    build: { target: "es2022", outDir: "dist-standalone" },
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
