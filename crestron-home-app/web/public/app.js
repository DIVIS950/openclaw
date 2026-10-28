// Home Control web app. Talks to the home server (server/index.js) when it is
// there; otherwise runs the demo house right in the browser.
import { icon, roomIcon, sceneIcon } from "./icons.js";
import { applyControlCall, ASSISTANT_RULES, CONTROL_TOOL_DESCRIPTION, CONTROL_TOOL_NAME, CONTROL_TOOL_SCHEMA, homeForModel } from "./shared/assistant-core.js";
import { DemoEngine } from "./shared/demo.js";
import {
  applyCommand, clamp01, emptyHome, GATE_TITLES, homeScenes, pct, roomOf, SECURITY_TITLES, stateKey,
} from "./shared/model.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isOn = (l) => l.level > 0.005;

// Per-device preferences (theme, wall-panel mode). Storage can be unavailable; fall back quietly.
const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`hc.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`hc.${key}`, JSON.stringify(value)); } catch {}
  },
};

const app = {
  home: emptyHome(),
  status: { connection: "connecting", message: null, mode: "demo" },
  homeName: "Home",
  cameras: [],
  transport: null, // "server" | "local"
  route: { name: "home", arg: null },
  renderedKey: null,
  recent: new Map(),
  dragging: false,
  pendingRender: false,
  renderQueued: false,
  lastTouch: Date.now(),
  device: { theme: prefs.get("theme", "auto"), wall: prefs.get("wall", false), saverMin: prefs.get("saverMin", 5) },
};

let engine = null;

// ---------- connection ----------

async function start() {
  applyTheme();
  app.route = parseHash();
  try {
    const res = await fetch("api/state", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("no server");
    receive(await res.json());
    app.transport = "server";
    const events = new EventSource("api/events");
    events.addEventListener("state", (e) => {
      try { receive(JSON.parse(e.data)); } catch {}
    });
    events.onerror = () => {
      app.status = { ...app.status, connection: "failed", message: "Lost the home server. Reconnecting…" };
      scheduleRender();
    };
  } catch {
    startLocal();
  }
  render();
  startTimers();
  initAssistant();
}

function startLocal() {
  app.transport = "local";
  engine = new DemoEngine((snap) => {
    app.home = merge(snap);
    scheduleRender();
  });
  app.home = engine.snapshot();
  app.status = { connection: "connected", message: null, mode: "demo" };
  app.cameras = [
    { id: "demo-drive", name: "Driveway", demo: "drive" },
    { id: "demo-door", name: "Front door", demo: "door" },
  ];
}

function receive(p) {
  app.home = merge(p.home ?? emptyHome());
  app.status = p.status ?? app.status;
  app.homeName = p.homeName || "Home";
  app.cameras = p.cameras ?? [];
  app.assistant = p.assistant ?? { available: false };
  updateAskFab();
  scheduleRender();
}

/** Re-apply what this device just set, so a slow processor doesn't make controls jump back. */
function merge(snapshot) {
  const now = Date.now();
  for (const [key, entry] of app.recent) if (now - entry.at > 3000) app.recent.delete(key);
  for (const { cmd } of app.recent.values()) applyCommand(snapshot, cmd);
  return snapshot;
}

async function send(cmd) {
  app.lastTouch = Date.now();
  applyCommand(app.home, cmd);
  const key = stateKey(cmd);
  if (key) app.recent.set(key, { cmd, at: Date.now() });
  scheduleRender();
  if (app.transport === "local") {
    engine.perform(cmd);
    return;
  }
  try {
    const res = await fetch("api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `The home server answered ${res.status}.`);
  } catch (err) {
    toast(err.message || "Couldn't reach the home server.");
  }
}

// ---------- routing & rendering ----------

const ROUTES = ["home", "rooms", "lights", "shades", "media", "security", "cameras", "setup"];

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("room-")) return { name: "room", arg: h.slice(5) };
  return { name: ROUTES.includes(h) ? h : "home", arg: null };
}

window.addEventListener("hashchange", () => {
  app.route = parseHash();
  closeModal();
  render();
  window.scrollTo(0, 0);
});

function scheduleRender() {
  // Never rebuild the page under a finger that is dragging a slider.
  if (app.dragging) { app.pendingRender = true; return; }
  if (app.renderQueued) return;
  app.renderQueued = true;
  requestAnimationFrame(() => {
    app.renderQueued = false;
    render();
  });
}

function render() {
  renderNav();
  const view = VIEWS[app.route.name] ?? VIEWS.home;
  const key = `${app.route.name}:${app.route.arg ?? ""}`;
  const entering = key !== app.renderedKey;
  if (view.static && !entering) {
    view.update?.();
    return;
  }
  const main = $("#main");
  const keep = snapshotUI(main);
  main.innerHTML = `<div class="view${entering ? " enter" : ""}">${view.html(app.route.arg)}</div>`;
  restoreUI(main, keep);
  app.renderedKey = key;
  if (entering) view.mount?.();
  updateClock();
}

/** Keep keyboard focus and sideways scroll positions across re-renders. */
function snapshotUI(root) {
  const active = document.activeElement;
  const focusKey = active && root.contains(active) ? active.dataset.key : null;
  const scrolls = Object.fromEntries($$("[data-scroll]", root).map((el) => [el.dataset.scroll, el.scrollLeft]));
  return { focusKey, scrolls };
}

function restoreUI(root, { focusKey, scrolls }) {
  for (const el of $$("[data-scroll]", root)) if (scrolls[el.dataset.scroll]) el.scrollLeft = scrolls[el.dataset.scroll];
  if (focusKey) $$("[data-key]", root).find((el) => el.dataset.key === focusKey)?.focus({ preventScroll: true });
}

function renderNav() {
  const h = app.home;
  const r = app.route.name;
  const lightsOn = h.lights.filter(isOn).length;
  const playing = h.media.filter((m) => m.on).length;
  const link = (hash, label, ic, current, extra = "") =>
    `<a class="nav-link" href="#${hash}"${current ? ' aria-current="page"' : ""}>${icon(ic)}<span>${esc(label)}</span>${extra}</a>`;
  const count = (n) => (n ? `<span class="count">${n}</span>` : "");
  const st = statusInfo();

  $("#sidebar").innerHTML = `
    <div class="brand">
      <span class="brand-mark">${icon("home")}</span>
      <div><div class="brand-name">${esc(app.homeName)}</div><div class="brand-sub">${esc(st.system)}</div></div>
    </div>
    <nav class="nav-group" aria-label="Sections">
      ${link("home", "Home", "home", r === "home")}
      ${link("lights", "Lights", "bulb", r === "lights", count(lightsOn))}
      ${link("shades", "Shades", "blinds", r === "shades")}
      ${link("media", "Media", "speaker", r === "media", count(playing))}
      ${link("security", "Security & gate", "shield", r === "security")}
      ${link("cameras", "Cameras", "camera", r === "cameras", count(app.cameras.length))}
    </nav>
    ${h.rooms.length ? `<nav class="nav-group" aria-label="Rooms"><div class="nav-label">Rooms</div>
      ${h.rooms.map((room) => link(`room-${encodeURIComponent(room.id)}`, room.name, roomIcon(room.name),
        r === "room" && app.route.arg === room.id,
        h.lights.some((l) => l.roomId === room.id && isOn(l)) ? '<span class="lit" title="Lights on"></span>' : "")).join("")}
    </nav>` : ""}
    <div class="sidebar-foot">
      ${link("setup", "Setup", "sliders", r === "setup")}
      <span class="pill" title="${esc(app.status.message ?? "")}"><span class="dot ${st.dot}"></span>${esc(st.label)}</span>
    </div>`;

  const tab = (hash, label, ic, current) =>
    `<a class="tab" href="#${hash}"${current ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`;
  $("#tabbar").innerHTML = [
    tab("home", "Home", "home", r === "home" || r === "setup"),
    tab("rooms", "Rooms", "grid", r === "rooms" || r === "room" || r === "lights" || r === "shades"),
    tab("media", "Media", "speaker", r === "media"),
    tab("security", "Security", "shield", r === "security"),
    tab("cameras", "Cameras", "camera", r === "cameras"),
  ].join("");
}

function statusInfo() {
  const { connection, mode } = app.status;
  const system = app.transport === "local" ? "Demo in this browser"
    : { demo: "Demo house", crestronHome: "Crestron Home", customProgram: "Custom program" }[mode] ?? "Crestron";
  if (connection === "connected") return { system, label: mode === "demo" ? "Demo running" : "Connected", dot: "ok" };
  if (connection === "connecting") return { system, label: "Connecting…", dot: "warn" };
  return { system, label: "Offline", dot: "bad" };
}

// ---------- pieces ----------

// Every room owns one candy gradient, in system order (CSS tokens: gradient + solid partner).
const CANDY = ["peach", "mint", "lilac", "sky", "rose", "lime", "periwinkle", "butter"];
const candyStyle = (name) => `--c:var(--${name});--cs:var(--${name}-solid)`;
function roomStyle(roomId) {
  const i = Math.max(0, app.home.rooms.findIndex((r) => r.id === roomId));
  return candyStyle(CANDY[i % CANDY.length]);
}

function roomLevel(lights) {
  if (!lights.length) return 0;
  return lights.reduce((sum, l) => sum + (isOn(l) ? l.level : 0), 0) / lights.length;
}

const sourceName = (m) => m.sources.find((s) => s.id === m.sourceId)?.name ?? "On";
const roomHref = (id) => `#room-${encodeURIComponent(id)}`;

function roomCard(room) {
  const h = app.home;
  const lights = h.lights.filter((l) => l.roomId === room.id);
  const on = lights.filter(isOn).length;
  const playing = h.media.find((m) => m.roomId === room.id && m.on);
  const alive = on > 0 || Boolean(playing);
  const meta = [
    on ? `${on} light${on === 1 ? "" : "s"} on` : lights.length ? "Lights off" : "",
    playing ? esc(sourceName(playing)) : "",
  ].filter(Boolean).join(" · ");
  // Rooms with something on wear their color; quiet rooms go white.
  return `<a class="room${alive ? "" : " off"}" href="${roomHref(room.id)}" style="${roomStyle(room.id)};--lvl:${roomLevel(lights).toFixed(2)}">
    <div class="room-top"><span class="room-glyph">${icon(roomIcon(room.name))}</span><span class="room-count num">${on || ""}</span></div>
    <div><div class="room-name">${esc(room.name)}</div><div class="room-meta">${meta}</div><div class="room-bar"><i></i></div></div>
  </a>`;
}

const SCENE_CANDY = ["butter", "lilac", "sky", "peach", "rose", "mint", "periwinkle", "lime"];

function sceneTile(scene, i = 0) {
  const room = roomOf(app.home, scene.roomId);
  // A scene that was just tapped pops and sparkles once (the tile is re-rendered, so remember it briefly).
  const popped = app.pop?.id === scene.id && Date.now() - app.pop.at < 700;
  return `<button class="scene${scene.active ? " active" : ""}${popped ? " pop" : ""}" style="${candyStyle(SCENE_CANDY[i % SCENE_CANDY.length])}" data-act="scene" data-id="${esc(scene.id)}" data-key="scene:${esc(scene.id)}" aria-pressed="${scene.active}" aria-label="${esc(scene.name)}${room ? `, ${esc(room.name)}` : ""}">
    <span class="scene-icon">${icon(sceneIcon(scene))}</span>
    <span class="scene-name">${esc(scene.name)}</span>
  </button>`;
}

function fmtValue(v, format) {
  if (format === "shade") return v < 0.01 ? "Closed" : v > 0.99 ? "Open" : pct(v);
  return v < 0.005 && format === "light" ? "Off" : pct(v);
}

function slider({ kind, id, value, tint, iconName, label, thin = false, format = "pct", disabled = false }) {
  const text = fmtValue(value, format);
  return `<div class="slider ${tint}${thin ? " thin" : ""}" role="slider" tabindex="0" data-key="slider:${kind}:${esc(id)}"
      aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}"
      aria-valuetext="${text}"${disabled ? ' aria-disabled="true"' : ""}
      data-slider="${kind}" data-id="${esc(id)}" data-format="${format}" style="--v:${value.toFixed(3)}">
    <div class="slider-label">${icon(iconName)}<span class="name">${esc(label)}</span><span class="value">${text}</span></div>
    <div class="slider-fill"><div class="slider-label on-fill" aria-hidden="true">${icon(iconName)}<span class="name">${esc(label)}</span><span class="value">${text}</span></div></div>
  </div>`;
}

function lightRow(l) {
  const on = isOn(l);
  const toggle = `<button class="round lamp${on ? " on" : ""}" data-act="light-toggle" data-id="${esc(l.id)}" data-key="lt:${esc(l.id)}"
      aria-label="${on ? "Turn off" : "Turn on"} ${esc(l.name)}" aria-pressed="${on}">${icon(on ? "bulb" : "bulbOff")}</button>`;
  const body = l.dimmable
    ? slider({ kind: "light", id: l.id, value: l.level, tint: "lamp", iconName: "sun", label: l.name, format: "light" })
    : `<button class="toggle-row${on ? " on" : ""}" data-act="light-toggle" data-id="${esc(l.id)}"><span>${esc(l.name)}</span><span class="muted">${on ? "On" : "Off"}</span></button>`;
  return `<div class="row${l.online ? "" : " offline"}">${toggle}${body}</div>`;
}

function shadeRow(s) {
  const btn = (label, ic, act, extra = "") =>
    `<button class="btn grow" data-act="${act}" data-id="${esc(s.id)}" ${extra}>${icon(ic)}${label}</button>`;
  return `<div class="stack${s.online ? "" : " offline"}">
    ${s.hasPosition
      ? slider({ kind: "shade", id: s.id, value: s.position, tint: "shade", iconName: "blinds", label: s.name, format: "shade" })
      : `<div class="group-title"><span>${esc(s.name)}</span></div>`}
    <div class="btn-row">
      ${btn("Open", "up", "shade", 'data-pos="1"')}
      ${s.canStop ? btn("Stop", "stop", "shade-stop") : ""}
      ${btn("Close", "down", "shade", 'data-pos="0"')}
    </div>
  </div>`;
}

function mediaCard(m) {
  const id = esc(m.id);
  return `<div class="card media-card${m.on ? "" : " off"}">
    <div class="media-head">
      <span class="media-art">${icon(m.on ? "music" : "speaker")}</span>
      <div style="flex:1;min-width:0"><div class="media-title">${esc(m.name)}</div><div class="media-sub">${m.on ? esc(sourceName(m)) : "Off"}</div></div>
      <button class="round media${m.on ? " on" : ""}" data-act="power" data-id="${id}" data-key="pw:${id}" aria-label="Power ${esc(m.name)}" aria-pressed="${m.on}">${icon("power")}</button>
    </div>
    ${m.sources.length ? `<div class="sources" data-scroll="src:${id}">${m.sources.map((s) =>
      `<button class="source${m.on && s.id === m.sourceId ? " on" : ""}" data-act="source" data-id="${id}" data-source="${esc(s.id)}" data-key="src:${id}:${esc(s.id)}">${esc(s.name)}</button>`).join("")}</div>` : ""}
    ${m.hasVolume ? `<div class="row vol">
      <button class="round danger${m.muted ? " on" : ""}" data-act="mute" data-id="${id}" data-key="mute:${id}" aria-label="${m.muted ? "Unmute" : "Mute"}" aria-pressed="${m.muted}">${icon(m.muted ? "mute" : "volume")}</button>
      ${slider({ kind: "volume", id: m.id, value: m.volume, tint: "media", iconName: "volume", label: "Volume", thin: true })}
    </div>` : ""}
  </div>`;
}

function gateCard(g) {
  const isOpen = g.state === "open";
  const openAction = g.separateOpenClose ? "open" : "trigger";
  const b = (label, ic, action, solid = false) =>
    `<button class="btn grow${solid ? " solid" : ""}" data-act="gate" data-id="${esc(g.id)}" data-action="${action}" data-key="gate:${esc(g.id)}:${action}">${icon(ic)}${label}</button>`;
  // Opening is a deliberate slide all the way across, so a stray tap never opens the gate.
  const main = isOpen
    ? b("Close gate", "closeIn", g.separateOpenClose ? "close" : "trigger", true)
    : `<div class="slide" data-slide="gate" data-id="${esc(g.id)}" data-action="${openAction}" role="button" tabindex="0" aria-label="Open ${esc(g.name)}: slide right, or press Enter">
        <span class="slide-track-text">Slide to open</span><span class="slide-knob">${icon("arrowRight")}</span></div>`;
  const extra = [g.canStop ? b("Stop", "stop", "stop") : "", g.separateOpenClose && !isOpen ? b("Close", "closeIn", "close") : ""].join("");
  return `<div class="status-card tone-gate${g.state === "moving" ? " moving" : ""}">
    <div class="status-top">
      <span class="status-glyph">${icon("gate")}</span>
      <div><div class="status-name">${esc(g.name)}</div><div class="status-state">${GATE_TITLES[g.state] ?? "Ready"}</div></div>
    </div>
    ${main}
    ${extra ? `<div class="btn-row">${extra}</div>` : ""}
  </div>`;
}

function alarmCard(p) {
  const tone = p.mode === "alarm" ? "tone-alert alarm" : "tone-alarm";
  const glyph = p.mode === "disarmed" ? "shield" : p.mode === "alarm" ? "shieldAlert" : "shieldCheck";
  const b = (label, ic, mode) =>
    `<button class="btn grow mode-btn${p.mode === mode ? " active" : ""}" data-act="arm" data-id="${esc(p.id)}" data-mode="${mode}" data-key="arm:${esc(p.id)}:${mode}">${icon(ic)}${label}</button>`;
  return `<div class="status-card ${tone}">
    <div class="status-top">
      <span class="status-glyph">${icon(glyph)}</span>
      <div><div class="status-name">${esc(p.name)}</div><div class="status-state">${SECURITY_TITLES[p.mode] ?? "Unknown"}</div></div>
    </div>
    <div class="btn-row">
      ${p.canArmAway ? b("Away", "away", "armedAway") : ""}
      ${p.canArmHome ? b("Home", "home", "armedHome") : ""}
      ${b("Disarm", "shield", "disarmed")}
    </div>
  </div>`;
}

function lockRow(l) {
  const unlocked = l.locked === false;
  return `<div class="status-card lock ${unlocked ? "tone-bad" : "tone-ok"}">
    <span class="status-glyph">${icon(unlocked ? "unlock" : "lock")}</span>
    <div class="lock-text"><div class="status-name">${esc(l.name)}</div><div class="status-state">${l.locked === null ? "Unknown" : unlocked ? "Unlocked" : "Locked"}</div></div>
    <button class="btn${unlocked ? " solid" : ""}" data-act="lock" data-id="${esc(l.id)}" data-target="${unlocked ? "lock" : "unlock"}" data-key="lock:${esc(l.id)}">${unlocked ? `${icon("lock")}Lock` : "Unlock"}</button>
  </div>`;
}

function cameraTile(c, big = false) {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const picture = c.demo
    ? `<div class="cam-demo ${c.demo}"></div>`
    : `<img alt="" data-cam="${esc(c.id)}" src="api/cameras/${encodeURIComponent(c.id)}/snapshot?t=${Date.now()}">`;
  return `<${big ? "div" : "button"} class="cam" ${big ? "" : `data-act="camera" data-id="${esc(c.id)}"`} aria-label="${esc(c.name)}">
    ${picture}
    <div class="cam-label"><span class="rec"></span>${esc(c.name)}<span class="cam-time" data-cam-time>${now}</span></div>
  </${big ? "div" : "button"}>`;
}

const section = (title, body, note = "") =>
  `<section class="section"><div class="section-head"><h2 class="section-title">${title}</h2>${note ? `<span class="section-note">${note}</span>` : ""}</div>${body}</section>`;

const empty = (ic, title, text) => `<div class="empty">${icon(ic)}<div class="empty-title">${title}</div><p class="help">${text}</p></div>`;

function statusNotice() {
  const { connection, message } = app.status;
  if (connection !== "failed") return "";
  return `<div class="notice">${icon("alert")}<div><strong>Can't reach your system.</strong> ${esc(message ?? "")} <a href="#setup"><u>Open setup</u></a></div></div>`;
}

// ---------- views ----------

function greeting(d) {
  const h = d.getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
const fmtDate = (d) => d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The big clock: hours and minutes large, AM/PM (where the locale uses it) small. */
function clockHTML(d) {
  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const time = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  return `${esc(time)}${period ? `<span class="ampm">${esc(period)}</span>` : ""}`;
}

const VIEWS = {
  home: {
    html() {
      const h = app.home;
      const now = new Date();
      const lightsOn = h.lights.filter(isOn).length;
      const unlocked = h.locks.filter((l) => l.locked === false).length;
      const playing = h.media.filter((m) => m.on);
      const st = statusInfo();
      const stats = [
        `<span class="stat">${lightsOn ? `${lightsOn} light${lightsOn === 1 ? "" : "s"} on` : "All lights off"}</span>`,
        playing.length ? `<span class="stat">${playing.length} playing</span>` : "",
        unlocked ? `<span class="stat warn">${unlocked} door${unlocked === 1 ? "" : "s"} unlocked</span>` : "",
        ...h.security.filter((p) => p.mode === "alarm").map(() => '<span class="stat warn">ALARM</span>'),
      ].join("");
      const scenes = homeScenes(h);
      return `
        <div class="bento">
          <section class="hello" aria-label="Today">
            <div class="hello-top">
              <span class="hello-date" data-clock="date">${fmtDate(now)}</span>
              <span class="row" style="gap:8px">
                <span class="pill" title="${esc(app.status.message ?? st.label)}"><span class="dot ${st.dot}"></span><span class="pill-label">${esc(st.label)}</span></span>
                <a class="icon-btn phone-only" href="#setup" aria-label="Setup">${icon("sliders")}</a>
              </span>
            </div>
            <div>
              <div class="clock" data-clock="clock">${clockHTML(now)}</div>
              <h1 class="greeting" data-clock="greeting">${greeting(now)}</h1>
            </div>
            <div class="hello-stats">${stats}</div>
          </section>
          ${h.gates.map(gateCard).join("")}
          ${h.security.map(alarmCard).join("")}
        </div>
        ${statusNotice()}
        ${scenes.length ? section("Scenes", `<div class="grid grid-scenes">${scenes.map(sceneTile).join("")}</div>`, "One tap, whole house") : ""}
        ${h.rooms.length ? section("Rooms", `<div class="grid grid-rooms">${h.rooms.map(roomCard).join("")}</div>`, `${h.rooms.length} rooms`) : ""}
        ${playing.length ? section("Now playing", `<div class="grid grid-cards">${playing.map(mediaCard).join("")}</div>`) : ""}
        ${!h.rooms.length && app.status.connection !== "connecting" ? empty("home", "Nothing here yet", "Rooms and devices show up once the app is connected. Open Setup to connect your system.") : ""}`;
    },
  },

  rooms: {
    html() {
      const h = app.home;
      return `<div class="page-head"><h1 class="page-title">Rooms</h1></div>
        ${h.rooms.length ? `<div class="grid grid-rooms">${h.rooms.map(roomCard).join("")}</div>` : empty("grid", "No rooms yet", "Rooms appear once the app is connected.")}
        <div class="btn-row"><a class="btn grow" href="#lights">${icon("bulb")}All lights</a><a class="btn grow" href="#shades">${icon("blinds")}All shades</a></div>`;
    },
  },

  room: {
    html(id) {
      const h = app.home;
      const room = roomOf(h, id);
      if (!room) return `<a class="back" href="#home">${icon("back")}Home</a>${empty("grid", "Room not found", "It may have been renamed or removed on the system.")}`;
      const lights = h.lights.filter((l) => l.roomId === id);
      const shades = h.shades.filter((s) => s.roomId === id);
      const scenes = h.scenes.filter((s) => s.roomId === id);
      const media = h.media.filter((m) => m.roomId === id);
      const locks = h.locks.filter((l) => l.roomId === id);
      const on = lights.filter(isOn).length;
      const groups = [
        lights.length ? `<div class="card group"><div class="group-title"><span>Lights</span><span class="section-note">${on} of ${lights.length} on</span></div>${lights.map(lightRow).join("")}</div>` : "",
        shades.length ? `<div class="card group"><div class="group-title"><span>Shades</span></div>${shades.map(shadeRow).join("")}</div>` : "",
        ...media.map(mediaCard),
        ...locks.map(lockRow),
      ].filter(Boolean);
      return `
        <button class="back" data-act="back">${icon("back")}Back</button>
        <div class="room hero" style="${roomStyle(id)};--lvl:${roomLevel(lights).toFixed(2)}">
          <div class="room-top"><span class="room-glyph">${icon(roomIcon(room.name))}</span><span class="room-count num">${on || ""}</span></div>
          <div>
            <h1 class="room-name">${esc(room.name)}</h1>
            <div class="room-meta">${lights.length ? (on ? `${on} of ${lights.length} lights on` : "Lights off") : "No lights"}</div>
            ${lights.length ? `<div class="hero-actions">
              <button class="btn on-color" data-act="all-lights" data-id="${esc(id)}" data-level="1">${icon("sun")}All on</button>
              <button class="btn on-color outline" data-act="all-lights" data-id="${esc(id)}" data-level="0">${icon("power")}All off</button>
            </div>` : ""}
          </div>
        </div>
        ${scenes.length ? section("Scenes", `<div class="grid grid-scenes">${scenes.map(sceneTile).join("")}</div>`) : ""}
        ${groups.length ? `<div class="grid grid-cards">${groups.join("")}</div>` : empty("grid", "No controls in this room", "Devices assigned to this room on the system show up here.")}`;
    },
  },

  lights: {
    html() {
      const h = app.home;
      const on = h.lights.filter(isOn).length;
      return `<div class="page-head"><div><p class="eyebrow">${on} of ${h.lights.length} on</p><h1 class="page-title">Lights</h1></div>
          ${on ? `<button class="btn" data-act="all-lights" data-id="*" data-level="0">${icon("power")}All off</button>` : ""}</div>
        ${byRoom(h.lights, (list) => list.map(lightRow).join("")) || empty("bulb", "No lights", "Lights from your system show up here.")}`;
    },
  },

  shades: {
    html() {
      const h = app.home;
      return `<div class="page-head"><h1 class="page-title">Shades</h1></div>
        ${byRoom(h.shades, (list) => list.map(shadeRow).join("")) || empty("blinds", "No shades", "Shades from your system show up here.")}`;
    },
  },

  media: {
    html() {
      const h = app.home;
      return `<div class="page-head"><h1 class="page-title">Media</h1></div>
        ${h.media.length ? `<div class="grid grid-cards">${h.media.map(mediaCard).join("")}</div>` : empty("speaker", "No media rooms", "Audio and video zones from your system show up here.")}`;
    },
  },

  security: {
    html() {
      const h = app.home;
      const unlocked = h.locks.filter((l) => l.locked === false).length;
      if (!h.gates.length && !h.security.length && !h.locks.length) {
        return `<div class="page-head"><h1 class="page-title">Security</h1></div>${empty("shield", "No security devices", "Gates, alarm panels and door locks show up here.")}`;
      }
      return `<div class="page-head"><h1 class="page-title">Security</h1></div>
        ${h.gates.length || h.security.length ? `<div class="grid grid-cards">${[...h.gates.map(gateCard), ...h.security.map(alarmCard)].join("")}</div>` : ""}
        ${h.locks.length ? section("Doors", `<div class="grid grid-cards">${h.locks.map(lockRow).join("")}</div>`, unlocked ? `${unlocked} unlocked` : "All locked") : ""}`;
    },
  },

  cameras: {
    html() {
      return `<div class="page-head"><h1 class="page-title">Cameras</h1>${app.transport === "local" ? '<span class="section-note">Demo pictures</span>' : ""}</div>
        ${app.cameras.length ? `<div class="grid grid-cards">${app.cameras.map((c) => cameraTile(c)).join("")}</div>`
          : empty("camera", "No cameras yet", "Add a camera's snapshot URL in Setup. Most IP cameras and recorders have one.")}`;
    },
  },

  setup: {
    static: true,
    html: setupHTML,
    mount: mountSetup,
    update: updateSetupStatus,
  },
};

function byRoom(items, rowsHTML) {
  if (!items.length) return "";
  const h = app.home;
  const known = (id) => (roomOf(h, id) ? id : null);
  const order = [...h.rooms.map((r) => r.id), null].filter((id) => items.some((x) => known(x.roomId) === id));
  return `<div class="grid grid-cards">${order.map((id) => {
    const list = items.filter((x) => known(x.roomId) === id);
    const room = roomOf(h, id);
    return `<div class="card group"><div class="group-title">${room ? `<a href="${roomHref(id)}">${esc(room.name)}</a>` : "<span>Other</span>"}</div>${rowsHTML(list)}</div>`;
  }).join("")}</div>`;
}

// ---------- setup ----------

const MODE_HELP = {
  demo: "A pretend house, so you can try everything without a processor.",
  crestronHome: "For systems set up with the Crestron Home setup app (CP4-R, MC4-R, PRO4…). Uses the processor's built-in Web API.",
  customProgram: "For systems your installer programmed in SIMPL and you control with Crestron Go today. The server joins the processor like an extra touch panel and uses a join map.",
};

let setupConfig = null;

function setupHTML() {
  const d = app.device;
  const seg = (name, value, label, current) => `<button type="button" data-act="${name}" data-value="${value}" aria-pressed="${current === value}">${label}</button>`;
  return `
    <div class="page-head"><h1 class="page-title">Setup</h1></div>
    <section class="card form" aria-labelledby="conn-title">
      <h2 class="section-title" id="conn-title">Connection</h2>
      <div id="conn-body">${app.transport === "local"
        ? `<div class="notice">${icon("alert")}<div><strong>This is a demo running in your browser.</strong> To control your house, run the home server on a computer at home (see the README) and open its address on this device.</div></div>`
        : '<p class="help">Loading…</p>'}</div>
    </section>
    ${app.transport === "local" ? "" : `<section class="card form" aria-labelledby="cam-title">
      <div class="section-head"><h2 class="section-title" id="cam-title">Cameras</h2><button class="btn" type="button" data-act="cam-add">${icon("plus")}Add camera</button></div>
      <p class="help">Use each camera's JPEG snapshot URL. Hikvision: <code>/ISAPI/Streaming/channels/101/picture</code> · Dahua: <code>/cgi-bin/snapshot.cgi</code> · Axis: <code>/axis-cgi/jpg/image.cgi</code>. Passwords stay on the home server.</p>
      <div id="cam-list" class="stack"></div>
    </section>`}
    <section class="card form" aria-labelledby="ai-title">
      <h2 class="section-title" id="ai-title">AI assistant</h2>
      ${app.transport === "local"
        ? `<p class="help">In this demo, the assistant uses your own Claude account. The first time you ask, you'll be asked to allow it.</p>`
        : `<p class="help">The assistant uses Claude to understand requests like “turn off the kitchen lights” or “good night”. It needs an Anthropic API key from console.anthropic.com; each request costs a fraction of a cent. The key stays on the home server. Unlocking doors and opening the gate always need a tap to confirm, and the assistant can't disarm the alarm.</p>
      <div class="field"><label for="f-ai">Anthropic API key</label><input class="input" id="f-ai" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"></div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn ink" type="button" data-act="ai-save">${icon("check")}Save key</button>
        <button class="btn ghost" type="button" data-act="ai-remove">Remove key</button>
        <span class="status-line" id="ai-status"></span>
      </div>`}
    </section>
    <section class="card form" aria-labelledby="dev-title">
      <h2 class="section-title" id="dev-title">This device</h2>
      <div class="field"><span class="label">Appearance</span>
        <div class="segmented" style="grid-template-columns: repeat(2, minmax(0, 1fr))">${seg("theme", "light", "Day", d.theme === "dark" ? "dark" : "light")}${seg("theme", "dark", "Night", d.theme === "dark" ? "dark" : "light")}</div>
      </div>
      <div class="row" style="justify-content:space-between">
        <div><div class="status-name">Wall panel mode</div><p class="help">Keeps the screen on and shows a clock when nobody has touched it for a while.</p></div>
        <button type="button" class="switch" role="switch" aria-checked="${d.wall}" aria-label="Wall panel mode" data-act="wall" id="wall-switch"></button>
      </div>
      <div class="field" ${d.wall ? "" : "hidden"} id="saver-field"><label for="saver-min">Clock screen after</label>
        <select class="select" id="saver-min" data-change="saver">${[1, 2, 5, 10, 15, 30].map((m) => `<option value="${m}"${m === d.saverMin ? " selected" : ""}>${m} minute${m === 1 ? "" : "s"}</option>`).join("")}</select>
      </div>
      <p class="help">On a mounted iPad: add this page to the Home Screen (Share › Add to Home Screen), then turn on Guided Access in iPad Settings › Accessibility to lock it to the app.</p>
    </section>`;
}

function pinHeader() {
  let pin = "";
  try { pin = sessionStorage.getItem("hc.pin") ?? ""; } catch {}
  return pin ? { "X-Admin-Pin": pin } : {};
}

async function mountSetup() {
  if (app.transport === "local") return;
  const res = await fetch("api/config", { headers: pinHeader(), cache: "no-store" }).catch(() => null);
  const body = $("#conn-body");
  if (!body) return;
  if (res?.status === 401) {
    body.innerHTML = `<form class="form" id="pin-form"><p class="help">Setup is protected. Enter the PIN set on the home server.</p>
      <div class="field"><label for="pin">Setup PIN</label><input class="input" id="pin" type="password" inputmode="numeric" autocomplete="off"></div>
      <button class="btn lamp" type="submit">Unlock setup</button></form>`;
    $("#pin-form").addEventListener("submit", (e) => {
      e.preventDefault();
      try { sessionStorage.setItem("hc.pin", $("#pin").value); } catch {}
      mountSetup();
    });
    return;
  }
  if (!res?.ok) {
    body.innerHTML = `<p class="help">Couldn't load the settings from the home server.</p>`;
    return;
  }
  setupConfig = await res.json();
  renderConnectionForm();
  renderCameraList();
  updateAiStatus();
}

function updateAiStatus() {
  const el = $("#ai-status");
  if (!el || !setupConfig) return;
  const ready = setupConfig.hasAssistantKey || setupConfig.assistantFromEnv;
  el.className = `status-line${ready ? " ok" : ""}`;
  el.innerHTML = `<span class="dot ${ready ? "ok" : "warn"}"></span>${setupConfig.hasAssistantKey ? "Key saved" : setupConfig.assistantFromEnv ? "Using the server's ANTHROPIC_API_KEY" : "No key yet"}`;
}

async function saveAiKey(remove) {
  const input = $("#f-ai");
  if (!remove && !input.value.trim()) { input.focus(); return; }
  const body = remove ? { removeAssistantKey: true } : { assistantKey: input.value.trim() };
  try {
    const res = await fetch("api/config", { method: "PUT", headers: { "Content-Type": "application/json", ...pinHeader() }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
    setupConfig = json;
    input.value = "";
    updateAiStatus();
  } catch (err) {
    toast(err.message);
  }
}

function renderConnectionForm() {
  const c = setupConfig;
  const seg = (value, label) => `<button type="button" data-act="mode" data-value="${value}" aria-pressed="${c.mode === value}">${label}</button>`;
  $("#conn-body").innerHTML = `
    <div class="form">
      <div class="segmented">${seg("demo", "Demo")}${seg("crestronHome", "Crestron Home")}${seg("customProgram", "Custom program")}</div>
      <p class="help" id="mode-help">${MODE_HELP[c.mode]}</p>
      <div class="field"><label for="f-name">Home name</label><input class="input" id="f-name" value="${esc(c.homeName)}" autocomplete="off"></div>
      <div class="field" data-modes="crestronHome customProgram"><label for="f-host">Processor IP address</label>
        <input class="input" id="f-host" value="${esc(c.host)}" placeholder="192.168.1.50" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"></div>
      <div class="field" data-modes="crestronHome"><label for="f-token">Web API token</label>
        <input class="input" id="f-token" type="password" placeholder="${c.hasToken ? "Saved. Leave empty to keep it." : "Paste the token"}" autocomplete="off">
        <p class="help">In the Crestron Home setup app: Installer Settings › System Control Options › Web API Settings › Update Token.</p></div>
      <div class="fields-2" data-modes="customProgram">
        <div class="field"><label for="f-ipid">IP ID (hex)</label><input class="input" id="f-ipid" value="${esc(c.ipId)}" placeholder="03" autocapitalize="characters" autocomplete="off"></div>
        <div class="field"><label for="f-port">Port</label><input class="input" id="f-port" value="${esc(c.port)}" inputmode="numeric" autocomplete="off"></div>
      </div>
      <div class="field" data-modes="customProgram">
        <div class="section-head"><label for="f-map">Join map</label>
          <span class="btn-row"><button class="btn ghost" type="button" data-act="map-check">${icon("check")}Check</button></span></div>
        <textarea class="textarea" id="f-map" spellcheck="false" autocapitalize="off">${esc(c.joinMap)}</textarea>
        <p class="help" id="map-result">Ask your installer for a free XPanel IP ID and the join numbers your Crestron Go panel uses. Analog joins: <code>level</code>, <code>position</code>, <code>volume</code>. Everything else is a digital button.</p>
      </div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn lamp" type="button" data-act="save">${icon("bolt")}Save and connect</button>
        <span class="status-line" id="conn-status"></span>
      </div>
    </div>`;
  showModeFields();
  updateSetupStatus();
}

function showModeFields() {
  for (const el of $$("[data-modes]")) el.hidden = !el.dataset.modes.split(" ").includes(setupConfig.mode);
  for (const b of $$('[data-act="mode"]')) b.setAttribute("aria-pressed", String(b.dataset.value === setupConfig.mode));
  const help = $("#mode-help");
  if (help) help.textContent = MODE_HELP[setupConfig.mode];
}

function renderCameraList() {
  const list = $("#cam-list");
  if (!list) return;
  list.innerHTML = setupConfig.cameras.length ? setupConfig.cameras.map((c, i) => `
    <div class="cam-edit" data-cam-index="${i}">
      <div class="fields-2">
        <div class="field"><label for="c-name-${i}">Name</label><input class="input" id="c-name-${i}" data-cam-field="name" value="${esc(c.name)}"></div>
        <div class="field"><label for="c-url-${i}">Snapshot URL</label><input class="input" id="c-url-${i}" data-cam-field="snapshotURL" value="${esc(c.snapshotURL)}" placeholder="http://192.168.1.60/cgi-bin/snapshot.cgi" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="c-user-${i}">Username</label><input class="input" id="c-user-${i}" data-cam-field="username" value="${esc(c.username)}" autocapitalize="off" autocomplete="off"></div>
        <div class="field"><label for="c-pass-${i}">Password</label><input class="input" id="c-pass-${i}" data-cam-field="password" type="password" placeholder="${c.hasPassword ? "Saved" : ""}" autocomplete="off"></div>
      </div>
      <div class="btn-row"><button class="btn ghost" type="button" data-act="cam-remove" data-index="${i}">${icon("close")}Remove</button></div>
    </div>`).join("") : '<p class="help">No cameras yet.</p>';
}

function readCameraEdits() {
  for (const row of $$("[data-cam-index]")) {
    const cam = setupConfig.cameras[Number(row.dataset.camIndex)];
    for (const input of $$("[data-cam-field]", row)) cam[input.dataset.camField] = input.value;
  }
}

function updateSetupStatus() {
  const el = $("#conn-status");
  if (!el) return;
  const st = statusInfo();
  el.className = `status-line ${st.dot === "ok" ? "ok" : st.dot === "bad" ? "bad" : ""}`;
  el.innerHTML = `<span class="dot ${st.dot}"></span>${esc(app.status.connection === "failed" ? app.status.message ?? "Offline" : st.label)}`;
}

async function saveSetup() {
  readCameraEdits();
  const body = {
    mode: setupConfig.mode,
    homeName: $("#f-name").value,
    host: $("#f-host").value,
    token: $("#f-token").value,
    ipId: $("#f-ipid").value,
    port: Number($("#f-port").value) || 41794,
    joinMap: $("#f-map").value,
    cameras: setupConfig.cameras,
  };
  const status = $("#conn-status");
  status.className = "status-line";
  status.innerHTML = '<span class="dot warn"></span>Saving…';
  try {
    const res = await fetch("api/config", { method: "PUT", headers: { "Content-Type": "application/json", ...pinHeader() }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
    setupConfig = json;
    $("#f-token").value = "";
    $("#f-token").placeholder = json.hasToken ? "Saved. Leave empty to keep it." : "Paste the token";
    renderCameraList();
    updateSetupStatus();
  } catch (err) {
    status.className = "status-line bad";
    status.innerHTML = `${icon("alert")}${esc(err.message)}`;
  }
}

function checkJoinMap() {
  const out = $("#map-result");
  try {
    const map = JSON.parse($("#f-map").value);
    const n = ["lights", "shades", "scenes", "media", "locks", "security", "gates"].reduce((s, k) => s + (Array.isArray(map[k]) ? map[k].length : 0), 0);
    out.innerHTML = `${icon("check")} Looks good: ${(map.rooms ?? []).length} rooms and ${n} controls.`;
    out.style.color = "var(--ok)";
  } catch (err) {
    out.textContent = `That isn't valid JSON: ${err.message}`;
    out.style.color = "var(--danger)";
  }
}

// ---------- device settings ----------

/** Day is the look everywhere; Night is only used when chosen in Setup (not from the system setting). */
function applyTheme() {
  const root = document.documentElement;
  if (app.device.theme === "dark") root.dataset.appTheme = "dark";
  else delete root.dataset.appTheme;
}

let wakeLock = null;
async function applyWall() {
  if (app.device.wall && document.visibilityState === "visible" && navigator.wakeLock && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch { wakeLock = null; }
  }
  if (!app.device.wall && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener("visibilitychange", applyWall);

// ---------- overlays ----------

let modal = null; // { onConfirm, keypad: { code, mode, id } }

function openModal(html, state = {}) {
  modal = state;
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-backdrop><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</div></div>`;
  $("#modal-root .modal button")?.focus({ preventScroll: true });
}

function closeModal() {
  modal = null;
  $("#modal-root").innerHTML = "";
}

function confirmModal({ title, text, label, tone = "danger", onConfirm }) {
  openModal(`<h2 class="modal-title" id="modal-title">${esc(title)}</h2>${text ? `<p class="help">${esc(text)}</p>` : ""}
    <div class="btn-row"><button class="btn grow" data-act="modal-close">Cancel</button><button class="btn grow ${tone}" data-act="modal-confirm">${esc(label)}</button></div>`,
  { onConfirm });
}

function keypadModal(title, onSubmit) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "del"];
  openModal(`<h2 class="modal-title" id="modal-title">${esc(title)}</h2>
    <div class="code-dots" id="code-dots" aria-live="polite"></div>
    <div class="keypad">${keys.map((k) => `<button class="key${k.length > 1 ? " small" : ""}" data-act="key" data-value="${k}" aria-label="${k === "del" ? "Delete" : k === "clear" ? "Clear" : k}">${k === "del" ? icon("deleteKey") : k === "clear" ? "Clear" : k}</button>`).join("")}</div>
    <div class="btn-row"><button class="btn grow" data-act="modal-close">Cancel</button><button class="btn grow ok" data-act="keypad-enter" id="keypad-enter" disabled>Enter</button></div>`,
  { keypad: { code: "", onSubmit } });
  drawCode();
}

function drawCode() {
  const code = modal?.keypad?.code ?? "";
  $("#code-dots").innerHTML = Array.from({ length: Math.max(4, code.length) }, (_, i) => `<span class="${i < code.length ? "on" : ""}"></span>`).join("");
  $("#keypad-enter").disabled = !code;
}

function cameraModal(cam) {
  openModal(`<div class="section-head"><h2 class="modal-title" id="modal-title">${esc(cam.name)}</h2><button class="icon-btn" data-act="modal-close" aria-label="Close">${icon("close")}</button></div>${cameraTile(cam, true)}`);
  $(".modal").style.width = "min(100%, 1100px)";
}

let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  el.innerHTML = `${icon("alert")}<span>${esc(message)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

function showSaver(show) {
  const el = $("#saver");
  if (!show) { el.hidden = true; return; }
  el.hidden = false;
  drawSaver();
}

function drawSaver() {
  const el = $("#saver");
  if (el.hidden) return;
  const h = app.home;
  const now = new Date();
  const panel = h.security[0];
  const gate = h.gates[0];
  el.innerHTML = `<div>
    <div class="saver-time">${fmtTime(now)}</div>
    <div class="saver-date">${fmtDate(now)}</div>
    <div class="saver-status">
      <span>${icon("bulb")}${h.lights.filter(isOn).length} lights on</span>
      ${panel ? `<span>${icon("shield")}${SECURITY_TITLES[panel.mode]}</span>` : ""}
      ${gate ? `<span>${icon("gate")}${esc(gate.name)}: ${GATE_TITLES[gate.state]}</span>` : ""}
    </div></div>`;
}

// ---------- timers ----------

function updateClock() {
  const now = new Date();
  for (const el of $$("[data-clock]")) {
    const kind = el.dataset.clock;
    if (kind === "clock") el.innerHTML = clockHTML(now);
    else el.textContent = kind === "time" ? fmtTime(now) : kind === "date" ? fmtDate(now) : greeting(now);
  }
}

function startTimers() {
  setInterval(() => {
    updateClock();
    drawSaver();
    const idle = Date.now() - app.lastTouch;
    if (app.device.wall && !modal && $("#saver").hidden && idle > app.device.saverMin * 60000) showSaver(true);
  }, 10000);

  // Refresh camera pictures about once a second, swapping only after the next frame has loaded.
  setInterval(() => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    for (const el of $$("[data-cam-time]")) el.textContent = time;
    for (const img of $$("img[data-cam]")) {
      if (img.dataset.loading) continue;
      img.dataset.loading = "1";
      const next = new Image();
      const url = `api/cameras/${encodeURIComponent(img.dataset.cam)}/snapshot?t=${Date.now()}`;
      next.onload = () => { img.src = url; delete img.dataset.loading; };
      next.onerror = () => { delete img.dataset.loading; };
      next.src = url;
    }
  }, 1000);
  applyWall();
}

// ---------- input ----------

function handleAction(el) {
  const act = el.dataset.act;
  const id = el.dataset.id;
  const h = app.home;
  switch (act) {
    case "scene":
      app.pop = { id, at: Date.now() };
      return send({ type: "recallScene", id });
    case "light-toggle": {
      const light = h.lights.find((l) => l.id === id);
      if (light) send({ type: "setLight", id, level: isOn(light) ? 0 : 1 });
      return;
    }
    case "all-lights": {
      const level = Number(el.dataset.level);
      for (const l of h.lights) if (id === "*" || l.roomId === id) send({ type: "setLight", id: l.id, level });
      return;
    }
    case "shade": return send({ type: "setShade", id, position: Number(el.dataset.pos) });
    case "shade-stop": return send({ type: "stopShade", id });
    case "power": {
      const m = h.media.find((x) => x.id === id);
      if (m) send({ type: "mediaPower", id, on: !m.on });
      return;
    }
    case "mute": {
      const m = h.media.find((x) => x.id === id);
      if (m) send({ type: "mediaMute", id, muted: !m.muted });
      return;
    }
    case "source": return send({ type: "mediaSource", id, sourceId: el.dataset.source });
    case "lock": {
      const lock = h.locks.find((l) => l.id === id);
      if (el.dataset.target === "lock") return send({ type: "setLock", id, locked: true });
      return confirmModal({ title: `Unlock ${lock?.name ?? "door"}?`, label: "Unlock", onConfirm: () => send({ type: "setLock", id, locked: false }) });
    }
    case "gate": {
      const gate = h.gates.find((g) => g.id === id);
      const action = el.dataset.action;
      const opens = action === "open" || (action === "trigger" && gate?.state !== "open");
      const cmd = { type: "gate", id, action };
      if (!opens) return send(cmd);
      return confirmModal({ title: `Open ${gate?.name ?? "the gate"}?`, text: "Make sure the way is clear.", label: "Open", tone: "lemon", onConfirm: () => send(cmd) });
    }
    case "arm": {
      const panel = h.security.find((p) => p.id === id);
      const mode = el.dataset.mode;
      const go = (code) => send({ type: "setSecurity", id, mode, code });
      if (!panel?.needsCode) return go(undefined);
      return keypadModal(`${mode === "disarmed" ? "Disarm" : "Arm"} ${panel.name}`, go);
    }
    case "camera": {
      const cam = app.cameras.find((c) => c.id === id);
      if (cam) cameraModal(cam);
      return;
    }
    case "back":
      if (history.length > 1) history.back();
      else location.hash = "home";
      return;
    case "modal-close": return closeModal();
    case "modal-confirm": {
      const fn = modal?.onConfirm;
      closeModal();
      fn?.();
      return;
    }
    case "key": {
      const k = modal?.keypad;
      if (!k) return;
      const v = el.dataset.value;
      if (v === "clear") k.code = "";
      else if (v === "del") k.code = k.code.slice(0, -1);
      else if (k.code.length < 10) k.code += v;
      drawCode();
      return;
    }
    case "keypad-enter": {
      const k = modal?.keypad;
      closeModal();
      if (k?.code) k.onSubmit(k.code);
      return;
    }
    // Setup page
    case "mode":
      setupConfig.mode = el.dataset.value;
      showModeFields();
      return;
    case "map-check": return checkJoinMap();
    case "save": return saveSetup();
    case "cam-add":
      readCameraEdits();
      setupConfig.cameras.push({ id: "", name: `Camera ${setupConfig.cameras.length + 1}`, snapshotURL: "http://", username: "", password: "" });
      renderCameraList();
      return;
    case "cam-remove":
      readCameraEdits();
      setupConfig.cameras.splice(Number(el.dataset.index), 1);
      renderCameraList();
      return;
    case "ai-save": return saveAiKey(false);
    case "ai-remove": return saveAiKey(true);
    case "ask-open": return openAsk();
    case "ask-close": return closeAsk();
    case "ask-suggest": return sendAsk(el.dataset.text ?? "");
    case "ask-mic": return toggleListening();
    case "ask-confirm": {
      const entry = ask.log[Number(el.dataset.index)];
      if (entry?.kind === "confirm" && !entry.done) {
        send(entry.command);
        entry.done = "Done";
        renderAskLog();
      }
      return;
    }
    case "theme":
      app.device.theme = el.dataset.value;
      prefs.set("theme", app.device.theme);
      for (const b of $$('[data-act="theme"]')) b.setAttribute("aria-pressed", String(b.dataset.value === app.device.theme));
      applyTheme();
      return;
    case "wall":
      app.device.wall = !app.device.wall;
      prefs.set("wall", app.device.wall);
      el.setAttribute("aria-checked", String(app.device.wall));
      $("#saver-field").hidden = !app.device.wall;
      applyWall();
      return;
  }
}

document.addEventListener("click", (e) => {
  app.lastTouch = Date.now();
  if (e.target.matches?.("[data-backdrop]")) return closeModal();
  const el = e.target.closest("[data-act]");
  if (el && !el.disabled) handleAction(el);
});

document.addEventListener("change", (e) => {
  if (e.target.dataset?.change === "saver") {
    app.device.saverMin = Number(e.target.value);
    prefs.set("saverMin", app.device.saverMin);
  }
});

document.addEventListener("keydown", (e) => {
  app.lastTouch = Date.now();
  if (e.key === "Escape" && modal) return closeModal();
  if (e.key === "Escape" && ask.open) return closeAsk();
  const gateSlide = e.target.closest?.(".slide");
  if (gateSlide && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    return confirmSlide(gateSlide);
  }
  const s = e.target.closest?.(".slider");
  if (!s) return;
  const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
  const current = Number(s.style.getPropertyValue("--v")) || 0;
  let v = null;
  if (step !== undefined) v = current + step;
  if (e.key === "Home") v = 0;
  if (e.key === "End") v = 1;
  if (v === null) return;
  e.preventDefault();
  setSlider(s, clamp01(v));
  commitSlider(s, clamp01(v));
});

$("#saver").addEventListener("click", (e) => {
  e.stopPropagation();
  app.lastTouch = Date.now();
  showSaver(false);
});

// Sliders: drag sideways or tap anywhere on them. Vertical swipes still scroll the page
// (the CSS sets touch-action: pan-y), so long room pages stay easy to move through.
let drag = null;

function setSlider(el, v) {
  el.style.setProperty("--v", v.toFixed(3));
  el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  const text = fmtValue(v, el.dataset.format);
  el.setAttribute("aria-valuetext", text);
  for (const label of $$(".value", el)) label.textContent = text;
}

function commitSlider(el, v) {
  const id = el.dataset.id;
  const kind = el.dataset.slider;
  if (kind === "light") send({ type: "setLight", id, level: v });
  else if (kind === "shade") send({ type: "setShade", id, position: v });
  else if (kind === "volume") send({ type: "mediaVolume", id, level: v });
}

function endDrag() {
  if (!drag) return;
  drag.el.classList.remove("dragging");
  drag = null;
  app.dragging = false;
  if (app.pendingRender) { app.pendingRender = false; scheduleRender(); }
}

document.addEventListener("pointerdown", (e) => {
  app.lastTouch = Date.now();
  const el = e.target.closest(".slider");
  if (!el || el.getAttribute("aria-disabled") === "true" || e.button > 0) return;
  drag = { el, rect: el.getBoundingClientRect(), x: e.clientX, y: e.clientY, pointer: e.pointerId, moved: false, sent: 0, value: null };
});

document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // a scroll, not a drag
    drag.moved = true;
    app.dragging = true;
    drag.el.classList.add("dragging");
    try { drag.el.setPointerCapture(e.pointerId); } catch {}
  }
  e.preventDefault();
  const v = clamp01((e.clientX - drag.rect.left) / drag.rect.width);
  drag.value = v;
  setSlider(drag.el, v);
  if (Date.now() - drag.sent > 250) {
    drag.sent = Date.now();
    commitSlider(drag.el, v);
  }
});

document.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const v = clamp01((e.clientX - drag.rect.left) / drag.rect.width);
  const el = drag.el;
  endDrag();
  setSlider(el, v);
  commitSlider(el, v);
});

document.addEventListener("pointercancel", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const { el, moved, value } = drag;
  endDrag();
  if (moved && value !== null) commitSlider(el, value);
});

// ---------- slide to open ----------

// The gate opens only after the knob is dragged (almost) all the way across.
let slide = null;

function confirmSlide(el) {
  const gate = app.home.gates.find((g) => g.id === el.dataset.id);
  confirmModal({
    title: `Open ${gate?.name ?? "the gate"}?`, text: "Make sure the way is clear.", label: "Open", tone: "lemon",
    onConfirm: () => send({ type: "gate", id: el.dataset.id, action: el.dataset.action }),
  });
}

function endSlide() {
  if (!slide) return;
  slide.el.classList.remove("dragging");
  slide = null;
  app.dragging = false;
  if (app.pendingRender) { app.pendingRender = false; scheduleRender(); }
}

document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".slide");
  if (!el || e.button > 0) return;
  slide = { el, x: e.clientX, y: e.clientY, pointer: e.pointerId, max: el.clientWidth - 64, moved: false, at: 0 };
});

document.addEventListener("pointermove", (e) => {
  if (!slide || e.pointerId !== slide.pointer) return;
  const dx = e.clientX - slide.x;
  const dy = e.clientY - slide.y;
  if (!slide.moved) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dy) > Math.abs(dx)) { slide = null; return; }
    slide.moved = true;
    app.dragging = true;
    slide.el.classList.add("dragging");
    try { slide.el.setPointerCapture(e.pointerId); } catch {}
  }
  e.preventDefault();
  slide.at = Math.max(0, Math.min(slide.max, dx));
  slide.el.style.setProperty("--x", String(slide.at));
});

document.addEventListener("pointerup", (e) => {
  if (!slide || e.pointerId !== slide.pointer) return;
  const { el, moved, at, max } = slide;
  endSlide();
  if (moved && at >= max * 0.85) {
    el.style.setProperty("--x", String(max));
    send({ type: "gate", id: el.dataset.id, action: el.dataset.action });
    return;
  }
  // Not far enough (or just a tap): spring back, with a little nudge as a hint.
  el.style.setProperty("--x", moved ? "0" : "26");
  if (!moved) setTimeout(() => el.style.setProperty("--x", "0"), 260);
});

document.addEventListener("pointercancel", (e) => {
  if (!slide || e.pointerId !== slide.pointer) return;
  const { el } = slide;
  endSlide();
  el.style.setProperty("--x", "0");
});

// ---------- assistant ----------

const ask = { open: false, log: [], turns: [], busy: false, ctl: null, rec: null, listening: false, sample: null, localReady: false };
const SUGGESTIONS = ["Turn off all the lights", "Good night", "Dim the living room to 30%", "Is the front door locked?", "Play Spotify in the kitchen", "Open the gate"];
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

async function initAssistant() {
  // The demo in this browser asks Claude through the page's own `sample` capability (the viewer's
  // Claude account, after they allow it). It needs page tools; without them the button stays hidden.
  if (app.transport === "local" && window.claude?.use) {
    try {
      const sample = await window.claude.use("sample");
      const limits = sample ? await sample.limits().catch(() => null) : null;
      if (sample && limits?.tools) {
        ask.sample = sample;
        ask.localReady = true;
      }
    } catch {}
  }
  updateAskFab();
}

function updateAskFab() {
  const fab = $("#ask-fab");
  if (!fab) return;
  if (!fab.innerHTML.trim()) fab.innerHTML = `<span class="orb">${icon("sparkle")}</span><span class="ask-label">Ask</span>`;
  fab.hidden = ask.open || (app.transport === "local" ? !ask.localReady : app.transport !== "server");
}

function openAsk() {
  ask.open = true;
  const panel = $("#ask-panel");
  panel.hidden = false;
  updateAskFab();
  renderAsk();
  $("#ask-input")?.focus({ preventScroll: true });
}

function closeAsk() {
  ask.open = false;
  ask.ctl?.abort();
  stopListening();
  $("#ask-panel").hidden = true;
  updateAskFab();
}

const keyMissing = () => app.transport === "server" && !app.assistant?.available;

function renderAsk() {
  const missing = keyMissing();
  $("#ask-panel").innerHTML = `
    <div class="ask-head">
      <span class="orb">${icon("sparkle")}</span>
      <div><div class="ask-title">Home assistant</div><div class="ask-sub">${app.transport === "local" ? "Demo house · uses your Claude account" : SpeechRec ? "Type, or tap the mic and speak" : "Type what you'd like"}</div></div>
      <button class="ask-close" type="button" data-act="ask-close" aria-label="Close assistant">${icon("close")}</button>
    </div>
    <div class="ask-log" id="ask-log" aria-live="polite"></div>
    <form class="ask-form" id="ask-form">
      <input class="input" id="ask-input" autocomplete="off" enterkeyhint="send" placeholder="Turn off the kitchen lights…" aria-label="Ask the home assistant"${missing ? " disabled" : ""}>
      ${SpeechRec && !missing ? `<button type="button" class="ask-mic${ask.listening ? " listening" : ""}" data-act="ask-mic" aria-label="${ask.listening ? "Stop listening" : "Speak"}">${icon("mic")}</button>` : ""}
      <button type="submit" class="ask-send" id="ask-send" aria-label="Send"${missing || ask.busy ? " disabled" : ""}>${icon("send")}</button>
    </form>`;
  renderAskLog();
}

function renderAskLog() {
  const log = $("#ask-log");
  if (!log) return;
  if (keyMissing()) {
    log.innerHTML = `<div class="ask-hello"><p>To use the assistant, add an Anthropic API key in <a href="#setup" data-act="ask-close"><u>Setup › AI assistant</u></a>.</p></div>`;
    return;
  }
  log.innerHTML = ask.log.length ? ask.log.map((e, i) => {
    switch (e.kind) {
      case "me": return `<div class="bubble me">${esc(e.text)}</div>`;
      case "ai": return `<div class="bubble ai${e.thinking ? " thinking" : ""}">${esc(e.text)}</div>`;
      case "err": return `<div class="bubble err">${esc(e.text)}</div>`;
      case "did": return `<div class="did">${e.items.map((t) => `<span>${esc(t)}</span>`).join("")}${e.failed.map((t) => `<span class="fail">${esc(t)}</span>`).join("")}</div>`;
      case "confirm": return `<div class="confirm-card${e.done ? " done" : ""}"><span>${esc(e.label)}</span>${e.done
        ? `<b>${icon("check")} ${esc(e.done)}</b>`
        : `<button class="btn ink" type="button" data-act="ask-confirm" data-index="${i}">Confirm</button>`}</div>`;
      default: return "";
    }
  }).join("") : `<div class="ask-hello"><p>Ask for anything in the house, in your own words.</p>
      <div class="ask-suggest">${SUGGESTIONS.map((t) => `<button type="button" data-act="ask-suggest" data-text="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>`;
  log.scrollTop = log.scrollHeight;
  const sendBtn = $("#ask-send");
  if (sendBtn) sendBtn.disabled = ask.busy;
}

async function sendAsk(raw) {
  const text = String(raw).trim();
  if (!text || ask.busy || keyMissing()) return;
  ask.busy = true;
  app.lastTouch = Date.now();
  ask.log.push({ kind: "me", text });
  const reply = { kind: "ai", text: "Thinking…", thinking: true };
  ask.log.push(reply);
  renderAskLog();
  try {
    const result = app.transport === "local" ? await askLocal(text, reply) : await askServer(text);
    reply.text = result.reply;
    reply.thinking = false;
    const extra = [];
    if (result.done.length || result.failed.length) extra.push({ kind: "did", items: result.done, failed: result.failed });
    for (const c of result.confirm) extra.push({ kind: "confirm", label: c.label, command: c.command });
    ask.log.push(...extra);
    ask.turns.push({ role: "user", text }, { role: "assistant", text: result.reply });
    ask.turns = ask.turns.slice(-12);
  } catch (err) {
    ask.log.splice(ask.log.indexOf(reply), 1);
    if (err?.code !== "cancelled") ask.log.push({ kind: "err", text: err?.message || "Something went wrong." });
  } finally {
    ask.busy = false;
    renderAskLog();
  }
}

async function askServer(text) {
  const res = await fetch("api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, history: ask.turns }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `The home server answered ${res.status}.`);
  return { reply: json.reply ?? "Done.", done: json.done ?? [], confirm: json.confirm ?? [], failed: json.failed ?? [] };
}

const SAMPLE_ERRORS = {
  not_granted: "The assistant needs your OK to use Claude. Reload the page to be asked again.",
  rate_limited: "Too many requests right now. Try again in a minute.",
  sampling_disabled: "Claude isn't available for this account.",
  session_expired: "Sign in to Claude again to use the assistant.",
  refused: "Sorry, I can't help with that one.",
  tools_unavailable: "The assistant can't control the demo house in this view.",
};

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
        renderAskLog();
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
    const err = new Error(SAMPLE_ERRORS[e?.code] ?? "The assistant had a problem. Try again.");
    err.code = e?.code;
    throw err;
  } finally {
    ask.ctl = null;
  }
}

function toggleListening() {
  if (ask.listening) return stopListening();
  try {
    const rec = new SpeechRec();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join("");
      const input = $("#ask-input");
      if (input) input.value = said;
      if (e.results[e.results.length - 1].isFinal) {
        stopListening();
        if (input) input.value = "";
        sendAsk(said);
      }
    };
    rec.onerror = (e) => {
      stopListening();
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Voice isn't allowed here. Check microphone access for this site.");
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
    toast("Voice isn't available on this device.");
  }
}

function stopListening() {
  try { ask.rec?.stop(); } catch {}
  ask.rec = null;
  ask.listening = false;
  updateMic();
}

function updateMic() {
  const b = $('[data-act="ask-mic"]');
  if (!b) return;
  b.classList.toggle("listening", ask.listening);
  b.setAttribute("aria-label", ask.listening ? "Stop listening" : "Speak");
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "ask-form") return;
  e.preventDefault();
  const input = $("#ask-input");
  sendAsk(input.value);
  input.value = "";
});

start();
