/**
 * Atlas Browser Design System - Design Tokens
 *
 * Single source of truth for all design token values.
 * CSS custom properties in index.css mirror these values.
 */

// ── Color Tokens ──

export const colors = {
  // Core dark palette
  void: "#050510",
  midnight: "#0A0A1F",
  navy: "#0D1B2A",
  deepBlue: "#1B1464",
  slate: "#1B2838",
  steel: "#2A3A4A",

  // Accent: red / warm
  red: "#E4002B",
  crimson: "#FF0000",
  gold: "#FFD700",
  amber: "#FFAB00",

  // Accent: green
  racingGreen: "#006F62",
  emerald: "#00594C",
  forest: "#2D6A4F",
  britishGreen: "#005C3B",

  // Accent: neon / electric
  lime: "#A6FF00",
  neonGreen: "#CCFF00",
  electric: "#B8FF00",

  // Text
  textPrimary: "#F0F0F5",
  textSecondary: "#8A8FA8",
  textTertiary: "#5A5F78",
  textGhost: "#3A3F58",
} as const;

// ── Gradient Tokens ──

export const gradients = {
  surface: `linear-gradient(135deg, ${colors.midnight} 0%, ${colors.navy} 50%, ${colors.slate} 100%)`,
  accent: `linear-gradient(135deg, ${colors.racingGreen} 0%, ${colors.emerald} 50%, ${colors.lime} 100%)`,
  warm: `linear-gradient(135deg, ${colors.red} 0%, ${colors.crimson} 50%, ${colors.gold} 100%)`,
  neon: `linear-gradient(135deg, ${colors.neonGreen} 0%, ${colors.electric} 50%, ${colors.lime} 100%)`,
  depth: `linear-gradient(180deg, ${colors.void} 0%, ${colors.midnight} 40%, ${colors.navy} 100%)`,
} as const;

// ── Glow Tokens ──

export const glows = {
  green: "0 0 12px rgba(166, 255, 0, 0.35), 0 0 24px rgba(166, 255, 0, 0.15)",
  red: "0 0 12px rgba(228, 0, 43, 0.35), 0 0 24px rgba(228, 0, 43, 0.15)",
  gold: "0 0 12px rgba(255, 215, 0, 0.35), 0 0 24px rgba(255, 215, 0, 0.15)",
  neon: "0 0 12px rgba(204, 255, 0, 0.4), 0 0 24px rgba(184, 255, 0, 0.2)",
  ambient:
    "0 0 40px rgba(27, 20, 100, 0.3), 0 0 80px rgba(13, 27, 42, 0.2)",
} as const;

// ── Shadow Tokens ──

export const shadows = {
  sm: "0 1px 2px rgba(5, 5, 16, 0.4)",
  md: "0 4px 12px rgba(5, 5, 16, 0.5), 0 1px 3px rgba(5, 5, 16, 0.3)",
  lg: "0 8px 24px rgba(5, 5, 16, 0.6), 0 2px 8px rgba(5, 5, 16, 0.4)",
  xl: "0 16px 48px rgba(5, 5, 16, 0.7), 0 4px 16px rgba(5, 5, 16, 0.5)",
  inset: "inset 0 1px 4px rgba(5, 5, 16, 0.5)",
} as const;

// ── Glass Tokens ──

export const glass = {
  bg: "rgba(10, 10, 31, 0.6)",
  border: "rgba(138, 143, 168, 0.12)",
  blur: "16px",
  bgHeavy: "rgba(10, 10, 31, 0.8)",
  bgLight: "rgba(10, 10, 31, 0.35)",
} as const;

// ── Spacing Tokens ──

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  "2xl": "48px",
  "3xl": "64px",
} as const;

/** Spacing values as raw numbers (pixels) for JS layout math. */
export const spacingPx = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
} as const;

// ── Radius Tokens ──

export const radii = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  "2xl": "24px",
  full: "9999px",
} as const;

// ── Typography Tokens ──

export const fontFamily = {
  sans: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", monospace',
} as const;

export const fontSize = {
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
} as const;

export const lineHeight = {
  tight: "1.25",
  normal: "1.5",
  relaxed: "1.75",
} as const;

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

// ── Transition Tokens ──

export const transitions = {
  fast: "120ms ease-out",
  normal: "200ms ease-out",
  slow: "350ms ease-out",
} as const;

// ── Aggregate Export ──

export const tokens = {
  colors,
  gradients,
  glows,
  shadows,
  glass,
  spacing,
  spacingPx,
  radii,
  fontFamily,
  fontSize,
  lineHeight,
  fontWeight,
  transitions,
} as const;

export type AtlasTokens = typeof tokens;
