// Claude features: read a card from a photo, and the chat assistant.
// Uses the official Anthropic SDK (vendor/anthropic.mjs) straight from the phone with the
// user's own API key, which is stored only on this device.

import { FORMATS, fromDetectorFormat } from "./barcode.js";
import { CATEGORIES } from "./brands.js";
import { t } from "./i18n.js";
import { cleanDate, cleanPoints } from "./model.js";
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
  sdkPromise ??= import("../vendor/anthropic.mjs");
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
  },
  required: ["is_card", "shop_name", "card_number", "barcode_type", "brand_color", "category", "expiry", "points", "note"],
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
    isCard: ai.is_card !== false,
  };
}

/**
 * Read a loyalty card from a photo.
 * @param {Blob} file
 * @param {{ rawValue: string, format: string } | null} detected exact barcode read on the phone
 * @param {{ model: string, lang: string }} opts
 */
export async function readCardPhoto(file, detected, opts) {
  const data = await photoToBase64(file);
  const hint = detected
    ? `The phone already decoded a barcode on this card: "${detected.rawValue}" (${detected.format}). Use it as the card number.`
    : "No barcode was decoded on the phone; read the printed number if you can.";
  const response = await send({
    model: opts.model,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: CARD_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          {
            type: "text",
            text: `This is a photo of a loyalty or membership card the user wants to save in a card wallet app. Fill in the fields from what is visible. Copy numbers exactly; never guess digits you cannot read. Write the note in ${opts.lang === "cs" ? "Czech" : "English"}. ${hint}`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    throw new AiError("refusal");
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError("unreadable");
  }
  const reading = mergeCardReading(parsed, detected);
  if (!reading.isCard && !reading.code) {
    throw new AiError("notCard");
  }
  return reading;
}

// ---------- Chat assistant ----------

const SYSTEM_PROMPT = `You are the assistant inside Kapsa, a loyalty-card wallet app on the user's phone.
Help with their loyalty and membership cards: which card to use where, what cards they have, points, expiry dates and notes.
Use the tools to look things up; never invent cards or shops. Card numbers are not available to you.
When you point the user to one of their cards, call show_card so a button to open it appears under your answer.
If the user tells you a points balance, an expiry date or a note for a card, save it with update_card and confirm in one short sentence.
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
   *   runTool: (name: string, input: any) => Promise<{ content: string, isError?: boolean, cardId?: string, saved?: string }>,
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
   * @returns {Promise<{ text: string, cardIds: string[], saved: string[] }>}
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
        return { text: answer, cardIds: [...new Set(cardIds)], saved };
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
          if (out.saved) {
            saved.push(out.saved);
          }
          return { type: "tool_result", tool_use_id: call.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
        }),
      );
      this.messages.push({ role: "user", content: results });
    }
    return { text: answer || t("ai.err.tooLong"), cardIds: [...new Set(cardIds)], saved };
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
  }));
}
