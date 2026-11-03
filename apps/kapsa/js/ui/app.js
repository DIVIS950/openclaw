// App shell: tabs (kept mounted so each keeps its scroll), pages pushed on top, bottom
// sheets on top of those, and the tab bar. Re-renders on every state change; Preact
// only touches what changed, so GPS updates don't make the screen jump.

import { rankCards } from "../geo.js";
import { detectLang, getLang, setLang, t } from "../i18n.js";
import { currentRoute, onRoute, replace } from "../nav.js";
import { dwellPending, dwellStep, emptyDwell } from "../dwell.js";
import { keepLocationFor } from "../location.js";
import { collectReminders, notifyNew, showNotice } from "../reminders.js";
import { extraPlaces, getCard, habitScores, state, subscribe } from "../state.js";
import { kv } from "../store.js";
import { buzz } from "../util.js";
import { AssistantTab } from "./assistant.js";
import { CardPage } from "./cardpage.js";
import { EditCardPage, NewCardSheet } from "./cardform.js";
import { EditCouponPage, NewCouponSheet } from "./couponform.js";
import { PaySheet, PromoSheet, activeCouponsFor, giftLine } from "./gift.js";
import { CouponPage, CouponsTab } from "./coupons.js";
import { Icon, Toasts, html, toast } from "./kit.js";
import { LogSheet } from "./logsheet.js";
import { MapPage } from "./map.js";
import { AddSheet, FindPage, ImportSheet, RemindersPage, reminderText } from "./pages.js";
import { SettingsPage } from "./settings.js";
import { StatsTab } from "./stats.js";
import { Wallet } from "./wallet.js";
import { go } from "../nav.js";
import { useEffect, useReducer, useRef, useState } from "../../vendor/preact.js";

const TAB_DEFS = [
  { name: "wallet", hash: "", icon: "wallet-cards", label: "tab.wallet" },
  { name: "coupons", hash: "#coupons", icon: "ticket-percent", label: "tab.coupons" },
  { name: "stats", hash: "#stats", icon: "chart-column", label: "tab.stats" },
  { name: "ai", hash: "#ai", icon: "sparkles", label: "tab.ai" },
];

function applyLang() {
  const lang = state.settings.lang === "auto" ? detectLang(navigator.languages ?? [navigator.language]) : state.settings.lang;
  if (lang !== getLang()) {
    setLang(lang);
  }
}

export function App() {
  const [tick, bump] = useReducer((n) => n + 1, 0);
  const [route, setRoute] = useState(currentRoute);
  const under = useRef({ tab: "wallet", page: /** @type {any} */ (null) });
  const visited = useRef(new Set(["wallet"]));
  const lastHere = useRef(/** @type {string | null} */ (null));
  const notified = useRef(/** @type {Set<string> | null} */ (null));
  const dwell = useRef(emptyDwell());
  const hereIds = useRef(/** @type {string[]} */ ([]));

  useEffect(() => subscribe(bump), []);
  useEffect(() => onRoute(setRoute), []);

  // What sits under a sheet: the last tab and the last page.
  if (route.kind === "tab") {
    under.current = { tab: route.name, page: null };
  } else if (route.kind === "page") {
    under.current = { ...under.current, page: route };
  }
  const tab = under.current.tab;
  visited.current.add(tab);
  applyLang();

  const rows = rankCards(state.cards, state.pos, extraPlaces(), state.settings.radius, habitScores());
  const here = rows.find((r) => r.here) ?? null;
  const reminders = collectReminders({
    cards: state.cards,
    coupons: state.coupons,
    now: Date.now(),
    days: state.settings.remindDays,
    hereCardIds: rows.filter((r) => r.here).map((r) => r.card.id),
  });

  // Walked into a shop: bring its card to the top of the wallet.
  useEffect(() => {
    const id = here?.card.id ?? null;
    if (id && id !== lastHere.current) {
      buzz([30, 60, 30]);
      if (state.settings.autoOpen && route.kind === "tab" && route.name !== "wallet") {
        replace("");
      }
      if (route.kind === "tab") {
        document.querySelector(".screen:not([hidden])")?.scrollTo({ top: 0, behavior: "smooth" });
      }
      toast(`${t("w.here")}: ${here.card.name}`);
    }
    lastHere.current = id;
  }, [here?.card.id]);

  // In a shop with a card for a couple of minutes: remind to use it (once per visit).
  hereIds.current = rows.filter((r) => r.here).map((r) => r.card.id);
  const dwellTick = useRef(() => {});
  dwellTick.current = () => {
    if (!state.settings.dwell) {
      return;
    }
    const thresholdMs = (state.settings.dwellMin || 2) * 60_000;
    const now = Date.now();
    const { next, due } = dwellStep(dwell.current, { hereIds: hereIds.current, now, thresholdMs });
    dwell.current = next;
    keepLocationFor(dwellPending(next, now, thresholdMs) ? thresholdMs + 30_000 : 0);
    due.forEach(remindToUse);
  };
  useEffect(() => {
    const timer = window.setInterval(() => dwellTick.current(), 10_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => dwellTick.current(), [hereIds.current.join("|")]);

  // Phone notifications for new reminders (each one once), when turned on.
  useEffect(() => {
    if (!state.settings.notifications || !reminders.length) {
      return;
    }
    (async () => {
      notified.current ??= new Set((await kv.get("notified")) ?? []);
      const shown = await notifyNew(reminders, notified.current, reminderText);
      if (shown.length) {
        shown.forEach((id) => notified.current.add(id));
        await kv.set("notified", [...notified.current].slice(-200));
      }
    })();
  }, [reminders.map((r) => r.id).join("|"), state.settings.notifications]);

  const page = under.current.page;
  const sheet = route.kind === "sheet" ? route : null;
  const hereRow = (id) => rows.find((r) => r.card.id === id) ?? null;

  return html`<div class="shell">
    ${TAB_DEFS.filter((d) => visited.current.has(d.name)).map(
      (d) => html`<div class="screen" key=${d.name} hidden=${d.name !== tab}>
        ${d.name === "wallet" ? html`<${Wallet} rows=${rows} reminders=${reminders.length} />` : null}
        ${d.name === "coupons" ? html`<${CouponsTab} />` : null}
        ${d.name === "stats" ? html`<${StatsTab} />` : null}
        ${d.name === "ai" ? html`<${AssistantTab} active=${tab === "ai"} />` : null}
      </div>`,
    )}

    <nav class="tabbar" aria-label="Kapsa">
      ${TAB_DEFS.slice(0, 2).map((d) => html`<${Tab} key=${d.name} d=${d} on=${tab === d.name} />`)}
      <button type="button" class="tab-add" aria-label=${t("tab.add")} onClick=${() => go("#add")}><${Icon} name="plus" /></button>
      ${TAB_DEFS.slice(2).map((d) => html`<${Tab} key=${d.name} d=${d} on=${tab === d.name} />`)}
    </nav>

    ${page ? html`<${PageView} key=${`${page.name}-${page.id ?? ""}`} page=${page} row=${page.id ? hereRow(page.id) : null} reminders=${reminders} tick=${tick} />` : null}
    ${sheet ? html`<${SheetView} key=${`${sheet.name}-${sheet.id ?? ""}`} sheet=${sheet} />` : null}
    <${Toasts} />
  </div>`;
}

/** "You've been at Bageterie for 2 minutes: show your card." */
function remindToUse(cardId) {
  const card = getCard(cardId);
  if (!card) {
    return;
  }
  const coupons = activeCouponsFor(card).length;
  const extras = [giftLine(card), coupons ? t("w.coupons", { n: coupons }) : "", card.stamps ? t("w.stampsLine", { n: card.stamps.count, g: card.stamps.goal }) : ""].filter(Boolean);
  const title = t("dwell.title", { name: card.name });
  const body = extras.length ? `${t("dwell.body")} ${extras.join(" · ")}` : t("dwell.body");
  buzz([40, 80, 40]);
  if (document.visibilityState === "visible") {
    toast(title, { action: t("dwell.show"), ms: 12_000, onAction: () => go(`#card-${card.id}`) });
  } else {
    showNotice({ title, body, url: `#card-${card.id}`, tag: `dwell:${card.id}` });
  }
}

function Tab({ d, on }) {
  return html`<button
    type="button"
    class=${`tab${on ? " is-on" : ""}`}
    aria-current=${on ? "page" : undefined}
    onClick=${() => {
      buzz(8);
      if (on) {
        document.querySelector(".screen:not([hidden])")?.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        replace(d.hash);
      }
    }}
  >
    <span class="tab-bubble"><${Icon} name=${d.icon} /></span>
    <span class="tab-label">${t(d.label)}</span>
  </button>`;
}

function PageView({ page, row, reminders, tick }) {
  switch (page.name) {
    case "card":
      return html`<${CardPage} id=${page.id} row=${row} />`;
    case "coupon":
      return html`<${CouponPage} id=${page.id} />`;
    case "edit":
      return html`<${EditCardPage} id=${page.id} />`;
    case "ecoupon":
      return html`<${EditCouponPage} id=${page.id} />`;
    case "settings":
      return html`<${SettingsPage} />`;
    case "reminders":
      return html`<${RemindersPage} reminders=${reminders} />`;
    case "map":
      return html`<${MapPage} tick=${tick} />`;
    case "pick":
      return html`<${MapPage} pickId=${page.id} tick=${tick} />`;
    case "find":
      return html`<${FindPage} id=${page.id} />`;
    default:
      return null;
  }
}

function SheetView({ sheet }) {
  switch (sheet.name) {
    case "add":
      return html`<${AddSheet} />`;
    case "scan":
      return html`<${NewCardSheet} />`;
    case "gift":
      return html`<${NewCardSheet} kind="gift" />`;
    case "pay":
      return html`<${PaySheet} id=${sheet.id} />`;
    case "promo":
      return html`<${PromoSheet} id=${sheet.id} />`;
    case "newc":
      return html`<${NewCouponSheet} />`;
    case "log":
      return html`<${LogSheet} cardId=${sheet.id} />`;
    case "import":
      return html`<${ImportSheet} data=${sheet.data} />`;
    default:
      return null;
  }
}
