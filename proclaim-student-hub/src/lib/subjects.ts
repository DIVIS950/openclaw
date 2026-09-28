// Every subject gets its own colour and emoji, used on the timetable, homework
// and revision packs so things are easy to spot at a glance.

export interface SubjectLook {
  emoji: string;
  /** Strong colour for stripes, dots and text on white. */
  color: string;
  /** Light tint for card backgrounds. */
  soft: string;
}

const LOOKS: [RegExp, SubjectLook][] = [
  [/art hist/i, { emoji: "🖼️", color: "#c2185b", soft: "#fde4ef" }],
  [/learning cent|library|reading/i, { emoji: "📖", color: "#0f766e", soft: "#d9f2ee" }],
  [
    /comput|\bict\b|\bit\b|information tech|coding/i,
    { emoji: "💻", color: "#334155", soft: "#e5e9f0" },
  ],
  [/math|further|stat/i, { emoji: "📐", color: "#1e63e9", soft: "#e2ecff" }],
  [/bio/i, { emoji: "🧬", color: "#14946b", soft: "#dcf6ec" }],
  [/chem/i, { emoji: "⚗️", color: "#0f8a8a", soft: "#d9f4f4" }],
  [/phys(?!ical)/i, { emoji: "⚡", color: "#5b3fd9", soft: "#e9e4ff" }],
  [/sci/i, { emoji: "🔬", color: "#12a150", soft: "#dcf7e6" }],
  [/hist|dějepis/i, { emoji: "🏰", color: "#b45309", soft: "#fcebd5" }],
  [/geo|zeměpis/i, { emoji: "🌍", color: "#0891b2", soft: "#dcf3fa" }],
  [/span|español/i, { emoji: "💃", color: "#e8590c", soft: "#ffe8d9" }],
  [/czech|češ|česk|cest/i, { emoji: "🦁", color: "#d6336c", soft: "#ffe3ec" }],
  [/french|franç/i, { emoji: "🥐", color: "#3b5bdb", soft: "#e3e9ff" }],
  [/german|deutsch/i, { emoji: "🥨", color: "#b8860b", soft: "#fbf1d6" }],
  [/eng|lit/i, { emoji: "📚", color: "#7c3aed", soft: "#efe5ff" }],
  [/art|design|dt\b/i, { emoji: "🎨", color: "#db2777", soft: "#fde2f0" }],
  [/music/i, { emoji: "🎵", color: "#9333ea", soft: "#f3e5ff" }],
  [/\bp\.?e\b|physical|sport|games|swim/i, { emoji: "⚽", color: "#16a34a", soft: "#dcfce7" }],
  [/drama|theatre/i, { emoji: "🎭", color: "#be123c", soft: "#ffe4e8" }],
  [/\br\.?e\b|relig|ethic|pshe|citizen/i, { emoji: "🕊️", color: "#0d9488", soft: "#d8f5f1" }],
  [/tutor|\bform\b|assembly|registr/i, { emoji: "👋", color: "#64748b", soft: "#eef1f5" }],
];

const FALLBACKS: SubjectLook[] = [
  { emoji: "⭐", color: "#f59f00", soft: "#fff3d6" },
  { emoji: "🚀", color: "#4263eb", soft: "#e4e9ff" },
  { emoji: "🌈", color: "#e64980", soft: "#ffe3ee" },
  { emoji: "🍀", color: "#2f9e44", soft: "#e0f5e3" },
];

export function subjectLook(name: string): SubjectLook {
  const found = LOOKS.find(([re]) => re.test(name));
  if (found) {
    return found[1];
  }
  // Unknown subjects still get a stable colour of their own.
  let h = 0;
  for (const ch of name) {
    h = (h * 31 + ch.charCodeAt(0)) % 997;
  }
  return FALLBACKS[h % FALLBACKS.length];
}

/** CSS custom properties that colour a card for a subject. */
export function subjectVars(name: string): React.CSSProperties {
  const look = subjectLook(name);
  return { "--subject": look.color, "--subject-soft": look.soft } as React.CSSProperties;
}
