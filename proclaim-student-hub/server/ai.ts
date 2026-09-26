import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type {
  BriefRequest,
  ChatTurn,
  InboxSummaryRequest,
  InboxSummaryResponse,
  ReviseRequest,
  TutorMode,
} from "../shared/api.ts";
import { normalizePack, type RevisionPack } from "../shared/pack.ts";
import {
  BRIEF_INSTRUCTIONS,
  INBOX_INSTRUCTIONS,
  PACK_INSTRUCTIONS,
  briefData,
  inboxData,
  packRequest,
  tutorInstructions,
} from "../shared/prompts.ts";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

// Reads ANTHROPIC_API_KEY (or another configured credential) from the environment.
const client = new Anthropic();

// If Claude declines a request, the API re-runs it on Anthropic's recommended
// fallback model instead of returning a refusal.
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

export class AiRefusalError extends Error {}

function toMessageParam(turn: ChatTurn): Anthropic.Beta.BetaMessageParam {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const image of turn.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  if (turn.text.trim()) {
    content.push({ type: "text", text: turn.text });
  }
  return { role: turn.role, content };
}

/** Streams the tutor's reply, calling onText for each chunk of text. */
export async function tutorReply(
  mode: TutorMode,
  history: ChatTurn[],
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      system: tutorInstructions(mode),
      messages: history.map(toMessageParam),
      output_config: { effort: "high" },
      ...FALLBACK,
    },
    { signal },
  );
  stream.on("text", onText);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new AiRefusalError(
      "Study Buddy can't help with that one. Try asking in a different way.",
    );
  }
}

// ---------- Daily brief ----------

export async function dailyBrief(req: BriefRequest): Promise<string> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: BRIEF_INSTRUCTIONS,
    messages: [
      {
        role: "user",
        content: briefData(req, new Date().toDateString()),
      },
    ],
    output_config: { effort: "low" },
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal") {
    throw new AiRefusalError("Couldn't write today's summary.");
  }
  return response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

// ---------- Inbox one-liners ----------

const InboxSchema = z.object({
  summaries: z.array(z.object({ id: z.string(), summary: z.string() })),
});

export async function summariseInbox(req: InboxSummaryRequest): Promise<InboxSummaryResponse> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: INBOX_INSTRUCTIONS,
    messages: [{ role: "user", content: inboxData(req) }],
    output_config: { effort: "low", format: betaZodOutputFormat(InboxSchema) },
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { summaries: [] };
  }
  const ids = new Set(req.emails.map((e) => e.id));
  return { summaries: response.parsed_output.summaries.filter((s) => ids.has(s.id)) };
}

// ---------- Notes → revision pack ----------

const PackSchema = z.object({
  topic: z.string().describe("Short topic name, e.g. Photosynthesis"),
  subject: z.string().describe("School subject, e.g. Science"),
  summary: z.array(z.string()).describe("3-6 key points, one sentence each"),
  keyFact: z.string().describe("One equation, rule or definition to remember, or empty string"),
  flashcards: z.array(z.object({ q: z.string(), a: z.string() })).describe("6-10 flashcards"),
  quiz: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).describe("3 or 4 options"),
        answer: z.number().int().describe("0-based index of the correct option"),
        explanation: z.string(),
      }),
    )
    .describe("5 multiple-choice questions"),
  match: z
    .array(z.object({ term: z.string(), meaning: z.string() }))
    .describe("Exactly 4 key terms with short meanings (max 6 words)"),
  trueFalse: z
    .array(z.object({ statement: z.string(), answer: z.boolean(), why: z.string() }))
    .describe("4-6 true/false statements, mixed true and false"),
  gaps: z
    .array(
      z.object({
        before: z.string(),
        answer: z.string().describe("The missing word"),
        after: z.string(),
        options: z.array(z.string()).describe("3 options including the answer"),
      }),
    )
    .describe("3-5 fill-the-gap sentences"),
});

export async function makeRevisionPack(req: ReviseRequest): Promise<RevisionPack> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = req.images.map((image) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
  }));
  content.push({
    type: "text",
    text: packRequest(req.text),
  });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: PACK_INSTRUCTIONS,
    messages: [{ role: "user", content }],
    output_config: { effort: "high", format: betaZodOutputFormat(PackSchema) },
    ...FALLBACK,
  });
  if (response.stop_reason === "refusal") {
    throw new AiRefusalError("Couldn't make a revision pack from those notes.");
  }
  if (!response.parsed_output) {
    throw new Error("The AI reply could not be read. Please try again.");
  }
  return normalizePack(response.parsed_output);
}
