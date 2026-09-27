"use client";

/**
 * Access to Claude from the published web page (claude.ai artifact runtime).
 * Only the static build uses this; it resolves null everywhere else.
 */
type SampleFn = ((
  input: string | { role: "user" | "assistant"; content: string }[],
  opts?: { onText?: (u: { text: string; delta: string }) => void; signal?: AbortSignal; cache?: boolean | { gcTime?: number }; modelTier?: "quick" | "default" | "complex" },
) => Promise<{ text: string; truncated: boolean }>) & { json: unknown };

export type SampleError = { code: string; message: string; text?: string };

type PageClaude = { use: (name: string) => Promise<unknown> };

let samplePromise: Promise<SampleFn | null> | null = null;

export function getSample(): Promise<SampleFn | null> {
  if (process.env.NEXT_PUBLIC_ORBIT_STATIC !== "1" || typeof window === "undefined") return Promise.resolve(null);
  samplePromise ??= (async () => {
    const c = (window as unknown as { claude?: PageClaude }).claude;
    if (!c?.use) return null;
    try {
      return ((await c.use("sample")) as SampleFn | null) ?? null;
    } catch {
      return null;
    }
  })();
  return samplePromise;
}

/** Codes after which the page should stop asking Claude for this view. */
export const PERMANENT = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);
