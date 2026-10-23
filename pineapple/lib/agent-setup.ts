import "server-only";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { BRIDGE_SECRET_NAME, voiceOptionsFromEnv } from "./agent-config";
import { hashBridgeToken } from "./bridge-auth";
import { claudeModel } from "./claude-config";
import { createAgent, updateAgent, upsertWorkspaceSecret } from "./elevenlabs";
import { listActiveOrders } from "./orders";
import { getSettings, saveAgentId, saveBridgeToken } from "./settings";

/** The public https URL ElevenLabs uses to reach this app's Claude bridge. */
export async function appBaseUrl(): Promise<string> {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  // Set automatically by Vercel: the project's production domain, without protocol.
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Can't tell this app's address. Set APP_URL in Vercel.");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

/**
 * Creates the voice agent, or updates it to the current prompt and settings.
 * Each run issues a fresh bridge token: ElevenLabs keeps it as a workspace secret, the app keeps
 * only its hash, and the Anthropic key itself never leaves Vercel.
 */
export async function setUpAgent(): Promise<{ agentId: string; created: boolean; bridgeUrl: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Add ANTHROPIC_API_KEY (your Claude key) in Vercel and redeploy first.");
  if ((await listActiveOrders()).length > 0) throw new Error("Wait until the current call has finished.");

  const settings = await getSettings();
  const bridgeUrl = `${await appBaseUrl()}/api/llm`;
  const token = randomBytes(32).toString("base64url");
  const secretId = await upsertWorkspaceSecret(BRIDGE_SECRET_NAME, token, settings.llmSecretId);
  await saveBridgeToken(hashBridgeToken(token), secretId);

  const options = { bridgeUrl, bridgeSecretId: secretId, claudeModel: claudeModel(), ...voiceOptionsFromEnv() };
  if (settings.agentId) {
    await updateAgent(settings.agentId, options);
    return { agentId: settings.agentId, created: false, bridgeUrl };
  }
  const agentId = await createAgent(options);
  await saveAgentId(agentId);
  return { agentId, created: true, bridgeUrl };
}
