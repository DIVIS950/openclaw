import type { UserCap } from "../lib/claudeRuntime.ts";
import type { Sample } from "../lib/claudeRuntime.ts";
import { isClaudeKey } from "./aiKind.ts";
import { geminiSample } from "./gemini.ts";
import { localDb } from "./localDb.ts";

// The GitHub Pages version has no claude.ai around it, so it provides the same
// `window.claude.use(...)` the app already talks to: AI through Claude (a
// Claude API key) or Gemini (a Gemini key), saving on the phone. Gmail and Canva stay on the claude.ai link.

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

/** The AI key added in More › Claude AI key; kept only on this phone. */
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

/**
 * Claude via the official SDK, loaded only the first time the AI is used so
 * the SDK stays out of the first download.
 */
let claudeLoad: Promise<Sample> | null = null;
const claudeLazy = (): Promise<Sample> => {
  claudeLoad ??= import("./claude.ts")
    .then((m) => m.claudeSample(aiKey.get))
    .catch((err: unknown) => {
      // Offline or a stale deploy: try again next time instead of failing for good.
      claudeLoad = null;
      throw err;
    });
  return claudeLoad;
};

/** Picks Claude or Gemini by the kind of key added, each time it's asked. */
function pickSample(): Sample {
  const gemini = geminiSample(aiKey.get);
  const which = async (): Promise<Sample> =>
    isClaudeKey((await aiKey.get()) ?? "") ? claudeLazy() : gemini;
  const sample = (async (input, options) => (await which())(input, options)) as Sample;
  sample.json = async (input, options) => (await which()).json(input, options);
  sample.limits = async () => (await which()).limits();
  return sample;
}

export function installPagesRuntime() {
  const caps = { sample: pickSample(), db: localDb, user } as Record<string, unknown>;
  (window as unknown as { claude: unknown }).claude = {
    use: async (name: string) => caps[name] ?? null,
  };
}

/** How many homework items the last import brought (null when none happened). */
export const pagesImport: { added: number | null } = { added: null };
