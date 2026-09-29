import { canSpeak, say, unlockSpeech } from "../lib/voice.ts";
import type { Item, LabPack, Subject } from "./model.ts";

// Pronunciation for language packs: the foreign word is read in its own
// language (Spanish or Czech voice), so the student hears how it sounds.

const LANG: Partial<Record<Subject, string>> = { Spanish: "es-ES", Czech: "cs-CZ" };

export function speechLang(subject: Subject): string | null {
  return LANG[subject] ?? null;
}

/** Items that have a foreign word to hear: vocabulary terms in Spanish or Czech. */
export function hearable(item: Item, subject: Subject): boolean {
  return Boolean(speechLang(subject)) && item.kind === "term" && item.prompt.length <= 80;
}

export function canHear(pack: Pick<LabPack, "subject" | "items">): boolean {
  return canSpeak() && pack.items.some((i) => hearable(i, pack.subject));
}

/** Says the foreign word (the item's prompt) in its language. */
export function hear(item: Item, subject: Subject): Promise<void> {
  const lang = speechLang(subject);
  if (!lang) {
    return Promise.resolve();
  }
  unlockSpeech();
  return say(item.prompt, lang);
}

// ---------- Daily goal ----------

const DAILY_KEY = "psh.lab.daily";
export const DAILY_GOAL = 20;

export interface Daily {
  date: string;
  count: number;
}

export const daily = {
  get(today: string): Daily {
    try {
      const d = JSON.parse(localStorage.getItem(DAILY_KEY) ?? "null") as Daily | null;
      return d && d.date === today ? d : { date: today, count: 0 };
    } catch {
      return { date: today, count: 0 };
    }
  },
  add(today: string, n: number): Daily {
    const next = { date: today, count: daily.get(today).count + n };
    try {
      localStorage.setItem(DAILY_KEY, JSON.stringify(next));
    } catch {
      // Not remembered.
    }
    return next;
  },
};
