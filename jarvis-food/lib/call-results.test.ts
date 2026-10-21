import assert from "node:assert/strict";
import { test } from "node:test";
import { extractResults, parseBoolean, parseNumber, toTranscript } from "./call-results";
import type { Conversation } from "./elevenlabs";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversation_id: "conv_1",
    status: "done",
    transcript: [
      { role: "agent", message: "Dobrý den, tady Jarvis.", time_in_call_secs: 0 },
      { role: "user", message: "Dobrý den.", time_in_call_secs: 2 },
      { role: "agent", message: null, time_in_call_secs: 3 },
    ],
    metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 95 },
    analysis: {
      data_collection_results: {
        order_confirmed: { value: true },
        total_czk: { value: 489 },
        eta_minutes: { value: "45" },
        notes: { value: "Tiramisu was sold out, dropped." },
      },
      transcript_summary: "Order placed.",
    },
    ...overrides,
  };
}

test("parses booleans and numbers leniently", () => {
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean("Ano"), true);
  assert.equal(parseBoolean(false), false);
  assert.equal(parseBoolean("maybe"), null);
  assert.equal(parseNumber("1 250 Kč"), 1250);
  assert.equal(parseNumber("45,5"), 45.5);
  assert.equal(parseNumber("about 40 min"), 40);
  assert.equal(parseNumber(null), null);
});

test("extracts a confirmed order", () => {
  const r = extractResults(conversation());
  assert.equal(r.orderConfirmed, true);
  assert.equal(r.totalCzk, 489);
  assert.equal(r.etaMinutes, 45);
  assert.equal(r.notes, "Tiramisu was sold out, dropped.");
  assert.equal(r.summary, "Order placed.");
  assert.equal(r.callEndedAt?.getTime(), (1_760_000_000 + 95) * 1000);
});

test("flags calls where nobody answered", () => {
  const r = extractResults(
    conversation({
      transcript: [{ role: "agent", message: "Dobrý den?", time_in_call_secs: 0 }],
      metadata: { start_time_unix_secs: 1, call_duration_secs: 20, termination_reason: "voicemail detected" },
      analysis: { data_collection_results: { order_confirmed: { value: false } } },
    }),
  );
  assert.equal(r.orderConfirmed, false);
  assert.match(r.notes ?? "", /Nobody talked on the line.*voicemail detected/);
});

test("missing analysis means not confirmed, never a crash", () => {
  const r = extractResults(conversation({ analysis: null }));
  assert.equal(r.orderConfirmed, null);
  assert.equal(r.totalCzk, null);
});

test("transcript drops empty messages", () => {
  assert.equal(toTranscript(conversation()).length, 2);
});
