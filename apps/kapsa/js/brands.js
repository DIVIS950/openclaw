// Shop categories and well-known chains: name, colour and website (the logo is the
// website's icon, loaded only when the person allows it in Settings).

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
  "#FF6B6B",
  "#FF9F43",
  "#FFC93C",
  "#2FCB86",
  "#14B8A6",
  "#3D9BFF",
  "#3D6BFF",
  "#7B5CFF",
  "#C04DE0",
  "#E0457B",
  "#C9875A",
  "#E6E1D6",
];

/**
 * @typedef {{ name: string, domain: string, color: string, category: string, aliases?: string[] }} Brand
 * @type {Brand[]}
 */
export const BRANDS = [
  { name: "Bageterie Boulevard", domain: "bb.cz", color: "#1E1E1E", category: "bakery" },
  { name: "Paul", domain: "paul.fr", color: "#2B2A29", category: "bakery" },
  { name: "Ugo", domain: "ugo.cz", color: "#E4007C", category: "food", aliases: ["Ugo Fresh"] },
  { name: "Albert", domain: "albert.cz", color: "#003C8F", category: "grocery", aliases: ["Albert Supermarket", "Albert Hypermarket"] },
  { name: "Billa", domain: "billa.cz", color: "#FFE500", category: "grocery" },
  { name: "Lidl", domain: "lidl.cz", color: "#0050AA", category: "grocery" },
  { name: "Kaufland", domain: "kaufland.cz", color: "#E10915", category: "grocery" },
  { name: "Tesco", domain: "itesco.cz", color: "#00539F", category: "grocery", aliases: ["Tesco Express", "Tesco Extra"] },
  { name: "Penny", domain: "penny.cz", color: "#CD1414", category: "grocery", aliases: ["Penny Market"] },
  { name: "Globus", domain: "globus.cz", color: "#007A3D", category: "grocery" },
  { name: "Coop", domain: "coop.cz", color: "#00843D", category: "grocery", aliases: ["COOP Tuty", "COOP Jednota"] },
  { name: "Žabka", domain: "zabka.cz", color: "#2C8B39", category: "grocery" },
  { name: "Rohlik", domain: "rohlik.cz", color: "#5BA829", category: "grocery", aliases: ["Rohlík"] },
  { name: "Starbucks", domain: "starbucks.com", color: "#00704A", category: "coffee" },
  { name: "Costa Coffee", domain: "costa.co.uk", color: "#6D1F37", category: "coffee" },
  { name: "Café Café", domain: "cafecafe.cz", color: "#3B2418", category: "coffee", aliases: ["Cafe Cafe"] },
  { name: "McDonald's", domain: "mcdonalds.cz", color: "#DA291C", category: "food" },
  { name: "KFC", domain: "kfc.cz", color: "#A3080C", category: "food" },
  { name: "Burger King", domain: "burgerking.cz", color: "#D62300", category: "food" },
  { name: "dm", domain: "dm.cz", color: "#1D3A8A", category: "beauty", aliases: ["dm drogerie markt"] },
  { name: "Rossmann", domain: "rossmann.cz", color: "#C3002F", category: "beauty" },
  { name: "Teta", domain: "tetadrogerie.cz", color: "#E2007A", category: "beauty", aliases: ["Teta drogerie"] },
  { name: "Notino", domain: "notino.cz", color: "#111111", category: "beauty" },
  { name: "Sephora", domain: "sephora.cz", color: "#101010", category: "beauty" },
  { name: "Douglas", domain: "douglas.cz", color: "#9BDCD2", category: "beauty" },
  { name: "Dr.Max", domain: "drmax.cz", color: "#00315F", category: "pharmacy", aliases: ["Dr. Max", "Lékárna Dr.Max"] },
  { name: "Benu", domain: "benu.cz", color: "#00A651", category: "pharmacy", aliases: ["BENU Lékárna", "Lékárna BENU"] },
  { name: "Pilulka", domain: "pilulka.cz", color: "#E5007D", category: "pharmacy" },
  { name: "H&M", domain: "hm.com", color: "#E50010", category: "fashion" },
  { name: "Reserved", domain: "reserved.com", color: "#1A1A1A", category: "fashion" },
  { name: "Pepco", domain: "pepco.cz", color: "#0047BB", category: "fashion" },
  { name: "Deichmann", domain: "deichmann.com", color: "#00843D", category: "fashion" },
  { name: "CCC", domain: "ccc.eu", color: "#B4121B", category: "fashion" },
  { name: "Tchibo", domain: "tchibo.cz", color: "#1D2C4C", category: "home" },
  { name: "Decathlon", domain: "decathlon.cz", color: "#0082C3", category: "sport" },
  { name: "Sportisimo", domain: "sportisimo.cz", color: "#E30613", category: "sport" },
  { name: "Hervis", domain: "hervis.cz", color: "#D4001A", category: "sport" },
  { name: "IKEA", domain: "ikea.com", color: "#0058A3", category: "home" },
  { name: "Hornbach", domain: "hornbach.cz", color: "#F7931E", category: "home" },
  { name: "OBI", domain: "obi.cz", color: "#FF7E21", category: "home" },
  { name: "Bauhaus", domain: "bauhaus.cz", color: "#DA2128", category: "home" },
  { name: "JYSK", domain: "jysk.cz", color: "#143C8A", category: "home" },
  { name: "Action", domain: "action.com", color: "#004B93", category: "home" },
  { name: "Datart", domain: "datart.cz", color: "#E2001A", category: "electronics" },
  { name: "Alza", domain: "alza.cz", color: "#21A9E1", category: "electronics", aliases: ["AlzaBox", "Alza.cz"] },
  { name: "Electro World", domain: "electroworld.cz", color: "#00A0E3", category: "electronics" },
  { name: "Shell", domain: "shell.cz", color: "#FFD500", category: "fuel" },
  { name: "OMV", domain: "omv.cz", color: "#0A3C78", category: "fuel" },
  { name: "MOL", domain: "molcesko.cz", color: "#E30613", category: "fuel" },
  { name: "Orlen", domain: "orlen.cz", color: "#E3000F", category: "fuel", aliases: ["Benzina", "Benzina Orlen"] },
  { name: "Lukoil", domain: "lukoil.com", color: "#D7001E", category: "fuel" },
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

/**
 * A website typed by a person or read from a card ("https://www.Albert.cz/akce") as a
 * bare domain ("albert.cz"), or "" when it doesn't look like one.
 * @param {unknown} value
 */
export function cleanDomain(value) {
  if (typeof value !== "string") {
    return "";
  }
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#:].*$/, "")
    .replace(/^www\./, "");
  return host.length <= 100 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

/** Website of a card: the one saved on it, else the known chain's. */
export function cardDomain(card) {
  return cleanDomain(card.website) || findBrand(card.name)?.domain || "";
}

/**
 * Logo picture for a card: the person's own picture, else the shop website's icon
 * (only when `remote` is allowed). Null means "show the category icon".
 * @param {{ logo?: string | null, website?: string, name: string }} card
 * @param {boolean} remote
 */
export function logoUrl(card, remote) {
  if (card.logo) {
    return card.logo;
  }
  const domain = remote ? cardDomain(card) : "";
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null;
}
