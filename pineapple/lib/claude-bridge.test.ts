import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { collectCompletion, parseChatRequest, toChatChunks, toClaudeConversation, type ChatChunk } from "./claude-bridge";

type Event = Anthropic.Beta.BetaRawMessageStreamEvent;
const meta = { id: "chatcmpl-test", model: "claude-opus-5-5", created: 1 };

async function* events(list: unknown[]): AsyncGenerator<Event> {
  for (const e of list) yield e as Event;
}

async function chunksOf(list: unknown[]): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of toChatChunks(events(list), meta)) out.push(c);
  return out;
}

test("rejects bodies that are not chat requests", () => {
  assert.equal(parseChatRequest(null), null);
  assert.equal(parseChatRequest({ messages: "hi" }), null);
  assert.equal(parseChatRequest({ messages: [{ role: "wizard", content: "x" }] }), null);
  assert.equal(parseChatRequest({ messages: Array.from({ length: 401 }, () => ({ role: "user", content: "x" })) }), null);
});

test("translates a phone conversation with a tool round trip", () => {
  const chat = parseChatRequest({
    model: "anything",
    temperature: 0.4,
    stream: true,
    messages: [
      { role: "system", content: "You are Pineapple." },
      { role: "assistant", content: "Dobrý den, tady Pineapple." },
      { role: "user", content: [{ type: "text", text: "Hello, English please." }] },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "toolu_1", type: "function", function: { name: "language_detection", arguments: '{"language":"en"}' } }],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "Switched to en" },
      { role: "tool", tool_call_id: "toolu_unknown", content: "orphan" },
    ],
    tools: [
      { type: "function", function: { name: "language_detection", description: "Switch language", parameters: { type: "object", properties: { language: { type: "string" } } } } },
      { type: "function", function: { name: "end_call" } },
      { type: "function", function: { name: "end_call" } },
    ],
  });
  assert.ok(chat);
  assert.equal(chat.stream, true);
  const { system, messages, tools } = toClaudeConversation(chat);

  assert.equal(system, "You are Pineapple.");
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(messages[0].content, [{ type: "text", text: "(The phone call has connected.)" }]);
  assert.deepEqual(messages[3].content, [{ type: "tool_use", id: "toolu_1", name: "language_detection", input: { language: "en" } }]);
  // Only the matching tool result survives; the orphan is dropped.
  assert.deepEqual(messages[4].content, [{ type: "tool_result", tool_use_id: "toolu_1", content: "Switched to en" }]);
  assert.deepEqual(tools.map((t) => t.name), ["language_detection", "end_call"]);
  assert.deepEqual(tools[1].input_schema, { type: "object", properties: {} });
});

test("adds a result for unanswered tool calls and never ends on an assistant turn", () => {
  const chat = parseChatRequest({
    messages: [
      { role: "user", content: "Ano?" },
      { role: "assistant", content: "Na shledanou.", tool_calls: [{ id: "weird id!", function: { name: "end_call", arguments: "not json" } }] },
    ],
  });
  assert.ok(chat);
  const { messages } = toClaudeConversation(chat);
  const toolUse = (messages[1].content as Anthropic.Beta.BetaContentBlockParam[])[1] as Anthropic.Beta.BetaToolUseBlockParam;
  assert.match(toolUse.id, /^call_[0-9a-f]{24}$/);
  assert.deepEqual(toolUse.input, {});
  assert.deepEqual(messages.at(-1), {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "No result." }],
  });
});

test("streams text immediately and sends finished tool calls at the end", async () => {
  const chunks = await chunksOf([
    { type: "message_start", message: {} },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Děkuji, " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "na shledanou." } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_9", name: "end_call", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"reason":' } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"done"}' } },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
    { type: "message_stop" },
  ]);
  assert.deepEqual(chunks[0].choices[0].delta, { role: "assistant", content: "Děkuji, " });
  assert.deepEqual(chunks[1].choices[0].delta, { content: "na shledanou." });
  assert.deepEqual(chunks[2].choices[0].delta.tool_calls, [
    { index: 0, id: "toolu_9", type: "function", function: { name: "end_call", arguments: '{"reason":"done"}' } },
  ]);
  assert.equal(chunks.at(-1)?.choices[0].finish_reason, "tool_calls");
});

test("drops tool calls from before a mid-stream fallback and from truncated turns", async () => {
  const afterFallback = await chunksOf([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_a", name: "end_call", input: {} } },
    { type: "content_block_start", index: 1, content_block: { type: "fallback" } },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Dobře." } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
  ]);
  assert.equal(afterFallback.some((c) => c.choices[0].delta.tool_calls), false);
  assert.equal(afterFallback.at(-1)?.choices[0].finish_reason, "stop");

  const truncated = await chunksOf([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_b", name: "end_call", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"rea' } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" } },
  ]);
  assert.deepEqual(truncated.map((c) => c.choices[0].finish_reason), ["length"]);
  assert.deepEqual(truncated[0].choices[0].delta, { role: "assistant" });
});

test("collects a non-streaming completion", async () => {
  const completion = await collectCompletion(
    toChatChunks(
      events([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "Ano" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", děkuji." } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ]),
      meta,
    ),
  );
  assert.equal(completion.object, "chat.completion");
  assert.deepEqual(completion.choices[0].message, { role: "assistant", content: "Ano, děkuji." });
  assert.equal(completion.choices[0].finish_reason, "stop");
});
