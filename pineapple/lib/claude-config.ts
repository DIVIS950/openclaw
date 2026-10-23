// Which Claude model answers on the phone. Server-side only; the bridge ignores the model name
// ElevenLabs sends, so the agent can never be pointed at anything else.
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = (typeof EFFORTS)[number];

// Models that accept `fallbacks: "default"` (server-side retry on another model after a
// safety-classifier refusal, so a false positive doesn't go silent mid-call).
const DEFAULT_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export function claudeModel(): string {
  return process.env.PINEAPPLE_CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

/** Low effort keeps Claude's thinking short, which keeps the pause before each reply short. */
export function claudeEffort(): ClaudeEffort {
  const value = process.env.PINEAPPLE_CLAUDE_EFFORT?.trim();
  return EFFORTS.find((e) => e === value) ?? "low";
}

export function supportsDefaultFallback(model: string): boolean {
  return DEFAULT_FALLBACK_MODELS.has(model);
}
