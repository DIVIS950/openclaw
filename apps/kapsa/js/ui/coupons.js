// Coupons tab, the coupon tile and the coupon page.

import { locale, t } from "../i18n.js";
import { expiryStatus } from "../model.js";
import { back, go } from "../nav.js";
import { deleteCoupon, getCard, getCoupon, saveCoupon, state, useCoupon } from "../state.js";
import { buildIcs, buzz, formatDate, money, offerFile } from "../util.js";
import { confetti } from "../confetti.js";
import { BigCode, ConfirmButton, Icon, Page, Section, Ticket, html, tint, toast, useWakeLock } from "./kit.js";
import { useState } from "../../vendor/preact.js";

const NEUTRAL = "#2563EB";

/** Colour of a coupon's little shop dot: its card's colour, or blue. */
export function couponColor(c) {
  return (c.cardId && getCard(c.cardId)?.color) || NEUTRAL;
}

/** Short status line: "3 days left", "ends today", "expired", "used 2 Nov". */
export function couponStatus(c, now = Date.now()) {
  if (c.used) {
    return { text: t("cp.used", { d: c.usedAt ? new Date(c.usedAt).toLocaleDateString(locale(), { day: "numeric", month: "short" }) : "" }), tone: "" };
  }
  const exp = expiryStatus(c.expiry, now);
  if (!exp) {
    return { text: t("cp.noExpiry"), tone: "" };
  }
  if (exp.state === "expired") {
    return { text: t("cp.expired"), tone: "bad" };
  }
  if (exp.days === 0) {
    return { text: t("cp.today"), tone: "warn" };
  }
  return { text: t("cp.daysLeft", { n: exp.days }), tone: exp.days <= state.settings.remindDays ? "warn" : "" };
}

export function CouponTile({ coupon, i = 0 }) {
  const st = couponStatus(coupon);
  const shop = coupon.cardId ? getCard(coupon.cardId)?.name : coupon.shop;
  return html`<button
    type="button"
    class=${`coupon${coupon.used ? " is-used" : ""}`}
    style=${{ ...tint(couponColor(coupon)), "--i": Math.min(i, 10) }}
    onClick=${() => go(`#coupon-${coupon.id}`)}
  >
    <span class="coupon-left">${coupon.discount || html`<${Icon} name="ticket-percent" />`}</span>
    <span class="coupon-body">
      <span class="coupon-title">${coupon.title}</span>
      ${shop ? html`<span class="coupon-shop">${shop}</span>` : null}
      <span class="coupon-meta"><span class=${`badge ${st.tone}`}>${st.text}</span></span>
    </span>
  </button>`;
}

export function CouponsTab() {
  const [filter, setFilter] = useState("active");
  const now = Date.now();
  const active = state.coupons.filter((c) => !c.used && expiryStatus(c.expiry, now)?.state !== "expired");
  const soon = active.filter((c) => {
    const e = expiryStatus(c.expiry, now);
    return e && e.days <= state.settings.remindDays;
  });
  const used = state.coupons.filter((c) => c.used || expiryStatus(c.expiry, now)?.state === "expired");
  const list = filter === "soon" ? soon : filter === "used" ? used : active;
  const sorted = [...list];
  sorted.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999") || b.createdAt - a.createdAt);
  return html`<div>
    <header class="hero">
      <div class="hero-inner">
        <div class="topbar">
          <h1 class="display sm">${t("cp.title")}</h1>
        </div>
        <div class="hero-stack">
          <div class="hero-chips">
            <span class="chip">${t("cp.active", { n: active.length })}</span>
            ${soon.length ? html`<span class="chip warn">${t("cp.soon", { n: soon.length })}</span>` : null}
          </div>
          <button type="button" class="btn xl block primary" onClick=${() => go("#newc")}><${Icon} name="plus" />${t("cp.add")}</button>
        </div>
      </div>
    </header>
    <${Section}>
      <div class="chips" role="radiogroup" style="margin-bottom:12px">
        ${[
          ["active", `${t("cp.filter.active")} · ${active.length}`],
          ["soon", `${t("cp.filter.soon")} · ${soon.length}`],
          ["used", `${t("cp.filter.used")} · ${used.length}`],
        ].map(
          ([v, label]) =>
            html`<button type="button" role="radio" aria-checked=${String(filter === v)} class=${`chip solid${filter === v ? " is-on" : ""}`} onClick=${() => setFilter(v)}>
              ${label}
            </button>`,
        )}
      </div>
      ${sorted.length
        ? html`<div class="tiles">${sorted.map((c, i) => html`<${CouponTile} key=${c.id} coupon=${c} i=${i} />`)}</div>`
        : html`<div class="empty">
            <h2>${t("cp.emptyTitle")}</h2>
            <p>${t("cp.emptyBody")}</p>
          </div>`}
    <//>
  </div>`;
}

/** #coupon-<id>: the code to show at the till, and "used it". */
export function CouponPage({ id }) {
  const coupon = getCoupon(id);
  const [big, setBig] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saved, setSaved] = useState("");
  useWakeLock();
  if (!coupon) {
    return null;
  }
  const card = coupon.cardId ? getCard(coupon.cardId) : null;
  const shop = card?.name ?? coupon.shop;
  const st = couponStatus(coupon);

  const finishUse = async (amount) => {
    await useCoupon(coupon.id, amount);
    buzz([20, 40, 20]);
    confetti({ count: 60 });
    toast(t("cp.markedUsed"));
    setAsking(false);
  };
  const remind = () =>
    offerFile(
      "kapsa-kupon.ics",
      "text/calendar",
      buildIcs({ title: t("cp.remindTitle", { name: [coupon.discount, shop].filter(Boolean).join(" ") }), date: coupon.expiry, uid: coupon.id, note: coupon.title }),
    );

  return html`<${Page}
    title=${coupon.title}
    actions=${html`<button type="button" class="hbtn" aria-label=${t("cf.titleEdit")} onClick=${() => go(`#ecoupon-${coupon.id}`)}><${Icon} name="pencil" /></button>`}
    hero=${html`<div class="hero-stack">
      ${shop ? html`<span class="eyebrow">${shop}</span>` : null}
      ${coupon.discount ? html`<div class="big-discount">${coupon.discount}</div>` : null}
      <h1 class="display sm">${coupon.title}</h1>
      <div class="hero-chips"><span class=${`chip ${st.tone ? st.tone : ""}`}>${st.text}</span>${coupon.expiry ? html`<span class="chip">${t("cp.validUntil", { d: formatDate(coupon.expiry) })}</span>` : null}</div>
      ${coupon.code
        ? html`<${Ticket} code=${coupon.code} format=${coupon.format} name=${coupon.title} onBig=${() => setBig(true)} />`
        : html`<div class="ticket"><p class="ticket-none">${t("cp.noCode")}</p></div>`}
    </div>`}
  >
    <${Section}>
      <div class="stack">
        ${coupon.used
          ? html`<button type="button" class="btn block" onClick=${() => saveCoupon({ ...coupon, used: false, usedAt: 0, saved: null })}>
              <${Icon} name="undo-2" />${t("cp.unuse")}
            </button>`
          : asking
            ? html`<div class="panel stack">
                <strong>${t("cp.savedQ")}</strong>
                <input
                  id="coupon-saved"
                  class="input big"
                  type="text"
                  inputmode="decimal"
                  placeholder="0"
                  value=${saved}
                  onInput=${(e) => setSaved(e.currentTarget.value)}
                />
                <div class="btn-row">
                  <button type="button" class="btn" onClick=${() => finishUse(null)}>${t("cp.skip")}</button>
                  <button type="button" class="btn primary" onClick=${() => finishUse(Number(saved.replace(",", ".")) || null)}>
                    <${Icon} name="check" />${t("common.save")}
                  </button>
                </div>
              </div>`
            : html`<button type="button" class="btn xl primary block" onClick=${() => setAsking(true)}><${Icon} name="circle-check" />${t("cp.markUsed")}</button>`}
        ${coupon.saved ? html`<p class="hint">${t("st.saved")}: <strong>${money(coupon.saved, state.settings.currency)}</strong></p>` : null}
        ${coupon.note ? html`<div class="panel"><div class="label">${t("cp.conditions")}</div><p style="margin:6px 0 0">${coupon.note}</p></div>` : null}
        ${card ? html`<button type="button" class="mini" onClick=${() => go(`#card-${card.id}`)}>
              <span class="mini-swatch" style=${tint(card.color)}><${Icon} name="credit-card" /></span>
              <span style="min-width:0"><span class="mini-label">${t("tab.wallet")}</span><span class="mini-name">${card.name}</span></span>
              <${Icon} name="chevron-right" />
            </button>` : null}
        <div class="btn-row">
          ${coupon.expiry && !coupon.used ? html`<button type="button" class="btn" onClick=${remind}><${Icon} name="calendar-plus" />${t("card.remind")}</button>` : null}
        </div>
        <${ConfirmButton}
          label=${t("cp.delete")}
          confirm=${t("card.deleteConfirm")}
          onConfirm=${async () => {
            await deleteCoupon(coupon.id);
            toast(t("cp.deleted"));
            back();
          }}
        />
      </div>
    <//>
    ${big ? html`<${BigCode} code=${coupon.code} format=${coupon.format} name=${coupon.title} onClose=${() => setBig(false)} />` : null}
  <//>`;
}
