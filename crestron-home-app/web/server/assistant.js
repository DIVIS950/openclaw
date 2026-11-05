// The home assistant on the home server: turns plain requests ("turn off the kitchen
// lights", "good night") into house commands using Claude with one tool, `control_home`.
//
// Safety rules live in code (shared/assistant-core.js), not in the prompt:
// unlocking a door and opening the gate come back as confirm buttons the person must
// tap, and disarming the alarm is refused (it needs the keypad code).
import Anthropic from "@anthropic-ai/sdk";

import {
  applyControlCall, applyScheduleCall, applyTimerCall, ASSISTANT_RULES, CONTROL_TOOL_DESCRIPTION, CONTROL_TOOL_NAME, CONTROL_TOOL_SCHEMA,
  homeForModel, SCHEDULE_TOOL, SCHEDULE_TOOL_NAME, TIMER_TOOL, TIMER_TOOL_NAME,
} from "../public/shared/assistant-core.js";

const MODEL = process.env.ASSISTANT_MODEL ?? "claude-opus-5-5";
const MAX_TURNS = 6;
const MAX_HISTORY = 12;

const TOOLS = [
  { name: CONTROL_TOOL_NAME, description: CONTROL_TOOL_DESCRIPTION, input_schema: CONTROL_TOOL_SCHEMA },
  { name: TIMER_TOOL_NAME, description: TIMER_TOOL.description, input_schema: TIMER_TOOL.schema },
  { name: SCHEDULE_TOOL_NAME, description: SCHEDULE_TOOL.description, input_schema: SCHEDULE_TOOL.schema },
];

/**
 * Runs one assistant request.
 * @param {object} opts
 * @param {string} opts.message - what the person said
 * @param {{role: "user"|"assistant", text: string}[]} opts.history - earlier turns (text only)
 * @param {() => object} opts.getHome - current home snapshot
 * @param {(cmd: object) => Promise<void>} opts.perform - runs a command on the house
 * @param {string} [opts.apiKey] - Anthropic API key from Setup (else the SDK reads ANTHROPIC_API_KEY)
 * @param {(t: {minutes, label, commands}) => Promise<void>} opts.addTimer
 * @param {(schedule: object) => Promise<void>} opts.addSchedule
 * @param {() => object} [opts.getContext] - viewing room, local time, weather and automations for the model
 */
export async function runAssistant({ message, history, getHome, perform, apiKey, addTimer, addSchedule, getContext = () => ({}) }) {
  const client = new Anthropic(apiKey ? { apiKey } : {});
  const done = [];
  const confirm = [];
  const failed = [];

  const messages = [];
  for (const turn of (history ?? []).slice(-MAX_HISTORY)) {
    if ((turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim()) {
      messages.push({ role: turn.role, content: turn.text.slice(0, 2000) });
    }
  }
  // The live state goes in the newest user turn, after the cached system prompt and tool.
  messages.push({
    role: "user",
    content: [
      { type: "text", text: `Current home state:\n${JSON.stringify(homeForModel(getHome(), getContext()))}` },
      { type: "text", text: message.slice(0, 2000) },
    ],
  });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Short home-control requests don't need deep reasoning; low effort keeps replies fast.
      output_config: { effort: "low" },
      system: [{ type: "text", text: ASSISTANT_RULES, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
      // If a safety classifier declines a request, Anthropic re-runs it on its recommended model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return { reply: "Sorry, I can't help with that one.", done, confirm, failed };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return { reply: reply || (done.length ? "Done." : "Sorry, I didn't catch that."), done, confirm, failed };
    }

    // Append the whole assistant turn unchanged (thinking blocks included), then the results.
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const use of toolUses) {
      const outcome = use.name === CONTROL_TOOL_NAME ? await applyControlCall(use.input, { getHome, perform })
        : use.name === TIMER_TOOL_NAME ? await applyTimerCall(use.input, { addTimer })
        : use.name === SCHEDULE_TOOL_NAME ? await applyScheduleCall(use.input, { getHome, addSchedule })
        : { text: `Unknown tool ${use.name}`, isError: true, done: [], confirm: [], failed: [] };
      done.push(...outcome.done);
      confirm.push(...outcome.confirm);
      failed.push(...outcome.failed);
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.text, is_error: outcome.isError });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: done.length ? "Done." : "Sorry, that took too many steps. Try asking in a simpler way.", done, confirm, failed };
}

/** Turns SDK errors into messages a person can act on. */
export function assistantErrorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return "The AI key isn't valid. Check it in Setup › AI assistant.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This AI key isn't allowed to use the assistant model.";
  if (err instanceof Anthropic.RateLimitError) return "The assistant is busy right now. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "The home server can't reach the AI service. Check its internet connection.";
  if (err instanceof Anthropic.APIError) return `The AI service had a problem (${err.status ?? "error"}). Try again.`;
  if (err instanceof Anthropic.AnthropicError) return "Add an Anthropic API key in Setup › AI assistant to use the assistant.";
  return err?.message || "Something went wrong.";
}
