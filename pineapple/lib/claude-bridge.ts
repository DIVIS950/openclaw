// Translates between ElevenLabs' "Custom LLM" protocol (OpenAI Chat Completions format) and the
// Claude Messages API. Pure functions only, so they can be unit tested without network access.
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

type BlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolUseParam = Anthropic.Beta.BetaToolUseBlockParam;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;
type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

// ---------- Incoming request (Chat Completions wire format) ----------

type ChatContent = string | Array<{ type?: unknown; text?: unknown }> | null | undefined;
type ChatToolCall = { id: string; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "developer"; content: ChatContent }
  | { role: "user"; content: ChatContent }
  | { role: "assistant"; content: ChatContent; tool_calls: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: ChatContent };
type ChatTool = { name: string; description?: string; parameters?: unknown };
export type ChatRequest = { messages: ChatMessage[]; tools: ChatTool[]; toolChoiceNone: boolean; stream: boolean };

const MAX_MESSAGES = 400;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Validates the untrusted JSON body. Returns null if it is not a usable chat request. */
export function parseChatRequest(body: unknown): ChatRequest | null {
  if (!isObject(body) || !Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const m of body.messages) {
    if (!isObject(m)) return null;
    const content = m.content as ChatContent;
    switch (m.role) {
      case "system":
      case "developer":
        messages.push({ role: m.role, content });
        break;
      case "user":
        messages.push({ role: "user", content });
        break;
      case "assistant": {
        const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
        const toolCalls = calls.filter(isObject).flatMap((c) =>
          isObject(c.function) && typeof c.function.name === "string"
            ? [{ id: str(c.id), function: { name: c.function.name, arguments: str(c.function.arguments) } }]
            : [],
        );
        messages.push({ role: "assistant", content, tool_calls: toolCalls });
        break;
      }
      case "tool":
        messages.push({ role: "tool", tool_call_id: str(m.tool_call_id), content });
        break;
      default:
        return null;
    }
  }
  const tools = (Array.isArray(body.tools) ? body.tools : []).flatMap((t) =>
    isObject(t) && isObject(t.function) && typeof t.function.name === "string"
      ? [{ name: t.function.name, description: str(t.function.description) || undefined, parameters: t.function.parameters }]
      : [],
  );
  return { messages, tools, toolChoiceNone: body.tool_choice === "none", stream: body.stream === true };
}

// ---------- Request translation ----------

function textOf(content: ChatContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Claude tool IDs must match ^[a-zA-Z0-9_-]+$. Same input always maps to the same ID. */
function toolId(id: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : `call_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const isToolUse = (b: BlockParam): b is ToolUseParam => b.type === "tool_use";
const isToolResult = (b: BlockParam): b is ToolResultParam => b.type === "tool_result";

type Turn = { role: "user" | "assistant"; content: BlockParam[] };

function pushTurn(turns: Turn[], role: Turn["role"], blocks: BlockParam[]): void {
  if (blocks.length === 0) return;
  const last = turns.at(-1);
  if (last && last.role === role) last.content.push(...blocks);
  else turns.push({ role, content: [...blocks] });
}

/**
 * Builds Claude `system`, `messages` and `tools` from a chat request.
 *
 * Claude's thinking blocks are never replayed: the Chat Completions format can't carry them, and
 * the Messages API accepts a history with all thinking blocks left out.
 */
export function toClaudeConversation(chat: ChatRequest): {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
} {
  const system: string[] = [];
  let turns: Turn[] = [];
  for (const m of chat.messages) {
    if (m.role === "system" || m.role === "developer") {
      const text = textOf(m.content).trim();
      if (text) system.push(text);
    } else if (m.role === "user") {
      const text = textOf(m.content).trim();
      pushTurn(turns, "user", text ? [{ type: "text", text }] : []);
    } else if (m.role === "assistant") {
      const text = textOf(m.content).trim();
      const blocks: BlockParam[] = text ? [{ type: "text", text }] : [];
      for (const call of m.tool_calls) {
        blocks.push({ type: "tool_use", id: toolId(call.id), name: call.function.name, input: parseArguments(call.function.arguments) });
      }
      pushTurn(turns, "assistant", blocks);
    } else if (m.role === "tool") {
      pushTurn(turns, "user", [{ type: "tool_result", tool_use_id: toolId(m.tool_call_id), content: textOf(m.content).trim() || "OK" }]);
    }
  }

  // Drop tool results that don't answer a tool call in the turn right before them (the API rejects those).
  turns.forEach((turn, i) => {
    if (turn.role !== "user") return;
    const prev = turns[i - 1];
    const asked = new Set(prev?.role === "assistant" ? prev.content.filter(isToolUse).map((b) => b.id) : []);
    turn.content = turn.content.filter((b) => !isToolResult(b) || asked.has(b.tool_use_id));
  });
  const compacted: Turn[] = [];
  for (const turn of turns) pushTurn(compacted, turn.role, turn.content);
  turns = compacted;

  // Every tool call needs a result in the next user turn, with tool results first.
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const ids = turn.role === "assistant" ? turn.content.filter(isToolUse).map((b) => b.id) : [];
    if (ids.length === 0) continue;
    let next = turns[i + 1];
    if (!next || next.role !== "user") {
      next = { role: "user", content: [] };
      turns.splice(i + 1, 0, next);
    }
    const answered = new Set(next.content.filter(isToolResult).map((b) => b.tool_use_id));
    const missing: ToolResultParam[] = ids
      .filter((id) => !answered.has(id))
      .map((id) => ({ type: "tool_result", tool_use_id: id, content: "No result." }));
    next.content = [...next.content.filter(isToolResult), ...missing, ...next.content.filter((b) => !isToolResult(b))];
  }

  // The conversation must start and end with a user turn (the agent speaks first on a phone call,
  // and Claude does not accept a trailing assistant turn as a prefill).
  if (turns[0]?.role !== "user") turns.unshift({ role: "user", content: [{ type: "text", text: "(The phone call has connected.)" }] });
  if (turns.at(-1)?.role !== "user") turns.push({ role: "user", content: [{ type: "text", text: "(Continue the call.)" }] });

  const seen = new Set<string>();
  const tools = chat.tools
    .filter((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(t.name) && !seen.has(t.name) && seen.add(t.name))
    .map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      input_schema:
        isObject(t.parameters) && t.parameters.type === "object"
          ? (t.parameters as Anthropic.Beta.BetaTool.InputSchema)
          : ({ type: "object", properties: {} } as const),
    }));

  return { system: system.join("\n\n"), messages: turns, tools };
}

// ---------- Response translation (Claude stream events -> Chat Completions chunks) ----------

export type ChatChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: Array<{ index: number; id: string; type: "function"; function: { name: string; arguments: string } }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
};

/**
 * Streams text as soon as Claude produces it (low latency for the voice), and sends tool calls
 * once the turn is complete so ElevenLabs only ever receives finished, valid tool arguments.
 */
export async function* toChatChunks(
  events: AsyncIterable<StreamEvent>,
  meta: { id: string; model: string; created: number },
): AsyncGenerator<ChatChunk> {
  let first = true;
  const chunk = (delta: ChatChunk["choices"][0]["delta"], finish: ChatChunk["choices"][0]["finish_reason"] = null): ChatChunk => {
    const withRole = first ? { role: "assistant" as const, ...delta } : delta;
    first = false;
    return { ...meta, object: "chat.completion.chunk", choices: [{ index: 0, delta: withRole, finish_reason: finish }] };
  };

  const calls = new Map<number, { id: string; name: string; json: string }>();
  let stopReason: string | null = null;

  for await (const event of events) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      // After a mid-stream refusal fallback, tool calls from the declined attempt must not run.
      if (block.type === "fallback") calls.clear();
      else if (block.type === "tool_use") calls.set(event.index, { id: block.id, name: block.name, json: "" });
      else if (block.type === "text" && block.text) yield chunk({ content: block.text });
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta" && event.delta.text) yield chunk({ content: event.delta.text });
      else if (event.delta.type === "input_json_delta") {
        const call = calls.get(event.index);
        if (call) call.json += event.delta.partial_json;
      }
    } else if (event.type === "message_delta" && event.delta.stop_reason) {
      stopReason = event.delta.stop_reason;
    }
  }

  // A turn cut off by max_tokens may carry incomplete tool input: never run it.
  const finished = stopReason === "max_tokens" ? [] : [...calls.values()].filter((c) => isObject(parseJson(c.json || "{}")));
  if (finished.length > 0) {
    yield chunk({
      tool_calls: finished.map((c, index) => ({ index, id: c.id, type: "function", function: { name: c.name, arguments: c.json || "{}" } })),
    });
  }
  yield chunk({}, finished.length > 0 ? "tool_calls" : stopReason === "max_tokens" ? "length" : "stop");
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Collapses chunks into one non-streaming Chat Completions response. */
export async function collectCompletion(chunks: AsyncIterable<ChatChunk>) {
  let content = "";
  let toolCalls: NonNullable<ChatChunk["choices"][0]["delta"]["tool_calls"]> = [];
  let finish: ChatChunk["choices"][0]["finish_reason"] = "stop";
  let meta: Pick<ChatChunk, "id" | "created" | "model"> | null = null;
  for await (const c of chunks) {
    meta ??= { id: c.id, created: c.created, model: c.model };
    const choice = c.choices[0];
    content += choice.delta.content ?? "";
    if (choice.delta.tool_calls) toolCalls = choice.delta.tool_calls;
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return {
    ...meta,
    object: "chat.completion" as const,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          content: content || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls.map(({ index: _index, ...call }) => call) } : {}),
        },
        finish_reason: finish,
      },
    ],
  };
}
