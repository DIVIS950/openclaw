import fs from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Where SnapSell keeps its data:
 * - Supabase Storage (free plan) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. Needed on
 *   free cloud hosts like Render, whose disk is wiped whenever the app sleeps.
 * - The local data/ folder otherwise.
 * Everything lives in one private bucket: db/*.json for listings/accounts, photos/<id>/<file>.
 */
export const DATA_DIR = path.resolve(process.env.SNAPSELL_DATA_DIR ?? "data");
const BUCKET = "snapsell";

export const supabaseConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function sb() {
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Create the private bucket on first use; "already exists" is fine.
  bucketReady ??= client.storage
    .createBucket(BUCKET, { public: false })
    .then(({ error }) => {
      if (error && !/exist/i.test(error.message)) throw new Error(`Supabase storage: ${error.message}`);
    });
  return client;
}

async function bucket() {
  const c = sb();
  await bucketReady;
  return c.storage.from(BUCKET);
}

async function readRemote(key: string): Promise<Buffer | null> {
  const { data, error } = await (await bucket()).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function writeRemote(key: string, body: Buffer, contentType: string) {
  const { error } = await (await bucket()).upload(key, body, { upsert: true, contentType });
  if (error) throw new Error(`Supabase storage: ${error.message}`);
}

async function writeLocal(file: string, body: Buffer | string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const buf = supabaseConfigured() ? await readRemote(`db/${name}`) : await fs.readFile(path.join(DATA_DIR, name));
    return buf ? (JSON.parse(buf.toString("utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(name: string, value: unknown) {
  const body = JSON.stringify(value, null, 2);
  if (supabaseConfigured()) await writeRemote(`db/${name}`, Buffer.from(body), "application/json");
  else await writeLocal(path.join(DATA_DIR, name), body);
}

export async function readPhoto(id: string, name: string): Promise<Buffer | null> {
  if (supabaseConfigured()) return readRemote(`photos/${id}/${name}`);
  try {
    return await fs.readFile(path.join(DATA_DIR, "uploads", id, name));
  } catch {
    return null;
  }
}

export async function writePhoto(id: string, name: string, data: Buffer) {
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  if (supabaseConfigured()) await writeRemote(`photos/${id}/${name}`, data, type);
  else await writeLocal(path.join(DATA_DIR, "uploads", id, name), data);
}

export async function deletePhotos(id: string) {
  if (supabaseConfigured()) {
    const b = await bucket();
    const { data } = await b.list(`photos/${id}`);
    if (data?.length) await b.remove(data.map((f) => `photos/${id}/${f.name}`));
    return;
  }
  await fs.rm(path.join(DATA_DIR, "uploads", id), { recursive: true, force: true });
}

/** Quick health check for the setup page. */
export async function storageCheck(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  try {
    await bucket();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
