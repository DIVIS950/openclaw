import type { UserCap } from "../lib/claudeRuntime.ts";
import { geminiSample } from "./gemini.ts";
import { localDb } from "./localDb.ts";

// The GitHub Pages version has no claude.ai around it, so it provides the same
// `window.claude.use(...)` the app already talks to: AI through Gemini, saving
// on the phone. Gmail and Canva stay on the claude.ai link.

export const PAGES = import.meta.env.VITE_PAGES === "1";

const KEY = "psh.ai.key";
const NAME = "psh.name";

function get(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function set(key: string, value: string) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Not remembered.
  }
}

/** The Gemini key added in Apps › AI key; kept only on this phone. */
export const aiKey = {
  get: async (): Promise<string | null> => get(KEY) || null,
  set: (key: string) => set(KEY, key.trim()),
};

export const studentName = {
  get: () => get(NAME),
  set: (name: string) => set(NAME, name.trim()),
};

const user: UserCap = {
  id: async () => "me",
  me: async () => ({ name: studentName.get(), email: null }),
};

export function installPagesRuntime() {
  const caps = { sample: geminiSample(aiKey.get), db: localDb, user } as Record<string, unknown>;
  (window as unknown as { claude: unknown }).claude = {
    use: async (name: string) => caps[name] ?? null,
  };
}

/** How many homework items the last import brought (null when none happened). */
export const pagesImport: { added: number | null } = { added: null };
