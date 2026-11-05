// Home View: the iPad-first app. Talks to the same home server as the classic view
// (../api/…) and falls back to the demo house when it can't reach one.
import { icon, sceneIcon } from "../icons.js";
import { DemoEngine } from "../shared/demo.js";
import { LANGS, locale, setLang, t } from "../shared/i18n.js";
import { parseJoinMap } from "../shared/joinmap.js";
import { applyCommand, clamp01, clampTarget, emptyHome, normalizeHome, pct, stateKey } from "../shared/model.js";
import { createAsk } from "./ask.js";
import { createFeatures } from "./features.js";
import { createSetup } from "./setup.js";
import { createStart } from "./start.js";
import { dots, isWideSheet, sheetHTML } from "./sheets.js";
import { createTvControls } from "./tv.js";
import { homePages, isLocal, isOn, isOpen, setFlash, shadeState, sidebarHTML, standbyHTML, timeHTML, viewHTML, wallpaperHues } from "./views.js";
import { createXPanelEngine, isXPanelPage, loadXPanelSettings, needsReload, reconnect, saveXPanelSettings } from "./xpanel.js";

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

// Language before anything is drawn: Czech unless this iPad was switched to English.
setLang(prefs.get("lang", "cs"));

const app = {
  api: new URL("../api/", location.href).href,
  home: emptyHome(),
  status: { connection: "connecting", message: null, mode: "demo" },
  homeName: "", // empty: shown as "Home" in the current language
  cameras: [],
  sources: [], // extra systems beside the main one (Samsung TVs): { id, name, origin, connection, message }
  assistant: { available: false },
  askVisible: false,
  transport: null, // "server" | "local" (the demo in this browser) | "xpanel" (on the processor)
  xpanel: null, // Web XPanel settings: { host, ipId, joinMapText }
  demoHouse: false, // Web XPanel: the demo house shown while setup isn't finished ("look at the demo first")
  setupNeeded: false, // Home shows the "finish setup" banner
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
  homePage: prefs.get("homePage", 0), // which Home page is showing
  flash: new Map(), // "light:l1" -> when it changed, so its tile can animate
  roomPhotos: {}, // roomId -> version, from the home server
  localPhotos: new Map(), // roomId -> object URL, for the demo in this browser
  photoURL(roomId) {
    if (isLocal(this)) return this.localPhotos.get(roomId) ?? null;
    const version = this.roomPhotos[roomId];
    return version ? `${this.api}rooms/${encodeURIComponent(roomId)}/photo?v=${version}` : null;
  },
};

let engine = null;
const DEMO_CAMERAS = [
  { id: "demo-drive", name: "Příjezd", demo: "drive" },
  { id: "demo-door", name: "Brána", demo: "door" },
];
const ask = createAsk({ app, send, notify, onVisibility: () => scheduleRender(), automation: () => features.assistantAutomation, onKeyChange: () => renderSheet(true) });
const features = createFeatures({
  app, prefs, send, notify, escText: (t) => escText(t), openSheet, closeSheet, renderSheet: () => renderSheet(true), scheduleRender,
  wake: () => { if (!$("#standby").hidden) showStandby(false); },
  ringDemo: (id) => engine?.ring(id),
});
const tv = createTvControls({ app, send, notify, escText: (s) => escText(s), renderSheet: () => renderSheet(true) });
// The setup guide: it asks for the processor, IP ID and join map and calls connectHouse() for the actual connecting.
const setup = createSetup({
  app, prefs, send, notify, escText: (s) => escText(s), openSheet, closeSheet, scheduleRender,
  mode: () => (app.transport === "xpanel" ? "xpanel" : app.transport === "server" ? "server" : "demo"),
  status: () => app.status,
  connect: connectHouse,
  saveMap: (text) => { app.xpanel = { ...app.xpanel, joinMapText: text }; saveXPanelSettings(app.xpanel); },
  showDemoHouse,
  toggleWall,
});
const startScreen = createStart({ app, prefs, notify, openSheet, closeSheet, openGuideDemo: () => setup.open(0) });

// ---------- connection ----------

async function start() {
  applyLook();
  translateStatic();
  app.route = parseHash();
  if (isXPanelPage()) {
    // Built for the processor: never look for a home server.
    await startXPanel();
  } else {
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
        app.status = { ...app.status, connection: "failed", message: t("Lost the home server. Reconnecting…") };
        scheduleRender();
      };
    } catch {
      startLocal();
    }
  }
  render();
  startTimers();
  ask.init();
  setup.init();
  startScreen.init();
}

function startLocal() {
  app.transport = "local";
  engine = new DemoEngine((snap) => {
    app.home = merge(snap);
    features.checkDoorbells();
    setup.onHome();
    scheduleRender();
  });
  app.home = engine.snapshot();
  app.homeName = "Můj dům";
  app.status = { connection: "connected", message: null, mode: "demo" };
  app.cameras = DEMO_CAMERAS;
  features.startLocal();
  features.checkDoorbells();
}

// ---------- Web XPanel: the processor hosts the app, no home server ----------

async function startXPanel() {
  app.transport = "xpanel";
  app.status = { connection: "idle", message: null, mode: "xpanel" };
  app.xpanel = await loadXPanelSettings();
  // Automations and the doorbell check run in this browser, like the demo; nothing else is sample data.
  features.startLocal({ demo: false });
  if (app.xpanel.joinMapText) connectXPanel();
}

/** Starts (or, after a new join map, restarts) the engine on the saved settings. */
function connectXPanel() {
  engine?.stop();
  engine = null;
  let map;
  try {
    map = parseJoinMap(app.xpanel.joinMapText);
  } catch (err) {
    app.status = { connection: "failed", kind: "map", message: t("The saved join map is broken: {error}", { error: err.message }), mode: "xpanel" };
    return scheduleRender();
  }
  engine = createXPanelEngine({
    host: app.xpanel.host, ipId: app.xpanel.ipId || "03", joinMap: map,
    onChange: (snap) => {
      app.home = merge(snap);
      features.checkDoorbells();
      setup.onHome();
      scheduleRender();
    },
    onStatus: (status) => {
      app.status = { ...status, mode: "xpanel" };
      setup.onStatus(app.status);
      scheduleRender();
    },
  });
  app.home = merge(engine.snapshot());
  app.status = { ...engine.status, mode: "xpanel" };
  scheduleRender();
}

/** The setup guide's "connect": saves the settings and starts the house the way this page runs. */
async function connectHouse({ host, ipId, joinMapText, pin }) {
  if (app.transport === "xpanel") {
    // The page's own host is stored as "", so the package keeps working if the processor's address changes.
    app.xpanel = { ...app.xpanel, host: host === location.hostname ? "" : host, ipId, joinMapText };
    saveXPanelSettings(app.xpanel);
    showDemoHouse(false, { connect: false });
    // WebXPanel can't be pointed at another processor once started: reload, and the guide resumes here.
    if (needsReload(app.xpanel.host, app.xpanel.ipId)) {
      prefs.set("setup", { ...(prefs.get("setup", null) ?? {}), step: "connect" });
      reconnect();
      return { reloading: true };
    }
    connectXPanel();
    return {};
  }
  if (app.transport === "server") {
    // The same PIN flow as the classic Setup page: the PIN is kept for this tab only.
    const headers = { "Content-Type": "application/json" };
    let savedPin = "";
    try { savedPin = sessionStorage.getItem("hc.pin") ?? ""; } catch {}
    if (pin || savedPin) headers["X-Admin-Pin"] = pin || savedPin;
    const res = await fetch(`${app.api}config`, { method: "PUT", headers, body: JSON.stringify({ mode: "customProgram", host, ipId, joinMap: joinMapText }) });
    if (res.status === 401) {
      const err = new Error(t("Enter the setup PIN."));
      err.code = "pin";
      throw err;
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t("The home server answered {status}.", { status: res.status }));
    if (pin) try { sessionStorage.setItem("hc.pin", pin); } catch {}
    app.status = { ...app.status, connection: "connecting", message: null };
    return {};
  }
  // The demo: pretend to connect.
  setTimeout(() => setup.onStatus({ connection: "connected", message: null, mode: "demo" }), 900);
  return { simulated: true };
}

/** "Look at the demo first": the demo house stands in for the real one until setup is finished. */
function showDemoHouse(on, { connect = true } = {}) {
  if (app.transport !== "xpanel" || on === app.demoHouse) return;
  app.demoHouse = on;
  engine?.stop();
  engine = null;
  if (on) {
    engine = new DemoEngine((snap) => {
      app.home = merge(snap);
      features.checkDoorbells();
      setup.onHome();
      scheduleRender();
    });
    app.home = engine.snapshot();
    app.status = { connection: "connected", message: null, mode: "demo" };
    app.cameras = DEMO_CAMERAS;
  } else {
    app.home = emptyHome();
    app.cameras = [];
    app.status = { connection: "idle", message: null, mode: "xpanel" };
    if (connect && app.xpanel?.joinMapText) connectXPanel();
  }
  scheduleRender();
}

function receive(p) {
  app.home = merge(p.home ?? emptyHome());
  app.status = p.status ?? app.status;
  app.homeName = p.homeName || "";
  app.cameras = p.cameras ?? [];
  app.sources = Array.isArray(p.sources) ? p.sources : [];
  app.assistant = p.assistant ?? { available: false };
  app.roomPhotos = p.roomPhotos ?? {};
  features.receive(p);
  setup.onStatus(app.status);
  ask.onStateChange();
  scheduleRender();
}

/** Re-apply what this iPad just set, so a slow processor doesn't make controls jump back. */
function merge(raw) {
  const snapshot = normalizeHome(raw);
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
  const kind = { setLight: "light", setShade: "shade", mediaPower: "media", mediaSource: "media", tvApp: "media", mediaChannel: "media", setLock: "lock", recallScene: "scene" }[cmd.type];
  if (kind) app.flash.set(`${kind}:${cmd.id}`, Date.now());
  const key = stateKey(cmd);
  if (key) app.recent.set(key, { cmd, at: Date.now() });
  scheduleRender();
  if (isLocal(app)) {
    // The demo engine answers at once; the Web XPanel engine can refuse (not connected, no join for it).
    try {
      await engine?.perform(cmd);
    } catch (err) {
      notify(escText(err.message || t("The house didn't take that.")), { error: true });
    }
    return;
  }
  try {
    const res = await fetch(`${app.api}command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t("The home server answered {status}.", { status: res.status }));
  } catch (err) {
    notify(escText(err.message || t("Couldn't reach the home server.")), { error: true });
  }
}

// ---------- routing & rendering ----------

const ROUTES = ["home", "lights", "shades", "media", "heating", "security", "cameras", "automations"];

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
  app.setupNeeded = setup.needed();
  applyWallpaper();
  const content = $("#content");
  const routeKey = `${app.route.name}:${app.route.arg ?? ""}`;
  const changed = routeKey !== app.lastRoute;
  const focusKey = document.activeElement?.closest?.("[data-key]")?.dataset.key;
  const scroll = content.scrollTop;
  // Home's pages scroll on their own: remember where each one was.
  const pageTops = [...document.querySelectorAll("#pager .page")].map((p) => p.scrollTop);
  // A tile plays its "just changed" animation for a moment after the change (the house's
  // own update usually arrives a few milliseconds later and redraws it).
  const now = Date.now();
  for (const [k, at] of app.flash) if (now - at > 700) app.flash.delete(k);
  setFlash(new Set(app.flash.keys()));
  $("#sidebar").innerHTML = sidebarHTML(app);
  content.innerHTML = `<div class="view${changed ? " enter" : ""}">${viewHTML(app)}</div><div class="drawer-scrim" data-act="menu"></div>`;
  content.scrollTop = changed ? 0 : scroll;
  content.classList.toggle("paged-mode", app.route.name === "home");
  setupPager(changed ? [] : pageTops);
  app.lastRoute = routeKey;
  app.pop = null;
  if (focusKey) document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  renderSheet();
  if (!$("#standby").hidden) drawStandby();
}

// ---------- Home pages ----------

let pagerTimer = null;
function setupPager(pageTops) {
  const pager = $("#pager");
  if (!pager) return;
  const pages = pager.querySelectorAll(".page");
  app.homePage = Math.max(0, Math.min(app.homePage, pages.length - 1));
  pager.scrollLeft = app.homePage * pager.clientWidth;
  pageTops.forEach((top, i) => { if (pages[i]) pages[i].scrollTop = top; });
  pager.addEventListener("scroll", () => {
    clearTimeout(pagerTimer);
    pagerTimer = setTimeout(() => {
      const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      if (i !== app.homePage) showPageMarkers(i);
    }, 90);
  }, { passive: true });
}

/** Moves the tab highlight and dots without rebuilding the page. */
function showPageMarkers(i) {
  app.homePage = i;
  prefs.set("homePage", i);
  document.querySelectorAll(".page-tabs [role=tab]").forEach((t, j) => t.setAttribute("aria-selected", String(j === i)));
  document.querySelectorAll(".page-dots i").forEach((d, j) => d.classList.toggle("on", j === i));
}

function goToPage(i) {
  const pager = $("#pager");
  if (!pager) return;
  showPageMarkers(i);
  pager.scrollTo({ left: i * pager.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

window.addEventListener("resize", () => {
  const pager = $("#pager");
  if (pager) pager.scrollLeft = app.homePage * pager.clientWidth;
});

// ---------- motion: tilt and scene ripple ----------

/** Cards lean a little toward the finger or pointer, like a physical object. */
function tilt(e) {
  const card = e.target.closest?.("[data-tilt]");
  if (!card || e.target.closest("button, a, input, .slide, .hbar, .seg")) return;
  if (e.pointerType !== "mouse" && e.buttons === 0) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  card.style.setProperty("--ry", `${(x * 6).toFixed(2)}deg`);
  card.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
  card.classList.add("tilting");
}
function untilt(e) {
  const card = e.target.closest?.("[data-tilt]");
  if (!card) return;
  card.style.removeProperty("--rx");
  card.style.removeProperty("--ry");
  card.classList.remove("tilting");
}
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.addEventListener("pointermove", tilt, { passive: true });
  document.addEventListener("pointerout", untilt, { passive: true });
  document.addEventListener("pointerup", untilt, { passive: true });
}

/** A wash of the scene's color spreading from the button that ran it. */
function ripple(el) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect();
  const color = getComputedStyle(el).getPropertyValue("--c").trim() || "var(--orange)";
  const dot = document.createElement("div");
  dot.className = "ripple";
  dot.style.left = `${r.left + 34}px`;
  dot.style.top = `${r.top + r.height / 2}px`;
  dot.style.setProperty("--c", color);
  document.body.append(dot);
  dot.addEventListener("animationend", () => dot.remove());
}

function applyWallpaper() {
  const [h1, h2, h3] = wallpaperHues(app);
  const root = document.documentElement.style;
  root.setProperty("--h1", h1);
  root.setProperty("--h2", h2);
  root.setProperty("--h3", h3);
  const layer = $("#room-photo");
  const url = app.route.name === "room" ? app.photoURL(app.route.arg) : null;
  if (url) layer.style.backgroundImage = `url("${url}")`;
  layer.classList.toggle("on", Boolean(url));
}

// ---------- room photos ----------

/** Shrinks a picked photo to at most 1600 px and re-encodes it as JPEG. */
async function resizePhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    // Some formats only decode through an <img>.
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t("Couldn't read that photo. Try a JPEG or PNG.")));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("Couldn't read that photo.")))), "image/jpeg", 0.85));
}

document.addEventListener("change", async (e) => {
  const input = e.target.closest?.("input[data-photo-room]");
  const file = input?.files?.[0];
  if (!file) return;
  const roomId = input.dataset.photoRoom;
  input.value = "";
  try {
    const blob = await resizePhoto(file);
    if (isLocal(app)) {
      const old = app.localPhotos.get(roomId);
      if (old) URL.revokeObjectURL(old);
      app.localPhotos.set(roomId, URL.createObjectURL(blob));
      scheduleRender();
    } else {
      const res = await fetch(`${app.api}rooms/${encodeURIComponent(roomId)}/photo`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t("The home server answered {status}.", { status: res.status }));
    }
    notify(t("Room photo saved"), { ic: "camera" });
  } catch (err) {
    notify(escText(err.message || t("Couldn't save the photo.")), { error: true });
  }
});

async function removePhoto(roomId) {
  if (isLocal(app)) {
    const old = app.localPhotos.get(roomId);
    if (old) URL.revokeObjectURL(old);
    app.localPhotos.delete(roomId);
    return scheduleRender();
  }
  try {
    const res = await fetch(`${app.api}rooms/${encodeURIComponent(roomId)}/photo`, { method: "DELETE" });
    if (!res.ok) throw new Error(t("The home server answered {status}.", { status: res.status }));
  } catch (err) {
    notify(escText(err.message), { error: true });
  }
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

/** Redraws the open card. Live updates skip it while someone types in it; `force` doesn't. */
function renderSheet(force = false) {
  const box = $("#sheet-root .sheet");
  if (!app.sheet || !box) return;
  if (!force && document.activeElement?.matches?.("#sheet-root input, #sheet-root select, #sheet-root textarea")) return;
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
  tv.reset();
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
/** Static text in index.html: elements with data-i18n-aria get their aria-label in the current language. */
function translateStatic() {
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
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
        return notify(t("{name} locked", { name: escText(l.name) }), { ic: "lock" });
      }
      return openSheet({ kind: "lock", id });
    }
    // A thermostat has no on/off: its icon opens the temperature card too.
    case "climate": return openSheet({ kind: "climate", id });
    case "switch": {
      const sw = h.switches.find((x) => x.id === id);
      if (!sw) return;
      const on = !sw.on;
      send({ type: "setSwitch", id, on });
      return notify(escText(sw.name), { ic: sw.kind === "sauna" ? "steam" : "power", color: "#ff9f0a", sub: on ? t("is on") : t("is off") });
    }
  }
}

function setTarget(id, target) {
  const c = app.home.climate.find((x) => x.id === id);
  if (!c) return;
  const next = clampTarget(c, target);
  if (next === c.target) return;
  send({ type: "setClimate", id, target: next });
}

function gateAction(id, action) {
  const g = app.home.gates.find((x) => x.id === id);
  const opens = action === "open" || (action === "trigger" && g?.state !== "open");
  send({ type: "gate", id, action });
  if (action === "stop") notify(t("{name} stopped", { name: escText(g?.name ?? t("Gate")) }), { ic: "stop", color: "#0a84ff" });
  else notify(t(opens ? "Opening {name}" : "Closing {name}", { name: escText(g?.name ?? t("the gate")) }), { ic: "gate", color: "#0a84ff" });
}

function arm(id, mode) {
  const panel = app.home.security.find((p) => p.id === id);
  if (!panel || panel.mode === mode) return;
  if (panel.needsCode) return openSheet({ kind: "keypad", id, mode, code: "" });
  send({ type: "setSecurity", id, mode });
  notify(escText(panel.name), { ic: mode === "disarmed" ? "unlock" : "lock", color: "#5e5ce6", sub: t(mode === "disarmed" ? "Disarmed" : mode === "armedAway" ? "Armed away" : "Armed home") });
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
    ripple(el);
    send({ type: "recallScene", id: s.id });
    notify(escText(s.name), { ic: sceneIcon(s), color: "#ff9f0a", sub: t("activated") });
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
  "climate-step": (el) => {
    const c = app.home.climate.find((x) => x.id === el.dataset.id);
    if (c) setTarget(c.id, (c.target ?? c.current ?? 20) + Number(el.dataset.delta));
  },
  "climate-set": (el) => setTarget(el.dataset.id, Number(el.dataset.target)),
  mode: (el) => {
    const m = app.home.modes.find((x) => x.id === el.dataset.id);
    const o = m?.options.find((x) => x.id === el.dataset.value);
    if (!m || !o || m.value === o.id) return;
    send({ type: "setMode", id: m.id, value: o.id });
    notify(escText(m.name), { ic: "flame", color: "#ff9f0a", sub: escText(o.name) });
  },
  switch: (el) => toggle("switch", el.dataset.id),
  "photo-remove": (el) => removePhoto(el.dataset.id),
  "room-lights": (el) => {
    for (const l of app.home.lights) if (l.roomId === el.dataset.id) send({ type: "setLight", id: l.id, level: Number(el.dataset.level) });
  },
  "room-shades": (el) => {
    for (const s of app.home.shades) if (s.roomId === el.dataset.id) send({ type: "setShade", id: s.id, position: Number(el.dataset.position) });
  },
  "all-lights": (el) => {
    const level = Number(el.dataset.level);
    for (const l of app.home.lights) send({ type: "setLight", id: l.id, level });
    notify(level ? t("All lights are on") : t("All lights are off"), { ic: level ? "bulb" : "bulbOff", color: "#ffb300" });
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
    notify(t(k.mode === "disarmed" ? "Alarm disarmed" : k.mode === "armedAway" ? "Armed away" : "Armed home"), { ic: "shieldCheck", color: "#5e5ce6" });
  },
  look: (el) => {
    app.device.look = el.dataset.v;
    prefs.set("look", app.device.look);
    applyLook();
    renderSheet();
  },
  wall: () => {
    toggleWall();
    renderSheet();
  },
  // Web XPanel: a reconnect is a page reload (the library can't be re-initialized; see xpanel.js).
  "xpanel-reload": () => reconnect(),
  "ask-settings": () => {
    ask.close();
    openSheet({ kind: "settings" });
  },
  "ask-key-remove": () => {
    ask.clearKey();
    renderSheet(true);
    notify(t("Key removed"), { ic: "check" });
  },
  lang: (el) => {
    if (!LANGS[el.dataset.v]) return;
    prefs.set("lang", el.dataset.v);
    setLang(el.dataset.v);
    translateStatic();
    // Everything on screen is rebuilt in the new language: page, open card, Ask Home, overlays.
    render();
    ask.refresh();
    features.renderOverlay();
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
  "home-page": (el) => goToPage(Number(el.dataset.i)),
  "ask-open": () => {
    document.body.classList.remove("drawer");
    ask.open();
  },
  "ask-close": () => ask.close(),
  "ask-suggest": (el) => ask.submit(el.dataset.text),
  "ask-confirm": (el) => ask.confirmAt(Number(el.dataset.index)),
  "ask-undo": (el) => ask.undoAt(Number(el.dataset.index)),
  "ask-speak": () => ask.toggleSpeak(),
  "ask-mic": () => ask.toggleListening(),
};

Object.assign(actions, features.actions, tv.actions, setup.actions, startScreen.actions);

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (el.closest("#sidebar") && el.tagName === "A") document.body.classList.remove("drawer");
  actions[el.dataset.act]?.(el, e);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (startScreen.isOpen) startScreen.close();
    if (setup.isOpen) setup.close(); // the same as "Continue later"
    else if (features.overlayOpen) features.closeOverlay();
    else if (app.sheet) closeSheet();
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
    openSheet({ kind: "confirm", title: t("Open {name}?", { name: g?.name ?? t("the gate") }), text: t("Make sure the way is clear."), label: t("action::Open"), icon: "gate",
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
  if (kind === "light") live("light", v > 0.005 ? pct(v) : t("Off"));
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
      notify(t("{name} unlocked", { name: escText(l?.name ?? t("Door")) }), { ic: "unlock", color: "#ff9f0a" });
      closeSheet();
      features.closeOverlay();
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

/** Wall panel mode on or off (Settings and the setup guide). */
function toggleWall() {
  app.device.wall = !app.device.wall;
  prefs.set("wall", app.device.wall);
  applyWall();
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
    else if (app.device.wall && !app.sheet && !ask.isOpen && !features.overlayOpen && Date.now() - app.lastTouch > app.device.saverMin * 60000) showStandby(true);
    // The home wallpaper follows the time of day.
    if (app.route.name !== "room") applyWallpaper();
  }, 10000);
  // Camera pictures: refresh the real ones every second, tick the clock on all of them.
  setInterval(() => {
    const now = new Date().toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit", second: "2-digit" });
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
