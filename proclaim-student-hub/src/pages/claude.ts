import Anthropic from "@anthropic-ai/sdk";
import type { Sample, SampleInput, SampleOptions } from "../lib/claudeRuntime.ts";
import { NoKeyError, parseJson } from "./gemini.ts";

// The AI on the GitHub Pages version when a Claude API key is added: Claude
// called straight from the phone with the official SDK. Like the Gemini
// stand-in, it plays the claude.ai page's `sample` capability, so every AI
// feature works unchanged. The key never leaves this phone except to go to
// Anthropic.

const MODEL = "claude-opus-5-5";

// If Claude declines a request, the API re-runs it on Anthropic's recommended
// fallback model instead of returning a refusal.
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

/** Quick answers think less; "complex" (tutor, scanning, planning) thinks most. */
const EFFORT = { quick: "low", default: "medium", complex: "high" } as const;

type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The app's turns → Claude messages, with photos on the last user turn. */
export async function toMessages(
  input: SampleInput,
  images?: Blob[],
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const turns = typeof input === "string" ? [{ role: "user" as const, content: input }] : input;
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({
    role: t.role,
    content: [{ type: "text", text: t.content || "…" }],
  }));
  if (images?.length) {
    const last = messages.findLast((m) => m.role === "user") ?? messages[0];
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const img of images) {
      const type = IMAGE_TYPES.has(img.type) ? (img.type as ImageType) : "image/jpeg";
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: type, data: await blobToBase64(img) },
      });
    }
    // Photos go before the text that talks about them.
    last.content = [...blocks, ...(last.content as Anthropic.Beta.BetaContentBlockParam[])];
  }
  return messages;
}

/** The API's own words for the problem, without the SDK's status prefix. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const raw = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
  return (raw ?? err.message).replace(/^\d{3}\s*/, "").slice(0, 200);
}

function friendly(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error("Claude says the key isn't valid (401). Paste it again in More › Claude AI key.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new Error(`Claude refused this key (403): ${apiMessage(err)}`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error("You've used the AI a lot just now (429). Try again in a minute.");
  }
  if (err instanceof Anthropic.BadRequestError && /credit|billing/i.test(err.message)) {
    return new Error(
      "The Claude account has no credit. Add credit at console.anthropic.com › Billing.",
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new Error(`Claude can't find that (404): ${apiMessage(err)}`);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new Error(`Claude rejected the request (400): ${apiMessage(err)}`);
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    return Object.assign(new Error("Stopped."), { code: "cancelled" });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error("Can't reach Claude. Check the internet connection.");
  }
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) {
    return new Error(`Claude is very busy right now (${err.status}). Try again in a minute.`);
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Claude error ${err.status ?? ""}: ${apiMessage(err)}`);
  }
  return err instanceof Error ? err : new Error("The AI had a problem. Please try again.");
}

/** One tiny real request, so the key card can say exactly what works or not. */
export async function testClaude(key: string): Promise<string> {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 });
  try {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      output_config: { effort: "low" },
      ...FALLBACK,
    });
    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (message.stop_reason === "refusal" || !text) {
      return `Claude replied but sent no text (${message.stop_reason}). The key works; try the app.`;
    }
    return `Claude answered "${text.slice(0, 20)}" using ${message.model}.`;
  } catch (err) {
    throw friendly(err);
  }
}

export function claudeSample(getKey: () => Promise<string | null>): Sample {
  let cached: { key: string; client: Anthropic } | null = null;
  const clientFor = (key: string) => {
    if (cached?.key !== key) {
      // Browser use is fine here: the key belongs to this student's family and
      // is stored only on their own phone.
      cached = { key, client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) };
    }
    return cached.client;
  };

  const run = async (
    input: SampleInput,
    options: SampleOptions | undefined,
    json: boolean,
  ): Promise<string> => {
    const key = await getKey();
    if (!key) {
      throw new NoKeyError();
    }
    const messages = await toMessages(input, options?.images);
    if (json) {
      const last = messages.at(-1);
      if (last && Array.isArray(last.content)) {
        last.content.push({ type: "text", text: "Reply with only the JSON, no other text." });
      }
    }
    try {
      const stream = clientFor(key).beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          system: "You are the AI inside Proclaim Student Hub, a school app for a Year 9 student.",
          messages,
          output_config: { effort: EFFORT[options?.modelTier ?? "default"] },
          ...FALLBACK,
        },
        { signal: options?.signal },
      );
      if (options?.onText && !json) {
        let text = "";
        stream.on("text", (delta) => {
          text += delta;
          options.onText?.({ text, delta });
        });
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw Object.assign(new Error("Study Buddy can't help with that one."), {
          code: "refused",
        });
      }
      return message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
    } catch (err) {
      if ((err as { code?: string }).code === "refused") {
        throw err;
      }
      throw friendly(err);
    }
  };

  const sample = (async (input: SampleInput, options?: SampleOptions) => ({
    text: await run(input, options, false),
    truncated: false,
  })) as Sample;
  sample.json = async <T>(input: SampleInput, options?: SampleOptions) =>
    parseJson(await run(input, options, true)) as T;
  sample.limits = async () => ({ images: { maxCount: 20 } });
  return sample;
}

export { isClaudeKey } from "./aiKind.ts";
