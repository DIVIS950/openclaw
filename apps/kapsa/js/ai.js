// Claude features: read a card, coupon or receipt from a photo, and the chat assistant.
// Uses the official Anthropic SDK (vendor/anthropic.js) straight from the phone with the
// user's own API key, which is stored only on this device.

import { FORMATS, fromDetectorFormat } from "./barcode.js";
import { CATEGORIES, cleanDomain } from "./brands.js";
import { t } from "./i18n.js";
import { cleanDate, cleanMoney, cleanPoints } from "./model.js";
import { kv } from "./store.js";

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];

const KEY_STORE = "aiKey";
let sdkPromise = null;
let cachedKey = null;

function loadSdk() {
  sdkPromise ??= import("../vendor/anthropic.js");
  return sdkPromise;
}

export async function getApiKey() {
  if (cachedKey === null) {
    cachedKey = (await kv.get(KEY_STORE)) ?? "";
  }
  return cachedKey;
}

/** @param {string} key */
export async function setApiKey(key) {
  cachedKey = key.trim();
  if (cachedKey) {
    await kv.set(KEY_STORE, cachedKey);
  } else {
    await kv.set(KEY_STORE, "");
  }
}

export async function hasApiKey() {
  return Boolean(await getApiKey());
}

async function client() {
  const key = await getApiKey();
  if (!key) {
    throw new AiError("noKey");
  }
  const { default: Anthropic } = await loadSdk();
  // The key belongs to the user and never leaves their phone except to call Anthropic,
  // which is the case this SDK flag exists for.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Errors shown to the user, with a translated message. */
export class AiError extends Error {
  /** @param {string} code @param {string} [detail] */
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Turn an SDK error into something the user can act on. */
export async function describeError(err) {
  if (err instanceof AiError) {
    return t(`ai.err.${err.code}`, { detail: err.detail });
  }
  const sdk = await loadSdk().catch(() => null);
  if (sdk) {
    if (err instanceof sdk.AuthenticationError) {
      return t("ai.err.key");
    }
    if (err instanceof sdk.PermissionDeniedError) {
      return t("ai.err.permission");
    }
    if (err instanceof sdk.RateLimitError) {
      return t("ai.err.rate");
    }
    if (err instanceof sdk.BadRequestError) {
      return t("ai.err.request", { detail: err.message });
    }
    if (err instanceof sdk.APIConnectionError) {
      return t("ai.err.offline");
    }
    if (err instanceof sdk.APIError) {
      return Number(err.status) >= 500 ? t("ai.err.busy") : t("ai.err.request", { detail: err.message });
    }
  }
  return t("ai.err.request", { detail: String(err?.message ?? err) });
}

/**
 * One Messages API call. Opus 5.5 and Sonnet 5.5 get server-side refusal fallbacks
 * (Anthropic picks the fallback model by refusal category); Haiku 5.5 has none.
 * @param {Record<string, any>} params
 */
async function send(params) {
  const api = await client();
  const model = params.model;
  if (model === "claude-haiku-5-5") {
    return api.messages.create(params);
  }
  return api.beta.messages.create({
    ...params,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
}

/** Check that the key works, without spending tokens (Models API). */
export async function testKey(model) {
  const api = await client();
  await api.models.retrieve(model);
}

// ---------- Read a card from a photo ----------

const CARD_SCHEMA = {
  type: "object",
  properties: {
    is_card: { type: "boolean", description: "True if the photo shows a loyalty, membership or club card (or its app screen)." },
    shop_name: { type: "string", description: "Shop or brand name as customers know it, e.g. 'Bageterie Boulevard'. Empty if unknown." },
    card_number: {
      type: "string",
      description: "The member/card number exactly as printed under the barcode or on the card, digits and letters only, no spaces. Empty if not readable.",
    },
    barcode_type: {
      type: "string",
      enum: ["ean13", "ean8", "upca", "upce", "code128", "code39", "code93", "itf", "codabar", "qr", "pdf417", "aztec", "datamatrix", "none", "unknown"],
    },
    brand_color: { type: "string", description: "Main background colour of the card as #RRGGBB." },
    category: { type: "string", enum: CATEGORIES.map((c) => c.id) },
    expiry: { type: "string", description: "Expiry date as YYYY-MM-DD if printed, else empty." },
    points: { type: "string", description: "Points or balance if printed, digits only, else empty." },
    note: { type: "string", description: "One short useful line printed on the card (e.g. discount level, member tier), in the user's language. Empty if none." },
    is_gift_card: { type: "boolean", description: "True if this is a gift card or voucher that holds money (dárková karta, poukaz)." },
    gift_value: { type: "string", description: "For a gift card: the amount of money on it if printed, digits only (e.g. '1000'), else empty." },
    pin: { type: "string", description: "For a gift card: the PIN or security code if printed or scratched off, exactly as shown, else empty." },
    website: { type: "string", description: "The shop's website domain if printed on the card, or the well-known domain of a big chain (e.g. 'albert.cz'). Empty if unsure." },
  },
  required: [
    "is_card",
    "shop_name",
    "card_number",
    "barcode_type",
    "brand_color",
    "category",
    "expiry",
    "points",
    "note",
    "is_gift_card",
    "gift_value",
    "pin",
    "website",
  ],
  additionalProperties: false,
};

/**
 * Downscale a photo for the API (long side at most 1568 px) and return base64 JPEG.
 * @param {Blob} file
 */
export async function photoToBase64(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return url.slice(url.indexOf(",") + 1);
}

/**
 * Merge Claude's reading with an exact code read on the phone (if any).
 * Pure, so it can be tested.
 * @param {Record<string, any>} ai
 * @param {{ rawValue: string, format: string } | null} detected
 */
export function mergeCardReading(ai, detected) {
  const aiFormat = ai.barcode_type && ai.barcode_type in FORMATS ? ai.barcode_type : "auto";
  const code = detected?.rawValue?.trim() || String(ai.card_number ?? "").replace(/\s+/g, "");
  return {
    name: String(ai.shop_name ?? "").trim().slice(0, 80),
    code,
    format: detected ? fromDetectorFormat(detected.format) : code ? aiFormat : "none",
    color: /^#[0-9a-f]{6}$/i.test(ai.brand_color ?? "") ? ai.brand_color.toUpperCase() : null,
    category: CATEGORIES.some((c) => c.id === ai.category) ? ai.category : null,
    expiry: cleanDate(ai.expiry),
    points: cleanPoints(ai.points === "" ? null : ai.points),
    note: String(ai.note ?? "").trim().slice(0, 200),
    isCard: ai.is_card !== false || ai.is_gift_card === true,
    kind: ai.is_gift_card === true ? "gift" : "loyalty",
    balance: ai.is_gift_card === true ? cleanMoney(ai.gift_value === "" ? null : ai.gift_value) : null,
    pin: String(ai.pin ?? "").replace(/\s+/g, "").slice(0, 32),
    website: cleanDomain(ai.website),
  };
}

/**
 * One photo + instructions in, one JSON object (matching `schema`) out.
 * @param {Blob} file
 * @param {Record<string, any>} schema
 * @param {string} instructions
 * @param {string} model
 */
async function readPhoto(file, schema, instructions, model) {
  const data = await photoToBase64(file);
  const response = await send({
    model,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: instructions },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    throw new AiError("refusal");
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("unreadable");
  }
}

const COUPON_SCHEMA = {
  type: "object",
  properties: {
    is_coupon: { type: "boolean", description: "True if the photo shows a coupon, voucher, discount or gift card." },
    discount: { type: "string", description: "The headline benefit, very short, e.g. '−20 %', '−100 Kč', '2+1', 'Káva zdarma'. Empty if none." },
    title: { type: "string", description: "Short description of what the coupon is for, in the user's language." },
    shop_name: { type: "string", description: "Shop or brand where it can be used. Empty if unknown." },
    code: { type: "string", description: "Coupon code or barcode number exactly as printed, no spaces. Empty if none." },
    barcode_type: {
      type: "string",
      enum: ["ean13", "ean8", "upca", "upce", "code128", "code39", "code93", "itf", "codabar", "qr", "pdf417", "aztec", "datamatrix", "none", "unknown"],
    },
    expiry: { type: "string", description: "Last valid day as YYYY-MM-DD if printed, else empty." },
    saving_amount: { type: "string", description: "Money saved if it is a fixed amount, digits only, else empty." },
    note: { type: "string", description: "Conditions in one short line (e.g. 'nákup nad 500 Kč'), in the user's language. Empty if none." },
  },
  required: ["is_coupon", "discount", "title", "shop_name", "code", "barcode_type", "expiry", "saving_amount", "note"],
  additionalProperties: false,
};

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean", description: "True if the photo shows a shop receipt." },
    shop_name: { type: "string", description: "Shop or brand name as customers know it, e.g. 'Albert'. Empty if unknown." },
    total: { type: "string", description: "Total amount paid, digits with a decimal point, e.g. '412.50'. Empty if not readable." },
    currency: { type: "string", description: "ISO currency code, e.g. CZK or EUR." },
    date: { type: "string", description: "Purchase date as YYYY-MM-DD if printed, else empty." },
    saved: { type: "string", description: "Total discounts or savings printed on the receipt (loyalty, coupons), digits only, else empty." },
    items: { type: "integer", description: "Number of item lines, 0 if unknown." },
  },
  required: ["is_receipt", "shop_name", "total", "currency", "date", "saved", "items"],
  additionalProperties: false,
};

/**
 * Merge Claude's coupon reading with an exact code read on the phone. Pure.
 * @param {Record<string, any>} ai
 * @param {{ rawValue: string, format: string } | null} detected
 */
export function mergeCouponReading(ai, detected) {
  const code = detected?.rawValue?.trim() || String(ai.code ?? "").replace(/\s+/g, "");
  const aiFormat = ai.barcode_type && ai.barcode_type in FORMATS ? ai.barcode_type : "code128";
  return {
    discount: String(ai.discount ?? "").trim().slice(0, 24),
    title: String(ai.title ?? "").trim().slice(0, 100),
    shop: String(ai.shop_name ?? "").trim().slice(0, 80),
    code,
    format: detected ? fromDetectorFormat(detected.format) : code ? aiFormat : "none",
    expiry: cleanDate(ai.expiry),
    saved: cleanMoney(ai.saving_amount),
    note: String(ai.note ?? "").trim().slice(0, 200),
    isCoupon: ai.is_coupon !== false,
  };
}

/** Pure: receipt reading -> purchase fields. */
export function mergeReceiptReading(ai) {
  return {
    shop: String(ai.shop_name ?? "").trim().slice(0, 80),
    amount: cleanMoney(ai.total),
    currency: /^[A-Z]{3}$/.test(ai.currency ?? "") ? ai.currency : null,
    date: cleanDate(ai.date),
    saved: cleanMoney(ai.saved) ?? 0,
    isReceipt: ai.is_receipt !== false,
  };
}

/**
 * Read a coupon or voucher from a photo.
 * @param {Blob} file
 * @param {{ rawValue: string, format: string } | null} detected
 * @param {{ model: string, lang: string }} opts
 */
export async function readCouponPhoto(file, detected, opts) {
  const hint = detected ? `The phone already decoded a code on it: "${detected.rawValue}" (${detected.format}).` : "";
  const parsed = await readPhoto(
    file,
    COUPON_SCHEMA,
    `This is a photo of a coupon, voucher or leaflet offer the user wants to keep in their wallet app. Fill in the fields from what is visible; copy codes exactly and never guess unreadable characters. Write title and note in ${opts.lang === "cs" ? "Czech" : "English"}. ${hint}`,
    opts.model,
  );
  const reading = mergeCouponReading(parsed, detected);
  if (!reading.isCoupon && !reading.code) {
    throw new AiError("notCoupon");
  }
  return reading;
}

/**
 * Read the shop, total and savings from a receipt photo.
 * @param {Blob} file
 * @param {{ model: string }} opts
 */
export async function readReceiptPhoto(file, opts) {
  const parsed = await readPhoto(
    file,
    RECEIPT_SCHEMA,
    "This is a photo of a shop receipt. Read the shop, the total paid, the date and the total of any discounts or savings. Copy numbers exactly; leave a field empty if you cannot read it.",
    opts.model,
  );
  const reading = mergeReceiptReading(parsed);
  if (!reading.isReceipt || reading.amount === null) {
    throw new AiError("notReceipt");
  }
  return reading;
}

/**
 * Read a loyalty card from a photo.
 * @param {Blob} file
 * @param {{ rawValue: string, format: string } | null} detected exact barcode read on the phone
 * @param {{ model: string, lang: string }} opts
 */
export async function readCardPhoto(file, detected, opts) {
  const hint = detected
    ? `The phone already decoded a barcode on this card: "${detected.rawValue}" (${detected.format}). Use it as the card number.`
    : "No barcode was decoded on the phone; read the printed number if you can.";
  const parsed = await readPhoto(
    file,
    CARD_SCHEMA,
    `This is a photo of a loyalty card, membership card or gift card the user wants to save in a card wallet app. Fill in the fields from what is visible. Copy numbers exactly; never guess digits you cannot read. Write the note in ${opts.lang === "cs" ? "Czech" : "English"}. ${hint}`,
    opts.model,
  );
  const reading = mergeCardReading(parsed, detected);
  if (!reading.isCard && !reading.code) {
    throw new AiError("notCard");
  }
  return reading;
}

// ---------- Chat assistant ----------

const SYSTEM_PROMPT = `You are the assistant inside Kapsa, a loyalty-card wallet app on the user's phone.
Help with their loyalty and membership cards, gift cards (money left on them), coupons and promo codes, stamp cards and spending: which card or coupon to use where, what they have, points, rewards, expiry dates and how much they spend or save.
Use the tools to look things up; never invent cards, coupons, shops or amounts. Card numbers and coupon codes are not available to you.
When you point the user to a card or coupon, call show_card or show_coupon so a button to open it appears under your answer.
If the user tells you a points balance, an expiry date or a note for a card, save it with update_card. If they tell you what they spent ("I spent 230 at Albert"), record it with log_purchase. Confirm saved changes in one short sentence.
Answer in the user's language (Czech or English). Keep answers short and phone-sized: one to three sentences, a short list at most.`;

/** Tool definitions (JSON Schema, strict). */
export const CHAT_TOOLS = [
  {
    name: "list_cards",
    description:
      "List the user's saved cards with category, distance from the user (if location is on), points, expiry, notes, how often and when they usually use it. Call this before answering anything about the user's cards.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "find_nearby_shops",
    description:
      "Find named shops, cafes, pharmacies and fuel stations around the user's current location from OpenStreetMap, each with distance and which of the user's cards matches it (if any).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { radius_m: { type: "integer", enum: [100, 300, 800], description: "Search radius in metres." } },
      required: ["radius_m"],
      additionalProperties: false,
    },
  },
  {
    name: "show_card",
    description: "Show a button under your answer that opens one of the user's cards with its barcode.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { card_id: { type: "string" } },
      required: ["card_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_coupons",
    description:
      "List the user's coupons and vouchers: discount, title, shop, linked card id, expiry, days left, whether used. Call this for anything about coupons, deals or discounts.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { include_used: { type: "boolean", description: "Also list coupons already used." } },
      required: ["include_used"],
      additionalProperties: false,
    },
  },
  {
    name: "show_coupon",
    description: "Show a button under your answer that opens one of the user's coupons with its code.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { coupon_id: { type: "string" } },
      required: ["coupon_id"],
      additionalProperties: false,
    },
  },
  {
    name: "spending_summary",
    description:
      "Spending and savings for a month: total spent, total saved, visits, and the top shops. Months are counted back from the current one (0 = this month, 1 = last month).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { months_ago: { type: "integer", enum: [0, 1, 2, 3, 4, 5] } },
      required: ["months_ago"],
      additionalProperties: false,
    },
  },
  {
    name: "log_purchase",
    description:
      "Record money the user spent. Use card_id when the shop matches one of their cards (from list_cards), otherwise null and give the shop name.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount spent in the user's currency." },
        card_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        shop: { type: "string" },
        saved: { anyOf: [{ type: "number" }, { type: "null" }], description: "Money saved on this purchase, if the user said." },
      },
      required: ["amount", "card_id", "shop", "saved"],
      additionalProperties: false,
    },
  },
  {
    name: "update_card",
    description: "Save a points balance, expiry date or note on one of the user's cards. Use null for fields that should stay as they are.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        points: { anyOf: [{ type: "integer" }, { type: "null" }] },
        expiry: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["card_id", "points", "expiry", "note"],
      additionalProperties: false,
    },
  },
];

/**
 * A chat session. History is kept append-only (assistant turns go back unchanged,
 * thinking blocks included), as the API expects.
 */
export class ChatSession {
  /**
   * @param {{
   *   runTool: (name: string, input: any) => Promise<{ content: string, isError?: boolean, cardId?: string, couponId?: string, saved?: string }>,
   *   model: () => string,
   *   send?: (params: Record<string, any>) => Promise<any>,
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    /** @type {Array<Record<string, any>>} */
    this.messages = [];
  }

  /**
   * Send the user's message and run tools until Claude answers.
   * @param {string} text
   * @param {string} context volatile facts for this turn (time, location on/off)
   * @returns {Promise<{ text: string, cardIds: string[], couponIds: string[], saved: string[] }>}
   */
  async ask(text, context) {
    const before = this.messages.length;
    try {
      return await this.run(text, context);
    } catch (err) {
      // Drop this unfinished turn so the conversation stays valid for the next question.
      this.messages = this.messages.slice(0, before);
      throw err;
    }
  }

  /** @param {string} text @param {string} context */
  async run(text, context) {
    this.messages.push({
      role: "user",
      content: [
        { type: "text", text },
        { type: "text", text: `<context>${context}</context>` },
      ],
    });
    const cardIds = [];
    const couponIds = [];
    const saved = [];
    let answer = "";
    for (let step = 0; step < 6; step++) {
      const call = this.deps.send ?? send;
      const response = await call({
        model: this.deps.model(),
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: CHAT_TOOLS,
        output_config: { effort: "low" },
        messages: this.messages,
      });
      if (response.stop_reason === "refusal") {
        throw new AiError("refusal");
      }
      this.messages.push({ role: "assistant", content: response.content });
      answer = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const calls = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !calls.length) {
        return { text: answer, cardIds: [...new Set(cardIds)], couponIds: [...new Set(couponIds)], saved };
      }
      // All results go back in one user message (keeps parallel tool use working).
      const results = await Promise.all(
        calls.map(async (call) => {
          let out;
          try {
            out = await this.deps.runTool(call.name, call.input);
          } catch (err) {
            out = { content: String(err?.message ?? err), isError: true };
          }
          if (out.cardId) {
            cardIds.push(out.cardId);
          }
          if (out.couponId) {
            couponIds.push(out.couponId);
          }
          if (out.saved) {
            saved.push(out.saved);
          }
          return { type: "tool_result", tool_use_id: call.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
        }),
      );
      this.messages.push({ role: "user", content: results });
    }
    return { text: answer || t("ai.err.tooLong"), cardIds: [...new Set(cardIds)], couponIds: [...new Set(couponIds)], saved };
  }

  reset() {
    this.messages = [];
  }
}

/**
 * What the assistant may see about the user's cards. Card numbers are left out on purpose.
 * Pure, so it can be tested.
 * @param {Array<import("./state.js").Card>} cards
 * @param {{ now: number, distances: Record<string, number | null>, here: Set<string> | string[], usual: Record<string, string | null> }} ctx
 */
export function cardsForAssistant(cards, ctx) {
  const here = new Set(ctx.here);
  return cards.map((c) => ({
    card_id: c.id,
    name: c.name,
    category: c.category,
    at_this_shop_now: here.has(c.id),
    distance_m: ctx.distances[c.id] === null || ctx.distances[c.id] === undefined ? null : Math.round(ctx.distances[c.id]),
    saved_places: c.places?.length ?? 0,
    points: c.points ?? null,
    expiry: c.expiry || null,
    note: c.note || null,
    times_used: c.uses ?? 0,
    last_used: c.lastUsedAt ? new Date(c.lastUsedAt).toISOString().slice(0, 10) : null,
    usually_used: ctx.usual[c.id] ?? null,
    has_barcode: Boolean(c.code) && c.format !== "none",
    has_second_code: Boolean(c.code2),
    sample_card: Boolean(c.sample),
    points_goal: c.pointsGoal ?? null,
    stamps: c.stamps ? { collected: c.stamps.count, goal: c.stamps.goal, reward: c.stamps.reward || null } : null,
    gift_card: c.kind === "gift",
    gift_balance: c.kind === "gift" ? (c.balance ?? null) : null,
  }));
}

/**
 * Coupons as the assistant sees them. Codes are left out on purpose. Pure.
 * @param {Array<import("./model.js").Coupon>} coupons
 * @param {{ now: number, includeUsed: boolean, daysLeft: (iso: string) => number | null }} ctx
 */
export function couponsForAssistant(coupons, ctx) {
  return coupons
    .filter((c) => ctx.includeUsed || !c.used)
    .map((c) => ({
      coupon_id: c.id,
      discount: c.discount || null,
      title: c.title,
      shop: c.shop || null,
      card_id: c.cardId,
      expiry: c.expiry || null,
      days_left: c.expiry ? ctx.daysLeft(c.expiry) : null,
      used: c.used,
      note: c.note || null,
      has_code: Boolean(c.code),
    }));
}
