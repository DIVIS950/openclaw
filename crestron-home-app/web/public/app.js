// Home Control web app. Talks to the home server (server/index.js) when it is
// there; otherwise runs the demo house right in the browser.
import { icon, roomIcon, sceneIcon } from "./icons.js";
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

const HUES = [222, 256, 198, 164, 18, 332, 284, 206, 40, 140];
function hue(name) {
  let n = 0;
  for (const ch of String(name)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return HUES[n % HUES.length];
}

function roomGlow(lights) {
  if (!lights.length) return 0;
  const avg = lights.reduce((sum, l) => sum + (isOn(l) ? l.level : 0), 0) / lights.length;
  return Math.min(1, avg * 1.5);
}

const leds = (lights) => `<span class="leds" aria-hidden="true">${lights.map((l) => `<i class="led${isOn(l) ? " on" : ""}"></i>`).join("")}</span>`;
const sourceName = (m) => m.sources.find((s) => s.id === m.sourceId)?.name ?? "On";
const roomHref = (id) => `#room-${encodeURIComponent(id)}`;

function roomCard(room) {
  const h = app.home;
  const lights = h.lights.filter((l) => l.roomId === room.id);
  const on = lights.filter(isOn).length;
  const playing = h.media.find((m) => m.roomId === room.id && m.on);
  const meta = [
    on ? `<span>${icon("bulb")}${on} on</span>` : lights.length ? "<span>Lights off</span>" : "",
    playing ? `<span>${icon("music")}${esc(sourceName(playing))}</span>` : "",
  ].join("");
  return `<a class="room" href="${roomHref(room.id)}" style="--h:${hue(room.name)};--glow:${roomGlow(lights).toFixed(2)}">
    <div class="room-top"><span class="room-glyph">${icon(roomIcon(room.name))}</span>${leds(lights)}</div>
    <div><div class="room-name">${esc(room.name)}</div><div class="room-meta">${meta}</div></div>
  </a>`;
}

function sceneTile(scene) {
  const room = roomOf(app.home, scene.roomId);
  return `<button class="scene${scene.active ? " active" : ""}" data-act="scene" data-id="${esc(scene.id)}" data-key="scene:${esc(scene.id)}" aria-pressed="${scene.active}">
    <span class="scene-icon">${icon(sceneIcon(scene))}</span>
    <span><span class="scene-name">${esc(scene.name)}</span><br><span class="scene-where">${room ? esc(room.name) : "Whole house"}</span></span>
  </button>`;
}

function fmtValue(v, format) {
  if (format === "shade") return v < 0.01 ? "Closed" : v > 0.99 ? "Open" : pct(v);
  return v < 0.005 && format === "light" ? "Off" : pct(v);
}

function slider({ kind, id, value, tint, iconName, label, thin = false, format = "pct", disabled = false }) {
  return `<div class="slider ${tint}${thin ? " thin" : ""}" role="slider" tabindex="0" data-key="slider:${kind}:${esc(id)}"
      aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}"
      aria-valuetext="${fmtValue(value, format)}"${disabled ? ' aria-disabled="true"' : ""}
      data-slider="${kind}" data-id="${esc(id)}" data-format="${format}" style="--v:${value.toFixed(3)}">
    <div class="slider-fill"></div>
    <div class="slider-label">${icon(iconName)}<span class="name">${esc(label)}</span><span class="value">${fmtValue(value, format)}</span></div>
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
  const tone = { open: "tone-bad", closed: "tone-ok", moving: "tone-lamp", unknown: "tone-gate" }[g.state] ?? "tone-gate";
  const b = (label, ic, action, primary) =>
    `<button class="btn grow${primary ? " gate" : ""}" data-act="gate" data-id="${esc(g.id)}" data-action="${action}" data-key="gate:${esc(g.id)}:${action}">${icon(ic)}${label}</button>`;
  const buttons = g.separateOpenClose
    ? [b("Open", "open", "open", g.state !== "open"), g.canStop ? b("Stop", "stop", "stop", false) : "", b("Close", "closeIn", "close", g.state === "open")]
    : [b(g.state === "open" ? "Close gate" : "Open gate", "bolt", "trigger", true), g.canStop ? b("Stop", "stop", "stop", false) : ""];
  return `<div class="card status-card ${tone}${g.state === "moving" ? " moving" : ""}">
    <div class="status-top">
      <span class="status-glyph">${icon("gate")}</span>
      <div><div class="status-name">${esc(g.name)}</div><div class="status-state">${GATE_TITLES[g.state] ?? "Ready"}</div></div>
    </div>
    <div class="btn-row">${buttons.join("")}</div>
  </div>`;
}

function alarmCard(p) {
  const tone = { disarmed: "tone-shade", armedHome: "tone-ok", armedAway: "tone-ok", alarm: "tone-bad" }[p.mode] ?? "tone-muted";
  const glyph = p.mode === "disarmed" ? "shield" : p.mode === "alarm" ? "shieldAlert" : "shieldCheck";
  const b = (label, ic, mode) =>
    `<button class="btn grow mode-btn${p.mode === mode ? " active" : ""}" data-act="arm" data-id="${esc(p.id)}" data-mode="${mode}" data-key="arm:${esc(p.id)}:${mode}">${icon(ic)}${label}</button>`;
  return `<div class="card status-card ${tone}${p.mode === "alarm" ? " alarm" : ""}">
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
  return `<div class="card lock ${unlocked ? "tone-bad" : "tone-ok"}">
    <span class="status-glyph">${icon(unlocked ? "unlock" : "lock")}</span>
    <div class="lock-text"><div class="status-name">${esc(l.name)}</div><div class="muted">${l.locked === null ? "Status unknown" : unlocked ? "Unlocked" : "Locked"}</div></div>
    <button class="btn${unlocked ? " ok" : ""}" data-act="lock" data-id="${esc(l.id)}" data-target="${unlocked ? "lock" : "unlock"}" data-key="lock:${esc(l.id)}">${unlocked ? `${icon("lock")}Lock` : "Unlock"}</button>
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
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const VIEWS = {
  home: {
    html() {
      const h = app.home;
      const now = new Date();
      const lightsOn = h.lights.filter(isOn).length;
      const unlocked = h.locks.filter((l) => l.locked === false).length;
      const playing = h.media.filter((m) => m.on);
      const chips = [
        `<span class="chip lamp">${icon("bulb")}${lightsOn ? `${lightsOn} light${lightsOn === 1 ? "" : "s"} on` : "All lights off"}</span>`,
        ...h.security.map((p) => `<span class="chip ${p.mode === "alarm" ? "bad" : "ok"}">${icon("shield")}${SECURITY_TITLES[p.mode]}</span>`),
        h.locks.length ? `<span class="chip ${unlocked ? "bad" : "ok"}">${icon(unlocked ? "unlock" : "lock")}${unlocked ? `${unlocked} unlocked` : "Doors locked"}</span>` : "",
        ...h.gates.map((g) => `<span class="chip gate">${icon("gate")}${esc(g.name)}: ${GATE_TITLES[g.state]}</span>`),
        playing.length ? `<span class="chip media">${icon("music")}${playing.length} playing</span>` : "",
      ].join("");
      const scenes = homeScenes(h);
      const statusCards = [...h.gates.map(gateCard), ...h.security.map(alarmCard)];
      return `
        <header class="dash-head">
          <div>
            <p class="eyebrow"><span data-clock="date">${fmtDate(now)}</span>${app.homeName !== "Home" ? ` · ${esc(app.homeName)}` : ""}</p>
            <h1 class="greeting" data-clock="greeting">${greeting(now)}</h1>
          </div>
          <div class="head-right">
            <span class="clock" data-clock="time">${fmtTime(now)}</span>
            <a class="icon-btn phone-only" href="#setup" aria-label="Setup">${icon("sliders")}</a>
          </div>
        </header>
        ${statusNotice()}
        <div class="chips" data-scroll="chips">${chips}</div>
        ${scenes.length ? section("Scenes", `<div class="grid grid-scenes">${scenes.map(sceneTile).join("")}</div>`) : ""}
        ${statusCards.length ? `<div class="grid grid-cards">${statusCards.join("")}</div>` : ""}
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
        <div class="room hero" style="--h:${hue(room.name)};--glow:${roomGlow(lights).toFixed(2)}">
          <div class="room-top"><span class="room-glyph">${icon(roomIcon(room.name))}</span>${leds(lights)}</div>
          <div class="stack">
            <div><h1 class="room-name">${esc(room.name)}</h1>
              <div class="room-meta"><span>${lights.length ? (on ? `${on} of ${lights.length} lights on` : "Lights off") : "No lights"}</span></div></div>
            ${lights.length ? `<div class="hero-actions">
              <button class="btn on-photo" data-act="all-lights" data-id="${esc(id)}" data-level="1">${icon("sun")}All on</button>
              <button class="btn on-photo" data-act="all-lights" data-id="${esc(id)}" data-level="0">${icon("power")}All off</button>
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
    <section class="card form" aria-labelledby="dev-title">
      <h2 class="section-title" id="dev-title">This device</h2>
      <div class="field"><span class="label">Appearance</span>
        <div class="segmented">${seg("theme", "auto", "Automatic", d.theme)}${seg("theme", "dark", "Dark", d.theme)}${seg("theme", "light", "Light", d.theme)}</div>
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

function applyTheme() {
  const root = document.documentElement;
  if (app.device.theme === "auto") {
    if (root.dataset.themeByApp) { delete root.dataset.theme; delete root.dataset.themeByApp; }
  } else {
    root.dataset.theme = app.device.theme;
    root.dataset.themeByApp = "1";
  }
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
    el.textContent = kind === "time" ? fmtTime(now) : kind === "date" ? fmtDate(now) : greeting(now);
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
    case "scene": return send({ type: "recallScene", id });
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
      return confirmModal({ title: `Open ${gate?.name ?? "the gate"}?`, text: "Make sure the way is clear.", label: "Open", tone: "gate", onConfirm: () => send(cmd) });
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
  const label = $(".value", el);
  if (label) label.textContent = text;
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

start();
