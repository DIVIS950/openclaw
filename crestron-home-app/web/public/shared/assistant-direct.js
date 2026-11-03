// Ask Home without a home server: the browser talks to the Claude API itself with the
// person's own key (Web XPanel mode). Same instructions, tools, safety rules and tool loop
// as the home server's assistant (../../server/assistant.js), only over fetch and without
// streaming. Nothing here depends on the server.
import {
  applyControlCall, applyScheduleCall, applyTimerCall, ASSISTANT_RULES, CONTROL_TOOL_DESCRIPTION, CONTROL_TOOL_NAME, CONTROL_TOOL_SCHEMA,
  homeForModel, SCHEDULE_TOOL, SCHEDULE_TOOL_NAME, TIMER_TOOL, TIMER_TOOL_NAME,
} from "./assistant-core.js";
import { t } from "./i18n.js";

export const DIRECT_MODEL = "claude-opus-5-5";
export const DIRECT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MAX_TURNS = 6;
const MAX_HISTORY = 12;

export const DIRECT_TOOLS = [
  { name: CONTROL_TOOL_NAME, description: CONTROL_TOOL_DESCRIPTION, input_schema: CONTROL_TOOL_SCHEMA },
  { name: TIMER_TOOL_NAME, description: TIMER_TOOL.description, input_schema: TIMER_TOOL.schema },
  { name: SCHEDULE_TOOL_NAME, description: SCHEDULE_TOOL.description, input_schema: SCHEDULE_TOOL.schema },
];

/** The headers a browser needs to call the API directly (the key never leaves the device otherwise). */
export const directHeaders = (apiKey) => ({
  "content-type": "application/json",
  "x-api-key": apiKey,
  "anthropic-version": "2026-10-21",
  "anthropic-beta": "server-side-fallback-2026-07-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

/**
 * Runs one assistant request. Resolves { reply, done, confirm, failed } like the server does.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.message - what the person said
 * @param {{role: "user"|"assistant", text: string}[]} [opts.history] - earlier turns (text only)
 * @param {() => object} opts.getHome - current home snapshot
 * @param {(cmd: object) => Promise<void>} opts.perform - runs a command on the house
 * @param {(t: {minutes, label, commands}) => Promise<void>} opts.addTimer
 * @param {(schedule: object) => Promise<void>} opts.addSchedule
 * @param {() => object} [opts.getContext] - viewing room, time, weather, automations, lang
 * @param {typeof fetch} [opts.fetch] - for tests
 * @param {AbortSignal} [opts.signal]
 */
export async function runDirectAssistant({
  apiKey, message, history = [], getHome, perform, addTimer, addSchedule, getContext = () => ({}),
  fetch = (...args) => globalThis.fetch(...args), signal, model = DIRECT_MODEL, endpoint = DIRECT_ENDPOINT,
}) {
  if (!apiKey) throw new Error(t("Add your Anthropic API key in Settings › Assistant to use Ask Home."));
  const done = [];
  const confirm = [];
  const failed = [];

  const messages = [];
  for (const turn of history.slice(-MAX_HISTORY)) {
    if ((turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim()) {
      messages.push({ role: turn.role, content: turn.text.slice(0, 2000) });
    }
  }
  // The live state goes in the newest user turn, after the cached system prompt and tools.
  messages.push({
    role: "user",
    content: [
      { type: "text", text: `Current home state:\n${JSON.stringify(homeForModel(getHome(), getContext()))}` },
      { type: "text", text: String(message).slice(0, 2000) },
    ],
  });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await call({
      model,
      max_tokens: 8000,
      // Short home-control requests don't need deep reasoning; low effort keeps replies fast.
      output_config: { effort: "low" },
      system: [{ type: "text", text: ASSISTANT_RULES, cache_control: { type: "ephemeral" } }],
      tools: DIRECT_TOOLS,
      messages,
      // If a safety classifier declines a request, Anthropic re-runs it on its recommended model.
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") return { reply: t("Sorry, I can't help with that one."), done, confirm, failed };

    const content = Array.isArray(response.content) ? response.content : [];
    const toolUses = content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return { reply: reply || (done.length ? t("Done.") : t("Sorry, I didn't catch that.")), done, confirm, failed };
    }

    // Append the whole assistant turn unchanged (thinking blocks included), then the results.
    messages.push({ role: "assistant", content });
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
  return { reply: done.length ? t("Done.") : t("Sorry, that took too many steps. Try asking in a simpler way."), done, confirm, failed };

  async function call(body) {
    let res;
    try {
      res = await fetch(endpoint, { method: "POST", headers: directHeaders(apiKey), body: JSON.stringify(body), signal });
    } catch (err) {
      if (err?.name === "AbortError") {
        const e = new Error(t("Cancelled."));
        e.code = "cancelled";
        throw e;
      }
      throw new Error(t("Couldn't reach the AI service. Check the internet connection."));
    }
    if (!res.ok) throw new Error(await errorMessage(res));
    return res.json();
  }
}

/** Turns API errors into messages a person can act on. */
async function errorMessage(res) {
  let detail = "";
  try { detail = String((await res.json())?.error?.message ?? ""); } catch {}
  switch (res.status) {
    case 401: return t("The AI key isn't valid. Check it in Settings › Assistant.");
    case 403: return t("This AI key isn't allowed to use the assistant model.");
    case 429: return t("The assistant is busy right now. Try again in a minute.");
    default: return `${t("The AI service had a problem ({status}). Try again.", { status: res.status })}${detail ? ` ${detail.slice(0, 200)}` : ""}`;
  }
}
