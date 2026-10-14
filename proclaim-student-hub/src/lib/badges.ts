import type { IconName } from "../components/Icon.tsx";
import { level, progress, totals, type Progress, type Totals } from "./store.ts";

// Levels & badges: XP comes from homework, revision, focus, to-dos, packing the
// bag and finishing the evening plan. Badges are earned from all-time totals,
// so they never disappear; each is announced once.

export interface Badge {
  id: string;
  name: string;
  detail: string;
  icon: IconName;
  tone: "orange" | "pink" | "violet" | "blue" | "green" | "yellow";
  /** How far along (current, goal). */
  count: (t: Totals, p: Progress) => number;
  goal: number;
}

const lvl = (_t: Totals, p: Progress) => level(p.xp).level;

export const BADGES: Badge[] = [
  {
    id: "hw1",
    name: "First tick",
    detail: "Tick off a homework",
    icon: "check",
    tone: "green",
    count: (t) => t.hw ?? 0,
    goal: 1,
  },
  {
    id: "hw10",
    name: "On it",
    detail: "10 homework done",
    icon: "checkSquare",
    tone: "green",
    count: (t) => t.hw ?? 0,
    goal: 10,
  },
  {
    id: "hw50",
    name: "Homework hero",
    detail: "50 homework done",
    icon: "cap",
    tone: "green",
    count: (t) => t.hw ?? 0,
    goal: 50,
  },
  {
    id: "streak3",
    name: "Warming up",
    detail: "3 days in a row",
    icon: "flame",
    tone: "orange",
    count: (t, p) => Math.max(t.best ?? 0, p.streak),
    goal: 3,
  },
  {
    id: "streak7",
    name: "Week streak",
    detail: "7 days in a row",
    icon: "flame",
    tone: "orange",
    count: (t, p) => Math.max(t.best ?? 0, p.streak),
    goal: 7,
  },
  {
    id: "streak30",
    name: "Unstoppable",
    detail: "30 days in a row",
    icon: "flame",
    tone: "pink",
    count: (t, p) => Math.max(t.best ?? 0, p.streak),
    goal: 30,
  },
  {
    id: "lab50",
    name: "Card shark",
    detail: "Practise 50 revision cards",
    icon: "flask",
    tone: "violet",
    count: (t) => t.lab ?? 0,
    goal: 50,
  },
  {
    id: "lab500",
    name: "Memory machine",
    detail: "Practise 500 revision cards",
    icon: "brain",
    tone: "violet",
    count: (t) => t.lab ?? 0,
    goal: 500,
  },
  {
    id: "focus5",
    name: "In the zone",
    detail: "2 hours of focus",
    icon: "timer",
    tone: "blue",
    count: (t) => t.focus ?? 0,
    goal: 120,
  },
  {
    id: "focus25",
    name: "Deep worker",
    detail: "10 hours of focus",
    icon: "timer",
    tone: "blue",
    count: (t) => t.focus ?? 0,
    goal: 600,
  },
  {
    id: "bag3",
    name: "Never forgets",
    detail: "Pack your bag 3 nights",
    icon: "bag",
    tone: "yellow",
    count: (t) => t.bag ?? 0,
    goal: 3,
  },
  {
    id: "plan3",
    name: "Planner",
    detail: "Finish 3 evening plans",
    icon: "calendar",
    tone: "blue",
    count: (t) => t.plan ?? 0,
    goal: 3,
  },
  {
    id: "todo20",
    name: "List crusher",
    detail: "Tick 20 to-dos",
    icon: "list",
    tone: "green",
    count: (t) => t.todo ?? 0,
    goal: 20,
  },
  {
    id: "lvl5",
    name: "Scholar",
    detail: "Reach level 5",
    icon: "star",
    tone: "yellow",
    count: lvl,
    goal: 5,
  },
  {
    id: "lvl10",
    name: "Ace",
    detail: "Reach level 10",
    icon: "trophy",
    tone: "pink",
    count: lvl,
    goal: 10,
  },
];

/** A name for each stage, so a level means something. */
export function levelTitle(n: number): string {
  if (n >= 15) {
    return "Legend";
  }
  if (n >= 10) {
    return "Ace";
  }
  if (n >= 7) {
    return "Expert";
  }
  if (n >= 5) {
    return "Scholar";
  }
  if (n >= 3) {
    return "Explorer";
  }
  return "Rookie";
}

export interface BadgeState {
  badge: Badge;
  have: number;
  earned: boolean;
  /** Day it was earned (YYYY-MM-DD), when it was. */
  on: string;
}

const KEY = "psh.badges";

function readEarned(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function badgeStates(t: Totals = totals.get(), p: Progress = progress.get()): BadgeState[] {
  const earned = readEarned();
  return BADGES.map((badge) => {
    const have = badge.count(t, p);
    return {
      badge,
      have: Math.min(have, badge.goal),
      earned: have >= badge.goal,
      on: typeof earned[badge.id] === "string" ? earned[badge.id] : "",
    };
  });
}

/**
 * Badges reached since the last check, remembered so each is announced once.
 * The first check after the feature arrives records what was already earned
 * quietly, so nobody gets a pile of old badges at once.
 */
export function newBadges(today: string): Badge[] {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  const earned = readEarned();
  const fresh = badgeStates().filter((s) => s.earned && !earned[s.badge.id]);
  if (fresh.length === 0) {
    return [];
  }
  for (const s of fresh) {
    earned[s.badge.id] = today;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(earned));
  } catch {
    // Not remembered: it may be announced again next time.
  }
  return saved === null ? [] : fresh.map((s) => s.badge);
}
