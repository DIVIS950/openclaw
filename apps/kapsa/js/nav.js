// Hash routing with real history entries, so the phone's back gesture closes sheets.
//   ""            wallet
//   #map          map            #pick-<id>   map, choosing a place for a card
//   #settings     settings
//   #card-<id>    card sheet     #edit-<id>   edit sheet     #find-<id> address search
//   #add          scan + new card
//   #ai           chat assistant
//   #import=...   shared card link

const listeners = new Set();

export function onRoute(fn) {
  listeners.add(fn);
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

/**
 * @returns {{ page: "home" | "map" | "settings", overlay: string | null, id: string | null, data: string | null }}
 */
export function currentRoute() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("import=")) {
    return { page: "home", overlay: "import", id: null, data: hash.slice(7) };
  }
  const m = /^(card|edit|find|pick)-([a-z0-9]+)$/i.exec(hash);
  if (m) {
    const kind = m[1].toLowerCase();
    if (kind === "pick") {
      return { page: "map", overlay: null, id: m[2], data: null };
    }
    return { page: "home", overlay: kind, id: m[2], data: null };
  }
  if (hash === "map" || hash === "settings") {
    return { page: hash, overlay: null, id: null, data: null };
  }
  if (hash === "add") {
    return { page: "home", overlay: "add", id: null, data: null };
  }
  if (hash === "ai") {
    return { page: "home", overlay: "ai", id: null, data: null };
  }
  return { page: "home", overlay: null, id: null, data: null };
}
