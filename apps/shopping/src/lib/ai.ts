import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5";

/** True when a Claude key is configured; otherwise routes fall back to demo logic. */
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | null = null;
export function claude() {
  client ??= new Anthropic();
  return client;
}

export { SHOPPING_SYSTEM } from "./prompts";
