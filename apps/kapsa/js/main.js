// Kapsa: membership cards that pop up when you walk into the shop.
// Boot: load data, apply theme and language, start the app, location, offline cache.

import { detectLang, setLang, t } from "./i18n.js";
import { autoStartLocation, bindVisibility, refreshBranches } from "./location.js";
import { registerDailyCheck } from "./reminders.js";
import { preloadDetector } from "./scanner.js";
import { loadState, state, subscribe } from "./state.js";
import { requestPersistence } from "./store.js";
import { App } from "./ui/app.js";
import { toast } from "./ui/kit.js";
import { html, render } from "../vendor/preact.js";

let lastTheme = "";

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
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color || "#fbf7f1");
}

let updateRequested = false;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      const offer = (worker) =>
        toast(t("update.ready"), {
          action: t("update.reload"),
          ms: 15_000,
          onAction: () => {
            updateRequested = true;
            worker.postMessage("skip-waiting");
          },
        });
      if (reg.waiting && navigator.serviceWorker.controller) {
        offer(reg.waiting);
      }
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            offer(worker);
          }
        });
      });
    })
    .catch(() => {});
  // Reload only for an update the user asked for, never when the first install takes over.
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
  setLang(state.settings.lang === "auto" ? detectLang(navigator.languages ?? [navigator.language]) : state.settings.lang);
  subscribe(applyTheme);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);

  const root = /** @type {HTMLElement} */ (document.getElementById("app"));
  root.replaceChildren();
  render(html`<${App} />`, root);

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
  if (state.cards.length || state.coupons.length) {
    requestPersistence();
  }
  if (state.settings.notifications) {
    registerDailyCheck();
  }
  registerServiceWorker();
  // Warm up the code reader while the user looks at the wallet.
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500)))(() => preloadDetector());
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML = "";
    const p = document.createElement("p");
    p.className = "fatal";
    p.textContent = String(err?.message ?? err);
    root.append(p);
  }
});
