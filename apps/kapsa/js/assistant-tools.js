// Tools the chat assistant can call. They run on the phone and only read or change
// local data; card numbers and coupon codes are never handed to the model.

import { cardsForAssistant, couponsForAssistant } from "./ai.js";
import { shopMatches } from "./brands.js";
import { distanceMeters, rankCards } from "./geo.js";
import { usualDayPart } from "./habits.js";
import { locale, t } from "./i18n.js";
import { cleanDate, cleanMoney, cleanPoints, expiryStatus } from "./model.js";
import { fetchHere } from "./osm.js";
import { byShop, monthOf, monthSummary } from "./stats.js";
import { extraPlaces, getCard, getCoupon, saveCard, savePurchase, state } from "./state.js";
import { money } from "./util.js";

/**
 * @param {string} name
 * @param {any} input
 * @returns {Promise<{ content: string, isError?: boolean, cardId?: string, couponId?: string, saved?: string }>}
 */
export async function runTool(name, input) {
  const now = Date.now();
  if (name === "list_cards") {
    const rows = rankCards(state.cards, state.pos, extraPlaces(), state.settings.radius);
    const distances = {};
    const usual = {};
    for (const r of rows) {
      distances[r.card.id] = r.distance;
      usual[r.card.id] = state.settings.habits ? usualDayPart(r.card.usage) : null;
    }
    const here = rows.filter((r) => r.here).map((r) => r.card.id);
    const list = cardsForAssistant(
      rows.map((r) => r.card),
      { now, distances, here, usual },
    );
    return { content: JSON.stringify({ location_on: Boolean(state.pos), cards: list }) };
  }
  if (name === "list_coupons") {
    const list = couponsForAssistant(state.coupons, {
      now,
      includeUsed: Boolean(input?.include_used),
      daysLeft: (iso) => expiryStatus(iso, now)?.days ?? null,
    });
    return { content: JSON.stringify({ coupons: list }) };
  }
  if (name === "spending_summary") {
    const back = [0, 1, 2, 3, 4, 5].includes(input?.months_ago) ? input.months_ago : 0;
    const { year, month } = monthOf(now, -back);
    const sum = monthSummary(state.purchases, state.coupons, state.cards, year, month);
    const top = byShop(state.purchases, state.cards, year, month)
      .slice(0, 5)
      .map((r) => ({ shop: r.name, spent: r.amount, purchases: r.count }));
    return {
      content: JSON.stringify({
        month: `${year}-${String(month + 1).padStart(2, "0")}`,
        currency: state.settings.currency,
        spent: sum.spent,
        saved: sum.saved,
        visits: sum.visits,
        coupons_used: sum.couponsUsed,
        top_shops: top,
      }),
    };
  }
  if (name === "find_nearby_shops") {
    if (!state.pos) {
      return { content: "Location is off, so nearby shops are unknown. Ask the user to turn on location in Kapsa.", isError: true };
    }
    if (!state.settings.osm) {
      return { content: "The user turned off OpenStreetMap lookups in Kapsa settings.", isError: true };
    }
    const radius = [100, 300, 800].includes(input?.radius_m) ? input.radius_m : 300;
    const shops = (await fetchHere(state.pos, undefined, radius)).slice(0, 25);
    const out = shops.map((s) => {
      const card = state.cards.find((c) => shopMatches(c.name, s.name) || (s.brand && shopMatches(c.name, s.brand)));
      return {
        name: s.name,
        kind: s.kind,
        distance_m: Math.round(distanceMeters(state.pos, s)),
        matching_card_id: card?.id ?? null,
        matching_card_name: card?.name ?? null,
      };
    });
    return { content: JSON.stringify({ radius_m: radius, shops: out }) };
  }
  if (name === "show_card") {
    const card = getCard(String(input?.card_id ?? ""));
    if (!card) {
      return { content: "No card with that id. Call list_cards to get valid ids.", isError: true };
    }
    return { content: `A button for ${card.name} is shown under your answer.`, cardId: card.id };
  }
  if (name === "show_coupon") {
    const coupon = getCoupon(String(input?.coupon_id ?? ""));
    if (!coupon) {
      return { content: "No coupon with that id. Call list_coupons to get valid ids.", isError: true };
    }
    return { content: `A button for the coupon is shown under your answer.`, couponId: coupon.id };
  }
  if (name === "log_purchase") {
    const amount = cleanMoney(input?.amount);
    if (amount === null || amount <= 0) {
      return { content: "amount must be a positive number.", isError: true };
    }
    const card = input?.card_id ? getCard(String(input.card_id)) : null;
    if (input?.card_id && !card) {
      return { content: "No card with that id. Use null and give the shop name instead.", isError: true };
    }
    const shop = card?.name ?? String(input?.shop ?? "").slice(0, 80);
    await savePurchase({ amount, cardId: card?.id ?? null, shop, saved: cleanMoney(input?.saved) ?? 0, at: now, source: "manual" });
    return {
      content: `Recorded ${amount} ${state.settings.currency} at ${shop || "unknown shop"}.`,
      cardId: card?.id,
      saved: `${shop}: ${t("ai.savedPurchase", { a: money(amount, state.settings.currency) })}`,
    };
  }
  if (name === "update_card") {
    const card = getCard(String(input?.card_id ?? ""));
    if (!card) {
      return { content: "No card with that id. Call list_cards to get valid ids.", isError: true };
    }
    const patch = {};
    const done = [];
    if (input.points !== null && input.points !== undefined) {
      patch.points = cleanPoints(input.points);
      done.push(t("ai.savedPoints", { n: new Intl.NumberFormat(locale()).format(patch.points ?? 0) }));
    }
    if (input.expiry !== null && input.expiry !== undefined) {
      const date = cleanDate(input.expiry);
      if (!date) {
        return { content: "expiry must be a real date as YYYY-MM-DD.", isError: true };
      }
      patch.expiry = date;
      done.push(t("ai.savedExpiry", { d: new Date(`${date}T12:00:00`).toLocaleDateString(locale()) }));
    }
    if (input.note !== null && input.note !== undefined) {
      patch.note = String(input.note).slice(0, 500);
      done.push(t("ai.savedNote"));
    }
    if (!done.length) {
      return { content: "Nothing to change." };
    }
    await saveCard({ ...card, ...patch });
    return { content: `Saved on ${card.name}.`, cardId: card.id, saved: `${card.name}: ${done.join(", ")}` };
  }
  return { content: `Unknown tool ${name}.`, isError: true };
}

/** Facts that change every turn; sent after the user's text so the cached prefix stays the same. */
export function turnContext() {
  const when = new Date().toLocaleString(locale(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const loc = state.pos ? `on (±${Math.round(state.pos.accuracy)} m)` : "off";
  return `Local time: ${when}. Location: ${loc}. Currency: ${state.settings.currency}. App language: ${locale().startsWith("cs") ? "Czech" : "English"}.`;
}
