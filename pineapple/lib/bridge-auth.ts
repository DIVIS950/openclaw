import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

export function hashBridgeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Who may use the Claude bridge: only ElevenLabs (it holds the bridge token as a workspace
 * secret), and only while one of our calls is live. That way a leaked token can't be used to
 * spend the Anthropic key outside a phone call.
 */
export async function checkBridgeRequest(authorization: string | null): Promise<"ok" | "unauthorized" | "no-active-call"> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (!token || token.length > 200) return "unauthorized";
  const presented = hashBridgeToken(token);

  const [row] = await sql<{ token_hash: string | null; active: boolean }>`
    SELECT (SELECT llm_token_hash FROM settings WHERE id = 1) AS token_hash,
           EXISTS (SELECT 1 FROM orders WHERE status IN ('dialing', 'calling', 'processing')) AS active`;
  const envToken = process.env.LLM_BRIDGE_TOKEN?.trim();
  const known = [row?.token_hash, envToken ? hashBridgeToken(envToken) : null].filter((h): h is string => Boolean(h));
  if (!known.some((hash) => sameHash(hash, presented))) return "unauthorized";
  return row?.active ? "ok" : "no-active-call";
}
