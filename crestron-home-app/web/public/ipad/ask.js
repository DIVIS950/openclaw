// "Ask Home": the assistant panel with the glowing screen edge. Uses the home server's
// /api/assistant (Claude with an API key) or, in the browser demo, the page's `sample` capability.
// It knows the room on screen, suggests things from the state of the house, can set timers and
// schedules, offers Undo for what it changed, and can read its answers out loud.
import { icon, sceneIcon } from "../icons.js";
import {
  applyControlCall, applyScheduleCall, applyTimerCall, ASSISTANT_RULES, CONTROL_TOOL_DESCRIPTION, CONTROL_TOOL_NAME,
  CONTROL_TOOL_SCHEMA, homeForModel, SCHEDULE_TOOL, TIMER_TOOL,
} from "../shared/assistant-core.js";
import { attr, esc, isOn } from "./views.js";

const $ = (s) => document.querySelector(s);
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const SAMPLE_ERRORS = {
  not_granted: "Ask Home needs your OK to use Claude. Reload the page to be asked again.",
  rate_limited: "Too many requests right now. Try again in a minute.",
  sampling_disabled: "Claude isn't available for this account.",
  session_expired: "Sign in to Claude again to use Ask Home.",
  refused: "Sorry, I can't help with that one.",
  tools_unavailable: "Ask Home can't control the demo house in this view.",
};

/** Suggestions that fit the house right now: something open, music playing, the time of day. */
function smartSuggestions(app) {
  const h = app.home;
  const hour = new Date().getHours();
  const out = [];
  const room = app.route.name === "room" ? h.rooms.find((r) => r.id === app.route.arg) : null;
  const unlocked = h.locks.filter((l) => l.locked === false);
  if (unlocked.length) out.push({ ic: "lock", text: unlocked.length > 1 ? "Lock all the doors" : `Lock the ${unlocked[0].name.toLowerCase()}` });
  if (room && h.lights.some((l) => l.roomId === room.id && isOn(l))) out.push({ ic: "bulbOff", text: "Turn off the lights in here" });
  else if (room) out.push({ ic: "bulb", text: "Turn on the lights in here" });
  const playing = h.media.find((m) => m.on);
  if (playing) out.push({ ic: "timer", text: `Turn off the ${playing.name.toLowerCase()} music in 30 minutes` });
  else if (h.media.length) out.push({ ic: "music", text: "Play Spotify in the kitchen" });
  const scene = h.scenes.find((s) => (hour >= 20 || hour < 5 ? /night/i : hour < 11 ? /morning|wake/i : /welcome|home/i).test(s.name));
  if (scene) out.push({ ic: sceneIcon(scene), text: scene.name });
  if (h.shades.length) out.push({ ic: "calendar", text: "Close all shades at sunset every day" });
  if (h.lights.filter(isOn).length > 2) out.push({ ic: "bulbOff", text: "Turn off all the lights" });
  out.push({ ic: "sparkle", text: "What's on right now?" });
  return out.slice(0, 6);
}

/** Commands that put back what an answer changed (lights, shades, music). Never locks, gate or alarm. */
function undoCommands(before, after) {
  const cmds = [];
  for (const l of before.lights) {
    const now = after.lights.find((x) => x.id === l.id);
    if (now && Math.abs(now.level - l.level) > 0.01) cmds.push({ type: "setLight", id: l.id, level: l.level });
  }
  for (const s of before.shades) {
    const now = after.shades.find((x) => x.id === s.id);
    if (now && Math.abs(now.position - s.position) > 0.01) cmds.push({ type: "setShade", id: s.id, position: s.position });
  }
  for (const m of before.media) {
    const now = after.media.find((x) => x.id === m.id);
    if (!now) continue;
    if (m.on && m.sourceId && now.sourceId !== m.sourceId) cmds.push({ type: "mediaSource", id: m.id, sourceId: m.sourceId });
    if (now.on !== m.on) cmds.push({ type: "mediaPower", id: m.id, on: m.on });
    if (m.on && Math.abs(now.volume - m.volume) > 0.01) cmds.push({ type: "mediaVolume", id: m.id, level: m.volume });
  }
  return cmds;
}

export function createAsk({ app, send, notify, onVisibility, automation }) {
  const ask = { open: false, log: [], turns: [], busy: false, ctl: null, rec: null, listening: false, sample: null, speak: false };
  const keyMissing = () => app.transport === "server" && !app.assistant?.available;
  try { ask.speak = localStorage.getItem("hv.askSpeak") === "1"; } catch {}

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

  const viewingRoom = () => (app.route.name === "room" ? app.home.rooms.find((r) => r.id === app.route.arg)?.name : undefined);

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
    window.speechSynthesis?.cancel();
    $("#siri").hidden = true;
    $("#glow").hidden = true;
  }

  function render() {
    const missing = keyMissing();
    const room = viewingRoom();
    $("#siri").innerHTML = `
      <div class="siri-head"><span class="orb big"></span>
        <div class="siri-titles"><div class="siri-title">Ask Home</div>
          <div class="siri-sub">${room ? `<span class="ctx-pill">${icon("home")}In ${esc(room)}</span>` : ""}${app.transport === "local" ? "Demo house · uses your Claude account" : SpeechRec ? "Type, or tap the mic and speak" : "Type what you'd like"}</div></div>
        ${"speechSynthesis" in window ? `<button type="button" class="siri-icon-btn${ask.speak ? " on" : ""}" data-act="ask-speak" aria-pressed="${ask.speak}" aria-label="Read answers out loud">${icon("volume")}</button>` : ""}
        <button type="button" class="siri-icon-btn" data-act="ask-close" aria-label="Close Ask Home">${icon("close")}</button>
      </div>
      <div class="siri-log" id="siri-log" aria-live="polite"></div>
      <form class="siri-form" id="siri-form">
        <div class="siri-field${ask.listening ? " listening" : ""}">
          <input class="siri-input" id="siri-input" autocomplete="off" enterkeyhint="send" placeholder="${ask.listening ? "Listening…" : "Ask anything about the house…"}" aria-label="Ask Home"${missing ? " disabled" : ""}>
          <span class="wave" aria-hidden="true">${"<i></i>".repeat(5)}</span>
        </div>
        ${SpeechRec && !missing ? `<button type="button" class="circle-btn${ask.listening ? " listening" : ""}" data-act="ask-mic" aria-label="${ask.listening ? "Stop listening" : "Speak"}">${icon("mic")}</button>` : ""}
        <button type="submit" class="circle-btn send" id="siri-send" aria-label="Send"${missing || ask.busy ? " disabled" : ""}>${icon("send")}</button>
      </form>`;
    renderLog();
  }

  function greeting() {
    const h = new Date().getHours();
    return h >= 5 && h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening.";
  }

  function renderLog() {
    const log = $("#siri-log");
    if (!log) return;
    $("#glow").classList.toggle("busy", ask.busy || ask.listening);
    if (keyMissing()) {
      log.innerHTML = `<div class="msg ai">To use Ask Home, add an Anthropic API key in <a href="../index.html#setup"><u>System setup › AI assistant</u></a>.</div>`;
      return;
    }
    if (!ask.log.length) {
      log.innerHTML = `<div class="ask-hello"><div class="msg ai">${greeting()} What can I do for you?</div>
        <p class="ask-hint">I can control anything in the house, set timers ("in 30 minutes") and schedules ("every night at 11"), and answer questions.</p>
        <div class="suggest-grid">${smartSuggestions(app).map((s) => `<button type="button" class="suggest-card"${attr({ act: "ask-suggest", text: s.text })}><span class="sg-icon">${icon(s.ic)}</span><span>${esc(s.text)}</span></button>`).join("")}</div></div>`;
    } else {
      log.innerHTML = ask.log.map((e, i) => {
        switch (e.kind) {
          case "me": return `<div class="msg me">${esc(e.text)}</div>`;
          case "ai": return `<div class="msg ai${e.thinking ? " thinking" : ""}">${e.thinking ? `<span class="dots"><i></i><i></i><i></i></span>` : esc(e.text)}</div>`;
          case "err": return `<div class="msg err">${icon("alert")}${esc(e.text)}</div>`;
          case "did": return `<div class="did-card">
              ${e.items.map((t) => `<div class="did-row">${icon("check")}<span>${esc(t)}</span></div>`).join("")}
              ${e.failed.map((t) => `<div class="did-row fail">${icon("close")}<span>${esc(t)}</span></div>`).join("")}
              ${e.undo?.length ? `<button type="button" class="undo-btn"${attr({ act: "ask-undo", index: i })}${e.undone ? " disabled" : ""}>${e.undone ? "Undone" : `${icon("back")}Undo`}</button>` : ""}
            </div>`;
          case "confirm": return `<div class="confirm"><span>${icon("alert")}${esc(e.label)}</span>${e.done
            ? `<b>${icon("check")}${esc(e.done)}</b>`
            : `<button type="button"${attr({ act: "ask-confirm", index: i })}>Confirm</button>`}</div>`;
          default: return "";
        }
      }).join("");
    }
    log.scrollTop = log.scrollHeight;
    const sendBtn = $("#siri-send");
    if (sendBtn) sendBtn.disabled = ask.busy;
  }

  function say(text) {
    if (!ask.speak || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = navigator.language || "en-US";
      window.speechSynthesis.speak(u);
    } catch {}
  }

  async function submit(raw) {
    const text = String(raw).trim();
    if (!text || ask.busy || keyMissing()) return;
    ask.busy = true;
    ask.log.push({ kind: "me", text });
    const reply = { kind: "ai", text: "", thinking: true };
    ask.log.push(reply);
    renderLog();
    const before = structuredClone(app.home);
    try {
      const result = app.transport === "local" ? await askLocal(text, reply) : await askServer(text);
      reply.text = result.reply;
      reply.thinking = false;
      say(result.reply);
      if (result.done.length || result.failed.length) {
        // Give the house a moment to report back before working out what Undo should restore.
        await new Promise((r) => setTimeout(r, 400));
        ask.log.push({ kind: "did", items: result.done, failed: result.failed, undo: undoCommands(before, app.home) });
      }
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
      body: JSON.stringify({ message: text, history: ask.turns, context: { room: viewingRoom() } }),
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
    const collect = (outcome) => {
      done.push(...outcome.done);
      confirm.push(...outcome.confirm);
      failed.push(...outcome.failed);
      if (outcome.isError) throw new Error(outcome.text);
      return outcome.text;
    };
    const auto = automation();
    const context = {
      viewingRoom: viewingRoom(),
      now: new Date().toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }),
      weather: app.weather ?? undefined,
      automations: app.automations,
    };
    // `sample` has no system prompt: the rules go in a leading user turn that is always kept.
    const input = [
      { role: "user", content: `${ASSISTANT_RULES}\n\nThis is a demo house running in the browser.` },
      ...ask.turns.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: `Current home state:\n${JSON.stringify(homeForModel(app.home, context))}\n\n${text}` },
    ];
    try {
      const result = await ask.sample(input, {
        modelTier: "quick",
        signal: ask.ctl.signal,
        onText: ({ text: soFar }) => {
          reply.text = soFar.split(/\n\s*\n/).filter((t) => t.trim()).at(-1) ?? soFar;
          reply.thinking = !reply.text;
          renderLog();
        },
        tools: [
          {
            name: CONTROL_TOOL_NAME,
            description: CONTROL_TOOL_DESCRIPTION,
            inputSchema: CONTROL_TOOL_SCHEMA,
            execute: async (toolInput) => collect(await applyControlCall(toolInput, { getHome: () => app.home, perform: async (cmd) => send(cmd) })),
          },
          {
            name: TIMER_TOOL.name,
            description: TIMER_TOOL.description,
            inputSchema: TIMER_TOOL.schema,
            execute: async (toolInput) => collect(await applyTimerCall(toolInput, { addTimer: auto.addTimer })),
          },
          {
            name: SCHEDULE_TOOL.name,
            description: SCHEDULE_TOOL.description,
            inputSchema: SCHEDULE_TOOL.schema,
            execute: async (toolInput) => collect(await applyScheduleCall(toolInput, { getHome: () => app.home, addSchedule: auto.addSchedule })),
          },
        ],
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

  function undoAt(index) {
    const entry = ask.log[index];
    if (!entry?.undo?.length || entry.undone) return;
    for (const cmd of entry.undo) send(cmd);
    entry.undone = true;
    renderLog();
    notify("Put back as it was", { ic: "back", color: "#0a84ff" });
  }

  function toggleSpeak() {
    ask.speak = !ask.speak;
    try { localStorage.setItem("hv.askSpeak", ask.speak ? "1" : "0"); } catch {}
    if (!ask.speak) window.speechSynthesis?.cancel();
    render();
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
    const field = document.querySelector(".siri-field");
    field?.classList.toggle("listening", ask.listening);
    const input = $("#siri-input");
    if (input) input.placeholder = ask.listening ? "Listening…" : "Ask anything about the house…";
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
    init, open, close, submit, confirmAt, undoAt, toggleListening, toggleSpeak, refreshVisibility,
    get isOpen() { return ask.open; },
    onStateChange() {
      if (!ask.open) return;
      if (keyMissing() !== Boolean($("#siri-input")?.disabled)) render();
      // Fresh suggestions while nothing has been asked yet.
      else if (!ask.log.length && !ask.busy) renderLog();
    },
  };
}
