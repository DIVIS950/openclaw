import type {
  BriefRequest,
  BriefResponse,
  ChatTurn,
  ImageInput,
  InboxSummaryRequest,
  InboxSummaryResponse,
  ReviseRequest,
  TutorMode,
} from "../../shared/api.ts";
import { coercePack, type RevisionPack } from "../../shared/pack.ts";
import {
  BRIEF_INSTRUCTIONS,
  INBOX_INSTRUCTIONS,
  PACK_INSTRUCTIONS,
  PACK_JSON_SHAPE,
  briefData,
  inboxData,
  packRequest,
  tutorInstructions,
} from "../../shared/prompts.ts";
import { isSampleError, type Sample } from "./claudeRuntime.ts";

export class AiError extends Error {}

/** The AI features, whichever way Claude is reached. */
export interface AiProvider {
  brief(req: BriefRequest): Promise<string>;
  inbox(req: InboxSummaryRequest): Promise<InboxSummaryResponse>;
  revise(req: ReviseRequest): Promise<RevisionPack>;
  /** One answer to one prompt; `quick` trades depth for speed. */
  text(prompt: string, opts?: { quick?: boolean }): Promise<string>;
  /** One JSON answer (the prompt must describe the shape). */
  json(prompt: string, opts?: { quick?: boolean; images?: ImageInput[] }): Promise<unknown>;
  /** Streams a chat reply under standing instructions. */
  chat(
    instructions: string,
    history: ChatTurn[],
    onText: (soFar: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
  /** Streams the tutor's answer; onText receives the full text so far. */
  tutor(
    mode: TutorMode,
    history: ChatTurn[],
    onText: (soFar: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
}

// ---------- Hosted version: our server holds the Claude API key ----------

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AiError(data.error ?? "The AI couldn't answer right now.");
  }
  return (await res.json()) as T;
}

/** getToken returns the Google token that proves the student is signed in. */
async function streamPost(
  path: string,
  token: string,
  body: unknown,
  onText: (soFar: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AiError(data.error ?? "The AI couldn't answer right now.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    text += value;
    onText(text);
  }
  return text;
}

export function serverAi(getToken: () => string): AiProvider {
  return {
    text: (prompt, opts) =>
      post<{ text: string }>("/api/ai/text", getToken(), { prompt, quick: opts?.quick }).then(
        (r) => r.text,
      ),
    json: (prompt, opts) =>
      post<{ value: unknown }>("/api/ai/json", getToken(), {
        prompt,
        quick: opts?.quick,
        images: opts?.images,
      }).then((r) => r.value),
    chat: (instructions, history, onText, signal) =>
      streamPost("/api/ai/chat", getToken(), { instructions, history }, onText, signal),
    brief: (req) => post<BriefResponse>("/api/ai/brief", getToken(), req).then((r) => r.brief),
    inbox: (req) => post<InboxSummaryResponse>("/api/ai/inbox", getToken(), req),
    revise: (req) => post<RevisionPack>("/api/ai/revise", getToken(), req),
    tutor: (mode, history, onText, signal) =>
      streamPost("/api/ai/tutor", getToken(), { mode, history }, onText, signal),
  };
}

// ---------- Web version: Claude on the viewer's own Claude account ----------

function toBlob(image: ImageInput): Blob {
  const binary = atob(image.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: image.mediaType });
}

/** Friendly copy for the page runtime's error codes. */
function sampleMessage(code: string): string {
  switch (code) {
    case "not_granted":
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      return "The AI isn't allowed on this page. Allow Claude when the page asks, then reload.";
    case "rate_limited":
      return "You've used the AI a lot just now. Try again in a little while.";
    case "session_expired":
      return "Please sign in to Claude again, then reload.";
    case "images_unavailable":
      return "Photos can't be sent from this device. Type the question or notes instead.";
    case "image_rejected":
      return "That photo couldn't be read. Try a different one.";
    case "refused":
      return "Study Buddy can't help with that one. Try asking in a different way.";
    case "prompt_too_large":
      return "That's too much at once. Try a shorter piece.";
    case "invalid_json":
      return "The AI's answer came back jumbled. Please try again.";
    default:
      return "The AI had a problem. Please try again.";
  }
}

function wrap(err: unknown): never {
  if (isSampleError(err)) {
    if (err.code === "cancelled") {
      throw err;
    }
    throw new AiError(sampleMessage(err.code));
  }
  throw err;
}

export function sampleAi(sample: Sample): AiProvider {
  const chat: AiProvider["chat"] = async (instructions, history, onText, signal) => {
    // No system prompt on this path: standing instructions go in a leading
    // user turn, and only the newest message's photos are sent.
    const last = history[history.length - 1];
    const turns = [
      { role: "user" as const, content: instructions },
      ...history.map((t) => ({
        role: t.role,
        content: t.text.trim() || (t.images?.length ? "(photo)" : "…"),
      })),
    ];
    try {
      const { text } = await sample(turns, {
        signal,
        cache: false,
        images: last?.images?.length ? last.images.map(toBlob) : undefined,
        onText: ({ text: soFar }) => onText(soFar),
      });
      return text;
    } catch (err) {
      return wrap(err);
    }
  };

  return {
    chat,
    tutor: (mode, history, onText, signal) =>
      chat(tutorInstructions(mode), history, onText, signal),
    async text(prompt, opts) {
      try {
        const { text } = await sample(prompt, {
          modelTier: opts?.quick ? "quick" : "default",
          cache: false,
        });
        return text.trim();
      } catch (err) {
        return wrap(err);
      }
    },
    async json(prompt, opts) {
      try {
        return await sample.json(prompt, {
          modelTier: opts?.quick ? "quick" : "default",
          cache: false,
          images: opts?.images?.length ? opts.images.map(toBlob) : undefined,
        });
      } catch (err) {
        return wrap(err);
      }
    },
    async brief(req) {
      try {
        const { text } = await sample(
          `${BRIEF_INSTRUCTIONS}\n\n${briefData(req, new Date().toDateString())}`,
          {
            modelTier: "quick",
            // Same homework and emails → reuse today's summary instead of asking again.
            cache: { gcTime: 30 * 60 * 1000 },
          },
        );
        return text.trim();
      } catch (err) {
        return wrap(err);
      }
    },

    async inbox(req) {
      try {
        const reply = await sample.json<{ summaries?: { id?: unknown; summary?: unknown }[] }>(
          `${INBOX_INSTRUCTIONS}\nReply with only a JSON object: {"summaries": [{"id": "...", "summary": "..."}]}\n\n${inboxData(req)}`,
          { modelTier: "quick", cache: { gcTime: 60 * 60 * 1000 } },
        );
        const ids = new Set(req.emails.map((e) => e.id));
        const summaries = (reply.summaries ?? []).flatMap((s) =>
          typeof s.id === "string" && typeof s.summary === "string" && ids.has(s.id)
            ? [{ id: s.id, summary: s.summary }]
            : [],
        );
        return { summaries };
      } catch (err) {
        return wrap(err);
      }
    },

    async revise(req) {
      try {
        const value = await sample.json(
          `${PACK_INSTRUCTIONS}\n\n${packRequest(req.text)}\n\n${PACK_JSON_SHAPE}`,
          {
            images: req.images.length > 0 ? req.images.map(toBlob) : undefined,
            modelTier: "complex",
          },
        );
        return coercePack(value);
      } catch (err) {
        return wrap(err);
      }
    },
  };
}
