// Every subject gets its own colour and emoji, used on the timetable, homework
// and revision packs so things are easy to spot at a glance.

export interface SubjectLook {
  emoji: string;
  /** Strong colour for stripes, dots and text on white. */
  color: string;
  /** Light tint for card backgrounds. */
  soft: string;
  /** Neon version for the timetable stripes and glow. */
  neon: string;
}

const LOOKS: [RegExp, SubjectLook][] = [
  [/art hist/i, { emoji: "🖼️", color: "#c2185b", soft: "#fde4ef", neon: "#ff2ec4" }],
  [
    /learning cent|library|reading/i,
    { emoji: "📖", color: "#0f766e", soft: "#d9f2ee", neon: "#00e5c3" },
  ],
  [
    /comput|\bict\b|\bit\b|information tech|coding/i,
    { emoji: "💻", color: "#334155", soft: "#e5e9f0", neon: "#00d4ff" },
  ],
  [/math|further|stat/i, { emoji: "📐", color: "#1e63e9", soft: "#e2ecff", neon: "#00a3ff" }],
  [/bio/i, { emoji: "🧬", color: "#14946b", soft: "#dcf6ec", neon: "#00ff88" }],
  [/chem/i, { emoji: "⚗️", color: "#0f8a8a", soft: "#d9f4f4", neon: "#00e5e5" }],
  [/phys(?!ical)/i, { emoji: "⚡", color: "#5b3fd9", soft: "#e9e4ff", neon: "#8a3dff" }],
  [/sci/i, { emoji: "🔬", color: "#12a150", soft: "#dcf7e6", neon: "#22ff77" }],
  [/hist|dějepis/i, { emoji: "🏰", color: "#b45309", soft: "#fcebd5", neon: "#ff8c00" }],
  [/geo|zeměpis/i, { emoji: "🌍", color: "#0891b2", soft: "#dcf3fa", neon: "#00d0ff" }],
  [/span|español/i, { emoji: "💃", color: "#e8590c", soft: "#ffe8d9", neon: "#ff5a00" }],
  [/czech|češ|česk|cest/i, { emoji: "🦁", color: "#d6336c", soft: "#ffe3ec", neon: "#ff2e7a" }],
  [/french|franç/i, { emoji: "🥐", color: "#3b5bdb", soft: "#e3e9ff", neon: "#4d6bff" }],
  [/german|deutsch/i, { emoji: "🥨", color: "#b8860b", soft: "#fbf1d6", neon: "#ffd400" }],
  [/eng|lit/i, { emoji: "📚", color: "#7c3aed", soft: "#efe5ff", neon: "#b026ff" }],
  [/art|design|dt\b/i, { emoji: "🎨", color: "#db2777", soft: "#fde2f0", neon: "#ff2ec4" }],
  [/music/i, { emoji: "🎵", color: "#9333ea", soft: "#f3e5ff", neon: "#c13dff" }],
  [
    /\bp\.?e\b|physical|sport|games|swim/i,
    { emoji: "⚽", color: "#16a34a", soft: "#dcfce7", neon: "#39ff14" },
  ],
  [/drama|theatre/i, { emoji: "🎭", color: "#be123c", soft: "#ffe4e8", neon: "#ff0044" }],
  [
    /\br\.?e\b|relig|ethic|pshe|citizen/i,
    { emoji: "🕊️", color: "#0d9488", soft: "#d8f5f1", neon: "#00e0b0" },
  ],
  [
    /tutor|\bform\b|assembly|registr/i,
    { emoji: "👋", color: "#64748b", soft: "#eef1f5", neon: "#9aa4ff" },
  ],
];

const FALLBACKS: SubjectLook[] = [
  { emoji: "⭐", color: "#f59f00", soft: "#fff3d6", neon: "#ffe600" },
  { emoji: "🚀", color: "#4263eb", soft: "#e4e9ff", neon: "#4d6bff" },
  { emoji: "🌈", color: "#e64980", soft: "#ffe3ee", neon: "#ff2ec4" },
  { emoji: "🍀", color: "#2f9e44", soft: "#e0f5e3", neon: "#39ff14" },
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
  return {
    "--subject": look.color,
    "--subject-soft": look.soft,
    "--neon": look.neon,
  } as React.CSSProperties;
}
