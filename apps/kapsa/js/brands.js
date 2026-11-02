// Shop categories and well-known chains (names and colours only, no logos).
// Colours are close to each chain's own colour so the card is easy to spot.

export const CATEGORIES = [
  { id: "bakery", icon: "croissant" },
  { id: "grocery", icon: "shopping-basket" },
  { id: "coffee", icon: "coffee" },
  { id: "food", icon: "utensils" },
  { id: "pharmacy", icon: "pill" },
  { id: "beauty", icon: "sparkles" },
  { id: "fashion", icon: "shirt" },
  { id: "sport", icon: "dumbbell" },
  { id: "fuel", icon: "fuel" },
  { id: "home", icon: "hammer" },
  { id: "electronics", icon: "plug" },
  { id: "other", icon: "tag" },
];

/** @param {string} id */
export function categoryIcon(id) {
  return CATEGORIES.find((c) => c.id === id)?.icon ?? "tag";
}

/** Colour swatches offered for cards without a known brand. */
export const SWATCHES = [
  "#1F2430",
  "#7A4A2B",
  "#C8102E",
  "#E8590C",
  "#F2C200",
  "#2F9E44",
  "#0B7A75",
  "#1C7ED6",
  "#2B44D6",
  "#6741D9",
  "#C2255C",
  "#E6E1D6",
];

/**
 * @typedef {{ name: string, color: string, category: string, aliases?: string[] }} Brand
 * @type {Brand[]}
 */
export const BRANDS = [
  { name: "Bageterie Boulevard", color: "#1E1E1E", category: "bakery" },
  { name: "Paul", color: "#2B2A29", category: "bakery" },
  { name: "Ugo", color: "#E4007C", category: "food", aliases: ["Ugo Fresh"] },
  { name: "Albert", color: "#003C8F", category: "grocery", aliases: ["Albert Supermarket", "Albert Hypermarket"] },
  { name: "Billa", color: "#FFE500", category: "grocery" },
  { name: "Lidl", color: "#0050AA", category: "grocery" },
  { name: "Kaufland", color: "#E10915", category: "grocery" },
  { name: "Tesco", color: "#00539F", category: "grocery", aliases: ["Tesco Express", "Tesco Extra"] },
  { name: "Penny", color: "#CD1414", category: "grocery", aliases: ["Penny Market"] },
  { name: "Globus", color: "#007A3D", category: "grocery" },
  { name: "Coop", color: "#00843D", category: "grocery", aliases: ["COOP Tuty", "COOP Jednota"] },
  { name: "Žabka", color: "#2C8B39", category: "grocery" },
  { name: "Rohlik", color: "#5BA829", category: "grocery", aliases: ["Rohlík"] },
  { name: "Starbucks", color: "#00704A", category: "coffee" },
  { name: "Costa Coffee", color: "#6D1F37", category: "coffee" },
  { name: "Café Café", color: "#3B2418", category: "coffee", aliases: ["Cafe Cafe"] },
  { name: "McDonald's", color: "#DA291C", category: "food" },
  { name: "KFC", color: "#A3080C", category: "food" },
  { name: "Burger King", color: "#D62300", category: "food" },
  { name: "dm", color: "#1D3A8A", category: "beauty", aliases: ["dm drogerie markt"] },
  { name: "Rossmann", color: "#C3002F", category: "beauty" },
  { name: "Teta", color: "#E2007A", category: "beauty", aliases: ["Teta drogerie"] },
  { name: "Notino", color: "#111111", category: "beauty" },
  { name: "Sephora", color: "#101010", category: "beauty" },
  { name: "Douglas", color: "#9BDCD2", category: "beauty" },
  { name: "Dr.Max", color: "#00315F", category: "pharmacy", aliases: ["Dr. Max", "Lékárna Dr.Max"] },
  { name: "Benu", color: "#00A651", category: "pharmacy", aliases: ["BENU Lékárna", "Lékárna BENU"] },
  { name: "Pilulka", color: "#E5007D", category: "pharmacy" },
  { name: "H&M", color: "#E50010", category: "fashion" },
  { name: "Reserved", color: "#1A1A1A", category: "fashion" },
  { name: "Pepco", color: "#0047BB", category: "fashion" },
  { name: "Deichmann", color: "#00843D", category: "fashion" },
  { name: "CCC", color: "#B4121B", category: "fashion" },
  { name: "Tchibo", color: "#1D2C4C", category: "home" },
  { name: "Decathlon", color: "#0082C3", category: "sport" },
  { name: "Sportisimo", color: "#E30613", category: "sport" },
  { name: "Hervis", color: "#D4001A", category: "sport" },
  { name: "IKEA", color: "#0058A3", category: "home" },
  { name: "Hornbach", color: "#F7931E", category: "home" },
  { name: "OBI", color: "#FF7E21", category: "home" },
  { name: "Bauhaus", color: "#DA2128", category: "home" },
  { name: "JYSK", color: "#143C8A", category: "home" },
  { name: "Action", color: "#004B93", category: "home" },
  { name: "Datart", color: "#E2001A", category: "electronics" },
  { name: "Alza", color: "#21A9E1", category: "electronics", aliases: ["AlzaBox", "Alza.cz"] },
  { name: "Electro World", color: "#00A0E3", category: "electronics" },
  { name: "Shell", color: "#FFD500", category: "fuel" },
  { name: "OMV", color: "#0A3C78", category: "fuel" },
  { name: "MOL", color: "#E30613", category: "fuel" },
  { name: "Orlen", color: "#E3000F", category: "fuel", aliases: ["Benzina", "Benzina Orlen"] },
  { name: "Lukoil", color: "#D7001E", category: "fuel" },
];

/**
 * Lowercase, strip accents and punctuation: "Lékárna Dr.Max" -> "lekarna dr max".
 * @param {string} value
 */
export function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Find the brand a typed name refers to (exact name or alias).
 * @param {string} name
 */
export function findBrand(name) {
  const n = normalizeName(name);
  if (!n) {
    return null;
  }
  return (
    BRANDS.find((b) => [b.name, ...(b.aliases ?? [])].some((alias) => normalizeName(alias) === n)) ?? null
  );
}

/**
 * Brands whose name starts with what the user typed, best matches first.
 * @param {string} query
 * @param {number} limit
 */
export function suggestBrands(query, limit = 6) {
  const q = normalizeName(query);
  if (!q) {
    return [];
  }
  const scored = [];
  for (const brand of BRANDS) {
    const names = [brand.name, ...(brand.aliases ?? [])].map(normalizeName);
    if (names.some((n) => n === q)) {
      continue;
    }
    if (names.some((n) => n.startsWith(q))) {
      scored.push({ brand, score: 0 });
    } else if (names.some((n) => n.split(" ").some((word) => word.startsWith(q)))) {
      scored.push({ brand, score: 1 });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.brand.name.localeCompare(b.brand.name));
  return scored.slice(0, limit).map((s) => s.brand);
}

/**
 * True when a shop name from the map belongs to the card's shop: every word of the
 * card name starts the matching word of the shop name, in order.
 * "Albert" matches "Albert Supermarket"; "dm" matches "dm drogerie markt" but not "Admiral".
 * @param {string} cardName
 * @param {string} shopName
 */
export function shopMatches(cardName, shopName) {
  const card = normalizeName(cardName).split(" ").filter(Boolean);
  const shop = normalizeName(shopName).split(" ").filter(Boolean);
  if (!card.length || card.length > shop.length) {
    return false;
  }
  for (let start = 0; start + card.length <= shop.length; start++) {
    if (card.every((word, i) => (i === card.length - 1 ? shop[start + i].startsWith(word) : shop[start + i] === word))) {
      // Short names ("dm", "OMV") must match a whole word to avoid false positives.
      const last = card.at(-1);
      if (last.length <= 3 && shop[start + card.length - 1] !== last) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Names to look for on the map for a card: its own name plus brand aliases.
 * @param {{ name: string }} card
 */
export function searchNamesFor(card) {
  const brand = findBrand(card.name);
  const names = [card.name, ...(brand ? [brand.name, ...(brand.aliases ?? [])] : [])];
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}

/**
 * Pick black or white text for a background colour.
 * @param {string} hex
 */
export function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return "#FFFFFF";
  }
  const n = Number.parseInt(m[1], 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  // Contrast against white vs. near-black ink; pick the larger.
  const vsWhite = 1.05 / (lum + 0.05);
  const vsBlack = (lum + 0.05) / (0.012 + 0.05);
  return vsWhite >= vsBlack ? "#FFFFFF" : "#14161A";
}
