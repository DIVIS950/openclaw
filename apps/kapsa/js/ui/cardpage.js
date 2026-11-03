// #card-<id>: everything about one card. The card itself first (code ready for the
// till), then gift card money, promo codes, stamps, points, spending and its places.

import { confetti } from "../confetti.js";
import { distanceMeters, formatDistance } from "../geo.js";
import { usualDayPart } from "../habits.js";
import { locale, t } from "../i18n.js";
import { startLocation } from "../location.js";
import { lookVars } from "../look.js";
import { cleanPoints, encodeShare, expiryStatus } from "../model.js";
import { back, go } from "../nav.js";
import { cardMonth } from "../stats.js";
import {
  addPlace,
  addStamp,
  deleteCard,
  forgetLearned,
  getCard,
  learnedFor,
  markUsed,
  redeemStamps,
  removePlace,
  removeStamp,
  saveCard,
  state,
} from "../state.js";
import { buildIcs, buzz, copyText, formatDate, formatNumber, money, offerFile } from "../util.js";
import { newCouponFor } from "./couponform.js";
import { GiftPanel, PromoList, activeCouponsFor, giftLine } from "./gift.js";
import { BigCode, ConfirmButton, Icon, Logo, Page, Section, Seg, Ticket, html, toast, useWakeLock } from "./kit.js";
import { useEffect, useState } from "../../vendor/preact.js";

export function CardPage({ id, row }) {
  const card = getCard(id);
  const [which, setWhich] = useState(0);
  const [big, setBig] = useState(/** @type {any} */ (null));
  useWakeLock();
  useEffect(() => {
    markUsed(id);
  }, [id]);
  if (!card) {
    return null;
  }
  const codes = [{ code: card.code, format: card.format }];
  if (card.code2) {
    codes.push({ code: card.code2, format: card.format2 || "code128" });
  }
  const shown = codes[Math.min(which, codes.length - 1)];
  const coupons = activeCouponsFor(card);
  const exp = expiryStatus(card.expiry, Date.now());

  const share = async () => {
    const url = `${location.origin}${location.pathname}#import=${encodeShare(card)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: t("card.shareText", { name: card.name }), url });
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }
    }
    if (await copyText(url)) {
      toast(t("card.linkCopied"));
    }
  };

  return html`<${Page}
    title=${card.name}
    actions=${html`<button type="button" class="hbtn" aria-label=${t("card.edit")} onClick=${() => go(`#edit-${card.id}`)}><${Icon} name="pencil" /></button>`}
    hero=${html`<div class="hero-stack">
      <div class="wcard big" style=${lookVars(card)}>
        <div class="wcard-top">
          <span class="wcard-title">
            ${row?.here
              ? html`<span class="wchip"><span class="pulse"></span>${t("w.here")}</span>`
              : row && row.distance !== null
                ? html`<span class="wchip">${formatDistance(row.distance, locale())}</span>`
                : html`<span class="wchip">${card.kind === "gift" ? t("gift.kind") : t(`cat.${card.category}`)}</span>`}
            <h1 class="wcard-name">${card.name}</h1>
            ${card.kind === "gift" ? html`<span class="wcard-sub">${giftLine(card)}</span>` : null}
          </span>
          <${Logo} card=${card} cls="lg" />
        </div>
        ${codes.length > 1
          ? html`<${Seg} value=${which} options=${[
              [0, t("card.code1")],
              [1, t("card.code2")],
            ]} onChange=${setWhich} />`
          : null}
        <${Ticket} code=${shown.code} format=${shown.format} name=${card.name} onBig=${() => setBig({ ...shown, name: card.name })} />
        <span class="wcard-tip"><${Icon} name="maximize-2" />${t("card.tapBig")}</span>
      </div>
    </div>`}
  >
    ${card.kind === "gift" ? html`<${GiftPanel} card=${card} />` : null}
    <${Section}
      title=${t("card.coupons")}
      count=${coupons.length || undefined}
      action=${html`<button type="button" class="link-btn" onClick=${() => newCouponFor(card.id)}><${Icon} name="ticket-percent" />${t("card.addCoupon")}</button>`}
    >
      <${PromoList} card=${card} empty=${true} />
    <//>
    ${card.stamps ? html`<${Stamps} card=${card} />` : null}
    ${card.kind !== "gift" ? html`<${Points} card=${card} />` : null}
    <${Spending} card=${card} />
    ${!card.stamps && card.kind !== "gift" ? html`<${StampSetup} card=${card} />` : null}
    <${Places} card=${card} />
    <${Section} title=${t("common.more")}>
      <div class="stack">
        ${card.expiry
          ? html`<div class=${`fact${exp?.state === "expired" ? " bad" : exp?.state === "soon" ? " warn" : ""}`}>
              <span class="label">${t("card.validUntil")}</span>
              <span class="fact-v">${formatDate(card.expiry)}</span>
            </div>`
          : null}
        ${card.note ? html`<div class="panel"><div class="label">${t("card.note")}</div><p style="margin:6px 0 0;white-space:pre-wrap">${card.note}</p></div>` : null}
        <div class="btn-row">
          ${card.expiry
            ? html`<button
                type="button"
                class="btn"
                onClick=${() => offerFile("kapsa-karta.ics", "text/calendar", buildIcs({ title: t("card.remindTitle", { name: card.name }), date: card.expiry, uid: card.id }))}
              >
                <${Icon} name="calendar-plus" />${t("card.remind")}
              </button>`
            : null}
          <button type="button" class="btn" onClick=${share}><${Icon} name="share-2" />${t("card.share")}</button>
        </div>
        <${ConfirmButton}
          label=${t("card.delete")}
          confirm=${t("card.deleteConfirm")}
          onConfirm=${async () => {
            await deleteCard(card.id);
            toast(t("card.deleted"));
            back();
          }}
        />
      </div>
    <//>
    ${big ? html`<${BigCode} ...${big} onClose=${() => setBig(null)} />` : null}
  <//>`;
}

/** Stamp grid: tap +1 at the till; when full, celebrate and use the reward. */
function Stamps({ card }) {
  const s = card.stamps;
  const [fresh, setFresh] = useState(-1);
  const ready = s.count >= s.goal;
  const add = async () => {
    const { ready: nowReady } = await addStamp(card.id);
    setFresh(s.count);
    buzz([20, 40, 20]);
    if (nowReady) {
      confetti();
      toast(t("stamps.ready"));
    }
  };
  const redeem = async () => {
    await redeemStamps(card.id);
    setFresh(-1);
    buzz(30);
    toast(t("stamps.redeemed"));
  };
  return html`<${Section} title=${t("stamps.title")} count=${`${s.count}/${s.goal}`}>
    <div class="panel stack">
      <div class="stamps" aria-label=${`${s.count}/${s.goal}`}>
        ${Array.from({ length: s.goal }, (_, i) => {
          const on = i < s.count;
          const last = i === s.goal - 1;
          return html`<span
            key=${i}
            class=${`stamp${on ? " on" : ""}${i === fresh ? " new" : ""}${last && !on ? " goal" : ""}`}
            aria-hidden="true"
          >
            <${Icon} name=${last ? "gift" : on ? "check" : "stamp"} />
          </span>`;
        })}
      </div>
      <strong style="font-size:18px">${ready ? t("stamps.ready") : t("stamps.left", { n: s.goal - s.count })}</strong>
      ${s.reward ? html`<span class="row hint" style="gap:8px;font-weight:800"><${Icon} name="gift" />${s.reward}</span>` : null}
      ${ready
        ? html`<button type="button" class="btn xl primary block" onClick=${redeem}><${Icon} name="party-popper" />${t("stamps.redeem")}</button>`
        : html`<div class="btn-row">
            <button type="button" class="btn xl primary" style="flex:3 1 200px" onClick=${add}><${Icon} name="stamp" />${t("stamps.add")}</button>
            ${s.count > 0
              ? html`<button type="button" class="btn" style="flex:1 1 90px" onClick=${() => removeStamp(card.id)}><${Icon} name="undo-2" />${t("stamps.undo")}</button>`
              : null}
          </div>`}
      ${s.redeemed ? html`<span class="hint">${t("stamps.total", { n: s.redeemed })}</span>` : null}
    </div>
  <//>`;
}

/** Offer a stamp card for cards that don't have one yet. */
function StampSetup({ card }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(10);
  const [reward, setReward] = useState("");
  if (!open) {
    return html`<${Section}>
      <button type="button" class="mini" onClick=${() => setOpen(true)}>
        <span class="mini-swatch"><${Icon} name="stamp" /></span>
        <span style="min-width:0"><span class="mini-name">${t("stamps.setup")}</span><span class="mini-label" style="text-transform:none;letter-spacing:0">${t("stamps.setupHint")}</span></span>
        <${Icon} name="plus" />
      </button>
    <//>`;
  }
  return html`<${Section} title=${t("stamps.setup")}>
    <div class="panel stack">
      <span class="label">${t("stamps.goal")}</span>
      <${Seg} value=${goal} options=${[5, 6, 8, 10, 12].map((n) => [n, String(n)])} onChange=${setGoal} />
      <label class="label" for="stamp-reward">${t("stamps.reward")}</label>
      <input id="stamp-reward" class="input" value=${reward} placeholder=${t("stamps.rewardPlaceholder")} onInput=${(e) => setReward(e.currentTarget.value)} />
      <button
        type="button"
        class="btn primary block"
        onClick=${() => saveCard({ ...card, stamps: { goal, count: 0, reward: reward.trim(), redeemed: 0 } })}
      >
        <${Icon} name="check" />${t("common.save")}
      </button>
    </div>
  <//>`;
}

function Points({ card }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const has = card.points !== null && card.points !== undefined;
  const save = async (e) => {
    e?.preventDefault();
    await saveCard({ ...card, points: cleanPoints(value.trim() === "" ? null : value) });
    buzz();
    setEditing(false);
  };
  if (!has && !card.pointsGoal && !editing) {
    return null;
  }
  const goal = card.pointsGoal;
  const pct = goal ? Math.min(100, Math.round(((card.points ?? 0) / goal) * 100)) : 0;
  return html`<${Section} title=${t("points.title")}>
    <div class="panel stack">
      ${editing
        ? html`<form class="code-row" onSubmit=${save}>
            <input id="points-edit" class="input big" inputmode="numeric" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} aria-label=${t("points.title")} />
            <button type="submit" class="btn primary"><${Icon} name="check" /></button>
          </form>`
        : html`<div class="row">
            <span class="bignum">${has ? formatNumber(card.points) : "—"}</span>
            <span class="spacer"></span>
            <button
              type="button"
              class="btn sm"
              onClick=${() => {
                setValue(has ? String(card.points) : "");
                setEditing(true);
              }}
            >
              <${Icon} name="pencil" />${t("points.edit")}
            </button>
          </div>`}
      ${goal
        ? html`<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax=${goal} aria-valuenow=${card.points ?? 0}>
              <i style=${{ width: `${pct}%` }}></i>
            </div>
            <strong>${(card.points ?? 0) >= goal ? t("points.reached") : t("points.toGoal", { n: formatNumber(goal - (card.points ?? 0)) })}</strong>`
        : null}
    </div>
  <//>`;
}

function Spending({ card }) {
  const m = cardMonth(card, state.purchases, Date.now());
  return html`<${Section} title=${t("card.spend")}>
    <div class="panel row" style="flex-wrap:wrap">
      <div style="display:grid;gap:2px">
        <span class="bignum">${money(m.spent, state.settings.currency)}</span>
        <span class="hint">${t("card.visits", { n: m.visits })}</span>
      </div>
      <span class="spacer"></span>
      <button type="button" class="btn" onClick=${() => go(`#log-${card.id}`)}><${Icon} name="receipt" />${t("card.logSpend")}</button>
    </div>
  <//>`;
}

function Places({ card }) {
  const pos = state.pos;
  const branches = state.branches[card.id] ?? [];
  const learned = learnedFor(card);
  const part = state.settings.habits ? usualDayPart(card.usage) : null;
  const addHere = async () => {
    if (!state.pos) {
      startLocation();
      toast(t("w.locSearching"));
      return;
    }
    await addPlace(card.id, { lat: state.pos.lat, lon: state.pos.lon, label: "", source: "here" });
    buzz();
    toast(t("card.placeSaved"));
  };
  return html`<${Section} title=${t("card.places")} count=${card.places.length + learned.length}>
    <div class="stack">
      ${part ? html`<span class="chip solid" style="justify-self:start"><${Icon} name="sparkles" />${t("card.usually", { p: t(`habit.${part}`) })}</span>` : null}
      <div class="places">
        ${card.places.map(
          (p) => html`<div class="place" key=${p.id}>
            <${Icon} name="map-pin" />
            <span style="min-width:0;display:grid">
              <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.label || t("card.placeHere")}</strong>
              <span class="hint" style="font-size:12px">${new Date(p.at).toLocaleDateString(locale())}</span>
            </span>
            ${pos ? html`<span class="place-dist">${formatDistance(distanceMeters(pos, p), locale())}</span>` : html`<span></span>`}
            <button type="button" class="ibtn" aria-label=${t("card.removePlace")} onClick=${() => removePlace(card.id, p.id)}><${Icon} name="x" /></button>
          </div>`,
        )}
        ${learned.map(
          (p) => html`<div class="place" key=${p.id}>
            <${Icon} name="sparkles" />
            <span style="min-width:0;display:grid">
              <strong>${t("card.learned")}</strong>
              <span class="hint" style="font-size:12px">${t("card.learnedMeta", { n: p.count })}</span>
            </span>
            ${pos ? html`<span class="place-dist">${formatDistance(distanceMeters(pos, p), locale())}</span>` : html`<span></span>`}
            <button type="button" class="ibtn" aria-label=${t("card.removePlace")} onClick=${() => forgetLearned(card.id, p)}><${Icon} name="x" /></button>
          </div>`,
        )}
        ${card.autoBranches
          ? html`<button type="button" class="place" onClick=${() => go("#map")} disabled=${!branches.length}>
              <${Icon} name="store" />
              <span>${!state.settings.osm ? t("card.branchesOff") : branches.length ? t("card.branches", { n: branches.length }) : t("card.branchesNone")}</span>
              ${branches.length && pos
                ? html`<span class="place-dist">${formatDistance(Math.min(...branches.map((b) => distanceMeters(pos, b))), locale())}</span>`
                : html`<span></span>`}
              <span></span>
            </button>`
          : null}
        ${!card.places.length && !learned.length ? html`<p class="hint">${t("card.noPlaces")}</p>` : null}
      </div>
      <div class="btn-row">
        <button type="button" class="btn sm primary" onClick=${addHere}><${Icon} name="locate-fixed" />${t("card.addHere")}</button>
        <button type="button" class="btn sm" onClick=${() => go(`#find-${card.id}`)}><${Icon} name="search" />${t("card.addSearch")}</button>
        <button type="button" class="btn sm" onClick=${() => go(`#pick-${card.id}`)}><${Icon} name="map" />${t("card.addMap")}</button>
      </div>
    </div>
  <//>`;
}
