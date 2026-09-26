import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type ExtensionStatus, type Listing, type Settings } from "../shared/types.ts";
import { deletePhotos, readJson, readPhoto, writeJson, writePhoto } from "./storage.ts";

export type EbayAccount = {
  refreshToken: string;
  refreshExpires?: string;
  username?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  locationKey?: string;
};

export type User = {
  email: string;
  name: string;
  picture?: string;
  settings: Settings;
  ebay?: EbayAccount;
  /** sha256 of the Chrome extension's pairing token */
  extTokenHash?: string;
  extension?: { lastSeen: string; sites: ExtensionStatus["sites"] };
};

/** A JSON document loaded once and written back in order (writes never interleave). */
function collection<T>(file: string, key: (v: T) => string) {
  let loading: Promise<Map<string, T>> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const load = () => (loading ??= readJson<T[]>(file, []).then((arr) => new Map(arr.map((v) => [key(v), v]))));
  return {
    load,
    persist() {
      chain = chain.then(async () => writeJson(file, [...(await load()).values()]));
      return chain;
    },
  };
}

const listingsDb = collection<Listing>("listings.json", (l) => l.id);
const usersDb = collection<User>("users.json", (u) => u.email);

// ---------- listings ----------

export async function listListings(owner: string) {
  return [...(await listingsDb.load()).values()]
    .filter((l) => l.owner === owner)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function allListings() {
  return [...(await listingsDb.load()).values()];
}

/** Returns the listing only when it belongs to `owner`. */
export async function getListing(id: string, owner: string) {
  const l = (await listingsDb.load()).get(id);
  return l && l.owner === owner ? l : undefined;
}

export async function createListing(owner: string, note?: string): Promise<Listing> {
  const now = new Date().toISOString();
  const listing: Listing = {
    id: randomUUID().slice(0, 8),
    owner,
    createdAt: now,
    updatedAt: now,
    status: "analyzing",
    note,
    photos: [],
    enhanced: [],
    edits: {},
    publish: {},
  };
  (await listingsDb.load()).set(listing.id, listing);
  await listingsDb.persist();
  return listing;
}

/** Hands listings made in local mode over to the first real account. */
export async function reassignListings(from: string, to: string) {
  for (const l of (await listingsDb.load()).values()) if (l.owner === from) l.owner = to;
  await listingsDb.persist();
}

export async function updateListing(id: string, owner: string, fn: (l: Listing) => void) {
  const l = await getListing(id, owner);
  if (!l) throw new Error(`Listing ${id} not found`);
  fn(l);
  l.updatedAt = new Date().toISOString();
  await listingsDb.persist();
  return l;
}

export async function deleteListing(id: string, owner: string) {
  if (!(await getListing(id, owner))) return;
  (await listingsDb.load()).delete(id);
  await listingsDb.persist();
  await deletePhotos(safeName(id));
}

/** Only allow plain file names so request data can never escape the uploads dir. */
export function safeName(name: string) {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error("Bad file name");
  return name;
}

export function savePhoto(id: string, name: string, data: Buffer) {
  return writePhoto(safeName(id), safeName(name), data);
}

export function loadPhoto(id: string, name: string) {
  return readPhoto(safeName(id), safeName(name));
}

/** Enhanced photo names when available, originals otherwise. */
export function bestPhotoNames(l: Listing) {
  return l.photos.map((p, i) => l.enhanced[i] ?? p);
}

// ---------- users ----------

export async function listUsers() {
  return [...(await usersDb.load()).values()];
}

export async function getUser(email: string) {
  return (await usersDb.load()).get(email);
}

export async function upsertUser(email: string, patch: Partial<Omit<User, "email">>): Promise<User> {
  const users = await usersDb.load();
  const existing = users.get(email);
  const user: User = {
    email,
    name: email.split("@")[0],
    settings: { ...DEFAULT_SETTINGS },
    ...existing,
    ...patch,
  };
  user.settings = { ...DEFAULT_SETTINGS, ...user.settings };
  users.set(email, user);
  await usersDb.persist();
  return user;
}

export async function updateUser(email: string, fn: (u: User) => void) {
  const u = (await getUser(email)) ?? (await upsertUser(email, {}));
  fn(u);
  await usersDb.persist();
  return u;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** New pairing token for the Chrome extension; replaces the previous one. */
export async function newExtensionToken(email: string) {
  const token = `ss_${randomBytes(24).toString("base64url")}`;
  await updateUser(email, (u) => void (u.extTokenHash = hashToken(token)));
  return token;
}

export async function userForExtensionToken(token: string) {
  const h = hashToken(token);
  return [...(await usersDb.load()).values()].find((u) => u.extTokenHash === h);
}

// ---------- secrets ----------

/** Session signing secret: SESSION_SECRET, else one generated once and stored with the data. */
let secret: Promise<string> | null = null;
export function sessionSecret() {
  if (process.env.SESSION_SECRET) return Promise.resolve(process.env.SESSION_SECRET);
  return (secret ??= (async () => {
    const saved = await readJson<{ secret?: string }>("session-secret.json", {});
    if (saved.secret) return saved.secret;
    const s = randomBytes(32).toString("hex");
    await writeJson("session-secret.json", { secret: s });
    return s;
  })());
}
