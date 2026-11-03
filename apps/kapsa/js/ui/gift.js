// Gift cards (money on the card) and promo codes on a card.
//   #pay-<id>    pay with a gift card, or set what's left on it
//   #promo-<id>  add a promo code to a card in three fields

import { guessFormat } from "../barcode.js";
import { t } from "../i18n.js";
import { lookVars } from "../look.js";
import { cleanDate, cleanMoney, expiryStatus } from "../model.js";
import { back, go } from "../nav.js";
import { couponsForCard, getCard, payWithGift, saveCoupon, setGiftBalance, state, undoGiftPayment } from "../state.js";
import { buzz, copyText, formatDate, money } from "../util.js";
import { confetti } from "../confetti.js";
import { Icon, Logo, Section, Sheet, html, toast } from "./kit.js";
import { useState } from "../../vendor/preact.js";

const cur = () => state.settings.currency;

/** "1 500 Kč left" for a gift card, "" for other cards. */
export function giftLine(card) {
  return card.kind === "gift" ? t("gift.left", { v: money(card.balance ?? 0, cur()) }) : "";
}

/** Active coupons and promo codes of a card, soonest ending first. */
export function activeCouponsFor(card, now = Date.now()) {
  const list = couponsForCard(card).filter((c) => !c.used && expiryStatus(c.expiry, now)?.state !== "expired");
  list.sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
  return list;
}

/** Pay with a gift card; the toast offers Undo. */
async function pay(card, amount) {
  const r = await payWithGift(card.id, amount);
  if (!r) {
    return false;
  }
  buzz([20, 40, 20]);
  toast(t("gift.paid", { v: money(amount, cur()), left: money(r.card.balance ?? 0, cur()) }), {
    action: t("common.undo"),
    ms: 6000,
    onAction: () => undoGiftPayment(r.purchase.id),
  });
  return true;
}

/** #pay-<id> */
export function PaySheet({ id }) {
  const card = getCard(id);
  const [mode, setMode] = useState("pay");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  if (!card || card.kind !== "gift") {
    return null;
  }
  const balance = card.balance ?? 0;
  const submit = async (e) => {
    e.preventDefault();
    const amount = cleanMoney(value);
    if (amount === null || amount < 0 || (mode === "pay" && amount === 0)) {
      setError(t("gift.needAmount"));
      return;
    }
    if (mode === "pay") {
      if (amount > balance + 0.001) {
        setError(t("gift.tooMuch", { v: money(balance, cur()) }));
        return;
      }
      if (await pay(card, amount)) {
        back();
      }
      return;
    }
    await setGiftBalance(card.id, amount);
    buzz();
    toast(t("gift.balanceSaved"));
    back();
  };
  return html`<${Sheet} title=${mode === "pay" ? t("gift.payTitle") : t("gift.setTitle")}>
    <form class="form" onSubmit=${submit}>
      <div class="wcard mini-card" style=${lookVars(card)}>
        <span class="wcard-top">
          <span class="wcard-title"><span class="wcard-name">${card.name}</span><span class="wcard-sub">${giftLine(card)}</span></span>
          <${Logo} card=${card} />
        </span>
      </div>
      <label class="field">
        <span class="label">${mode === "pay" ? t("gift.amount") : t("gift.newBalance")}</span>
        <input
          id="gift-amount"
          class="input big"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0"
          value=${value}
          onInput=${(e) => {
            setValue(e.currentTarget.value);
            setError("");
          }}
        />
      </label>
      ${mode === "pay" && balance > 0
        ? html`<button type="button" class="chip solid" style="justify-self:start" onClick=${() => setValue(String(balance))}>
            ${t("gift.all", { v: money(balance, cur()) })}
          </button>`
        : null}
      ${error ? html`<p class="err" role="alert">${error}</p>` : null}
      <button type="submit" class="btn xl primary block">
        <${Icon} name=${mode === "pay" ? "wallet" : "check"} />${mode === "pay" ? t("gift.payButton") : t("gift.saveBalance")}
      </button>
      <button
        type="button"
        class="btn ghost"
        onClick=${() => {
          setMode(mode === "pay" ? "set" : "pay");
          setValue(mode === "pay" ? String(balance) : "");
          setError("");
        }}
      >
        ${mode === "pay" ? t("gift.setInstead") : t("gift.payInstead")}
      </button>
    </form>
  <//>`;
}

/** Card page: what's left, pay, PIN and recent payments. */
export function GiftPanel({ card }) {
  const balance = card.balance ?? 0;
  const initial = Math.max(card.initialBalance ?? 0, balance);
  const pct = initial ? Math.round((balance / initial) * 100) : 0;
  const payments = state.purchases.filter((p) => p.cardId === card.id && p.source === "gift");
  payments.sort((a, b) => b.at - a.at);
  payments.length = Math.min(payments.length, 5);
  return html`<${Section} title=${t("gift.title")}>
    <div class="panel stack">
      <div class="row" style="align-items:baseline;flex-wrap:wrap;gap:8px">
        <span class="bignum">${money(balance, cur())}</span>
        ${initial ? html`<span class="hint">${t("gift.of", { v: money(initial, cur()) })}</span>` : null}
      </div>
      ${initial
        ? html`<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax=${initial} aria-valuenow=${balance}><i style=${{ width: `${pct}%` }}></i></div>`
        : null}
      <div class="btn-row">
        <button type="button" class="btn primary" disabled=${balance <= 0} onClick=${() => go(`#pay-${card.id}`)}><${Icon} name="wallet" />${t("gift.payButton")}</button>
      </div>
      ${card.pin ? html`<${PinRow} pin=${card.pin} />` : null}
      ${payments.length
        ? html`<div class="stack" style="gap:6px">
            <span class="label">${t("gift.history")}</span>
            ${payments.map(
              (p) => html`<div class="row hist" key=${p.id}>
                <span class="hint">${formatDate(new Date(p.at).toISOString().slice(0, 10))}</span>
                <span class="spacer"></span>
                <strong>−${money(p.amount, cur())}</strong>
              </div>`,
            )}
          </div>`
        : null}
    </div>
  <//>`;
}

/** PIN hidden behind a tap (people stand next to you at the till). */
export function PinRow({ pin, onCard = false }) {
  const [open, setOpen] = useState(false);
  return html`<div class=${`pin-row${onCard ? " on-card" : ""}`}>
    <span class="pin-label">PIN</span>
    <span class="pin-value mono">${open ? pin : "•".repeat(Math.min(8, Math.max(4, pin.length)))}</span>
    <button type="button" class="pin-btn" onClick=${() => setOpen(!open)}>${open ? t("gift.hidePin") : t("gift.showPin")}</button>
    ${open
      ? html`<button
          type="button"
          class="pin-btn"
          aria-label=${t("card.copy")}
          onClick=${async () => {
            if (await copyText(pin)) {
              buzz();
              toast(t("card.copied"));
            }
          }}
        >
          <${Icon} name="copy" />
        </button>`
      : null}
  </div>`;
}

/**
 * Coupons and promo codes of one card, each with its code ready to copy.
 * @param {{ card: any, empty?: boolean }} props `empty`: still show when there are none
 */
export function PromoList({ card, empty = false }) {
  const list = activeCouponsFor(card);
  if (!list.length && !empty) {
    return null;
  }
  return html`<div class="promos">
    ${list.map(
      (c) => html`<div class="promo" key=${c.id} style=${lookVars(card)}>
        <button type="button" class="promo-main" onClick=${() => go(`#coupon-${c.id}`)}>
          <span class="promo-badge">${c.discount || html`<${Icon} name="ticket-percent" />`}</span>
          <span class="promo-text">
            <span class="promo-title">${c.title}</span>
            ${c.code ? html`<span class="promo-code mono">${c.code}</span>` : html`<span class="promo-code">${t("cp.noCodeShort")}</span>`}
          </span>
        </button>
        ${c.code
          ? html`<button
              type="button"
              class="promo-copy"
              aria-label=${t("card.copy")}
              onClick=${async () => {
                if (await copyText(c.code)) {
                  buzz();
                  toast(t("card.copied"));
                }
              }}
            >
              <${Icon} name="copy" />
            </button>`
          : null}
      </div>`,
    )}
    <button type="button" class="promo-add" onClick=${() => go(`#promo-${card.id}`)}><${Icon} name="plus" />${t("promo.add")}</button>
  </div>`;
}

/** #promo-<cardId>: a promo code for this card in three fields. */
export function PromoSheet({ id }) {
  const card = getCard(id);
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState("");
  if (!card) {
    return null;
  }
  const submit = async (e) => {
    e.preventDefault();
    const clean = code.trim();
    if (!clean) {
      setError(t("promo.needCode"));
      return;
    }
    await saveCoupon({
      title: t("promo.title"),
      discount: discount.trim().slice(0, 24),
      cardId: card.id,
      shop: card.name,
      code: clean,
      format: guessFormat(clean),
      expiry: cleanDate(expiry),
    });
    buzz([20, 40, 20]);
    confetti({ count: 40 });
    toast(t("promo.saved"));
    back();
  };
  return html`<${Sheet} title=${t("promo.sheetTitle", { name: card.name })}>
    <form class="form" onSubmit=${submit}>
      <label class="field">
        <span class="label">${t("promo.code")}</span>
        <input
          id="promo-code"
          class="input mono"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="512"
          placeholder="LETO20"
          value=${code}
          onInput=${(e) => {
            setCode(e.currentTarget.value);
            setError("");
          }}
        />
      </label>
      ${error ? html`<p class="err" role="alert">${error}</p>` : null}
      <div class="two">
        <label class="field">
          <span class="label">${t("promo.gives")}</span>
          <input id="promo-discount" class="input" maxlength="24" placeholder="−20 %" value=${discount} onInput=${(e) => setDiscount(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span class="label">${t("promo.until")}</span>
          <input id="promo-expiry" class="input" type="date" value=${expiry} onInput=${(e) => setExpiry(e.currentTarget.value)} />
        </label>
      </div>
      <button type="submit" class="btn xl primary block"><${Icon} name="check" />${t("promo.save")}</button>
    </form>
  <//>`;
}
