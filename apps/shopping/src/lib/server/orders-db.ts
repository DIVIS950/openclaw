import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { Order } from "../order-types";

/**
 * Order storage. Production uses Upstash Redis (Vercel Marketplace sets
 * KV_REST_API_URL/KV_REST_API_TOKEN, or use UPSTASH_REDIS_REST_URL/TOKEN).
 * Local development (or ORBIT_FILE_DB=1) uses a JSON file in .data/.
 */
interface OrderDb {
  get(id: string): Promise<Order | null>;
  put(order: Order): Promise<void>;
  list(): Promise<Order[]>;
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

// ORBIT_FILE_DB=1 allows the JSON file store on a single self-hosted server.
export const dbConfigured = Boolean(redisUrl && redisToken) || process.env.NODE_ENV !== "production" || process.env.ORBIT_FILE_DB === "1";

function redisDb(): OrderDb {
  const redis = new Redis({ url: redisUrl!, token: redisToken! });
  return {
    get: async (id) => (await redis.get<Order>(`order:${id}`)) ?? null,
    async put(order) {
      await redis.set(`order:${order.id}`, order);
      await redis.zadd("orders", { score: order.createdAt, member: order.id });
    },
    async list() {
      const ids = await redis.zrange<string[]>("orders", 0, 199, { rev: true });
      if (!ids.length) return [];
      const rows = await redis.mget<(Order | null)[]>(...ids.map((id) => `order:${id}`));
      return rows.filter((o): o is Order => Boolean(o));
    },
  };
}

function fileDb(): OrderDb {
  const file = path.join(process.cwd(), ".data", "orders.json");
  // Serialise writes so concurrent requests can't clobber each other.
  let chain: Promise<unknown> = Promise.resolve();
  const readAll = async (): Promise<Record<string, Order>> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, Order>;
    } catch {
      return {};
    }
  };
  return {
    get: async (id) => (await readAll())[id] ?? null,
    put(order) {
      const next = chain.then(async () => {
        const all = await readAll();
        all[order.id] = order;
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(all, null, 1));
      });
      chain = next.catch(() => {});
      return next;
    },
    list: async () => Object.values(await readAll()).sort((a, b) => b.createdAt - a.createdAt),
  };
}

let db: OrderDb | null = null;
export function orders(): OrderDb {
  if (!dbConfigured) throw new Error("Order storage is not configured (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).");
  db ??= redisUrl && redisToken ? redisDb() : fileDb();
  return db;
}

export const newId = () => `ord_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
export const newToken = () => randomBytes(18).toString("base64url");
