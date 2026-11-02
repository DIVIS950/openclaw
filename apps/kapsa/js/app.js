// Kapsa: membership cards that show up when you're at the shop.
// Boot, routing between pages and sheets, theme/language and auto-open.

import { h, mount, toast } from "./dom.js";
import { enableSwipeToClose } from "./gesture.js";
import { rankCards } from "./geo.js";
import { detectLang, setLang, t } from "./i18n.js";
import { autoStartLocation, bindVisibility, refreshBranches } from "./location.js";
import { back, currentRoute, go, onRoute, replace } from "./nav.js";
import { preloadDetector } from "./scanner.js";
import { extraPlaces, loadState, state, subscribe } from "./state.js";
import { requestPersistence } from "./store.js";
import { createAddSheet, createEditSheet } from "./views/addflow.js";
import { createAssistantSheet } from "./views/assistant.js";
import { createCardSheet } from "./views/cardsheet.js";
import { createHome } from "./views/home.js";
import { createMapPage } from "./views/mapview.js";
import { createSettingsPage } from "./views/settings.js";
import { createFindSheet, createImportSheet } from "./views/sheets.js";

const AUTO_OPEN_PAUSE_MS = 30 * 60 * 1000;

const app = /** @type {HTMLElement} */ (document.getElementById("app"));
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("sheet"));
const dialogBody = /** @type {HTMLElement} */ (dialog.querySelector(".sheet-body"));

/** @type {ReturnType<typeof createHome>} */
let home;
/** Current non-home page (map or settings). */
let page = null;
/** Current sheet. */
let sheet = null;
let homeScroll = 0;
let lastLang = "";
let lastTheme = "";
/** When each card was last shown, so auto-open doesn't keep popping it up. */
const shownAt = new Map();

function applyTheme() {
  const theme = state.settings.theme;
  if (theme === lastTheme) {
    return;
  }
  lastTheme = theme;
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  try {
    localStorage.setItem("kapsa-theme", theme);
  } catch {
    // Private mode: the theme still applies for this session.
  }
  syncThemeColor();
}

/** Match the phone's status/address bar to the app background. */
function syncThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && color) {
    meta.setAttribute("content", color);
  }
}

function applyLang() {
  const lang = state.settings.lang === "auto" ? detectLang(navigator.languages ?? [navigator.language]) : state.settings.lang;
  if (lang === lastLang) {
    return false;
  }
  lastLang = lang;
  setLang(lang);
  document.title = "Kapsa";
  return true;
}

function showBase(route) {
  const key = route.page === "map" ? `map:${route.id ?? ""}` : route.page;
  if ((page?.key ?? "home") === key) {
    return;
  }
  if (!page) {
    homeScroll = window.scrollY;
  }
  page?.cleanup?.();
  page?.root.remove();
  page = null;
  if (route.page === "home") {
    home.root.hidden = false;
    home.update();
    requestAnimationFrame(() => window.scrollTo(0, homeScroll));
    return;
  }
  home.root.hidden = true;
  const created = route.page === "map" ? createMapPage(route.id) : createSettingsPage();
  page = { ...created, key };
  app.append(page.root);
  window.scrollTo(0, 0);
  page.update?.(true);
  page.mounted?.();
}

function openSheet(key, factory) {
  if (sheet?.key === key) {
    return;
  }
  closeSheet();
  const created = factory();
  if (!created) {
    if (currentRoute().overlay !== "import") {
      replace("");
    }
    return;
  }
  sheet = { ...created, key };
  dialog.classList.toggle("sheet-dark", Boolean(created.dark));
  dialog.classList.toggle("sheet-tall", Boolean(created.tall));
  dialog.classList.remove("is-closing");
  mount(dialogBody, created.el);
  if (!dialog.open) {
    dialog.showModal();
  }
  dialogBody.scrollTop = 0;
}

function closeSheet() {
  if (!sheet) {
    return;
  }
  sheet.cleanup?.();
  sheet = null;
  if (dialog.open) {
    dialog.close();
  }
  mount(dialogBody);
}

function render(route) {
  // A sheet opens on top of whatever page is showing (e.g. a card from the map).
  if (!route.overlay || (!page && route.page !== "home")) {
    showBase(route);
  }
  switch (route.overlay) {
    case "card":
      shownAt.set(route.id, Date.now());
      openSheet(`card-${route.id}`, () => createCardSheet(route.id));
      break;
    case "edit":
      openSheet(`edit-${route.id}`, () => createEditSheet(route.id));
      break;
    case "find":
      openSheet(`find-${route.id}`, () => createFindSheet(route.id));
      break;
    case "add":
      openSheet("add", () => createAddSheet());
      break;
    case "ai":
      openSheet("ai", () => createAssistantSheet());
      break;
    case "import":
      openSheet(`import-${route.data}`, () => createImportSheet(route.data));
      break;
    default:
      closeSheet();
  }
}

/** Open the card of the shop you just walked into, once per visit. */
function maybeAutoOpen() {
  if (!state.settings.autoOpen || document.hidden || !state.pos) {
    return;
  }
  const route = currentRoute();
  if (route.page !== "home" || route.overlay) {
    return;
  }
  const [top] = rankCards(state.cards, state.pos, extraPlaces(), state.settings.radius);
  if (!top?.here) {
    return;
  }
  if (Date.now() - (shownAt.get(top.card.id) ?? 0) < AUTO_OPEN_PAUSE_MS) {
    return;
  }
  go(`#card-${top.card.id}`);
}

function rebuild() {
  const wasHidden = home?.root.hidden ?? false;
  home?.root.remove();
  home = createHome();
  home.root.hidden = wasHidden;
  app.prepend(home.root);
  home.update();
  if (page) {
    const route = currentRoute();
    page.cleanup?.();
    page.root.remove();
    page = null;
    showBase(route);
  }
  if (sheet) {
    closeSheet();
    render(currentRoute());
  }
}

let persistAsked = false;

function onState() {
  applyTheme();
  if (state.cards.length && !persistAsked) {
    persistAsked = true;
    requestPersistence();
  }
  if (applyLang()) {
    rebuild();
    return;
  }
  if (!home.root.hidden) {
    home.update();
  }
  page?.update?.();
  sheet?.update?.();
  maybeAutoOpen();
}

let updateRequested = false;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      const offerUpdate = (worker) => {
        toast(t("update.ready"), {
          action: t("update.reload"),
          ms: 15_000,
          onAction: () => {
            updateRequested = true;
            worker.postMessage("skip-waiting");
          },
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        offerUpdate(reg.waiting);
      }
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            offerUpdate(worker);
          }
        });
      });
    })
    .catch(() => {});
  // Reload only for an update the user asked for, not when the first install takes control.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested) {
      updateRequested = false;
      location.reload();
    }
  });
}

async function boot() {
  try {
    await loadState();
  } catch {
    // Storage blocked (private mode on some browsers): run with an empty wallet.
  }
  applyTheme();
  applyLang();

  home = createHome();
  app.prepend(home.root);
  app.removeAttribute("aria-busy");

  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    back();
  });
  enableSwipeToClose(dialog, () => back());
  dialog.addEventListener("click", (e) => {
    // A tap on the dimmed backdrop (outside the panel) closes the sheet.
    if (e.target === dialog && !dialog.classList.contains("sheet-dark")) {
      back();
    }
  });

  subscribe(onState);
  onRoute(render);
  render(currentRoute());
  home.update();

  bindVisibility();
  autoStartLocation();
  window.addEventListener("online", () => {
    state.online = true;
    refreshBranches();
  });
  window.addEventListener("offline", () => {
    state.online = false;
    toast(t("offline"));
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
  registerServiceWorker();
  // Warm up the code reader while the user looks at the wallet.
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500)))(() => preloadDetector());
}

boot().catch((err) => {
  console.error(err);
  mount(app, h("p", { class: "fatal" }, String(err?.message ?? err)));
});
