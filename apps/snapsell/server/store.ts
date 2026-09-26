import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, type Listing, type Settings } from "../shared/types.ts";

export const DATA_DIR = path.resolve(process.env.SNAPSELL_DATA_DIR ?? "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const LISTINGS_FILE = path.join(DATA_DIR, "listings.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

let listings: Map<string, Listing> | null = null;
// Serialize writes so concurrent updates never interleave on disk.
let writeChain: Promise<void> = Promise.resolve();

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

async function load() {
  if (!listings) {
    const arr = await readJson<Listing[]>(LISTINGS_FILE, []);
    listings = new Map(arr.map((l) => [l.id, l]));
  }
  return listings;
}

function persist() {
  writeChain = writeChain.then(async () => {
    const all = [...(await load()).values()];
    await writeJson(LISTINGS_FILE, all);
  });
  return writeChain;
}

export async function listListings() {
  return [...(await load()).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getListing(id: string) {
  return (await load()).get(id);
}

export async function createListing(note?: string): Promise<Listing> {
  const now = new Date().toISOString();
  const listing: Listing = {
    id: randomUUID().slice(0, 8),
    createdAt: now,
    updatedAt: now,
    status: "analyzing",
    note,
    photos: [],
    enhanced: [],
    edits: {},
    publish: {},
  };
  (await load()).set(listing.id, listing);
  await persist();
  return listing;
}

export async function updateListing(id: string, fn: (l: Listing) => void) {
  const l = (await load()).get(id);
  if (!l) throw new Error(`Listing ${id} not found`);
  fn(l);
  l.updatedAt = new Date().toISOString();
  await persist();
  return l;
}

export async function deleteListing(id: string) {
  (await load()).delete(id);
  await persist();
  await fs.rm(path.join(UPLOADS_DIR, id), { recursive: true, force: true });
}

export function listingDir(id: string) {
  return path.join(UPLOADS_DIR, id);
}

/** Only allow plain file names so request data can never escape the uploads dir. */
export function safeName(name: string) {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error("Bad file name");
  return name;
}

export async function savePhoto(id: string, name: string, data: Buffer) {
  const dir = listingDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, safeName(name)), data);
}

export function photoPath(id: string, name: string) {
  return path.join(listingDir(safeName(id)), safeName(name));
}

/** Enhanced photos when available, originals otherwise. */
export function bestPhotoPaths(l: Listing) {
  return l.photos.map((p, i) => photoPath(l.id, l.enhanced[i] ?? p));
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS_FILE, {})) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const next = { ...(await getSettings()), ...patch };
  await writeJson(SETTINGS_FILE, next);
  return next;
}
