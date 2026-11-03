// New coupon (#newc) and edit coupon (#ecoupon-<id>). A coupon can be read from a photo
// by Claude, scanned from its code, or typed in.

import { describeError, hasApiKey, readCouponPhoto } from "../ai.js";
import { FORMAT_ORDER, FORMATS, fromDetectorFormat, guessFormat } from "../barcode.js";
import { confetti } from "../confetti.js";
import { getLang, t } from "../i18n.js";
import { cleanDate, cleanMoney } from "../model.js";
import { go, replace } from "../nav.js";
import { scanImageFile } from "../scanner.js";
import { getCoupon, saveCoupon, state } from "../state.js";
import { buzz } from "../util.js";
import { couponColor } from "./coupons.js";
import { Icon, Page, Sheet, html, tint, toast } from "./kit.js";
import { Scanner } from "./scanner.js";
import { useRef, useState } from "../../vendor/preact.js";

let presetCardId = null;

/** Open the new-coupon sheet already linked to a card. */
export function newCouponFor(cardId) {
  presetCardId = cardId;
  go("#newc");
}

export function NewCouponSheet() {
  const [cardId] = useState(() => {
    const id = presetCardId;
    presetCardId = null;
    return id;
  });
  return html`<${Sheet} tall title=${t("cf.titleAdd")}>
    <${CouponForm} mode="add" prefill=${{ cardId }} />
  <//>`;
}

export function EditCouponPage({ id }) {
  const coupon = getCoupon(id);
  if (!coupon) {
    return null;
  }
  return html`<${Page} color=${couponColor(coupon)} title=${t("cf.titleEdit")} hero=${html`<h1 class="display sm">${t("cf.titleEdit")}</h1>`}>
    <div style="padding:20px var(--gx-r) 0 var(--gx)"><${CouponForm} mode="edit" prefill=${coupon} /></div>
  <//>`;
}

function CouponForm({ mode, prefill }) {
  const [discount, setDiscount] = useState(prefill.discount ?? "");
  const [title, setTitle] = useState(prefill.title ?? "");
  const [cardId, setCardId] = useState(prefill.cardId ?? null);
  const [shop, setShop] = useState(prefill.shop ?? "");
  const [code, setCode] = useState(prefill.code ?? "");
  const [format, setFormat] = useState(prefill.format && prefill.format !== "none" ? prefill.format : "auto");
  const [expiry, setExpiry] = useState(prefill.expiry ?? "");
  const [saves, setSaves] = useState(prefill.saved ? String(prefill.saved) : "");
  const [note, setNote] = useState(prefill.note ?? "");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [fromAi, setFromAi] = useState(false);
  const aiInput = useRef(null);

  const fill = (r) => {
    setDiscount(r.discount || discount);
    setTitle(r.title || title);
    if (r.shop) {
      const card = state.cards.find((c) => c.name.toLowerCase() === r.shop.toLowerCase());
      setCardId(card?.id ?? null);
      setShop(card ? "" : r.shop);
    }
    if (r.code) {
      setCode(r.code);
      setFormat(r.format && r.format !== "none" ? r.format : "auto");
    }
    if (r.expiry) {
      setExpiry(r.expiry);
    }
    if (r.saved) {
      setSaves(String(r.saved));
    }
    if (r.note) {
      setNote(r.note);
    }
  };

  const onAiPhoto = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) {
      return;
    }
    setAiBusy(true);
    try {
      const detected = await scanImageFile(file).catch(() => null);
      const r = await readCouponPhoto(file, detected, { model: state.settings.aiModel, lang: getLang() });
      fill(r);
      setFromAi(true);
      buzz([20, 40, 20]);
    } catch (err) {
      toast(await describeError(err), { ms: 5000 });
    } finally {
      setAiBusy(false);
    }
  };

  const startAi = async () => {
    if (!(await hasApiKey())) {
      toast(t("ai.needKey"), { action: t("ai.setup"), onAction: () => go("#settings"), ms: 6000 });
      return;
    }
    aiInput.current?.click();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!discount.trim() && !title.trim()) {
      setError(t("cf.needTitle"));
      return;
    }
    const c = code.trim();
    const saved = await saveCoupon({
      ...(mode === "edit" ? { id: prefill.id } : {}),
      title: title.trim() || discount.trim(),
      discount: discount.trim(),
      cardId,
      shop: cardId ? "" : shop.trim(),
      code: c,
      format: c ? (format === "auto" ? guessFormat(c) : format) : "none",
      expiry: cleanDate(expiry),
      saved: cleanMoney(saves),
      note: note.trim(),
    });
    buzz([20, 40, 20]);
    if (mode === "add") {
      confetti({ count: 60 });
    }
    toast(t("cf.saved"));
    replace(`#coupon-${saved.id}`);
  };

  if (scanning) {
    return html`<div style="position:fixed;inset:0;z-index:70;background:#000;color:#fff">
      <${Scanner}
        kind="coupon"
        onCode=${(raw) => {
          setCode(raw.rawValue.trim());
          setFormat(fromDetectorFormat(raw.format));
          setScanning(false);
        }}
        onAi=${(r) => {
          fill(r);
          setFromAi(true);
          setScanning(false);
        }}
        onManual=${() => setScanning(false)}
        onClose=${() => setScanning(false)}
      />
    </div>`;
  }

  return html`<form class="form" novalidate onSubmit=${submit}>
    ${mode === "add"
      ? html`<div class="btn-row">
          <button type="button" class="btn violet" onClick=${startAi} disabled=${aiBusy}>
            ${aiBusy ? html`<span class="orb"></span>` : html`<${Icon} name="sparkles" />`}${aiBusy ? t("ai.reading") : t("cf.aiPhoto")}
          </button>
          <button type="button" class="btn" onClick=${() => setScanning(true)}><${Icon} name="scan-barcode" />${t("cf.scanCode")}</button>
        </div>`
      : null}
    ${fromAi ? html`<p class="ai-note"><${Icon} name="sparkles" />${t("ai.filled")}</p>` : null}
    <input ref=${aiInput} id="coupon-ai-photo" type="file" accept="image/*" capture="environment" hidden onChange=${onAiPhoto} />

    <div class="two">
      <label class="field"><span class="label">${t("cf.discount")}</span>
        <input id="coupon-discount" class="input" maxlength="24" placeholder=${t("cf.discountPlaceholder")} value=${discount} onInput=${(e) => setDiscount(e.currentTarget.value)} />
      </label>
      <label class="field"><span class="label">${t("cf.expiry")}</span>
        <input id="coupon-expiry" class="input" type="date" value=${expiry} onInput=${(e) => setExpiry(e.currentTarget.value)} />
      </label>
    </div>
    <label class="field"><span class="label">${t("cf.what")}</span>
      <input id="coupon-title" class="input" maxlength="100" placeholder=${t("cf.whatPlaceholder")} value=${title} onInput=${(e) => setTitle(e.currentTarget.value)} />
    </label>
    ${error ? html`<p class="err" role="alert">${error}</p>` : null}

    <div class="field">
      <span class="label">${t("cf.shop")}</span>
      ${state.cards.length
        ? html`<div class="chips wrap-chips" role="radiogroup">
            ${state.cards.map(
              (c) => html`<button
                type="button"
                role="radio"
                aria-checked=${String(cardId === c.id)}
                class=${`chip solid${cardId === c.id ? " is-on" : ""}`}
                onClick=${() => {
                  setCardId(cardId === c.id ? null : c.id);
                  setShop("");
                }}
              >
                <span style=${{ ...tint(c.color), width: "12px", height: "12px", borderRadius: "4px", border: "2px solid var(--line)", background: c.color }}></span>${c.name}
              </button>`,
            )}
          </div>`
        : null}
      ${cardId
        ? null
        : html`<input id="coupon-shop" class="input" maxlength="80" placeholder=${t("cf.shopPlaceholder")} value=${shop} onInput=${(e) => setShop(e.currentTarget.value)} />`}
    </div>

    <div class="field">
      <label class="label" for="coupon-code">${t("cf.code")}</label>
      <div class="code-row">
        <input id="coupon-code" class="input mono" autocomplete="off" spellcheck="false" placeholder=${t("cf.codePlaceholder")} value=${code} onInput=${(e) => setCode(e.currentTarget.value)} />
        <select id="coupon-format" class="input" aria-label=${t("form.format")} value=${format} onChange=${(e) => setFormat(e.currentTarget.value)}>
          ${FORMAT_ORDER.filter((k) => k !== "none").map((k) => html`<option value=${k}>${k === "auto" ? t("form.formatAuto") : FORMATS[k].label}</option>`)}
        </select>
      </div>
    </div>

    <div class="two">
      <label class="field"><span class="label">${t("cf.saves")}</span>
        <input id="coupon-saves" class="input mono" inputmode="decimal" placeholder="0" value=${saves} onInput=${(e) => setSaves(e.currentTarget.value)} />
      </label>
      <span></span>
    </div>
    <label class="field"><span class="label">${t("cf.note")}</span>
      <textarea id="coupon-note" class="input" maxlength="300" placeholder=${t("cf.notePlaceholder")} value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
    </label>

    <div class="form-foot">
      <button type="submit" class="btn xl pink block"><${Icon} name="check" />${t("cf.save")}</button>
    </div>
  </form>`;
}
