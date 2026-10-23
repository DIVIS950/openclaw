import type { Sample, SampleInput, SampleOptions } from "../lib/claudeRuntime.ts";

// The AI on the GitHub Pages version: Google Gemini called straight from the
// phone. It stands in for the claude.ai page's `sample` capability, so every
// AI feature works unchanged.

const API = "https://generativelanguage.googleapis.com/v1beta/models";
/** Tried in order while Google reports a model busy (503) or retired (404). */
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];
const QUICK = ["gemini-flash-lite-latest", "gemini-flash-latest"];

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}
interface GeminiReply {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { code?: number; status?: string; message?: string };
}

export class NoKeyError extends Error {
  constructor() {
    super(
      "The AI isn't set up on this phone yet. Ask a parent to add a Claude API key in More › Claude AI key.",
    );
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Claude-style turns → Gemini contents, with photos added to the last user turn. */
export async function toContents(input: SampleInput, images?: Blob[]): Promise<Content[]> {
  const turns = typeof input === "string" ? [{ role: "user" as const, content: input }] : input;
  const contents: Content[] = [];
  for (const t of turns) {
    const role = t.role === "assistant" ? "model" : "user";
    const prev = contents.at(-1);
    // Gemini wants turns to alternate; join two in a row from the same side.
    if (prev && prev.role === role) {
      prev.parts.push({ text: t.content });
    } else {
      contents.push({ role, parts: [{ text: t.content }] });
    }
  }
  if (images?.length) {
    const last = contents.findLast((c) => c.role === "user") ?? contents[0];
    for (const img of images) {
      last.parts.push({
        inlineData: { mimeType: img.type || "image/jpeg", data: await blobToBase64(img) },
      });
    }
  }
  return contents;
}

function failure(status: number, body: GeminiReply | null): Error & { retry?: boolean } {
  const msg = body?.error?.message ?? "";
  if (status === 400 && /api key/i.test(msg)) {
    return new Error("The AI key isn't valid. Check it in More › Claude AI key.");
  }
  if (status === 403) {
    return new Error("The AI key isn't allowed to use Gemini. Check it in More › Claude AI key.");
  }
  if (status === 429) {
    return new Error("The AI's free limit is used up for now. Try again in a few minutes.");
  }
  const err: Error & { retry?: boolean } = new Error(
    status === 503
      ? "The AI is very busy right now. Try again in a minute."
      : "The AI had a problem. Please try again.",
  );
  err.retry = status === 503 || status === 404;
  return err;
}

/** Pulls every text chunk out of a server-sent-events stream. */
export function sseTexts(chunk: string): { texts: string[]; rest: string } {
  const lines = chunk.split("\n");
  const rest = lines.pop() ?? "";
  const texts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    try {
      const reply = JSON.parse(line.slice(5)) as GeminiReply;
      for (const p of reply.candidates?.[0]?.content?.parts ?? []) {
        if (p.text) {
          texts.push(p.text);
        }
      }
    } catch {
      // A partial line; the next chunk completes it.
    }
  }
  return { texts, rest };
}

/** Reads a JSON answer, forgiving a ```json fence around it. */
export function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Fall through.
      }
    }
    throw { code: "invalid_json", message: "The AI's answer came back jumbled." };
  }
}

export function geminiSample(
  getKey: () => Promise<string | null>,
  fetcher: typeof fetch = fetch,
): Sample {
  const run = async (
    input: SampleInput,
    options: SampleOptions | undefined,
    json: boolean,
  ): Promise<string> => {
    const key = await getKey();
    if (!key) {
      throw new NoKeyError();
    }
    const body = JSON.stringify({
      contents: await toContents(input, options?.images),
      generationConfig: json ? { responseMimeType: "application/json" } : undefined,
    });
    const stream = Boolean(options?.onText) && !json;
    let last: Error | null = null;
    for (const model of options?.modelTier === "quick" ? QUICK : MODELS) {
      const res = await fetcher(
        `${API}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
          signal: options?.signal,
        },
      );
      if (!res.ok) {
        const err = failure(res.status, (await res.json().catch(() => null)) as GeminiReply | null);
        if (err.retry) {
          last = err;
          continue;
        }
        throw err;
      }
      if (stream && res.body) {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let text = "";
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          const { texts, rest } = sseTexts(buffer + value);
          buffer = rest;
          for (const delta of texts) {
            text += delta;
            options?.onText?.({ text, delta });
          }
        }
        return text;
      }
      const reply = (await res.json()) as GeminiReply;
      return (reply.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    }
    throw last ?? new Error("The AI had a problem. Please try again.");
  };

  const sample = (async (input: SampleInput, options?: SampleOptions) => ({
    text: await run(input, options, false),
    truncated: false,
  })) as Sample;
  sample.json = async <T>(input: SampleInput, options?: SampleOptions) =>
    parseJson(await run(input, options, true)) as T;
  sample.limits = async () => ({ images: { maxCount: 10 } });
  return sample;
}
