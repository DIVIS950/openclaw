// Language for the whole app (browser and home server). Strings are written in English
// in the code and looked up here; Czech is the default because the house is in Czech.
//
//   t("Lights")                       -> "Světla"
//   t("{name} is on", { name })       -> "{name} je zapnuto"
//   tn(3, "{n} light", "{n} lights")  -> "3 světla"  (Czech has 3 plural forms)
import { CS } from "./i18n-cs.js";

export const LANGS = { cs: "Čeština", en: "English" };
let LANG = "cs";

export function setLang(lang) {
  LANG = LANGS[lang] ? lang : "cs";
  if (typeof document !== "undefined") document.documentElement.lang = LANG;
}
export const lang = () => LANG;
/** For toLocaleString and friends. */
export const locale = () => (LANG === "cs" ? "cs-CZ" : "en-US");

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);

export function t(en, vars) {
  const s = LANG === "cs" ? CS[en] : null;
  return fill(typeof s === "string" ? s : en, vars);
}

/**
 * Plural. Czech: 1 -> one, 2–4 -> few, 0 and 5+ -> many. The Czech forms live in CS under
 * the key "one|other" as [one, few, many].
 */
export function tn(n, one, other, vars = {}) {
  const v = { n, ...vars };
  if (LANG === "cs") {
    const forms = CS[`${one}|${other}`];
    if (Array.isArray(forms)) return fill(n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2], v);
  }
  return fill(n === 1 ? one : other, v);
}

/** Missing Czech strings, for tests: every English key that has no translation. */
export const hasCs = (en) => typeof CS[en] === "string" || Array.isArray(CS[en]);
