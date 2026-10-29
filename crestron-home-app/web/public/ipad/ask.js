// "Ask Home": the assistant panel with the glowing screen edge. Uses the home server's
// /api/assistant (Claude with an API key) or, in the browser demo, the page's `sample` capability.
import { icon } from "../icons.js";
import { applyControlCall, ASSISTANT_RULES, CONTROL_TOOL_DESCRIPTION, CONTROL_TOOL_NAME, CONTROL_TOOL_SCHEMA, homeForModel } from "../shared/assistant-core.js";
import { esc } from "./views.js";

const $ = (s) => document.querySelector(s);
const SUGGESTIONS = ["Good night", "Turn off all the lights", "Dim the living room to 30%", "Is the front door locked?", "Play Spotify in the kitchen", "Open the gate"];
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const SAMPLE_ERRORS = {
  not_granted: "Ask Home needs your OK to use Claude. Reload the page to be asked again.",
  rate_limited: "Too many requests right now. Try again in a minute.",
  sampling_disabled: "Claude isn't available for this account.",
  session_expired: "Sign in to Claude again to use Ask Home.",
  refused: "Sorry, I can't help with that one.",
  tools_unavailable: "Ask Home can't control the demo house in this view.",
};

export function createAsk({ app, send, notify, onVisibility }) {
  const ask = { open: false, log: [], turns: [], busy: false, ctl: null, rec: null, listening: false, sample: null };
  const keyMissing = () => app.transport === "server" && !app.assistant?.available;

  async function init() {
    // In the browser demo, the viewer's own Claude account answers (after they allow it).
    if (app.transport === "local" && window.claude?.use) {
      try {
        const sample = await window.claude.use("sample");
        const limits = sample ? await sample.limits().catch(() => null) : null;
        if (sample && limits?.tools) ask.sample = sample;
      } catch {}
    }
    refreshVisibility();
  }

  function refreshVisibility() {
    const visible = app.transport === "server" || Boolean(ask.sample);
    if (visible !== app.askVisible) {
      app.askVisible = visible;
      onVisibility();
    }
  }

  function open(prefill = "") {
    ask.open = true;
    $("#siri").hidden = false;
    $("#glow").hidden = false;
    render();
    const input = $("#siri-input");
    if (input) {
      input.value = prefill;
      input.focus({ preventScroll: true });
    }
  }

  function close() {
    ask.open = false;
    ask.ctl?.abort();
    stopListening();
    $("#siri").hidden = true;
    $("#glow").hidden = true;
  }

  function render() {
    const missing = keyMissing();
    $("#siri").innerHTML = `
      <div class="siri-head"><span class="orb"></span>
        <div><div class="siri-title">Ask Home</div><div class="siri-sub">${app.transport === "local" ? "Demo house · answers with your Claude account" : SpeechRec ? "Type, or tap the mic and speak" : "Type what you'd like"}</div></div>
        <button type="button" class="sheet-close" data-act="ask-close" aria-label="Close Ask Home">${icon("close")}</button></div>
      <div class="siri-log" id="siri-log" aria-live="polite"></div>
      <form class="siri-form" id="siri-form">
        <input class="siri-input" id="siri-input" autocomplete="off" enterkeyhint="send" placeholder="Turn off the kitchen lights…" aria-label="Ask Home"${missing ? " disabled" : ""}>
        ${SpeechRec && !missing ? `<button type="button" class="circle-btn${ask.listening ? " listening" : ""}" data-act="ask-mic" aria-label="${ask.listening ? "Stop listening" : "Speak"}">${icon("mic")}</button>` : ""}
        <button type="submit" class="circle-btn send" id="siri-send" aria-label="Send"${missing || ask.busy ? " disabled" : ""}>${icon("send")}</button>
      </form>`;
    renderLog();
  }

  function renderLog() {
    const log = $("#siri-log");
    if (!log) return;
    $("#glow").classList.toggle("busy", ask.busy || ask.listening);
    if (keyMissing()) {
      log.innerHTML = `<div class="msg ai">To use Ask Home, add an Anthropic API key in <a href="../#setup"><u>System setup › AI assistant</u></a>.</div>`;
      return;
    }
    log.innerHTML = ask.log.length ? ask.log.map((e, i) => {
      switch (e.kind) {
        case "me": return `<div class="msg me">${esc(e.text)}</div>`;
        case "ai": return `<div class="msg ai${e.thinking ? " thinking" : ""}">${esc(e.text)}</div>`;
        case "err": return `<div class="msg err">${esc(e.text)}</div>`;
        case "did": return `<div class="did">${e.items.map((t) => `<span>${icon("check")}${esc(t)}</span>`).join("")}${e.failed.map((t) => `<span class="fail">${icon("close")}${esc(t)}</span>`).join("")}</div>`;
        case "confirm": return `<div class="confirm"><span>${esc(e.label)}</span>${e.done
          ? `<b>${icon("check")}${esc(e.done)}</b>`
          : `<button type="button" data-act="ask-confirm" data-index="${i}">Confirm</button>`}</div>`;
        default: return "";
      }
    }).join("") : `<div class="msg ai">What would you like to do?</div>
      <div class="suggest">${SUGGESTIONS.map((t) => `<button type="button" data-act="ask-suggest" data-text="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
    log.scrollTop = log.scrollHeight;
    const sendBtn = $("#siri-send");
    if (sendBtn) sendBtn.disabled = ask.busy;
  }

  async function submit(raw) {
    const text = String(raw).trim();
    if (!text || ask.busy || keyMissing()) return;
    ask.busy = true;
    ask.log.push({ kind: "me", text });
    const reply = { kind: "ai", text: "Thinking…", thinking: true };
    ask.log.push(reply);
    renderLog();
    try {
      const result = app.transport === "local" ? await askLocal(text, reply) : await askServer(text);
      reply.text = result.reply;
      reply.thinking = false;
      if (result.done.length || result.failed.length) ask.log.push({ kind: "did", items: result.done, failed: result.failed });
      for (const c of result.confirm) ask.log.push({ kind: "confirm", label: c.label, command: c.command });
      ask.turns.push({ role: "user", text }, { role: "assistant", text: result.reply });
      ask.turns = ask.turns.slice(-12);
    } catch (err) {
      ask.log.splice(ask.log.indexOf(reply), 1);
      if (err?.code !== "cancelled") ask.log.push({ kind: "err", text: err?.message || "Something went wrong." });
    } finally {
      ask.busy = false;
      renderLog();
    }
  }

  async function askServer(text) {
    const res = await fetch(`${app.api}assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: ask.turns }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `The home server answered ${res.status}.`);
    return { reply: json.reply ?? "Done.", done: json.done ?? [], confirm: json.confirm ?? [], failed: json.failed ?? [] };
  }

  async function askLocal(text, reply) {
    const done = [];
    const confirm = [];
    const failed = [];
    ask.ctl = new AbortController();
    // `sample` has no system prompt: the rules go in a leading user turn that is always kept.
    const input = [
      { role: "user", content: `${ASSISTANT_RULES}\n\nThis is a demo house running in the browser.` },
      ...ask.turns.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: `Current home state:\n${JSON.stringify(homeForModel(app.home))}\n\n${text}` },
    ];
    try {
      const result = await ask.sample(input, {
        modelTier: "quick",
        signal: ask.ctl.signal,
        onText: ({ text: soFar }) => {
          reply.text = soFar.split(/\n\s*\n/).filter((t) => t.trim()).at(-1) ?? soFar;
          reply.thinking = false;
          renderLog();
        },
        tools: [{
          name: CONTROL_TOOL_NAME,
          description: CONTROL_TOOL_DESCRIPTION,
          inputSchema: CONTROL_TOOL_SCHEMA,
          execute: async (toolInput, context) => {
            if (context.signal.aborted) throw new Error("Stopped.");
            const outcome = await applyControlCall(toolInput, { getHome: () => app.home, perform: async (cmd) => send(cmd) });
            done.push(...outcome.done);
            confirm.push(...outcome.confirm);
            failed.push(...outcome.failed);
            if (outcome.isError) throw new Error(outcome.text);
            return outcome.text;
          },
        }],
      });
      // With tools, the text of every round comes back joined; the last paragraph is the answer.
      const answer = result.text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).at(-1) ?? "Done.";
      return { reply: answer, done, confirm, failed };
    } catch (e) {
      const err = new Error(SAMPLE_ERRORS[e?.code] ?? "Ask Home had a problem. Try again.");
      err.code = e?.code;
      throw err;
    } finally {
      ask.ctl = null;
    }
  }

  function confirmAt(index) {
    const entry = ask.log[index];
    if (!entry || entry.kind !== "confirm" || entry.done) return;
    send(entry.command);
    entry.done = "Done";
    renderLog();
  }

  function toggleListening() {
    if (ask.listening) return stopListening();
    try {
      const rec = new SpeechRec();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      rec.onresult = (e) => {
        const said = Array.from(e.results).map((r) => r[0].transcript).join("");
        const input = $("#siri-input");
        if (input) input.value = said;
        if (e.results[e.results.length - 1].isFinal) {
          stopListening();
          if (input) input.value = "";
          submit(said);
        }
      };
      rec.onerror = (e) => {
        stopListening();
        if (e.error === "not-allowed" || e.error === "service-not-allowed") notify("Voice isn't allowed here. Check microphone access for this site.", { error: true });
      };
      rec.onend = () => {
        ask.listening = false;
        updateMic();
      };
      rec.start();
      ask.rec = rec;
      ask.listening = true;
      updateMic();
    } catch {
      notify("Voice isn't available on this device.", { error: true });
    }
  }

  function stopListening() {
    try { ask.rec?.stop(); } catch {}
    ask.rec = null;
    ask.listening = false;
    updateMic();
  }

  function updateMic() {
    const b = document.querySelector('[data-act="ask-mic"]');
    if (b) {
      b.classList.toggle("listening", ask.listening);
      b.setAttribute("aria-label", ask.listening ? "Stop listening" : "Speak");
    }
    $("#glow")?.classList.toggle("busy", ask.busy || ask.listening);
  }

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "siri-form") return;
    e.preventDefault();
    const input = $("#siri-input");
    submit(input.value);
    input.value = "";
  });

  return {
    init, open, close, submit, confirmAt, toggleListening, refreshVisibility,
    get isOpen() { return ask.open; },
    onStateChange() { if (ask.open && keyMissing() !== $("#siri-input")?.disabled) render(); },
  };
}
