/**
 * Atlas Browser Design System - Theme Provider
 *
 * React context-based theme provider. Dark theme is the default (and
 * primary) theme; the architecture supports adding alternative themes
 * later without breaking consumers.
 */

import { createContext, useContext, useState, useCallback, createElement, type ReactNode } from "react";
import { tokens, type AtlasTokens } from "./tokens";

// ── Theme Definitions ──

export type ThemeMode = "dark";

export interface AtlasTheme {
  mode: ThemeMode;
  tokens: AtlasTokens;
}

const darkTheme: AtlasTheme = {
  mode: "dark",
  tokens,
};

const themes: Record<ThemeMode, AtlasTheme> = {
  dark: darkTheme,
};

// ── Context ──

interface ThemeContextValue {
  theme: AtlasTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ──

export interface ThemeProviderProps {
  defaultMode?: ThemeMode;
  children: ReactNode;
}

export function ThemeProvider({ defaultMode = "dark", children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(defaultMode);

  const setMode = useCallback((next: ThemeMode) => {
    if (themes[next]) {
      setModeState(next);
    }
  }, []);

  const value: ThemeContextValue = {
    theme: themes[mode],
    mode,
    setMode,
  };

  return createElement(ThemeContext.Provider, { value }, children);
}

// ── Hook ──

export function useAtlasTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useAtlasTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}

/**
 * Shorthand: returns the token bag directly for quick destructuring.
 *
 * @example
 * const { colors, spacing } = useTokens();
 */
export function useTokens(): AtlasTokens {
  return useAtlasTheme().theme.tokens;
}
