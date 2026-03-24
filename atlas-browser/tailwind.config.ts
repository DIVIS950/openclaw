import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        atlas: {
          bg: "#050510",
          surface: "#0a0a1a",
          "surface-light": "#111128",
          border: "#1a1a3e",
          "border-light": "#2a2a5e",
          primary: "#6366f1",
          "primary-light": "#818cf8",
          "primary-dark": "#4f46e5",
          secondary: "#8b5cf6",
          "secondary-light": "#a78bfa",
          accent: "#06b6d4",
          "accent-light": "#22d3ee",
          success: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          text: "#e2e8f0",
          "text-muted": "#94a3b8",
          "text-dim": "#64748b",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(99, 102, 241, 0.15)",
        "glow-lg": "0 0 40px rgba(99, 102, 241, 0.2)",
      },
    },
  },
  plugins: [],
} satisfies Config;
