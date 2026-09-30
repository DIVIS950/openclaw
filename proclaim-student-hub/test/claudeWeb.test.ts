import { describe, expect, it, vi } from "vitest";
import { claudeSample, isClaudeKey, toMessages } from "../src/pages/claude.ts";
import { NoKeyError } from "../src/pages/gemini.ts";

/** A streamed Messages API reply, as server-sent events. */
function sse(text: string, stop = "end_turn"): Response {
  const events = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    ...text
      .split("|")
      .map((t) => [
        "content_block_delta",
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } },
      ]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 3 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events
    .map(([e, d]) => `event: ${e as string}\ndata: ${JSON.stringify(d)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("Claude on the website", () => {
  it("tells Claude keys from Gemini keys", () => {
    expect(isClaudeKey(" sk-ant-api03-abc")).toBe(true);
    expect(isClaudeKey("AIzaSyXYZ")).toBe(false);
  });

  it("puts photos before the text on the last user turn", async () => {
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const m = await toMessages([{ role: "user", content: "read this" }], [photo]);
    expect(m[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      { type: "text", text: "read this" },
    ]);
  });

  it("asks for a key when there is none", async () => {
    await expect(claudeSample(async () => null)("hi")).rejects.toBeInstanceOf(NoKeyError);
  });

  it("streams text, uses Opus 5.5 with effort by tier, and reads JSON", async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Headers[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      headers.push(new Headers(init.headers));
      return bodies.length === 1 ? sse("Hel|lo") : sse('{"ok":|true}');
    });
    vi.stubGlobal("fetch", fetchMock);
    const s = claudeSample(async () => "sk-ant-test");
    const seen: string[] = [];
    const out = await s("hi", { modelTier: "quick", onText: ({ text }) => seen.push(text) });
    expect(out.text).toBe("Hello");
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(bodies[0]).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "low" },
      fallbacks: "default",
    });
    expect(headers[0].get("x-api-key")).toBe("sk-ant-test");
    expect(headers[0].get("anthropic-dangerous-direct-browser-access")).toBe("true");
    await expect(s.json("q", { modelTier: "complex" })).resolves.toEqual({ ok: true });
    expect(bodies[1]).toMatchObject({ output_config: { effort: "high" } });
    vi.unstubAllGlobals();
  });

  it("explains a bad key in plain words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: "error",
              error: { type: "authentication_error", message: "invalid x-api-key" },
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );
    await expect(claudeSample(async () => "sk-ant-bad")("hi")).rejects.toThrow(/key isn't valid/);
    vi.unstubAllGlobals();
  });
});
