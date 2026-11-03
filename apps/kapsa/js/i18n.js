// Czech + English. Texts live in strings-cs.js and strings-en.js; a value is a string
// or plural forms keyed by Intl.PluralRules categories (Czech: one / few / many / other).

import { cs } from "./strings-cs.js";
import { en } from "./strings-en.js";

export const DICTS = { cs, en };
export const LANGS = ["cs", "en"];

let current = "cs";

/**
 * Language from the phone: Czech or Slovak -> Czech, anything else -> English.
 * @param {readonly string[]} languages
 */
export function detectLang(languages) {
  for (const lang of languages) {
    const base = lang.toLowerCase().split("-")[0];
    if (base === "cs" || base === "sk") {
      return "cs";
    }
    if (base === "en") {
      return "en";
    }
  }
  return "en";
}

/** @param {string} lang */
export function setLang(lang) {
  current = LANGS.includes(lang) ? lang : "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
  }
}

export function getLang() {
  return current;
}

/** BCP 47 locale for number formatting. */
export function locale() {
  return current === "cs" ? "cs-CZ" : "en-GB";
}

/**
 * Translate a key. `{name}` placeholders are filled from `vars`; `vars.n` picks the plural form.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars = {}) {
  let value = DICTS[current]?.[key] ?? DICTS.en[key] ?? key;
  if (typeof value === "object") {
    const n = Number(vars.n ?? 0);
    const rule = new Intl.PluralRules(locale()).select(n);
    value = value[rule] ?? value.other;
  }
  return String(value).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
