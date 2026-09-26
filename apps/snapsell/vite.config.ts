import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  ...(mode === "preview"
    ? {
        // Static web preview: relative asset paths, no 24 MB cut-out model.
        base: "./",
        // One JS file and one CSS file, so the page can inline both.
        build: { target: "es2022", outDir: "dist-preview", cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
        resolve: { alias: { "@imgly/background-removal": path.resolve("src/preview/bg-removal-stub.ts") } },
      }
    : {}),
}));
