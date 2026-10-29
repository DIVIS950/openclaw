// Home View: the iPad-first app. Talks to the same home server as the classic view
// (../api/…) and falls back to the demo house when it can't reach one.
import { icon, sceneIcon } from "../icons.js";
import { DemoEngine } from "../shared/demo.js";
import { applyCommand, clamp01, emptyHome, pct, stateKey } from "../shared/model.js";
import { createAsk } from "./ask.js";
import { dots, isWideSheet, sheetHTML } from "./sheets.js";
import { isOn, isOpen, shadeState, sidebarHTML, standbyHTML, timeHTML, viewHTML, wallpaperHues } from "./views.js";

const $ = (s, root = document) => root.querySelector(s);

// Per-device preferences. Storage can be unavailable (private mode, previews); fall back quietly.
const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`hv.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`hv.${key}`, JSON.stringify(value)); } catch {}
  },
};

const app = {
  api: new URL("../api/", location.href).href,
  home: emptyHome(),
  status: { connection: "connecting", message: null, mode: "demo" },
  homeName: "Home",
  cameras: [],
  assistant: { available: false },
  askVisible: false,
  transport: null, // "server" | "local"
  route: { name: "home", arg: null },
  lastRoute: "",
  sheet: null, // what the open sheet shows: { kind, id, … }
  pop: null, // scene that just ran, for a one-time bounce
  recent: new Map(),
  lastLevel: new Map(), // brightness to restore when a light is tapped back on
  dragging: false,
  renderQueued: false,
  pendingRender: false,
  lastTouch: Date.now(),
  device: { look: prefs.get("look", "auto"), wall: prefs.get("wall", false), saverMin: prefs.get("saverMin", 5) },
};

let engine = null;
const ask = createAsk({ app, send, notify, onVisibility: () => scheduleRender() });

// ---------- connection ----------

async function start() {
  applyLook();
  app.route = parseHash();
  try {
    const res = await fetch(`${app.api}state`, { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("no server");
    receive(await res.json());
    app.transport = "server";
    const events = new EventSource(`${app.api}events`);
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
  ask.init();
}

function startLocal() {
  app.transport = "local";
  engine = new DemoEngine((snap) => {
    app.home = merge(snap);
    scheduleRender();
  });
  app.home = engine.snapshot();
  app.homeName = "Maple House";
  app.status = { connection: "connected", message: null, mode: "demo" };
  app.cameras = [
    { id: "demo-drive", name: "Driveway", demo: "drive" },
    { id: "demo-door", name: "Front Door", demo: "door" },
  ];
}

function receive(p) {
  app.home = merge(p.home ?? emptyHome());
  app.status = p.status ?? app.status;
  app.homeName = p.homeName || "Home";
  app.cameras = p.cameras ?? [];
  app.assistant = p.assistant ?? { available: false };
  ask.onStateChange();
  scheduleRender();
}

/** Re-apply what this iPad just set, so a slow processor doesn't make controls jump back. */
function merge(snapshot) {
  const now = Date.now();
  for (const [key, entry] of app.recent) if (now - entry.at > 3000) app.recent.delete(key);
  for (const { cmd } of app.recent.values()) applyCommand(snapshot, cmd);
  return snapshot;
}

async function send(cmd) {
  app.lastTouch = Date.now();
  if (cmd.type === "setLight") {
    const l = app.home.lights.find((x) => x.id === cmd.id);
    if (l && isOn(l)) app.lastLevel.set(l.id, l.level);
  }
  applyCommand(app.home, cmd);
  const key = stateKey(cmd);
  if (key) app.recent.set(key, { cmd, at: Date.now() });
  scheduleRender();
  if (app.transport === "local") {
    engine.perform(cmd);
    return;
  }
  try {
    const res = await fetch(`${app.api}command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `The home server answered ${res.status}.`);
  } catch (err) {
    notify(err.message || "Couldn't reach the home server.", { error: true });
  }
}

// ---------- routing & rendering ----------

const ROUTES = ["home", "lights", "shades", "media", "security", "cameras"];

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("room-")) return { name: "room", arg: h.slice(5) };
  return { name: ROUTES.includes(h) ? h : "home", arg: null };
}

window.addEventListener("hashchange", () => {
  app.route = parseHash();
  closeSheet();
  document.body.classList.remove("drawer");
  render();
});

function scheduleRender() {
  // Never rebuild the page under a finger that is dragging a control.
  if (app.dragging) {
    app.pendingRender = true;
    return;
  }
  if (app.renderQueued) return;
  app.renderQueued = true;
  requestAnimationFrame(() => {
    app.renderQueued = false;
    render();
  });
}

function render() {
  if (app.dragging) {
    app.pendingRender = true;
    return;
  }
  app.pendingRender = false;
  applyWallpaper();
  const content = $("#content");
  const routeKey = `${app.route.name}:${app.route.arg ?? ""}`;
  const changed = routeKey !== app.lastRoute;
  const focusKey = document.activeElement?.closest?.("[data-key]")?.dataset.key;
  const scroll = content.scrollTop;
  $("#sidebar").innerHTML = sidebarHTML(app);
  content.innerHTML = `<div class="view${changed ? " enter" : ""}">${viewHTML(app)}</div><div class="drawer-scrim" data-act="menu"></div>`;
  content.scrollTop = changed ? 0 : scroll;
  app.lastRoute = routeKey;
  app.pop = null;
  if (focusKey) document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  renderSheet();
  if (!$("#standby").hidden) drawStandby();
}

function applyWallpaper() {
  const [h1, h2, h3] = wallpaperHues(app);
  const root = document.documentElement.style;
  root.setProperty("--h1", h1);
  root.setProperty("--h2", h2);
  root.setProperty("--h3", h3);
}

function applyLook() {
  const look = app.device.look;
  if (look === "auto") delete document.documentElement.dataset.look;
  else document.documentElement.dataset.look = look;
}

// ---------- sheets ----------

function openSheet(spec) {
  app.sheet = spec;
  const root = $("#sheet-root");
  root.innerHTML = `<div class="sheet-backdrop" data-act="backdrop"><div class="sheet${isWideSheet(spec) ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></div></div>`;
  renderSheet();
  root.querySelector(".sheet")?.focus?.();
  root.querySelector("button, [tabindex]")?.focus({ preventScroll: true });
}

function renderSheet() {
  const box = $("#sheet-root .sheet");
  if (!app.sheet || !box) return;
  const html = sheetHTML(app, app.sheet);
  if (!html) return closeSheet(); // the device went away
  const focusKey = document.activeElement?.closest?.("#sheet-root [data-key], #sheet-root [data-act]");
  const keySel = focusKey?.dataset.key ? `[data-key="${CSS.escape(focusKey.dataset.key)}"]` : null;
  box.innerHTML = html;
  if (keySel) box.querySelector(keySel)?.focus({ preventScroll: true });
}

function closeSheet() {
  app.sheet = null;
  cancelHold();
  $("#sheet-root").innerHTML = "";
}

// ---------- feedback ----------

let islandTimer = null;
function notify(text, { error = false, ic = error ? "alert" : "check", color, sub = "" } = {}) {
  const el = $("#island");
  el.innerHTML = `<span class="i-icon" style="--c:${color ?? (error ? "#ff453a" : "#30d158")}">${icon(ic)}</span><span>${text}${sub ? ` <span class="i-sub">${sub}</span>` : ""}</span>`;
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth; // restart the entrance animation
  el.style.animation = "";
  clearTimeout(islandTimer);
  islandTimer = setTimeout(() => { el.hidden = true; }, error ? 4200 : 2400);
}
const escText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- actions ----------

function toggle(kind, id) {
  const h = app.home;
  switch (kind) {
    case "light": {
      const l = h.lights.find((x) => x.id === id);
      if (!l) return;
      const level = isOn(l) ? 0 : l.dimmable ? (app.lastLevel.get(id) ?? 1) : 1;
      return send({ type: "setLight", id, level });
    }
    case "shade": {
      const s = h.shades.find((x) => x.id === id);
      return s && send({ type: "setShade", id, position: isOpen(s) ? 0 : 1 });
    }
    case "media": {
      const m = h.media.find((x) => x.id === id);
      return m && send({ type: "mediaPower", id, on: !m.on });
    }
    case "lock": {
      const l = h.locks.find((x) => x.id === id);
      if (!l) return;
      // Locking is instant; unlocking always goes through press-and-hold.
      if (l.locked === false) {
        send({ type: "setLock", id, locked: true });
        return notify(`${escText(l.name)} locked`, { ic: "lock" });
      }
      return openSheet({ kind: "lock", id });
    }
  }
}

function gateAction(id, action) {
  const g = app.home.gates.find((x) => x.id === id);
  const opens = action === "open" || (action === "trigger" && g?.state !== "open");
  send({ type: "gate", id, action });
  if (action === "stop") notify(`${escText(g?.name ?? "Gate")} stopped`, { ic: "stop", color: "#0a84ff" });
  else notify(`${opens ? "Opening" : "Closing"} ${escText(g?.name ?? "the gate")}`, { ic: "gate", color: "#0a84ff" });
}

function arm(id, mode) {
  const panel = app.home.security.find((p) => p.id === id);
  if (!panel || panel.mode === mode) return;
  if (panel.needsCode) return openSheet({ kind: "keypad", id, mode, code: "" });
  send({ type: "setSecurity", id, mode });
}

const SLIDER_SEND = {
  light: (id, v) => send({ type: "setLight", id, level: v }),
  shade: (id, v) => send({ type: "setShade", id, position: v }),
  volume: (id, v) => send({ type: "mediaVolume", id, level: v }),
};

const actions = {
  toggle: (el) => toggle(el.dataset.kind, el.dataset.id),
  detail: (el) => openSheet({ kind: el.dataset.kind, id: el.dataset.id }),
  scene: (el) => {
    const s = app.home.scenes.find((x) => x.id === el.dataset.id);
    if (!s) return;
    app.pop = s.id;
    send({ type: "recallScene", id: s.id });
    notify(`${escText(s.name)}`, { ic: sceneIcon(s), color: "#ff9f0a", sub: "is on" });
  },
  arm: (el) => arm(el.dataset.id, el.dataset.mode),
  gate: (el) => gateAction(el.dataset.id, el.dataset.action),
  camera: (el) => openSheet({ kind: "camera", id: el.dataset.id }),
  settings: () => openSheet({ kind: "settings" }),
  "sheet-close": () => closeSheet(),
  backdrop: (el, e) => { if (e.target === el) closeSheet(); },
  "confirm-yes": () => {
    const fn = app.sheet?.onConfirm;
    closeSheet();
    fn?.();
  },
  "light-set": (el) => send({ type: "setLight", id: el.dataset.id, level: Number(el.dataset.level) }),
  "shade-set": (el) => send({ type: "setShade", id: el.dataset.id, position: Number(el.dataset.position) }),
  "shade-stop": (el) => send({ type: "stopShade", id: el.dataset.id }),
  "media-power": (el) => toggle("media", el.dataset.id),
  "media-mute": (el) => {
    const m = app.home.media.find((x) => x.id === el.dataset.id);
    if (m) send({ type: "mediaMute", id: m.id, muted: !m.muted });
  },
  "media-source": (el) => send({ type: "mediaSource", id: el.dataset.id, sourceId: el.dataset.source }),
  "lock-now": (el) => toggle("lock", el.dataset.id),
  "room-lights": (el) => {
    for (const l of app.home.lights) if (l.roomId === el.dataset.id) send({ type: "setLight", id: l.id, level: Number(el.dataset.level) });
  },
  "room-shades": (el) => {
    for (const s of app.home.shades) if (s.roomId === el.dataset.id) send({ type: "setShade", id: s.id, position: Number(el.dataset.position) });
  },
  "all-lights": (el) => {
    const level = Number(el.dataset.level);
    for (const l of app.home.lights) send({ type: "setLight", id: l.id, level });
    notify(level ? "All lights on" : "All lights off", { ic: level ? "bulb" : "bulbOff", color: "#ffb300" });
  },
  "all-shades": (el) => {
    const position = Number(el.dataset.position);
    for (const s of app.home.shades) send({ type: "setShade", id: s.id, position });
  },
  key: (el) => {
    const k = app.sheet;
    if (k?.kind !== "keypad") return;
    const v = el.dataset.v;
    if (v === "clear") k.code = "";
    else if (v === "del") k.code = k.code.slice(0, -1);
    else if (k.code.length < 10) k.code += v;
    $("#code-dots").innerHTML = dots(k.code);
    $("#key-enter").disabled = !k.code;
  },
  "key-enter": () => {
    const k = app.sheet;
    if (k?.kind !== "keypad" || !k.code) return;
    send({ type: "setSecurity", id: k.id, mode: k.mode, code: k.code });
    closeSheet();
    notify(k.mode === "disarmed" ? "Alarm disarmed" : k.mode === "armedAway" ? "Armed away" : "Armed home", { ic: "shieldCheck", color: "#5e5ce6" });
  },
  look: (el) => {
    app.device.look = el.dataset.v;
    prefs.set("look", app.device.look);
    applyLook();
    renderSheet();
  },
  wall: () => {
    app.device.wall = !app.device.wall;
    prefs.set("wall", app.device.wall);
    applyWall();
    renderSheet();
  },
  "saver-min": (el) => {
    app.device.saverMin = Number(el.dataset.v);
    prefs.set("saverMin", app.device.saverMin);
    renderSheet();
  },
  "standby-now": () => {
    closeSheet();
    showStandby(true);
  },
  menu: () => document.body.classList.toggle("drawer"),
  "ask-open": () => {
    document.body.classList.remove("drawer");
    ask.open();
  },
  "ask-close": () => ask.close(),
  "ask-suggest": (el) => ask.submit(el.dataset.text),
  "ask-confirm": (el) => ask.confirmAt(Number(el.dataset.index)),
  "ask-mic": () => ask.toggleListening(),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (el.closest("#sidebar") && el.tagName === "A") document.body.classList.remove("drawer");
  actions[el.dataset.act]?.(el, e);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (app.sheet) closeSheet();
    else if (ask.isOpen) ask.close();
    else document.body.classList.remove("drawer");
    return;
  }
  const el = e.target;
  // Keyboard for sliders: arrows nudge by 5%, Page keys by 25%.
  const slider = el.closest?.("[data-slider], [data-hslider]");
  if (slider) {
    const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.25, PageDown: -0.25, Home: -1, End: 1 }[e.key];
    if (step === undefined) {
      if ((e.key === "Enter" || e.key === " ") && slider.dataset.slider === "light-switch") { e.preventDefault(); toggle("light", slider.dataset.id); }
      return;
    }
    e.preventDefault();
    const kind = slider.dataset.slider ?? slider.dataset.hslider;
    const v = clamp01(Number(slider.style.getPropertyValue("--v")) + step);
    if (kind === "light-switch") return toggle("light", slider.dataset.id);
    setSliderVisual(slider, kind, v);
    SLIDER_SEND[kind]?.(slider.dataset.id, v);
    return;
  }
  // A slide-to-open control asks for a confirmation from the keyboard instead.
  if (el.dataset?.slide && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    const g = app.home.gates.find((x) => x.id === el.dataset.id);
    openSheet({ kind: "confirm", title: `Open ${g?.name ?? "the gate"}?`, text: "Make sure the way is clear.", label: "Open", icon: "gate",
      onConfirm: () => gateAction(el.dataset.id, el.dataset.action) });
    return;
  }
  if (el.dataset?.hold && (e.key === "Enter" || e.key === " ") && !e.repeat) {
    e.preventDefault();
    startHold(el);
  }
});
document.addEventListener("keyup", (e) => {
  if ((e.key === "Enter" || e.key === " ") && hold) cancelHold();
});

// ---------- sliders (Control Center style: drag anywhere, relative to where you started) ----------

let drag = null;

function setSliderVisual(el, kind, v) {
  el.style.setProperty("--v", v.toFixed(3));
  el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  el.classList.toggle("lit", v > 0.04);
  const id = el.dataset.id;
  const live = (k, text) => document.querySelectorAll(`[data-live="${k}:${CSS.escape(id)}"]`).forEach((n) => { n.textContent = text; });
  if (kind === "light") live("light", v > 0.005 ? pct(v) : "Off");
  if (kind === "shade") live("shade", shadeState({ position: v }));
  if (kind === "volume") live("volume", pct(v));
}

document.addEventListener("pointerdown", (e) => {
  app.lastTouch = Date.now();
  if (!$("#standby").hidden) {
    e.preventDefault();
    return showStandby(false);
  }
  const el = e.target.closest("[data-slider], [data-hslider], [data-slide], [data-hold]");
  if (!el) return;
  if (el.dataset.hold) return startHold(el);
  const vertical = Boolean(el.dataset.slider);
  const kind = el.dataset.slider ?? el.dataset.hslider ?? "slide";
  const rect = (el.querySelector(".hbar-track") ?? el).getBoundingClientRect();
  el.setPointerCapture?.(e.pointerId);
  drag = {
    el, kind, vertical, rect, id: el.dataset.id, x0: e.clientX, y0: e.clientY, moved: false, lastSend: 0,
    v0: Number(el.style.getPropertyValue("--v")) || 0, v: Number(el.style.getPropertyValue("--v")) || 0,
  };
  if (kind === "slide") {
    el.classList.remove("snap");
    drag.max = el.clientWidth - 58;
  }
  app.dragging = true;
  el.classList.add("dragging");
});

document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  const dy = drag.y0 - e.clientY;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.kind === "slide") {
    drag.x = Math.max(0, Math.min(drag.max, dx));
    drag.el.style.setProperty("--x", `${drag.x}px`);
    return;
  }
  if (drag.kind === "light-switch") return;
  const v = clamp01(drag.v0 + (drag.vertical ? dy / drag.rect.height : dx / drag.rect.width));
  drag.v = v;
  setSliderVisual(drag.el, drag.kind, v);
  // Send while dragging, but not faster than the processor likes.
  const now = Date.now();
  if (now - drag.lastSend > 220) {
    drag.lastSend = now;
    drag.sent = v;
    sendQuiet(drag.kind, drag.id, v);
  }
});

/** A send during a drag: updates state without re-rendering under the finger. */
function sendQuiet(kind, id, v) {
  SLIDER_SEND[kind]?.(id, v);
}

function endDrag(e, cancelled = false) {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.el.classList.remove("dragging");
  app.dragging = false;
  if (d.kind === "slide") {
    if (!cancelled && d.x >= d.max * 0.85) {
      d.el.style.setProperty("--x", `${d.max}px`);
      gateAction(d.id, d.el.dataset.action);
    } else {
      d.el.classList.add("snap");
      d.el.style.setProperty("--x", "0px");
    }
  } else if (d.kind === "light-switch") {
    if (!cancelled) toggle("light", d.id);
  } else if (!cancelled) {
    let v = d.v;
    // A tap (no drag) sets the level where you tapped.
    if (!d.moved) {
      v = d.vertical ? 1 - (e.clientY - d.rect.top) / d.rect.height : (e.clientX - d.rect.left) / d.rect.width;
      v = clamp01(Math.round(v * 20) / 20);
      setSliderVisual(d.el, d.kind, v);
    }
    if (v !== d.sent) SLIDER_SEND[d.kind]?.(d.id, v);
  }
  if (app.pendingRender) scheduleRender();
}
document.addEventListener("pointerup", (e) => endDrag(e));
document.addEventListener("pointercancel", (e) => endDrag(e, true));

// ---------- press and hold to unlock ----------

let hold = null;
function startHold(el) {
  cancelHold();
  el.classList.add("holding");
  const id = el.dataset.id;
  hold = {
    el,
    timer: setTimeout(() => {
      const l = app.home.locks.find((x) => x.id === id);
      hold = null;
      el.classList.remove("holding");
      send({ type: "setLock", id, locked: false });
      notify(`${escText(l?.name ?? "Door")} unlocked`, { ic: "unlock", color: "#ff9f0a" });
      closeSheet();
    }, 1000),
  };
}
function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold.el.classList.remove("holding");
  hold = null;
}
document.addEventListener("pointerup", () => cancelHold());
document.addEventListener("pointercancel", () => cancelHold());

// ---------- StandBy & wall panel ----------

function showStandby(show) {
  const el = $("#standby");
  el.hidden = !show;
  if (show) {
    ask.close();
    drawStandby();
  } else app.lastTouch = Date.now();
}

function drawStandby() {
  const el = $("#standby");
  el.innerHTML = standbyHTML(app);
  // Drift a little every minute so nothing burns into the screen.
  const inner = el.firstElementChild;
  const t = Math.floor(Date.now() / 60000);
  inner.style.setProperty("--dx", `${((t * 37) % 41) - 20}px`);
  inner.style.setProperty("--dy", `${((t * 23) % 31) - 15}px`);
}

let wakeLock = null;
async function applyWall() {
  try {
    if (app.device.wall && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
    } else {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (app.device.wall) applyWall(); });

function startTimers() {
  setInterval(() => {
    document.querySelectorAll("[data-clock]").forEach((n) => { n.innerHTML = timeHTML(new Date()); });
    const sb = $("#standby");
    if (!sb.hidden) drawStandby();
    else if (app.device.wall && !app.sheet && !ask.isOpen && Date.now() - app.lastTouch > app.device.saverMin * 60000) showStandby(true);
    // The home wallpaper follows the time of day.
    if (app.route.name !== "room") applyWallpaper();
  }, 10000);
  // Camera pictures: refresh the real ones every second, tick the clock on all of them.
  setInterval(() => {
    const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    document.querySelectorAll("[data-cam-time]").forEach((n) => { n.textContent = now; });
    if (document.visibilityState !== "visible" || !$("#standby").hidden) return;
    document.querySelectorAll("img[data-cam]").forEach((img) => {
      if (img.dataset.loading) return;
      const next = new Image();
      img.dataset.loading = "1";
      next.onload = () => { img.src = next.src; delete img.dataset.loading; };
      next.onerror = () => { delete img.dataset.loading; };
      next.src = `${app.api}cameras/${encodeURIComponent(img.dataset.cam)}/snapshot?t=${Date.now()}`;
    });
  }, 1000);
  applyWall();
}

start();
