// Hash routing with real history entries, so the phone's back gesture closes pages and sheets.
//   tabs:   ""  #coupons  #stats  #ai
//   pages:  #card-<id>  #coupon-<id>  #edit-<id>  #ecoupon-<id>  #settings  #map  #pick-<id>
//           #find-<id>  #reminders
//   sheets: #add (what to add)  #scan (new card)  #gift (new gift card)  #newc (new coupon)
//           #log  #log-<cardId>  #pay-<giftCardId>  #promo-<cardId>  #import=<shared card>

const listeners = new Set();

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    fn(currentRoute());
  }
}

window.addEventListener("popstate", emit);
window.addEventListener("hashchange", emit);

function depth() {
  return Number(history.state?.kapsa ?? 0);
}

function urlFor(hash) {
  return hash ? hash : location.pathname + location.search;
}

/** Open a route on top of the current one. */
export function go(hash) {
  if (location.hash === hash) {
    return;
  }
  history.pushState({ kapsa: depth() + 1 }, "", urlFor(hash));
  emit();
}

/** Swap the current route without adding a history entry. */
export function replace(hash) {
  history.replaceState({ kapsa: depth() }, "", urlFor(hash));
  emit();
}

/** Go back if we opened this route ourselves, otherwise land on `fallback`. */
export function back(fallback = "") {
  if (depth() > 0) {
    history.back();
  } else {
    replace(fallback);
  }
}

export const TABS = ["wallet", "coupons", "stats", "ai"];

/**
 * @returns {{ kind: "tab" | "page" | "sheet", name: string, id: string | null, data: string | null }}
 */
export function currentRoute() {
  return parseHash(location.hash);
}

/** @param {string} raw */
export function parseHash(raw) {
  const hash = raw.replace(/^#/, "");
  if (hash.startsWith("import=")) {
    return { kind: "sheet", name: "import", id: null, data: hash.slice(7) };
  }
  if (hash === "" || hash === "wallet") {
    return { kind: "tab", name: "wallet", id: null, data: null };
  }
  if (TABS.includes(hash)) {
    return { kind: "tab", name: hash, id: null, data: null };
  }
  if (["settings", "map", "reminders"].includes(hash)) {
    return { kind: "page", name: hash, id: null, data: null };
  }
  if (["add", "scan", "gift", "newc", "log"].includes(hash)) {
    return { kind: "sheet", name: hash, id: null, data: null };
  }
  const m = /^(card|coupon|edit|ecoupon|pick|find|log|pay|promo)-([a-z0-9]+)$/i.exec(hash);
  if (m) {
    const name = m[1].toLowerCase();
    return { kind: ["log", "pay", "promo"].includes(name) ? "sheet" : "page", name, id: m[2], data: null };
  }
  return { kind: "tab", name: "wallet", id: null, data: null };
}
