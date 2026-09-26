import fs from "node:fs/promises";
import path from "node:path";
import { effectiveCondition, effectiveCopy, effectivePrice, type Condition } from "../../shared/types.ts";
import type { Publisher } from "./types.ts";

/**
 * eBay is posted through the official Sell APIs (no browser needed).
 * Needs an eBay developer app + a user refresh token and business policies, see README.
 */
const env = () => ({
  clientId: process.env.EBAY_CLIENT_ID,
  clientSecret: process.env.EBAY_CLIENT_SECRET,
  refreshToken: process.env.EBAY_REFRESH_TOKEN,
  sandbox: process.env.EBAY_ENV === "sandbox",
  marketplace: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
  language: process.env.EBAY_CONTENT_LANGUAGE ?? "en-US",
  fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
  paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
  returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
  locationKey: process.env.EBAY_LOCATION_KEY,
});

const REQUIRED = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_REFRESH_TOKEN",
  "EBAY_FULFILLMENT_POLICY_ID",
  "EBAY_PAYMENT_POLICY_ID",
  "EBAY_RETURN_POLICY_ID",
  "EBAY_LOCATION_KEY",
];

const CONDITION: Record<Condition, string> = {
  new: "NEW",
  like_new: "USED_EXCELLENT",
  good: "USED_GOOD",
  fair: "USED_ACCEPTABLE",
  poor: "FOR_PARTS_OR_NOT_WORKING",
};

const MARKETPLACE_HOST: Record<string, string> = {
  EBAY_US: "www.ebay.com",
  EBAY_GB: "www.ebay.co.uk",
  EBAY_DE: "www.ebay.de",
  EBAY_FR: "www.ebay.fr",
  EBAY_IT: "www.ebay.it",
  EBAY_ES: "www.ebay.es",
  EBAY_AU: "www.ebay.com.au",
  EBAY_CA: "www.ebay.ca",
  EBAY_PL: "www.ebay.pl",
};

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken() {
  const e = env();
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`https://api${e.sandbox ? ".sandbox" : ""}.ebay.com/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${e.clientId}:${e.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: e.refreshToken ?? "",
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`eBay login failed: ${json.error_description ?? res.status}`);
  cachedToken = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 7200) * 1000 };
  return cachedToken.value;
}

async function ebay<T>(method: string, url: string, body?: unknown, host = "api"): Promise<{ data: T; res: Response }> {
  const e = env();
  const res = await fetch(`https://${host}${e.sandbox ? ".sandbox" : ""}.ebay.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "Content-Language": e.language,
      "X-EBAY-C-MARKETPLACE-ID": e.marketplace,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: T & { errors?: { message: string; longMessage?: string }[] };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`eBay: unexpected response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const err = data.errors?.[0];
    throw new Error(`eBay: ${err?.longMessage ?? err?.message ?? `HTTP ${res.status}`}`);
  }
  return { data, res };
}

/** eBay needs publicly hosted images, so upload each photo to eBay Picture Services first. */
async function uploadImage(file: string) {
  const e = env();
  const form = new FormData();
  form.append("image", new Blob([await fs.readFile(file)], { type: "image/jpeg" }), path.basename(file));
  const res = await fetch(
    `https://apim${e.sandbox ? ".sandbox" : ""}.ebay.com/commerce/media/v1_beta/image/create_image_from_file`,
    { method: "POST", headers: { Authorization: `Bearer ${await accessToken()}` }, body: form },
  );
  if (!res.ok) throw new Error(`eBay image upload failed (HTTP ${res.status})`);
  const json = (await res.json().catch(() => ({}))) as { imageUrl?: string };
  if (json.imageUrl) return json.imageUrl;
  const location = res.headers.get("location");
  if (!location) throw new Error("eBay image upload returned no location");
  const img = await fetch(location, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const meta = (await img.json()) as { imageUrl: string };
  return meta.imageUrl;
}

async function suggestCategory(query: string) {
  const { data: tree } = await ebay<{ categoryTreeId: string }>(
    "GET",
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${env().marketplace}`,
  );
  const { data } = await ebay<{ categorySuggestions?: { category: { categoryId: string } }[] }>(
    "GET",
    `/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
  );
  const id = data.categorySuggestions?.[0]?.category.categoryId;
  if (!id) throw new Error(`eBay found no category for "${query}"`);
  return id;
}

export const ebayPublisher: Publisher = {
  platform: "ebay",

  async status() {
    const missing = REQUIRED.filter((k) => !process.env[k]);
    return {
      platform: "ebay",
      connected: missing.length === 0,
      mode: "api",
      detail: missing.length ? `Add ${missing.length} eBay keys to .env (see README)` : `Official API · ${env().marketplace}`,
    };
  },

  async publish({ listing, settings, photoPaths, progress }) {
    const e = env();
    const a = listing.analysis;
    if (!a) throw new Error("Listing has no analysis yet");
    const copy = effectiveCopy(listing, "ebay");
    const sku = `snapsell-${listing.id}`;

    progress("Uploading photos to eBay");
    const imageUrls: string[] = [];
    for (const p of photoPaths.slice(0, 12)) imageUrls.push(await uploadImage(p));

    progress("Finding the right category");
    const categoryId = await suggestCategory(`${a.item.name} ${a.item.category}`);

    progress("Creating the listing");
    const aspects: Record<string, string[]> = {};
    for (const at of a.attributes) aspects[at.name] = [at.value];
    await ebay("PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: CONDITION[effectiveCondition(listing)],
      conditionDescription: a.conditionNotes.slice(0, 1000),
      product: {
        title: copy.title.slice(0, 80),
        description: copy.description,
        aspects,
        imageUrls,
        ...(a.item.brand ? { brand: a.item.brand } : {}),
      },
    });

    // Re-use an existing offer for this SKU if we've tried before.
    const { data: existing } = await ebay<{ offers?: { offerId: string }[] }>(
      "GET",
      `/sell/inventory/v1/offer?sku=${sku}`,
    ).catch(() => ({ data: { offers: [] as { offerId: string }[] } }));
    const offer = {
      sku,
      marketplaceId: e.marketplace,
      format: "FIXED_PRICE",
      availableQuantity: 1,
      categoryId,
      listingDescription: copy.description.replace(/\n/g, "<br>"),
      listingPolicies: {
        fulfillmentPolicyId: e.fulfillmentPolicyId,
        paymentPolicyId: e.paymentPolicyId,
        returnPolicyId: e.returnPolicyId,
      },
      pricingSummary: { price: { value: effectivePrice(listing).toFixed(2), currency: settings.currency } },
      merchantLocationKey: e.locationKey,
    };
    let offerId = existing.offers?.[0]?.offerId;
    if (offerId) await ebay("PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
    else offerId = (await ebay<{ offerId: string }>("POST", "/sell/inventory/v1/offer", offer)).data.offerId;

    progress("Publishing");
    const { data } = await ebay<{ listingId: string }>("POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
    const host = e.sandbox ? "sandbox.ebay.com" : (MARKETPLACE_HOST[e.marketplace] ?? "www.ebay.com");
    return { status: "live", message: "Live on eBay", url: `https://${host}/itm/${data.listingId}` };
  },
};
