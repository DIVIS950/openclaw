import Anthropic from "@anthropic-ai/sdk";
import { checkBridgeRequest } from "@/lib/bridge-auth";
import { collectCompletion, parseChatRequest, toChatChunks, toClaudeConversation } from "@/lib/claude-bridge";
import { claudeEffort, claudeModel, supportsDefaultFallback } from "@/lib/claude-config";

// The voice agent's brain. ElevenLabs ("Custom LLM") posts each turn of the phone call here in the
// Chat Completions format; we answer with Claude through the official Anthropic SDK. The Anthropic
// key never leaves this server.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 512_000;
const MAX_OUTPUT_TOKENS = 4096;

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { message, type: "pineapple_bridge_error" } }, { status, headers: { "cache-control": "no-store" } });
}

function anthropicErrorResponse(error: unknown): Response {
  if (error instanceof Anthropic.AuthenticationError) return errorResponse(502, "Anthropic rejected ANTHROPIC_API_KEY.");
  if (error instanceof Anthropic.PermissionDeniedError) return errorResponse(502, "The Anthropic key may not use this model.");
  if (error instanceof Anthropic.NotFoundError) return errorResponse(502, "Unknown PINEAPPLE_CLAUDE_MODEL.");
  if (error instanceof Anthropic.RateLimitError) return errorResponse(429, "Claude is rate limited. Try again shortly.");
  if (error instanceof Anthropic.BadRequestError) return errorResponse(400, `Claude rejected the request: ${error.message}`);
  if (error instanceof Anthropic.APIError) return errorResponse(502, `Claude API error ${error.status ?? ""}`.trim());
  return errorResponse(502, "Could not reach Claude.");
}

async function* prepend<T>(first: IteratorResult<T>, rest: AsyncIterator<T>): AsyncGenerator<T> {
  if (first.done) return;
  yield first.value;
  for (let next = await rest.next(); !next.done; next = await rest.next()) yield next.value;
}

export async function POST(request: Request): Promise<Response> {
  const access = await checkBridgeRequest(request.headers.get("authorization"));
  if (access === "unauthorized") return errorResponse(401, "Invalid bridge token.");
  if (access === "no-active-call") return errorResponse(403, "Pineapple only answers during one of its own calls.");
  if (!process.env.ANTHROPIC_API_KEY) return errorResponse(500, "ANTHROPIC_API_KEY is not set.");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return errorResponse(413, "Request too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "Body must be JSON.");
  }
  const chat = parseChatRequest(body);
  if (!chat) return errorResponse(400, "Not a chat completions request.");

  const { system, messages, tools } = toClaudeConversation(chat);
  const model = claudeModel();
  const fallback = supportsDefaultFallback(model);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Sampling parameters (temperature etc.) from ElevenLabs are intentionally not forwarded:
  // the current Claude API rejects them.
  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...(system ? { system } : {}),
      messages,
      ...(tools.length > 0 ? { tools, ...(chat.toolChoiceNone ? { tool_choice: { type: "none" as const } } : {}) } : {}),
      output_config: { effort: claudeEffort() },
      // System prompt + tools are identical for every turn of a call: cache them.
      cache_control: { type: "ephemeral" },
      ...(fallback ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {}),
    },
    { signal: request.signal },
  );

  // Wait for the first event so API errors still become a proper HTTP error response.
  const events = stream[Symbol.asyncIterator]();
  let first: IteratorResult<Anthropic.Beta.BetaRawMessageStreamEvent>;
  try {
    first = await events.next();
  } catch (error) {
    return anthropicErrorResponse(error);
  }

  const meta = { id: `chatcmpl-${crypto.randomUUID()}`, model, created: Math.floor(Date.now() / 1000) };
  const chunks = toChatChunks(prepend(first, events), meta);

  if (!chat.stream) {
    try {
      return Response.json(await collectCompletion(chunks), { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return anthropicErrorResponse(error);
    }
  }

  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await chunks.next();
          if (next.done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
          }
        } catch {
          // Mid-stream failure: end the turn cleanly; ElevenLabs keeps the call going.
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } },
  );
}
