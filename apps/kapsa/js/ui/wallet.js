// Wallet tab: the shop you're in takes over the top of the screen with its card ready
// to scan (plus its promo codes and gift card money); below, all your cards stacked
// like in a real wallet, each in its own bright colour with its logo.

import { normalizeName } from "../brands.js";
import { addDemo } from "../demo.js";
import { formatDistance } from "../geo.js";
import { dayPart, suggestNow, usualDayPart } from "../habits.js";
import { locale, t } from "../i18n.js";
import { startLocation } from "../location.js";
import { lookVars } from "../look.js";
import { expiryStatus } from "../model.js";
import { go } from "../nav.js";
import { addStamp, couponsForCard, markUsed, state } from "../state.js";
import { buzz, formatNumber, greetingPart } from "../util.js";
import { confetti } from "../confetti.js";
import { PinRow, PromoList, giftLine } from "./gift.js";
import { BigCode, Icon, Logo, Section, Ticket, html, toast } from "./kit.js";
import { useMemo, useState } from "../../vendor/preact.js";

/**
 * @param {{ rows: ReturnType<typeof import("../geo.js").rankCards>, reminders: number }} props
 */
export function Wallet({ rows, reminders }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [big, setBig] = useState(/** @type {any} */ (null));
  const hasCards = state.cards.length > 0;
  const here = rows.find((r) => r.here) ?? null;
  const now = Date.now();

  const activeCoupons = state.coupons.filter((c) => !c.used && expiryStatus(c.expiry, now)?.state !== "expired");
  const couponsBy = useMemo(() => {
    const map = {};
    for (const card of state.cards) {
      map[card.id] = couponsForCard(card, activeCoupons).length;
    }
    return map;
  }, [state.cards, state.coupons]);

  const q = normalizeName(query);
  const visible = rows.filter((r) => {
    if (q && !normalizeName(r.card.name).includes(q)) {
      return false;
    }
    if (filter === "near") {
      return r.distance !== null && r.distance < 2000;
    }
    if (filter === "coupons") {
      return couponsBy[r.card.id] > 0;
    }
    if (filter === "stamps") {
      return Boolean(r.card.stamps);
    }
    if (filter === "gift") {
      return r.card.kind === "gift";
    }
    return true;
  });

  const openBig = (card, code = card.code, format = card.format) => {
    markUsed(card.id);
    setBig({ code, format, name: card.name });
  };

  return html`<div class="wallet">
    <header class="hero">
      <div class="hero-inner">
        <${TopBar} reminders=${reminders} />
        ${here
          ? html`<${HereHero} row=${here} coupons=${couponsBy[here.card.id] ?? 0} onBig=${() => openBig(here.card)} />`
          : hasCards
            ? html`<${HomeHero} rows=${rows} coupons=${activeCoupons.length} />`
            : html`<${EmptyHero} />`}
      </div>
    </header>

    ${hasCards
      ? html`<${Section}
          title=${t("w.myCards")}
          count=${state.cards.length}
          action=${html`<button type="button" class="link-btn" onClick=${() => go("#add")}><${Icon} name="plus" />${t("tab.add")}</button>`}
        >
          ${state.cards.length >= 6
            ? html`<input
                id="wallet-search"
                class="input"
                type="search"
                placeholder=${t("w.search")}
                aria-label=${t("w.search")}
                value=${query}
                onInput=${(e) => setQuery(e.currentTarget.value)}
                style="margin-bottom:12px"
              />`
            : null}
          <div class="chips" role="radiogroup" aria-label=${t("w.myCards")} style="margin-bottom:12px">
            ${[
              ["all", t("w.filter.all")],
              ["near", t("w.filter.near")],
              ["coupons", t("w.filter.coupons")],
              ["stamps", t("w.filter.stamps")],
              ...(state.cards.some((c) => c.kind === "gift") ? [["gift", t("w.filter.gift")]] : []),
            ].map(
              ([v, label]) =>
                html`<button
                  type="button"
                  role="radio"
                  aria-checked=${String(filter === v)}
                  class=${`chip solid${filter === v ? " is-on" : ""}`}
                  onClick=${() => setFilter(v)}
                >
                  ${label}
                </button>`,
            )}
          </div>
          ${visible.length
            ? html`<div class="wstack">
                ${visible.map((r, i) => html`<${WalletCard} key=${r.card.id} row=${r} i=${i} coupons=${couponsBy[r.card.id] ?? 0} />`)}
              </div>`
            : html`<p class="hint">${t("w.noResults")}</p>`}
        <//>`
      : null}
    ${big ? html`<${BigCode} ...${big} onClose=${() => setBig(null)} />` : null}
  </div>`;
}

function TopBar({ reminders }) {
  return html`<div class="topbar">
    <div class="wordmark"><img src="icons/logo.svg" alt="" width="32" height="32" />Kapsa</div>
    <div class="topbar-actions">
      <button type="button" class="hbtn" aria-label=${t("w.bell")} onClick=${() => go("#reminders")}>
        <${Icon} name="bell" />${reminders ? html`<span class="count">${reminders}</span>` : null}
      </button>
      <button type="button" class="hbtn" aria-label=${t("map.title")} onClick=${() => go("#map")}><${Icon} name="map" /></button>
      <button type="button" class="hbtn" aria-label=${t("set.title")} onClick=${() => go("#settings")}><${Icon} name="settings" /></button>
    </div>
  </div>`;
}

/** You're in a shop: its card, big and ready to scan, with quick actions below. */
function HereHero({ row, coupons, onBig }) {
  const card = row.card;
  const stampAction = async () => {
    const { card: saved, ready } = await addStamp(card.id);
    buzz([20, 40, 20]);
    if (ready) {
      confetti();
      toast(t("stamps.ready"));
    } else if (saved?.stamps) {
      toast(`${t("stamps.added")} · ${saved.stamps.count}/${saved.stamps.goal}`);
    }
  };
  const sub = [
    giftLine(card),
    card.stamps ? t("w.stampsLine", { n: card.stamps.count, g: card.stamps.goal }) : "",
    coupons ? t("w.coupons", { n: coupons }) : "",
  ].filter(Boolean);
  return html`<div class="hero-stack">
    <div class="wcard big" style=${lookVars(card)}>
      <div class="wcard-top">
        <span class="wcard-title">
          <span class="wchip"><span class="pulse"></span>${t("w.here")} · ${formatDistance(row.distance ?? 0, locale())}</span>
          <button type="button" class="wcard-name" onClick=${() => go(`#card-${card.id}`)}>${card.name}</button>
          ${sub.length ? html`<span class="wcard-sub">${sub.join(" · ")}</span>` : null}
        </span>
        <${Logo} card=${card} cls="lg" />
      </div>
      <${Ticket} code=${card.code} format=${card.format} name=${card.name} onBig=${onBig} />
      ${card.kind === "gift" && card.pin ? html`<${PinRow} pin=${card.pin} onCard=${true} />` : null}
      <div class="wcard-actions">
        ${card.kind === "gift"
          ? html`<button type="button" class="wbtn strong" onClick=${() => go(`#pay-${card.id}`)}><${Icon} name="wallet" />${t("gift.payButton")}</button>`
          : null}
        ${card.stamps
          ? html`<button type="button" class="wbtn strong" onClick=${stampAction}><${Icon} name="stamp" />${t("stamps.add")}</button>`
          : null}
        <button type="button" class="wbtn" onClick=${onBig}><${Icon} name="maximize-2" />${t("w.fullscreen")}</button>
        ${card.kind !== "gift"
          ? html`<button type="button" class="wbtn" onClick=${() => go(`#log-${card.id}`)}><${Icon} name="receipt" />${t("card.logSpend")}</button>`
          : null}
      </div>
    </div>
    <${PromoList} card=${card} empty=${true} />
  </div>`;
}

/** Not in a shop: greeting, a summary, and the card you probably want now. */
function HomeHero({ rows, coupons }) {
  const now = Date.now();
  const rewards = state.cards.filter((c) => c.stamps && c.stamps.count >= c.stamps.goal).length;
  const suggestion = state.settings.habits ? suggestNow(state.cards, now) : null;
  const nearest = state.locStatus === "on" ? rows.find((r) => r.distance !== null && r.card.id !== suggestion?.card.id) : null;
  return html`<div class="hero-stack">
    <h1 class="display sm">${t(`w.greet.${greetingPart(now)}`)}</h1>
    <div class="hero-chips">
      <span class="chip">${t("w.cards", { n: state.cards.length })}</span>
      ${coupons ? html`<button type="button" class="chip accent" onClick=${() => go("#coupons")}>${t("w.coupons", { n: coupons })}</button>` : null}
      ${rewards ? html`<span class="chip accent"><${Icon} name="gift" />${t("w.rewards", { n: rewards })}</span>` : null}
    </div>
    ${suggestion
      ? html`<${Mini} card=${suggestion.card} label=${t("w.usuallyNow")} meta=${t(`habit.${dayPart(now)}`)} />`
      : null}
    ${nearest ? html`<${Mini} card=${nearest.card} label=${t("w.nearest")} meta=${formatDistance(nearest.distance ?? 0, locale())} />` : null}
    <${LocationPrompt} />
  </div>`;
}

function Mini({ card, label, meta }) {
  return html`<button type="button" class="mini" onClick=${() => go(`#card-${card.id}`)}>
    <span class="mini-logo" style=${lookVars(card)}><${Logo} card=${card} /></span>
    <span style="min-width:0">
      <span class="mini-label">${label}</span>
      <span class="mini-name">${card.name}</span>
    </span>
    <span class="mini-meta">${meta}</span>
  </button>`;
}

function LocationPrompt() {
  const s = state.locStatus;
  if (s === "on") {
    return null;
  }
  if (s === "searching") {
    return html`<span class="eyebrow"><span class="pulse"></span>${t("w.locSearching")}</span>`;
  }
  const denied = s === "denied";
  return html`<div class="mini" style="grid-template-columns:auto 1fr auto">
    <span class="mini-swatch"><${Icon} name=${denied ? "locate-off" : "locate-fixed"} /></span>
    <span style="min-width:0">
      <span class="mini-name">${t("w.locTitle")}</span>
      <span class="mini-label" style="text-transform:none;letter-spacing:0;font-weight:700">${denied ? t("w.locDenied") : t("w.locBody")}</span>
    </span>
    ${denied ? null : html`<button type="button" class="btn sm primary" onClick=${() => startLocation()}>${t("w.locOn")}</button>`}
  </div>`;
}

function EmptyHero() {
  return html`<div class="hero-stack">
    <div class="art-cards" aria-hidden="true"><span></span><span></span><span></span></div>
    <h1 class="display sm">${t("w.emptyTitle")}</h1>
    <p style="margin:0;font-weight:650">${t("w.emptyBody")}</p>
    <ol class="steps">
      <li>${t("w.step1")}</li>
      <li>${t("w.step2")}</li>
      <li>${t("w.step3")}</li>
    </ol>
    <button type="button" class="btn xl primary block" onClick=${() => go("#scan")}><${Icon} name="scan-barcode" />${t("w.emptyScan")}</button>
    <button
      type="button"
      class="btn block"
      onClick=${async () => {
        if (!state.pos && state.locStatus !== "denied") {
          startLocation();
          for (let waited = 0; !state.pos && waited < 5000 && state.locStatus !== "denied"; waited += 250) {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        await addDemo();
        confetti();
      }}
    >
      <${Icon} name="sparkles" />${t("w.emptyDemo")}
    </button>
  </div>`;
}

/** One card in the wallet stack: everything important sits in its top strip. */
function WalletCard({ row, i, coupons }) {
  const card = row.card;
  const now = Date.now();
  const exp = expiryStatus(card.expiry, now);
  const part = state.settings.habits ? usualDayPart(card.usage) : null;
  let sub = "";
  if (card.kind === "gift") {
    sub = giftLine(card);
  } else if (card.points !== null && card.points !== undefined) {
    sub = t("w.points", { n: formatNumber(card.points) });
  } else if (card.stamps) {
    sub = t("w.stampsLine", { n: card.stamps.count, g: card.stamps.goal });
  } else if (part) {
    sub = t("card.usually", { p: t(`habit.${part}`) });
  } else if (card.sample) {
    sub = t("common.sample");
  } else {
    sub = t(`cat.${card.category}`);
  }
  return html`<button
    type="button"
    class=${`wcard${row.here ? " is-here" : ""}`}
    style=${{ ...lookVars(card), "--i": Math.min(i, 12) }}
    onClick=${() => go(`#card-${card.id}`)}
  >
    <span class="wcard-top">
      <span class="wcard-title">
        <span class="wcard-name">${card.name}</span>
        <span class="wcard-sub">${sub}</span>
      </span>
      <${Logo} card=${card} />
    </span>
    <span class="wpills">
      ${card.kind === "gift" ? html`<span class="wpill"><${Icon} name="gift" />${t("gift.kind")}</span>` : null}
      ${row.distance !== null
        ? html`<span class="wpill">${row.here ? html`<span class="pulse"></span>` : null}${formatDistance(row.distance, locale())}</span>`
        : null}
      ${coupons ? html`<span class="wpill"><${Icon} name="ticket" />${coupons}</span>` : null}
      ${card.stamps && card.kind !== "gift" && (card.points !== null && card.points !== undefined)
        ? html`<span class="wpill"><${Icon} name="stamp" />${card.stamps.count}/${card.stamps.goal}</span>`
        : null}
      ${exp && exp.state !== "ok"
        ? html`<span class="wpill warn">${exp.state === "expired" ? t("card.expired") : exp.days === 0 ? t("card.expiresToday") : t("w.daysLeft", { n: exp.days })}</span>`
        : null}
    </span>
  </button>`;
}
