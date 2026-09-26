import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API server runs separately (npm run dev starts both).
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { outDir: "dist" },
});
