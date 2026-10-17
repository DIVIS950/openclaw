// Risky, safe and money word lists (English and Czech) used to classify clicks.
// Pure module: no runtime imports from OpenClaw.
import { cleanText, fold, safeUrl } from "./text.js";
import type { ActionDescriptor } from "./types.js";

// Word lists match folded text (lowercase, no accents), so "Zrušit" and "zrusit" both match.
const START = "(?<![a-z0-9])";
const END = "(?![a-z0-9])";

const RISKY_WORDS = [
  // English
  `send(?:s|ing)?${END}`,
  `resend${END}`,
  `submit(?:s|ted|ting)?${END}`,
  `post(?:s|ed|ing)?${END}`,
  "repost",
  "publish",
  "tweet",
  "retweet",
  `repl(?:y|ies|ied|ying)${END}`,
  "comment",
  `shar(?:e|es|ed|ing)${END}`,
  `buy(?:s|ing)?${END}`,
  "purchas",
  `order(?:s|ed|ing)?${END}`,
  `check ?out`,
  `pay(?:s|ing|ment|ments)?${END}`,
  `paid${END}`,
  `book(?:s|ed|ing|ings)?${END}`,
  `reserv(?:e|es|ed|ing|ation|ations)${END}`,
  "confirm",
  "subscri",
  "unsubscri",
  "delet",
  `remov(?:e|es|ed|ing|al)${END}`,
  "cancel (?:[a-z0-9]+ )?(?:subscription|membership|plan|account)",
  "transfer",
  "donat",
  `sign ?up${END}`,
  "registr",
  "register",
  `appl(?:y|ies|ied|ying)${END}`,
  "upload",
  `save(?:s|d)?${END}`,
  "save changes",
  `updat(?:e|es|ed|ing)${END}`,
  "accept (?:the )?(?:offer|invitation|invite|terms|agreement|request)",
  `bid(?:s|ding)?${END}`,
  "close (?:[a-z0-9]+ )?account",
  "deactivat",
  "terminat",
  `follow(?:s|ed|ing)?${END}`,
  "unfollow",
  `invit(?:e|es|ed|ing)${END}`,
  `vote(?:s|d)?${END}`,
  // Compounds the start-of-word rule would miss.
  "upvot",
  "downvot",
  "reorder",
  "resubmit",
  `flag${END}`,
  `approv(?:e|es|ed|ing|al)${END}`,
  "pledge",
  // Czech (folded): odeslat, poslat, koupit, objednat, zaplatit, rezervovat, potvrdit, smazat,
  // odstranit, zrušit, přihlásit k odběru, registrovat, nahrát, uložit, sdílet, publikovat, zveřejnit
  "odesl",
  "odesil",
  `posl(?:at|ete|i)${END}`,
  "koupit",
  `koup(?:e|i|im|ite)${END}`,
  "kupt",
  "nakoup",
  "nakup",
  "objedn",
  "zaplat",
  "platb",
  "uhrad",
  "rezerv",
  "potvrd",
  "potvrz",
  "smaz",
  "odstran",
  "zrus",
  "prihlasit k odberu",
  "k odberu",
  "odebirat",
  "zaregistr",
  `nahr(?:at|ajte|aj|ani)${END}`,
  "uloz",
  "sdil",
  "publik",
  "zverejn",
  "darov",
  "daruj",
  "prevest",
  "prevod",
];

const SAFE_WORDS = [
  // English
  "search(?:ing)?",
  "next",
  "previous",
  "prev",
  "(?:go )?back",
  "close",
  "menu",
  "more",
  "(?:show|see|read|load|view) (?:more|all)",
  "show",
  "expand",
  "collapse",
  "accept cookies",
  "accept all(?: cookies)?",
  "reject all(?: cookies)?",
  "sign in",
  "log ?in",
  "continue reading",
  "open",
  "view",
  "details?",
  "filters?",
  "sort(?: by(?: [a-z0-9]+)?)?",
  "dismiss",
  "got it",
  "skip",
  // Czech (folded)
  "hledat",
  "vyhledat",
  "vyhledavani",
  "dalsi",
  "predchozi",
  "zpet",
  "zavrit",
  "nabidka",
  "vice",
  "zobrazit(?: vice| vse)?",
  "rozbalit",
  "sbalit",
  "prijmout (?:vse|vsechn[ay]?|cookies)",
  "odmitnout(?: vse| vsechn[ay]?)?",
  "rozumim",
  "prihlasit(?: se)?",
  "otevrit",
  "detail",
  "podrobnosti",
  "filtr(?:y|ovat)?",
  "radit",
  "seradit",
];

const MONEY_WORDS = [
  `pay(?:s|ing|ment|ments|pal)?${END}`,
  `paid${END}`,
  "buy",
  "bought",
  "order",
  "check ?out",
  "purchas",
  "subscri",
  "donat",
  "transfer",
  "price",
  "pricing",
  `cart${END}`,
  "basket",
  "billing",
  "invoice",
  "wallet",
  "credit card",
  "card number",
  "zaplat",
  "platb",
  "plati",
  "uhrad",
  "koup",
  "kupt",
  "nakup",
  "objedn",
  "pokladn",
  "predplat",
  "darov",
  "daruj",
  "prevod",
  "prevest",
  `cen(?:a|u|y|ou)${END}`,
  "kosik",
  "faktur",
];

const RISKY_RE = new RegExp(`${START}(?:${RISKY_WORDS.join("|")})`);
// The whole name must be a safe word, optionally followed by one small noun ("Close menu",
// "Show all"): "Close issue", "Agree & Join" or "Accept all invitations" are not navigation.
const SAFE_SUFFIX =
  "(?: (?:cookies|results|options|filters|menu|details|all|images|photos|comments|page))?";
const SAFE_RE = new RegExp(`^(?:${SAFE_WORDS.join("|")})${SAFE_SUFFIX}$`);
// "I agree" is only a cookie-banner word when the banner says so; elsewhere it accepts terms.
const AGREE_RE = /^(?:(?:i )?agree|souhlasim)$/;
const COOKIE_RE = new RegExp(`${START}cookies?${END}`);
const MONEY_RE = new RegExp(`${START}(?:${MONEY_WORDS.join("|")})`);
const CURRENCY_RE = /[€$£¥]|(?<![\p{L}\p{N}])(?:kč|czk|eur|usd|gbp)(?![\p{L}\p{N}])|\d\s?,-/iu;
// Pages where even a harmless-looking link may complete a purchase: the guard decides there.
const CHECKOUT_URL_RE = new RegExp(
  `${START}(?:checkout|check-out|payments?|pay|billing|carts?|basket|orders?|kosik|pokladna|objednavka|platba)${END}`,
);

/** True when the name contains a word for something that leaves the machine. */
export function hasRiskyWord(name: string): boolean {
  return RISKY_RE.test(fold(name));
}

/**
 * True when the whole name is a navigation/cookie-banner word. Long names, and names with hidden
 * or direction-changing characters, never count as safe. "Agree" counts only when `context`
 * (the lines around the element) mentions cookies.
 */
export function hasSafeWord(name: string, context: readonly string[] = []): boolean {
  if (cleanText(name) !== name) {
    return false;
  }
  // Edge punctuation and arrows ("Next ›", "Search…") do not change what a button does.
  const folded = fold(name).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (folded.split(" ").length > 5) {
    return false;
  }
  if (AGREE_RE.test(folded)) {
    return COOKIE_RE.test(fold(context.join("\n")));
  }
  return SAFE_RE.test(folded);
}

export function mentionsMoney(action: ActionDescriptor): boolean {
  const text = [
    action.summary,
    action.detail,
    action.element?.name,
    action.element?.context.join("\n"),
    action.text,
    action.url,
  ]
    .filter(Boolean)
    .join("\n");
  return MONEY_RE.test(fold(text)) || CURRENCY_RE.test(text);
}

/** Host/path of a checkout, cart, payment or order page, where every click goes to the guard. */
export function isCheckoutPage(hostPath: string | undefined): boolean {
  return CHECKOUT_URL_RE.test(fold(hostPath ?? ""));
}

// A path segment, query key or query value naming something a plain GET link can do
// (Hacker News "vote?id=..&how=up", one-click unsubscribe and confirm links). The word may end
// a hyphenated segment ("list-unsubscribe") but not sit inside an article slug
// ("fans-join-protest"), which would send ordinary reading to the guard.
const URL_ACTION_RE = new RegExp(
  `(?:^|[/?&=#;_.-])(?:${[
    "vote",
    "upvote",
    "downvote",
    "unvote",
    "flag",
    "like",
    "unlike",
    "dislike",
    "follow",
    "unfollow",
    "subscribe",
    "unsubscribe",
    "confirm",
    "approve",
    "accept",
    "decline",
    "reject",
    "report",
    "block",
    "unblock",
    "join",
    "leave",
    "delete",
    "remove",
    "cancel",
    "verify",
    "opt-?out",
    "rsvp",
  ].join("|")})(?=$|[/?&=#;.])`,
  "i",
);
// A credential or signature in the query makes a link act as the signed-in owner.
const URL_SECRET_PARAM_RE = /[?&#](?:[a-z0-9]*[_-])?(?:auth|token|csrf|xsrf|sig|signature|hmac)=/i;
/** A longer query than this can carry page data out (for example a fetch to ?d=<inbox>). */
export const MAX_PLAIN_QUERY_CHARS = 256;

/**
 * True when opening `url` (absolute, or relative to `base`) with a plain GET can change
 * something or carry data out. The host is not checked, only path, query and fragment.
 * Deliberately narrow: ordinary article, product and search URLs stay allowed.
 */
export function riskyUrl(url: string | undefined, base?: string): boolean {
  if (!url?.trim()) {
    return false;
  }
  const parsed = safeUrl(url, base) ?? safeUrl(url, "https://relative.invalid/");
  const rest = parsed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
  let decoded = rest;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    // keep the raw text
  }
  if (URL_ACTION_RE.test(decoded) || URL_SECRET_PARAM_RE.test(decoded)) {
    return true;
  }
  return (parsed?.search.length ?? url.length) > MAX_PLAIN_QUERY_CHARS;
}
