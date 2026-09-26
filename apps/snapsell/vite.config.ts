import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: Object.fromEntries(["/api", "/photos", "/auth", "/p/"].map((p) => [p, "http://localhost:8787"])),
  },
  // Background removal ships its own WASM/ONNX workers; keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ["@imgly/background-removal"] },
});
