import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { effectiveCondition, effectiveCopy, effectivePrice, type Condition } from "../../shared/types.ts";
import { publicUrl } from "../auth.ts";
import { getUser, loadPhoto, updateUser, type EbayAccount, type User } from "../store.ts";
import type { Publisher } from "./types.ts";

/**
 * eBay goes through the official Sell APIs with "Log in with eBay" (OAuth).
 * The server needs one eBay developer app (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_RUNAME);
 * each user then connects their own seller account with one click.
 */
const cfg = () => ({
  clientId: process.env.EBAY_CLIENT_ID ?? "",
  clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
  ruName: process.env.EBAY_RUNAME ?? "",
  sandbox: process.env.EBAY_ENV === "sandbox",
  marketplace: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
  language: process.env.EBAY_CONTENT_LANGUAGE ?? "en-US",
});

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
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

export const ebayAppConfigured = () => Boolean(cfg().clientId && cfg().clientSecret && cfg().ruName);
const host = (prefix: string) => `https://${prefix}${cfg().sandbox ? ".sandbox" : ""}.ebay.com`;
const basicAuth = () => `Basic ${Buffer.from(`${cfg().clientId}:${cfg().clientSecret}`).toString("base64")}`;

// ---------- OAuth ----------

export function ebayLoginStart(c: Context) {
  if (!ebayAppConfigured()) return c.redirect("/#/connections?ebay=not_configured");
  const state = randomBytes(16).toString("hex");
  setCookie(c, "ss_ebay_state", state, {
    httpOnly: true,
    secure: publicUrl(c).startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: cfg().clientId,
    redirect_uri: cfg().ruName,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
  });
  return c.redirect(`https://auth${cfg().sandbox ? ".sandbox" : ""}.ebay.com/oauth2/authorize?${params}`);
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${host("api")}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) throw new Error(`eBay login failed: ${json.error_description ?? res.status}`);
  return json;
}

/** eBay redirects here (the RuName's "accept URL") after the seller approves access. */
export async function ebayLoginCallback(c: Context, user: User) {
  const { code, state } = c.req.query();
  const expected = getCookie(c, "ss_ebay_state");
  deleteCookie(c, "ss_ebay_state", { path: "/" });
  if (!code || !state || state !== expected) return c.redirect("/#/connections?ebay=failed");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: cfg().ruName });
  tokens.set(user.email, { value: t.access_token!, expires: Date.now() + (t.expires_in ?? 7200) * 1000 });
  const account: EbayAccount = {
    refreshToken: t.refresh_token!,
    refreshExpires: new Date(Date.now() + (t.refresh_token_expires_in ?? 0) * 1000).toISOString(),
  };
  await updateUser(user.email, (u) => void (u.ebay = account));
  await ebaySetup(user.email).catch((e) => console.warn("eBay setup", e));
  return c.redirect("/#/connections?ebay=connected");
}

const tokens = new Map<string, { value: string; expires: number }>();

async function accessToken(user: User) {
  const cached = tokens.get(user.email);
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  if (!user.ebay?.refreshToken) throw new Error("eBay isn't connected. Log in with eBay in Connections.");
  const t = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: user.ebay.refreshToken,
    scope: SCOPES.join(" "),
  });
  tokens.set(user.email, { value: t.access_token!, expires: Date.now() + (t.expires_in ?? 7200) * 1000 });
  return t.access_token!;
}

async function ebay<T>(user: User, method: string, url: string, body?: unknown, prefix = "api"): Promise<T> {
  const res = await fetch(`${host(prefix)}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(user)}`,
      "Content-Type": "application/json",
      "Content-Language": cfg().language,
      "X-EBAY-C-MARKETPLACE-ID": cfg().marketplace,
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
  return data;
}

/**
 * Reads the seller's username and business policies (shipping, payment, returns) so posting
 * needs no manual IDs. Policies must exist in Seller Hub; we pick the first of each.
 */
export async function ebaySetup(email: string) {
  const user = await getUser(email);
  if (!user?.ebay) throw new Error("eBay isn't connected");
  const m = cfg().marketplace;
  await ebay(user, "POST", "/sell/account/v1/program/opt_in", { programType: "SELLING_POLICY_MANAGEMENT" }).catch(() => {});
  const [id, ful, pay, ret, loc] = await Promise.all([
    ebay<{ username?: string }>(user, "GET", "/commerce/identity/v1/user/", undefined, "apiz").catch(() => ({ username: undefined })),
    ebay<{ fulfillmentPolicies?: { fulfillmentPolicyId: string }[] }>(user, "GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${m}`).catch(() => ({ fulfillmentPolicies: [] })),
    ebay<{ paymentPolicies?: { paymentPolicyId: string }[] }>(user, "GET", `/sell/account/v1/payment_policy?marketplace_id=${m}`).catch(() => ({ paymentPolicies: [] })),
    ebay<{ returnPolicies?: { returnPolicyId: string }[] }>(user, "GET", `/sell/account/v1/return_policy?marketplace_id=${m}`).catch(() => ({ returnPolicies: [] })),
    ebay<{ locations?: { merchantLocationKey: string }[] }>(user, "GET", "/sell/inventory/v1/location").catch(() => ({ locations: [] })),
  ]);
  return updateUser(email, (u) => {
    if (!u.ebay) return;
    u.ebay.username = id.username ?? u.ebay.username;
    u.ebay.fulfillmentPolicyId = ful.fulfillmentPolicies?.[0]?.fulfillmentPolicyId ?? u.ebay.fulfillmentPolicyId;
    u.ebay.paymentPolicyId = pay.paymentPolicies?.[0]?.paymentPolicyId ?? u.ebay.paymentPolicyId;
    u.ebay.returnPolicyId = ret.returnPolicies?.[0]?.returnPolicyId ?? u.ebay.returnPolicyId;
    u.ebay.locationKey = loc.locations?.[0]?.merchantLocationKey ?? u.ebay.locationKey;
  });
}

/** Creates the "ships from" location eBay requires, from a postal code + country. */
export async function ebayCreateLocation(user: User, postalCode: string, country: string) {
  const key = "snapsell-home";
  await ebay(user, "POST", `/sell/inventory/v1/location/${key}`, {
    location: { address: { postalCode, country: country.toUpperCase() } },
    locationTypes: ["WAREHOUSE"],
    name: "SnapSell",
    merchantLocationStatus: "ENABLED",
  });
  return updateUser(user.email, (u) => void (u.ebay && (u.ebay.locationKey = key)));
}

export async function ebayDisconnect(user: User) {
  tokens.delete(user.email);
  await updateUser(user.email, (u) => void delete u.ebay);
}

function missingSetup(a: EbayAccount) {
  const missing: string[] = [];
  if (!a.fulfillmentPolicyId || !a.paymentPolicyId || !a.returnPolicyId) missing.push("policies");
  if (!a.locationKey) missing.push("location");
  return missing;
}

/** Upload each photo to eBay Picture Services: eBay needs publicly hosted image URLs. */
async function uploadImage(user: User, listingId: string, name: string) {
  const data = await loadPhoto(listingId, name);
  if (!data) throw new Error("A photo is missing");
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(data)], { type: "image/jpeg" }), "photo.jpg");
  const res = await fetch(`${host("apim")}/commerce/media/v1_beta/image/create_image_from_file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(user)}` },
    body: form,
  });
  if (!res.ok) throw new Error(`eBay image upload failed (HTTP ${res.status})`);
  const json = (await res.json().catch(() => ({}))) as { imageUrl?: string };
  if (json.imageUrl) return json.imageUrl;
  const location = res.headers.get("location");
  if (!location) throw new Error("eBay image upload returned no location");
  const img = await fetch(location, { headers: { Authorization: `Bearer ${await accessToken(user)}` } });
  return ((await img.json()) as { imageUrl: string }).imageUrl;
}

export const ebayPublisher: Publisher = {
  platform: "ebay",

  async status(user) {
    const base = { platform: "ebay" as const, mode: "api" as const };
    if (!ebayAppConfigured()) {
      return { ...base, connected: false, unavailable: true, detail: "Add eBay app keys on the server (see README)" };
    }
    if (!user.ebay) return { ...base, connected: false, action: "ebay_login" as const, detail: "Not connected" };
    const missing = missingSetup(user.ebay);
    if (missing.length) {
      return {
        ...base,
        connected: false,
        action: "ebay_setup" as const,
        detail: missing.includes("policies") ? "Create shipping, payment and return policies in Seller Hub" : "Add where you ship from",
      };
    }
    return { ...base, connected: true, detail: `Connected${user.ebay.username ? ` as ${user.ebay.username}` : ""} · official eBay API` };
  },

  async publish({ user, listing, settings, photoNames, progress }) {
    const a = listing.analysis;
    const acct = user.ebay;
    if (!a || !acct) throw new Error("eBay isn't connected");
    const copy = effectiveCopy(listing, "ebay");
    const sku = `snapsell-${listing.id}`;

    progress("Uploading photos to eBay");
    const imageUrls: string[] = [];
    for (const n of photoNames.slice(0, 12)) imageUrls.push(await uploadImage(user, listing.id, n));

    progress("Finding the right category");
    const tree = await ebay<{ categoryTreeId: string }>(
      user,
      "GET",
      `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${cfg().marketplace}`,
    );
    const sugg = await ebay<{ categorySuggestions?: { category: { categoryId: string } }[] }>(
      user,
      "GET",
      `/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(`${a.item.name} ${a.item.category}`)}`,
    );
    const categoryId = sugg.categorySuggestions?.[0]?.category.categoryId;
    if (!categoryId) throw new Error("eBay found no category for this item");

    progress("Creating the listing");
    const aspects: Record<string, string[]> = {};
    for (const at of a.attributes) aspects[at.name] = [at.value];
    await ebay(user, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
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

    const offer = {
      sku,
      marketplaceId: cfg().marketplace,
      format: "FIXED_PRICE",
      availableQuantity: 1,
      categoryId,
      listingDescription: copy.description.replace(/\n/g, "<br>"),
      listingPolicies: {
        fulfillmentPolicyId: acct.fulfillmentPolicyId,
        paymentPolicyId: acct.paymentPolicyId,
        returnPolicyId: acct.returnPolicyId,
      },
      pricingSummary: { price: { value: effectivePrice(listing).toFixed(2), currency: settings.currency } },
      merchantLocationKey: acct.locationKey,
    };
    // Re-use an existing offer for this SKU if a previous attempt created one.
    const existing = await ebay<{ offers?: { offerId: string }[] }>(user, "GET", `/sell/inventory/v1/offer?sku=${sku}`).catch(
      () => ({ offers: [] as { offerId: string }[] }),
    );
    let offerId = existing.offers?.[0]?.offerId;
    if (offerId) await ebay(user, "PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
    else offerId = (await ebay<{ offerId: string }>(user, "POST", "/sell/inventory/v1/offer", offer)).offerId;

    progress("Publishing");
    const { listingId } = await ebay<{ listingId: string }>(user, "POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
    const site = cfg().sandbox ? "sandbox.ebay.com" : (MARKETPLACE_HOST[cfg().marketplace] ?? "www.ebay.com");
    return { status: "live", message: "Live on eBay", url: `https://${site}/itm/${listingId}` };
  },
};
