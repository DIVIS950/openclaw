// How a card looks in the wallet: a bright gradient made from its colour, text that
// stays readable on it, and a soft coloured shadow. Very dark or grey shop colours
// (black bakery cards, dark navy banks) are swapped for a bright colour of the
// category, so the wallet stays colourful and never turns black.

/** Bright two-stop gradients per category (light end first). */
const CATEGORY_COLORS = {
  bakery: ["#FFB347", "#FF6B6B"],
  grocery: ["#3DD68C", "#0E9F6E"],
  coffee: ["#E0A16B", "#B5523B"],
  food: ["#FF9966", "#FF5E62"],
  pharmacy: ["#4FD1C5", "#0F9B8E"],
  beauty: ["#FF9AC8", "#E0457B"],
  fashion: ["#B79CFF", "#7B5CFF"],
  sport: ["#6FB1FF", "#3D6BFF"],
  fuel: ["#FFD86B", "#FFA62B"],
  home: ["#FFC27A", "#FF8A3D"],
  electronics: ["#5ED0FF", "#2E8CFF"],
  other: ["#9FA8FF", "#6C63FF"],
};
const GIFT_COLORS = ["#FF9A8B", "#FF5C8A"];

/** Ink used on light cards (warm dark brown, not black). */
export const DARK_INK = "#3B2A14";

/** @param {string} hex */
function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {string} hex @returns {{ h: number, s: number, l: number }} */
export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

/** @returns {string} "#RRGGBB" */
export function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const a = Math.min(1, Math.max(0, s)) * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** Relative luminance (0 black .. 1 white). */
function luminance(hex) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function mix(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `#${x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Colours for one card. Pure, so it can be tested.
 * @param {{ color?: string, category?: string, kind?: string }} card
 * @returns {{ from: string, to: string, ink: string, shadow: string }}
 */
export function cardLook(card) {
  const base = typeof card.color === "string" && /^#[0-9a-f]{6}$/i.test(card.color) ? card.color.toUpperCase() : null;
  const hsl = base ? hexToHsl(base) : null;
  let from;
  let to;
  if (!hsl || hsl.l < 0.2 || (hsl.s < 0.15 && hsl.l < 0.7)) {
    // Black, near-black or grey: use a bright colour that fits the shop.
    [from, to] = card.kind === "gift" ? GIFT_COLORS : (CATEGORY_COLORS[card.category ?? "other"] ?? CATEGORY_COLORS.other);
  } else if (hsl.l > 0.82) {
    // Pale cards (cream, light grey-blue) stay pale with dark text.
    from = hslToHex(hsl.h, hsl.s, Math.min(0.95, hsl.l + 0.06));
    to = base;
  } else {
    // Lift dark brand colours a little and add a light end for the gradient.
    const l = Math.min(0.58, Math.max(hsl.l, 0.36));
    const s = Math.max(hsl.s, 0.55);
    from = hslToHex(hsl.h - 8, s, Math.min(0.76, l + 0.15));
    to = hslToHex(hsl.h + 4, s, l);
  }
  // White text unless the card is light (yellow, cream); white wins ties because a
  // bold name on a bright card reads well with a soft text shadow.
  const ink = luminance(mix(from, to)) > 0.42 ? DARK_INK : "#FFFFFF";
  const [r, g, b] = hexToRgb(to);
  return { from, to, ink, shadow: `rgba(${r}, ${g}, ${b}, 0.35)` };
}

/** CSS variables for an element painted like the card. */
export function lookVars(card) {
  const l = cardLook(card);
  return { "--c1": l.from, "--c2": l.to, "--ci": l.ink, "--cs": l.shadow };
}
