// Tiny on purpose: telling the key kinds apart must not pull the Claude SDK
// into the first download (claude.ts is loaded only when the AI is used).

/** Claude keys look like "sk-ant-…"; anything else is treated as a Gemini key. */
export const isClaudeKey = (key: string): boolean => key.trim().startsWith("sk-ant-");
