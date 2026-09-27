"use client";

import { getSample, PERMANENT, type SampleError } from "./claude-page";
import type { Product } from "./data";
import { lineReader, normalize, searchPrompt } from "./search";

export type SearchSource = "web" | "estimate" | "sample";

let sampleBlocked = false;

/**
 * Runs a product search and calls onProduct as each result arrives.
 * - Full app with ANTHROPIC_API_KEY: live web search on the server.
 * - Web demo: Claude estimates from its own knowledge (viewer's Claude account).
 * - Otherwise: resolves "sample" and the caller shows the built-in catalog.
 */
export async function runSearch(query: string, city: string, onProduct: (p: Product) => void, signal: AbortSignal): Promise<SearchSource> {
  if (process.env.NEXT_PUBLIC_ORBIT_STATIC === "1") {
    const sample = sampleBlocked ? null : await getSample();
    if (!sample) return "sample";
    const reader = lineReader((raw) => {
      const p = normalize(raw, "estimate");
      if (p) onProduct(p);
    });
    try {
      const { text } = await sample(searchPrompt(query, city, false), {
        signal,
        // Same search within 30 min replays for free.
        cache: { gcTime: 30 * 60_000 },
        onText: ({ text }) => reader.push(text),
      });
      reader.end(text);
      return "estimate";
    } catch (e) {
      const err = e as SampleError;
      if (err.code === "cancelled") throw e;
      if (err.text) reader.end(err.text);
      if (PERMANENT.has(err.code)) sampleBlocked = true;
      return "sample";
    }
  }

  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, city }),
    signal,
  });
  if (!res.ok || res.headers.get("X-Orbit-Mode") !== "live" || !res.body) return "sample";
  const reader = lineReader((raw) => {
    const p = normalize(raw, "web");
    if (p) onProduct(p);
  });
  const dec = new TextDecoder();
  const stream = res.body.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await stream.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    reader.push(text);
  }
  reader.end(text);
  return "web";
}
