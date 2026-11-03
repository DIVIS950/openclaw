// #log and #log-<cardId>: record what you spent (by hand, or read from a receipt).

import { describeError, hasApiKey, readReceiptPhoto } from "../ai.js";
import { t } from "../i18n.js";
import { cleanMoney } from "../model.js";
import { back, go } from "../nav.js";
import { getCard, payWithGift, savePurchase, state } from "../state.js";
import { buzz, isoDay, money } from "../util.js";
import { giftLine } from "./gift.js";
import { cardLook } from "../look.js";
import { Icon, Seg, Sheet, Toggle, html, toast } from "./kit.js";
import { useRef, useState } from "../../vendor/preact.js";

let preset = null;

/** Open the sheet filled from a receipt reading. */
export function openLogWith(data) {
  preset = data;
  go("#log");
}

/** Read a receipt photo, then open the sheet with the result. */
export async function receiptToLog(file) {
  const r = await readReceiptPhoto(file, { model: state.settings.aiModel });
  const card = r.shop ? state.cards.find((c) => c.name.toLowerCase() === r.shop.toLowerCase()) : null;
  openLogWith({ amount: r.amount, shop: card ? "" : r.shop, cardId: card?.id ?? null, saved: r.saved, date: r.date, fromReceipt: true });
}

export function LogSheet({ cardId }) {
  const [init] = useState(() => {
    const p = preset ?? {};
    preset = null;
    return p;
  });
  const today = isoDay(Date.now());
  const yesterday = isoDay(Date.now() - 86_400_000);
  const [amount, setAmount] = useState(init.amount ? String(init.amount) : "");
  const [selCard, setSelCard] = useState(init.cardId ?? cardId ?? null);
  const [shop, setShop] = useState(init.shop ?? "");
  const [saved, setSaved] = useState(init.saved ? String(init.saved) : "");
  const [date, setDate] = useState(init.date || today);
  const [error, setError] = useState("");
  const [fromGift, setFromGift] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fromReceipt, setFromReceipt] = useState(Boolean(init.fromReceipt));
  const file = useRef(null);
  const dayMode = date === today ? "today" : date === yesterday ? "yesterday" : "other";
  const currency = state.settings.currency;

  const onReceipt = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) {
      return;
    }
    setBusy(true);
    try {
      const r = await readReceiptPhoto(f, { model: state.settings.aiModel });
      setAmount(String(r.amount ?? ""));
      if (r.shop) {
        const card = state.cards.find((c) => c.name.toLowerCase() === r.shop.toLowerCase());
        setSelCard(card?.id ?? null);
        setShop(card ? "" : r.shop);
      }
      if (r.saved) {
        setSaved(String(r.saved));
      }
      if (r.date) {
        setDate(r.date);
      }
      setFromReceipt(true);
      buzz([20, 40, 20]);
    } catch (err) {
      toast(await describeError(err), { ms: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = cleanMoney(amount);
    if (value === null || value <= 0) {
      setError(t("lg.needAmount"));
      return;
    }
    const [y, m, d] = date.split("-").map(Number);
    const at = date === today ? Date.now() : new Date(y, m - 1, d, 12).getTime();
    const card = selCard ? getCard(selCard) : null;
    // Paid with a gift card: take it off its balance too (today's payments only).
    if (card?.kind === "gift" && fromGift && date === today) {
      if (value > (card.balance ?? 0) + 0.001) {
        setError(t("gift.tooMuch", { v: money(card.balance ?? 0, currency) }));
        return;
      }
      await payWithGift(card.id, value);
      buzz([20, 40, 20]);
      toast(t("gift.paid", { v: money(value, currency), left: money(Math.max(0, (card.balance ?? 0) - value), currency) }));
      back();
      return;
    }
    await savePurchase({
      amount: value,
      cardId: card?.id ?? null,
      shop: card?.name ?? shop.trim(),
      saved: cleanMoney(saved) ?? 0,
      at,
      source: fromReceipt ? "receipt" : "manual",
    });
    buzz([20, 40, 20]);
    toast(t("lg.done"));
    back();
  };

  return html`<${Sheet} title=${t("lg.title")}>
    <form class="form" novalidate onSubmit=${submit}>
      <button
        type="button"
        class="btn block"
        disabled=${busy}
        onClick=${async () => {
          if (!(await hasApiKey())) {
            toast(t("ai.needKey"), { action: t("ai.setup"), onAction: () => go("#settings"), ms: 6000 });
            return;
          }
          file.current?.click();
        }}
      >
        ${busy ? html`<span class="orb"></span>${t("ai.reading")}` : html`<${Icon} name="receipt" />${t("lg.readReceipt")}`}
      </button>
      <input ref=${file} id="receipt-photo" type="file" accept="image/*" capture="environment" hidden onChange=${onReceipt} />
      ${fromReceipt ? html`<p class="ai-note"><${Icon} name="sparkles" />${t("lg.fromReceipt")}</p>` : null}

      <label class="field"><span class="label">${t("lg.amount")} (${currency})</span>
        <input
          id="log-amount"
          class="input big"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0"
          value=${amount}
          onInput=${(e) => {
            setAmount(e.currentTarget.value);
            setError("");
          }}
        />
      </label>
      ${error ? html`<p class="err" role="alert">${error}</p>` : null}

      <div class="field">
        <span class="label">${t("lg.shop")}</span>
        ${state.cards.length
          ? html`<div class="chips wrap-chips" role="radiogroup">
              ${state.cards.map(
                (c) => html`<button
                  type="button"
                  role="radio"
                  aria-checked=${String(selCard === c.id)}
                  class=${`chip solid${selCard === c.id ? " is-on" : ""}`}
                  onClick=${() => {
                    setSelCard(selCard === c.id ? null : c.id);
                    setShop("");
                  }}
                >
                  <span class="dot" style=${{ background: cardLook(c).to }}></span>${c.name}
                </button>`,
              )}
            </div>`
          : null}
        ${selCard ? null : html`<input id="log-shop" class="input" placeholder=${t("lg.shopPlaceholder")} value=${shop} onInput=${(e) => setShop(e.currentTarget.value)} />`}
        ${selCard && getCard(selCard)?.kind === "gift" && date === today
          ? html`<${Toggle} id="log-gift" label=${t("gift.fromBalance")} meta=${giftLine(getCard(selCard))} checked=${fromGift} onChange=${setFromGift} />`
          : null}
      </div>

      <div class="field">
        <span class="label">${t("lg.date")}</span>
        <${Seg}
          value=${dayMode}
          options=${[
            ["today", t("common.today")],
            ["yesterday", t("common.yesterday")],
            ["other", "…"],
          ]}
          onChange=${(v) => setDate(v === "today" ? today : v === "yesterday" ? yesterday : date === today || date === yesterday ? isoDay(Date.now() - 2 * 86_400_000) : date)}
        />
        ${dayMode === "other" ? html`<input id="log-date" class="input" type="date" max=${today} value=${date} onInput=${(e) => setDate(e.currentTarget.value || today)} />` : null}
      </div>

      <label class="field"><span class="label">${t("lg.saved")} (${currency})</span>
        <input id="log-saved" class="input mono" inputmode="decimal" placeholder="0" value=${saved} onInput=${(e) => setSaved(e.currentTarget.value)} />
      </label>

      <div class="form-foot">
        <button type="submit" class="btn xl primary block"><${Icon} name="check" />${t("lg.save")}</button>
      </div>
    </form>
  <//>`;
}
