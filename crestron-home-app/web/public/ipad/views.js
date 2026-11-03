// Home View screens: pure functions from app state to HTML. homeview.js owns state and events.
import { icon, roomIcon, sceneIcon } from "../icons.js";
import { describeAction, nextRun } from "../shared/automation.js";
import { floorsOf, GATE_TITLES, homeScenes, pct, roomOf, SECURITY_TITLES } from "../shared/model.js";
import { arrivalWidget, averageTemp, climateTile, heatingBody, heatingMode, heatingOff, heatingSummaryWidget, roomClimate, switchTile, temp, zonesWidget } from "./climate.js";
import { sunTimes } from "../shared/sun.js";
import { locale, t, tn } from "../shared/i18n.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const attr = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");

export const isOn = (l) => l.level > 0.005;
export const isOpen = (s) => s.position > 0.02;
export const sourceName = (m) => m.sources.find((s) => s.id === m.sourceId)?.name ?? t("On");
export const roomHref = (id) => `#room-${encodeURIComponent(id)}`;

/** The app a TV is showing ("Netflix"), from its now-playing line; null when it's a channel or an input. */
export const tvApp = (m) => {
  const np = m.nowPlaying;
  if (!np?.title || m.channel) return null;
  return np.artist === "App" || m.apps?.some((a) => a.name === np.title) ? np.title : null;
};
/** What a TV shows: the channel ("Nova"), the app ("Netflix") or the input. */
export function tvTitle(m) {
  if (!m.on) return t("Off");
  if (m.channel) return m.channel.name || t("Channel {n}", { n: m.channel.number });
  return tvApp(m) || m.nowPlaying?.title || sourceName(m);
}
/** One line for what a zone plays: a TV's channel or app, otherwise the track or source. */
export const playingTitle = (m) => (m.kind === "tv" ? tvTitle(m) : m.nowPlaying?.title || sourceName(m));

// Brand-like colors for app tiles; anything else gets a hue from its name.
const APP_COLORS = [
  [/netflix/i, "#e50914", "#8a0410"], [/youtube/i, "#ff3d3d", "#b00020"], [/disney/i, "#1f4fd8", "#0b2a8f"],
  [/prime|amazon/i, "#00a8e1", "#0b5f9e"], [/spotify/i, "#1ed760", "#0a8f4a"], [/apple/i, "#3a3a3c", "#111113"],
  [/max|hbo/i, "#6a3cff", "#2d0d8f"], [/plex/i, "#e5a00d", "#9a6a05"], [/twitch/i, "#9146ff", "#5a1fbd"],
];
export function appColors(name) {
  const hit = APP_COLORS.find(([re]) => re.test(name));
  if (hit) return { a1: hit[1], a2: hit[2] };
  const h = [...String(name)].reduce((x, c) => (x * 31 + c.charCodeAt(0)) % 360, 11);
  return { a1: `hsl(${h} 70% 52%)`, a2: `hsl(${(h + 40) % 360} 75% 36%)` };
}

// ---------- wallpaper ----------

// Three hues per wallpaper: two corners and the floor glow.
const TIME_HUES = { dawn: [24, 336, 205], day: [204, 176, 40], dusk: [22, 300, 252], night: [232, 268, 196] };
const ROOM_HUES = [
  [24, 345, 44], [46, 150, 92], [8, 318, 276], [262, 220, 322],
  [198, 168, 234], [128, 62, 186], [34, 200, 12], [290, 332, 200],
];

export function dayPeriod(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 5 || h >= 20.5) return "night";
  if (h < 8.5) return "dawn";
  if (h < 17) return "day";
  return "dusk";
}

export function roomHues(home, roomId) {
  const i = Math.max(0, home.rooms.findIndex((r) => r.id === roomId));
  return ROOM_HUES[i % ROOM_HUES.length];
}

export function wallpaperHues(app) {
  return app.route.name === "room" ? roomHues(app.home, app.route.arg) : TIME_HUES[dayPeriod()];
}

const roomColor = (home, roomId) => `hsl(${roomHues(home, roomId)[0]} 78% 54%)`;

// ---------- small pieces ----------

// Czech uses the 24-hour clock ("21:05"); English adds a small AM/PM ("9:05 PM").
const fmtTime = (d) => {
  const parts = d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }).split(/[\s\u202f]/);
  return parts.length > 1 ? `${esc(parts[0])}<span class="ampm">${esc(parts.slice(1).join(" "))}</span>` : esc(parts[0]);
};
export const timeHTML = fmtTime;
/** "úterý 3. listopadu" / "Tuesday, November 3". */
export const fmtDate = (d) => d.toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" });
/** Plain clock time for running text: "21:05" / "9:05 PM". */
export const shortTime = (d) => d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });

function greeting(d) {
  const h = d.getHours();
  // After midnight it is still "Good evening" until 5.
  return t(h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening");
}

const SCENE_COLORS = ["var(--orange)", "var(--indigo)", "var(--blue)", "var(--pink)", "var(--purple)", "var(--teal)", "var(--green)", "var(--yellow)"];
const SOURCE_ART = [
  [/apple|tv\b/i, "#3a3a3c", "#8e8e93", "tv"],
  [/spotify/i, "#1ed760", "#0a8f6a", "music"],
  [/cable|sat|dish/i, "#3b6cff", "#6a3bff", "tv"],
  [/radio|fm|tuner/i, "#ff8a3d", "#ff3d77", "music"],
  [/sonos|airplay|music/i, "#ff5f7e", "#b05bff", "music"],
];
/** Artwork colors: the source's own, or colors made from the track title for music. */
export function art(m) {
  const n = sourceName(m);
  let [, a1, a2, ic] = SOURCE_ART.find(([re]) => re.test(n)) ?? [null, "#7a7bff", "#ff5fa2", "music"];
  if (m.kind === "tv") {
    // A TV shows its app's colors, or a channel's blue; the glyph is always a TV.
    const app = tvApp(m);
    ({ a1, a2 } = app ? appColors(app) : m.channel ? { a1: "#3b6cff", a2: "#6a3bff" } : { a1, a2 });
    return { a1, a2, ic: "tv" };
  }
  if (m.nowPlaying?.title && ic === "music") {
    const h = [...m.nowPlaying.title].reduce((x, c) => (x * 31 + c.charCodeAt(0)) % 360, 7);
    a1 = `hsl(${h} 80% 62%)`;
    a2 = `hsl(${(h + 70) % 360} 85% 50%)`;
  }
  return { a1, a2, ic };
}

function statusInfo(app) {
  const { connection, mode, message } = app.status;
  const system = { demo: t("Demo house"), crestronHome: "Crestron Home", customProgram: "Crestron" }[mode] ?? "Crestron";
  if (connection === "connected") return { label: app.transport === "local" ? t("Demo in this browser") : system, dot: "" };
  if (connection === "connecting") return { label: t("Connecting…"), dot: "warn" };
  return { label: message || t("Not connected"), dot: "bad" };
}

function counts(home) {
  return {
    lightsOn: home.lights.filter(isOn).length,
    shadesOpen: home.shades.filter(isOpen).length,
    playing: home.media.filter((m) => m.on),
    unlocked: home.locks.filter((l) => l.locked === false),
  };
}

// ---------- tiles ----------

// Devices someone just changed ("light:l1"), so their tile can play a short animation.
let FLASH = new Set();
export function setFlash(keys) {
  FLASH = keys;
}

export function tile({ kind, id, on, color, iconName, name, state, room, toggleLabel, warn = false, offline = false, v, cls = "" }) {
  const k = `${kind}:${id}`;
  return `<div class="tile cat-${kind}${on ? " on" : ""}${warn ? " warn" : ""}${offline ? " offline" : ""}${FLASH.has(k) ? " flash" : ""}${cls}" style="--c:${color}${v != null ? `;--v:${v.toFixed(3)}` : ""}">
    <button class="tile-icon" type="button" aria-label="${esc(toggleLabel)}"${attr({ act: "toggle", kind, id, key: `t:${k}` })}>${icon(iconName)}</button>
    <button class="tile-body" type="button" aria-label="${esc(t("{name}, {state}. More controls", { name, state }))}"${attr({ act: "detail", kind, id, key: `d:${k}` })}>
      ${room ? `<span class="tile-room">${esc(room)}</span>` : ""}<span class="tile-name">${esc(name)}</span><span class="tile-state">${esc(state)}</span>
    </button>
  </div>`;
}

export function lightState(l) {
  if (l.online === false) return t("No response");
  if (!isOn(l)) return t("Off");
  return l.dimmable ? pct(l.level) : t("On");
}
export function shadeState(s) {
  if (s.position >= 0.98) return t("Open");
  if (s.position <= 0.02) return t("Closed");
  return t("{pct} open", { pct: pct(s.position) });
}
const mediaIcon = (m) => (m.kind === "tv" || /tv|cable|apple/i.test(m.on ? sourceName(m) : m.name) ? "tv" : "speaker");

export function accessoryTiles(home, items, showRoom) {
  const room = (x) => (showRoom ? roomOf(home, x.roomId)?.name ?? "" : "");
  return items.map(([kind, x]) => {
    switch (kind) {
      case "light":
        return tile({ kind, id: x.id, on: isOn(x), color: "var(--yellow)", iconName: "bulb", name: x.name, state: lightState(x), room: room(x),
          toggleLabel: t(isOn(x) ? "{name}: turn off" : "{name}: turn on", { name: x.name }), offline: x.online === false, v: x.dimmable ? x.level : 1 });
      case "shade":
        return tile({ kind, id: x.id, on: isOpen(x), color: "var(--teal)", iconName: "blinds", name: x.name, state: shadeState(x), room: room(x),
          toggleLabel: t(isOpen(x) ? "{name}: close" : "{name}: open", { name: x.name }), offline: x.online === false });
      case "media":
        // A media room is usually named after its room; call it TV or Speakers on the tile instead.
        // A TV's state is what it shows: the channel or the app ("Nova", "Netflix").
        return tile({ kind, id: x.id, on: x.on, color: "var(--purple)", iconName: mediaIcon(x), room: room(x),
          name: roomOf(home, x.roomId)?.name === x.name ? (x.kind === "tv" || /tv|cable|apple/i.test(x.sources.map((s) => s.name).join(" ")) ? t("TV") : t("Speakers")) : x.name,
          state: !x.on ? t("Off") : x.kind === "tv" ? `${tvTitle(x)}${x.muted ? ` · ${t("Muted")}` : ""}` : `${sourceName(x)}${x.hasVolume ? ` · ${x.muted ? t("Muted") : pct(x.volume)}` : ""}`,
          toggleLabel: t(x.on ? "{name}: turn off" : "{name}: turn on", { name: x.name }) });
      case "lock": {
        const unlocked = x.locked === false;
        return tile({ kind, id: x.id, on: x.locked !== null, warn: unlocked, color: unlocked ? "var(--orange)" : "var(--green)",
          iconName: unlocked ? "unlock" : "lock", name: x.name, room: room(x),
          state: x.locked === null ? t("Unknown") : unlocked ? t("Unlocked") : t("Locked"), toggleLabel: t(unlocked ? "Lock {name}" : "Unlock {name}", { name: x.name }) });
      }
      case "climate": return tile(climateTile(home, x, showRoom));
      case "switch": return tile(switchTile(home, x, showRoom));
      default: return "";
    }
  }).join("");
}

export function roomItems(home, roomId) {
  const pick = (list, kind) => list.filter((x) => x.roomId === roomId).map((x) => [kind, x]);
  return [...pick(home.climate, "climate"), ...pick(home.lights, "light"), ...pick(home.shades, "shade"), ...pick(home.media, "media"),
    ...pick(home.locks, "lock"), ...pick(home.switches, "switch")];
}

/** Scene buttons. With `home`, each scene keeps the same color wherever it appears. */
export function sceneTiles(scenes, popId, home = null) {
  return scenes.map((s, i) => `<button type="button" class="tile scene${s.active ? " on" : ""}${popId === s.id ? " pop" : ""}${FLASH.has(`scene:${s.id}`) ? " flash" : ""}" style="--c:${SCENE_COLORS[(home ? Math.max(0, home.scenes.indexOf(s)) : i) % SCENE_COLORS.length]}"${attr({ act: "scene", id: s.id, key: `s:${s.id}` })}>
      <span class="tile-icon" aria-hidden="true">${icon(sceneIcon(s))}</span>
      <span class="tile-body"><span class="tile-name">${esc(s.name)}</span><span class="tile-state">${s.active ? t("Active") : t("Scene")}</span></span>
    </button>`).join("");
}

// ---------- widgets ----------

export function gateControls(g) {
  if (g.state === "moving") {
    return `<div class="moving-bar"><span>${t("Moving…")}</span></div>
      ${g.canStop ? `<div class="w-row"><button type="button" class="w-btn"${attr({ act: "gate", id: g.id, action: "stop", key: `g:${g.id}:stop` })}>${icon("stop")}${t("Stop")}</button></div>` : ""}`;
  }
  if (g.state === "open") {
    return `<div class="w-row"><button type="button" class="w-btn primary"${attr({ act: "gate", id: g.id, action: g.separateOpenClose ? "close" : "trigger", key: `g:${g.id}:close` })}>${icon("closeIn")}${t("Close {name}", { name: esc(g.name) })}</button></div>`;
  }
  // Opening is a deliberate slide all the way across, so a stray tap never opens the gate.
  return `<div class="slide" role="button" tabindex="0" aria-label="${esc(t("Open {name}: slide right, or press Enter", { name: g.name }))}"${attr({ slide: "gate", id: g.id, action: g.separateOpenClose ? "open" : "trigger", key: `g:${g.id}:slide` })}>
      <span class="slide-fill"></span><span class="slide-text">${t("slide to open")}</span><span class="slide-knob">${icon("arrowRight")}</span></div>`;
}

/** A little gate that swings open and shut with the real one. */
function gateArt(g) {
  return `<div class="gate-art ${esc(g.state)}" aria-hidden="true"><span class="post"></span><span class="leaf l"></span><span class="leaf r"></span><span class="post"></span></div>`;
}

function gateWidget(g) {
  return `<div data-tilt class="widget" style="--c:var(--blue)">
    <div class="w-top"><span class="w-glyph">${icon("gate")}</span>
      <div class="w-text"><div class="w-name">${esc(g.name)}</div><div class="w-state">${esc(t(GATE_TITLES[g.state] ?? "Ready"))}</div></div>
      <button type="button" class="w-more" aria-label="${esc(t("{name} controls", { name: g.name }))}"${attr({ act: "detail", kind: "gate", id: g.id })}>${icon("more")}</button></div>
    ${gateArt(g)}
    ${gateControls(g)}
  </div>`;
}

const ALARM_COLOR = { disarmed: "#8e8e93", armedHome: "var(--indigo)", armedAway: "var(--blue)", alarm: "var(--red)", unknown: "#8e8e93" };
function securityWidget(p) {
  const b = (label, ic, mode) => `<button type="button" aria-pressed="${p.mode === mode}"${attr({ act: "arm", id: p.id, mode, key: `a:${p.id}:${mode}` })}>${icon(ic)}${label}</button>`;
  return `<div data-tilt class="widget" style="--c:${ALARM_COLOR[p.mode] ?? ALARM_COLOR.unknown}">
    <div class="w-top"><span class="w-glyph">${icon(p.mode === "disarmed" ? "shield" : p.mode === "alarm" ? "shieldAlert" : "shieldCheck")}</span>
      <div class="w-text"><div class="w-name">${esc(p.name)}</div><div class="w-state${p.mode === "alarm" ? " bad" : ""}">${esc(t(SECURITY_TITLES[p.mode] ?? "Unknown"))}</div></div></div>
    <div class="seg">${p.canArmAway ? b(t("alarm::Away"), "away", "armedAway") : ""}${p.canArmHome ? b(t("alarm::Home"), "home", "armedHome") : ""}${b(t("alarm::Off"), "shield", "disarmed")}</div>
  </div>`;
}

export function hbar(m) {
  return `<div class="hbar" role="slider" tabindex="0" aria-label="${esc(t("{name} volume", { name: m.name }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m.volume * 100)}" style="--v:${m.volume.toFixed(3)}"${attr({ hslider: "volume", id: m.id, key: `hv:${m.id}` })}>
    ${icon("mute")}<span class="hbar-track"><span class="hbar-fill"></span></span>${icon("volume")}</div>`;
}

/** Previous, play or pause, next. */
export function transportRow(m, big = false) {
  const b = (action, ic, label) => `<button type="button" class="tr-btn${action === "play" || action === "pause" ? " main" : ""}" aria-label="${esc(label)}"${attr({ act: "transport", id: m.id, action, key: `tr:${m.id}:${action === "pause" ? "play" : action}` })}>${icon(ic)}</button>`;
  return `<div class="transport${big ? " big" : ""}">${b("previous", "prev", t("Previous"))}${m.playing ? b("pause", "pause", t("Pause")) : b("play", "playFill", t("Play"))}${b("next", "next", t("Next"))}</div>`;
}

export function zoneWidget(home, m, others = []) {
  const room = roomOf(home, m.roomId)?.name ?? m.name;
  if (!m.on) {
    return `<div data-tilt class="widget" style="--c:var(--purple)">
      <div class="w-top"><span class="w-glyph">${icon(mediaIcon(m))}</span>
        <div class="w-text"><div class="w-name">${esc(room)}</div><div class="w-state">${t("Off")}</div></div>
        <button type="button" class="w-more" aria-label="${esc(t(m.canRemote ? "{name} remote" : "{name} controls", { name: m.name }))}"${attr({ act: "detail", kind: "media", id: m.id, key: `d:media:${m.id}` })}>${icon(m.canRemote ? "remote" : "more")}</button></div>
      <div class="w-row"><button type="button" class="w-btn primary"${attr({ act: "toggle", kind: "media", id: m.id })}>${icon("power")}${t("Turn on")}</button></div>
    </div>`;
  }
  const a = art(m);
  const np = m.nowPlaying;
  const title = playingTitle(m);
  // A TV: the show under the channel, the input under an app; music: artist and source.
  const detail = (m.kind === "tv"
    ? [np?.title !== title ? np?.title : null, m.channel ? t("Channel {n}", { n: m.channel.number }) : m.sourceId ? sourceName(m) : null, room]
    : [np?.artist, np ? sourceName(m) : null, room]).filter(Boolean).join(" · ");
  const state = m.muted ? ` · ${t("Muted")}` : m.playing ? `<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>` : ` · ${t("Paused")}`;
  return `<div data-tilt class="widget" style="--c:var(--purple)">
    <div class="np"><span class="art" style="--a1:${a.a1};--a2:${a.a2}">${icon(a.ic)}</span>
      <div class="w-text"><div class="w-state">${esc(title)}</div>
        <div class="w-name">${esc(detail)}${state}</div></div>
      <button type="button" class="w-more" aria-label="${esc(t(m.canRemote ? "{name} remote" : "{name} controls", { name: m.name }))}"${attr({ act: "detail", kind: "media", id: m.id, key: `d:media:${m.id}` })}>${icon(m.canRemote ? "remote" : "more")}</button></div>
    ${m.canTransport ? transportRow(m) : ""}
    ${m.hasVolume ? hbar(m) : ""}
    ${others.length ? `<a class="w-name" href="#media">${t("Also playing in {rooms}", { rooms: esc(others.map((o) => roomOf(home, o.roomId)?.name ?? o.name).join(", ")) })}</a>` : ""}
  </div>`;
}

function nowPlayingWidget(home) {
  const on = home.media.filter((m) => m.on);
  if (on.length) return zoneWidget(home, on[0], on.slice(1));
  if (!home.media.length) return "";
  return `<div data-tilt class="widget" style="--c:var(--purple)">
    <div class="w-top"><span class="w-glyph">${icon("music")}</span>
      <div class="w-text"><div class="w-name">${t("Media")}</div><div class="w-state">${t("Nothing playing")}</div></div></div>
    <div class="w-row">${home.media.slice(0, 2).map((m) => `<button type="button" class="w-btn"${attr({ act: "toggle", kind: "media", id: m.id })}>${icon("power")}${esc(roomOf(home, m.roomId)?.name ?? m.name)}</button>`).join("")}</div>
  </div>`;
}

export function cameraPicture(c, api) {
  return c.demo
    ? `<div class="cam-demo ${esc(c.demo)}"></div>`
    : `<img alt="" data-cam="${esc(c.id)}" src="${esc(api)}cameras/${encodeURIComponent(c.id)}/snapshot?t=${Date.now()}">`;
}

export function cameraTiles(cams, api) {
  const now = new Date().toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return cams.map((c) => `<button type="button" class="cam" aria-label="${esc(t("{name} camera", { name: c.name }))}"${attr({ act: "camera", id: c.id })}>
    ${cameraPicture(c, api)}
    <span class="cam-pill name"><span class="live"></span>${esc(c.name)}</span>
    <span class="cam-pill time" data-cam-time>${now}</span></button>`).join("");
}

// ---------- page frame ----------

export const sec = (title, body, { href, note = "", action = "" } = {}) => `<section class="sec">
    <div class="sec-head">${href ? `<a class="sec-title" href="${href}">${title}${icon("chevron")}</a>` : `<h2 class="sec-title">${title}</h2>`}${note ? `<span class="sec-note">${note}</span>` : ""}${action}</div>
    ${body}
  </section>`;

export function head(app, { eyebrow, title, sub, back, home = false }) {
  const d = new Date();
  return `<header class="head">
    <div class="head-text">
      ${back ? `<a class="back-link" href="${back}">${icon("back")}${t("Home")}</a>` : ""}
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1>${esc(title)}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
    </div>
    <div class="head-side">
      <button type="button" class="round-btn menu-btn" aria-label="${t("Rooms and controls")}" data-act="menu">${icon("grid")}</button>
      <div class="head-clock">${home ? weatherLine(app) : ""}<div class="head-time" data-clock>${fmtTime(d)}</div></div>
      ${home ? `<button type="button" class="round-btn" aria-label="${t("Edit Home")}" data-act="edit-home">${icon("edit")}</button>` : ""}
      ${app.askVisible ? `<button type="button" class="round-btn" aria-label="${t("Ask Home")}" data-act="ask-open"><span class="orb"></span></button>` : ""}
      <button type="button" class="round-btn" aria-label="${t("Settings")}" data-act="settings">${icon("gear")}</button>
    </div>
  </header>`;
}

export function notice(app) {
  const s = app.status;
  if (s.connection === "connected" || !s.message) return "";
  return `<div class="notice">${icon("alert")}<div>${esc(s.message)}</div></div>`;
}

// ---------- sidebar ----------

export function sidebarHTML(app) {
  const h = app.home;
  const st = statusInfo(app);
  const c = counts(h);
  const cur = (name, arg = null) => (app.route.name === name && (arg === null || app.route.arg === arg) ? ' aria-current="page"' : "");
  const item = (href, ic, label, color, count = "", current = "", attn = false) =>
    `<a class="side-item" href="${href}" style="--c:${color}"${current}><span class="si-icon">${icon(ic)}</span><span class="si-name">${esc(label)}</span>${count !== "" ? `<span class="si-count${attn ? " attn" : ""}">${esc(count)}</span>` : ""}</a>`;
  const roomItem = (r) => {
    const on = h.lights.filter((l) => l.roomId === r.id && isOn(l)).length;
    return item(roomHref(r.id), roomIcon(r.name), r.name, roomColor(h, r.id), on ? tn(on, "{n} on", "{n} on") : "", cur("room", r.id));
  };
  // With floors (1.NP, 2.NP…), each floor gets its own heading; otherwise one "Rooms" list.
  const floors = floorsOf(h);
  const rooms = floors.length > 1 || floors[0]?.name
    ? floors.map((f) => `<div class="side-head">${esc(f.name || t("Other"))}</div>${f.rooms.map(roomItem).join("")}`).join("")
    : h.rooms.length ? `<div class="side-head">${t("Rooms")}</div>${h.rooms.map(roomItem).join("")}` : "";
  const avgTemp = averageTemp(h);
  const alarm = h.security[0];
  return `<div class="side-home"><span class="app-glyph">${icon("home")}</span>
      <div><div class="side-title">${esc(app.homeName || t("Home"))}</div><div class="side-sub"><span class="dot ${st.dot}"></span>${esc(st.label)}</div></div></div>
    ${item("#home", "home", t("Home"), "var(--orange)", "", cur("home"))}
    <div class="side-head">${t("Controls")}</div>
    ${h.lights.length ? item("#lights", "bulb", t("Lights"), "var(--yellow)", c.lightsOn ? tn(c.lightsOn, "{n} on", "{n} on") : t("Off"), cur("lights")) : ""}
    ${h.climate.length || h.modes.length || h.switches.length ? item("#heating", "thermo", t("Heating"), "var(--orange)", avgTemp != null ? temp(avgTemp) : "", cur("heating")) : ""}
    ${h.shades.length ? item("#shades", "blinds", t("Shades"), "var(--teal)", c.shadesOpen ? tn(c.shadesOpen, "{n} open", "{n} open") : t("Closed"), cur("shades")) : ""}
    ${h.media.length ? item("#media", "music", t("Media"), "var(--purple)", c.playing.length ? tn(c.playing.length, "{n} playing", "{n} playing") : "", cur("media")) : ""}
    ${h.security.length || h.locks.length || h.gates.length ? item("#security", "shieldCheck", t("Security"), "var(--indigo)",
      c.unlocked.length ? tn(c.unlocked.length, "{n} unlocked", "{n} unlocked") : alarm ? t(SECURITY_TITLES[alarm.mode] ?? "Unknown") : "", cur("security"), c.unlocked.length > 0) : ""}
    ${app.cameras.length ? item("#cameras", "camera", t("Cameras"), "var(--pink)", String(app.cameras.length), cur("cameras")) : ""}
    ${item("#automations", "calendar", t("Automations"), "var(--green)", automationCount(app), cur("automations"))}
    ${rooms}
    <div class="side-foot">
      ${app.askVisible ? `<button type="button" class="side-item side-btn" data-act="ask-open"><span class="orb"></span><span class="si-name">${t("Ask Home")}</span></button>` : ""}
      <button type="button" class="side-item side-btn" data-act="settings" style="--c:#8e8e93"><span class="si-icon">${icon("gear")}</span><span class="si-name">${t("Settings")}</span></button>
    </div>`;
}

// ---------- views ----------

function summary(home) {
  const c = counts(home);
  const parts = [];
  parts.push(c.lightsOn ? tn(c.lightsOn, "{n} light on", "{n} lights on") : t("All lights are off"));
  if (c.unlocked.length) parts.push(tn(c.unlocked.length, "{names} is unlocked", "{names} are unlocked", { names: c.unlocked.map((l) => l.name).join(t(" and ")) }));
  else if (home.locks.length) parts.push(t("Doors locked"));
  if (c.playing.length) parts.push(t("Playing in {rooms}", { rooms: c.playing.map((m) => roomOf(home, m.roomId)?.name ?? m.name).join(t(" and ")) }));
  return parts.join(" · ");
}

function chips(app) {
  const h = app.home;
  const c = counts(h);
  const chip = (href, ic, color, title, val, attn = false) =>
    `<a class="chip${attn ? " attn" : ""}" href="${href}"><span class="chip-icon" style="--c:${color}">${icon(ic)}</span><span><div class="chip-title">${esc(title)}</div><div class="chip-val">${esc(val)}</div></span></a>`;
  const out = [];
  if (h.lights.length) out.push(chip("#lights", "bulb", "var(--yellow)", t("Lights"), c.lightsOn ? tn(c.lightsOn, "{n} on", "{n} on") : t("All off")));
  const avgTemp = averageTemp(h);
  if (avgTemp != null) out.push(chip("#heating", "thermo", heatingOff(h) ? "#8e8e93" : "var(--orange)", t("Heating"), temp(avgTemp)));
  if (h.security.length > 1) {
    const armed = h.security.filter((z) => z.mode === "armedAway" || z.mode === "armedHome").length;
    const alarm = h.security.some((z) => z.mode === "alarm");
    out.push(chip("#security", alarm ? "shieldAlert" : armed ? "shieldCheck" : "shield", alarm ? "var(--red)" : armed ? "var(--indigo)" : "#8e8e93", t("Security"), alarm ? t("Alarm") : t("{a}/{b} armed", { a: armed, b: h.security.length }), alarm));
  } else if (h.security.length) {
    const p = h.security[0];
    out.push(chip("#security", p.mode === "disarmed" ? "shield" : "shieldCheck", ALARM_COLOR[p.mode] ?? ALARM_COLOR.unknown, t("Security"), t(SECURITY_TITLES[p.mode] ?? "Unknown"), p.mode === "alarm"));
  }
  if (h.locks.length) out.push(chip("#security", c.unlocked.length ? "unlock" : "lock", c.unlocked.length ? "var(--orange)" : "var(--green)", t("Doors"), c.unlocked.length ? tn(c.unlocked.length, "{n} unlocked", "{n} unlocked") : t("Locked"), c.unlocked.length > 0));
  if (h.gates.length > 2) {
    const open = h.gates.filter((g) => g.state !== "closed" && g.state !== "unknown").length;
    out.push(chip("#security", "gate", "var(--blue)", t("Gates"), open ? tn(open, "{n} open", "{n} open") : t("Closed"), open > 0));
  } else for (const g of h.gates) out.push(chip("#security", "gate", "var(--blue)", g.name, t(GATE_TITLES[g.state] ?? "Ready"), g.state === "open"));
  if (h.shades.length) out.push(chip("#shades", "blinds", "var(--teal)", t("Shades"), c.shadesOpen ? tn(c.shadesOpen, "{n} open", "{n} open") : t("Closed")));
  if (h.media.length) out.push(chip("#media", "music", "var(--purple)", t("Media"), c.playing.length ? tn(c.playing.length, "{n} playing", "{n} playing") : t("Off")));
  return out.length ? `<nav class="chips" aria-label="${t("House status")}">${out.join("")}</nav>` : "";
}

// ---------- weather ----------

const WEATHER = [
  [[0], "weather::Clear", "sun"], [[1, 2], "Partly cloudy", "cloudSun"], [[3], "Cloudy", "cloud"], [[45, 48], "Fog", "fog"],
  [[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], "Rain", "rain"], [[71, 73, 75, 77, 85, 86], "Snow", "snow"],
  [[95, 96, 99], "Thunderstorms", "storm"],
];

export function weatherInfo(w) {
  let [, text, ic] = WEATHER.find(([codes]) => codes.includes(w.code)) ?? [null, "Weather", "cloud"];
  if (ic === "sun" && !w.isDay) ic = "moon";
  return { text: t(text), ic };
}

function weatherLine(app) {
  const w = app.weather;
  if (!w) return "";
  const info = weatherInfo(w);
  return `<div class="head-weather" title="${esc(info.text)}">${icon(info.ic)}<b>${w.temp}°</b><span>${esc(t("H {high}° · L {low}°", { high: w.high, low: w.low }))}</span></div>`;
}

/** Drawn, gently moving weather: sun, moon, clouds, rain, snow. */
function weatherArt(ic) {
  const clouds = `<span class="wa-cloud c1"></span><span class="wa-cloud c2"></span>`;
  switch (ic) {
    case "sun": return `<span class="wa-sun"></span>`;
    case "moon": return `<span class="wa-moon"></span><span class="wa-stars"><i></i><i></i><i></i></span>`;
    case "cloudSun": return `<span class="wa-sun small"></span><span class="wa-cloud c1"></span>`;
    case "rain": return `${clouds}<span class="wa-drops">${"<i></i>".repeat(6)}</span>`;
    case "snow": return `${clouds}<span class="wa-drops snow">${"<i></i>".repeat(6)}</span>`;
    case "storm": return `${clouds}<span class="wa-bolt"></span><span class="wa-drops">${"<i></i>".repeat(4)}</span>`;
    case "fog": return `<span class="wa-fog"><i></i><i></i><i></i></span>`;
    default: return clouds;
  }
}

function weatherWidget(app) {
  const w = app.weather;
  if (!app.location) {
    return `<div data-tilt class="widget" style="--c:var(--blue)">
      <div class="w-top"><span class="w-glyph">${icon("cloudSun")}</span><div class="w-text"><div class="w-name">${t("Weather")}</div><div class="w-state">${t("Add your town")}</div></div></div>
      <p class="w-note">${t("Weather, sunrise and sunset, and schedules that follow the sun.")}</p>
      <div class="w-row"><button type="button" class="w-btn primary" data-act="settings">${icon("gear")}${t("Set location")}</button></div>
    </div>`;
  }
  const sun = sunTimes(new Date(), app.location.lat, app.location.lon);
  if (!w) {
    return `<div data-tilt class="widget" style="--c:var(--blue)">
      <div class="w-top"><span class="w-glyph">${icon("cloudSun")}</span><div class="w-text"><div class="w-name">${esc(app.location.place)}</div><div class="w-state">${t("Weather is loading…")}</div></div></div>
    </div>`;
  }
  const info = weatherInfo(w);
  return `<div data-tilt class="widget weather${w.isDay ? "" : " night"}" style="--c:${w.isDay ? "var(--orange)" : "var(--indigo)"}">
    <div class="wx-art" aria-hidden="true">${weatherArt(info.ic)}</div>
    <div class="w-top"><span class="w-glyph">${icon(info.ic)}</span><div class="w-text"><div class="w-name">${esc(app.location.place)}</div><div class="w-state">${esc(info.text)}</div></div></div>
    <div class="wx-row"><span class="wx-temp">${w.temp}°</span><span class="wx-range">${esc(t("H {high}°", { high: w.high }))}<br>${esc(t("L {low}°", { low: w.low }))}</span></div>
    ${sun ? `<div class="wx-sun"><span>${icon("sunrise")}${esc(t("Sunrise {time}", { time: shortTime(sun.sunrise) }))}</span><span>${icon("moon")}${esc(t("Sunset {time}", { time: shortTime(sun.sunset) }))}</span></div>` : ""}
  </div>`;
}

// ---------- favorites ----------

const LISTS = { light: "lights", shade: "shades", media: "media", lock: "locks", scene: "scenes" };

/** The favorites that still exist, in the order they were added: [kind, item]. */
export function favoriteItems(app) {
  return app.favorites.map((key) => {
    const i = key.indexOf(":");
    const kind = key.slice(0, i);
    const item = app.home[LISTS[kind]]?.find((x) => x.id === key.slice(i + 1));
    return item ? [kind, item] : null;
  }).filter(Boolean);
}

function favoritesSection(app) {
  const items = favoriteItems(app);
  const edit = `<button type="button" class="text-btn" data-act="pick-favorites">${items.length ? t("Edit") : ""}</button>`;
  if (!items.length) {
    return sec(t("Favorites"), `<div class="empty-row">${icon("star")}<div><b>${t("Add your favorites")}</b><span>${t("Tap the star on any light, shade, music room or scene, or choose them here.")}</span></div>
      <button type="button" class="capsule" data-act="pick-favorites">${icon("plus")}${t("Choose")}</button></div>`);
  }
  const tiles = items.map(([kind, item]) => (kind === "scene" ? sceneTiles([item], app.pop, app.home) : accessoryTiles(app.home, [[kind, item]], true))).join("");
  return sec(t("Favorites"), `<div class="tiles">${tiles}</div>`, { action: edit });
}

// ---------- coming up ----------

function whenText(at, now = new Date()) {
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day - today) / 86400000);
  const name = diff === 0 ? t("Today") : diff === 1 ? t("Tomorrow") : at.toLocaleDateString(locale(), { weekday: "long" });
  return `${name} ${shortTime(at)}`;
}

export function minutesLeft(at) {
  const m = Math.max(1, Math.round((at - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
}

export function automationCount(app) {
  const n = app.automations.schedules.filter((x) => x.enabled).length + app.automations.timers.length;
  return n ? String(n) : "";
}

export function upcomingItems(app, limit = 4) {
  const now = new Date();
  const items = [];
  for (const timer of app.automations.timers) {
    items.push({ at: timer.at, ic: "timer", title: timer.label, when: t("in {time}", { time: minutesLeft(timer.at) }), timerId: timer.id });
  }
  for (const s of app.automations.schedules) {
    const at = nextRun(s, now, app.location);
    if (at) items.push({ at: at.getTime(), ic: "calendar", title: s.name, when: whenText(at, now), detail: s.actions.map((x) => describeAction(x, app.home)).join(", ") });
  }
  return items.sort((x, y) => x.at - y.at).slice(0, limit);
}

export function upcomingRows(items) {
  return items.map((it) => `<div class="up-row"><span class="up-icon">${icon(it.ic)}</span>
      <div class="up-text"><b>${esc(it.title)}</b><span>${esc(it.when)}${it.detail ? ` · ${esc(it.detail)}` : ""}</span></div>
      ${it.timerId ? `<button type="button" class="up-x" aria-label="${esc(t("Cancel {name}", { name: it.title }))}"${attr({ act: "timer-cancel", id: it.timerId })}>${icon("close")}</button>` : ""}
    </div>`).join("");
}

function upcomingSection(app) {
  const items = upcomingItems(app);
  const vacation = app.automations.vacation.enabled ? `<span class="badge">${icon("suitcase")}${t("Vacation mode on")}</span>` : "";
  if (!items.length) {
    return sec(t("Coming up"), `<div class="empty-row">${icon("calendar")}<div><b>${t("Nothing scheduled")}</b><span>${t("Make lights and shades follow a schedule, or set a timer from any light.")}</span></div>
      <a class="capsule" href="#automations">${icon("plus")}${t("New schedule")}</a></div>`, { href: "#automations", action: vacation });
  }
  return sec(t("Coming up"), `<div class="upcoming">${upcomingRows(items)}</div>`, { href: "#automations", action: vacation });
}

// ---------- home: the parts people can add, remove and reorder ----------

// Names and descriptions are English keys; show them with t(p.name) and t(p.about).
export const HOME_PARTS = [
  { id: "status", name: "Status bar", about: "Lights, doors, alarm and gate at a glance", icon: "grid" },
  { id: "weather", name: "Weather", about: "Today's weather, sunrise and sunset", icon: "cloudSun", widget: true },
  { id: "gate", name: "Gate", about: "Slide to open, close and stop", icon: "gate", widget: true },
  { id: "alarm", name: "part::Alarm", about: "Arm away, arm home or turn off", icon: "shield", widget: true },
  { id: "heating", name: "Heating", about: "Temperature, heating mode and the sauna", icon: "thermo", widget: true },
  { id: "music", name: "Now Playing", about: "What's playing, with play, pause and volume", icon: "music", widget: true },
  { id: "favorites", name: "Favorites", about: "Your most-used lights, shades and scenes", icon: "star" },
  { id: "scenes", name: "Scenes", about: "Whole-house scenes like Good Night", icon: "sparkle" },
  { id: "upcoming", name: "Coming up", about: "Next schedules and running timers", icon: "clock" },
  { id: "cameras", name: "Cameras", about: "Live pictures from your cameras", icon: "camera" },
  { id: "rooms", name: "Rooms", about: "Every room with its lights, shades and music", icon: "home" },
];
export const DEFAULT_LAYOUT = HOME_PARTS.map((p) => p.id);

function roomsPart(app) {
  const h = app.home;
  const rooms = h.rooms.map((r) => {
    const items = roomItems(h, r.id);
    return items.length ? sec(esc(r.name), `<div class="tiles">${accessoryTiles(h, items, false)}</div>`, { href: roomHref(r.id) }) : "";
  }).join("");
  const loose = (list, kind) => list.filter((x) => !roomOf(h, x.roomId)).map((x) => [kind, x]);
  const looseItems = [...loose(h.lights, "light"), ...loose(h.shades, "shade"), ...loose(h.media, "media"), ...loose(h.locks, "lock")];
  return rooms + (looseItems.length ? sec(t("Other"), `<div class="tiles">${accessoryTiles(h, looseItems, false)}</div>`) : "");
}

const PART_HTML = {
  status: (app) => chips(app),
  weather: (app) => weatherWidget(app),
  gate: (app) => (app.home.gates.length > 1 ? arrivalWidget(app.home) : app.home.gates.map(gateWidget).join("")),
  alarm: (app) => (app.home.security.length > 1 ? zonesWidget(app.home) : app.home.security.slice(0, 1).map(securityWidget).join("")),
  heating: (app) => heatingSummaryWidget(app.home),
  music: (app) => nowPlayingWidget(app.home),
  favorites: (app) => favoritesSection(app),
  scenes: (app) => {
    const scenes = homeScenes(app.home);
    return scenes.length ? sec(t("Scenes"), `<div class="tiles">${sceneTiles(scenes, app.pop, app.home)}</div>`) : "";
  },
  upcoming: (app) => upcomingSection(app),
  cameras: (app) => (app.cameras.length ? sec(t("Cameras"), `<div class="cams">${cameraTiles(app.cameras.slice(0, 2), app.api)}</div>`, { href: "#cameras" }) : ""),
  rooms: roomsPart,
};

/** The Home overview: the parts chosen in Edit Home, in their order. */
function overviewBody(app) {
  const h = app.home;
  const nothing = !h.rooms.length && !h.lights.length && !h.scenes.length;
  // Widgets that sit next to each other in the layout share one row.
  let body = "";
  let widgets = [];
  const flush = () => {
    if (widgets.length) body += `<div class="widgets">${widgets.join("")}</div>`;
    widgets = [];
  };
  for (const id of app.layout) {
    const part = HOME_PARTS.find((p) => p.id === id);
    const html = part && PART_HTML[id](app);
    if (!html) continue;
    if (part.widget) widgets.push(html);
    else {
      flush();
      body += html;
    }
  }
  flush();
  return `${body}
    ${nothing ? `<div class="empty">${icon("home")}<b>${t("No devices yet")}</b><span>${t("Open Settings to connect your Crestron system.")}</span></div>` : ""}
    <div class="edit-row"><button type="button" class="capsule" data-act="edit-home">${icon("edit")}${t("Edit Home")}</button></div>`;
}

// ---------- rooms page: a big card per room ----------

function roomStats(app, roomId) {
  const h = app.home;
  const lights = h.lights.filter((l) => l.roomId === roomId);
  return {
    lights,
    on: lights.filter(isOn),
    avg: lights.length ? lights.reduce((sum, l) => sum + l.level, 0) / lights.length : 0,
    shades: h.shades.filter((x) => x.roomId === roomId),
    media: h.media.filter((m) => m.roomId === roomId),
    locks: h.locks.filter((l) => l.roomId === roomId),
    climate: roomClimate(h, roomId),
  };
}

const badge = (ic, text, attn = false) => `<span class="rc-badge${attn ? " attn" : ""}">${icon(ic)}${esc(text)}</span>`;

function roomCard(app, r) {
  const st = roomStats(app, r.id);
  const [h1, h2] = roomHues(app.home, r.id);
  const photo = app.photoURL(r.id);
  const playing = st.media.find((m) => m.on);
  const status = [st.lights.length ? (st.on.length ? t("{on} of {total} lights on", { on: st.on.length, total: st.lights.length }) : t("Lights off")) : "",
    playing ? t("Playing {what}", { what: playingTitle(playing) }) : ""].filter(Boolean).join(" · ") || t("Nothing on");
  const open = st.shades.filter(isOpen).length;
  const unlocked = st.locks.filter((l) => l.locked === false).length;
  return `<article class="room-card${st.on.length ? " lit" : ""}" style="--rh1:${h1};--rh2:${h2};--glow:${st.avg.toFixed(2)}" data-tilt>
    <div class="rc-bg${photo ? " photo" : ""}"${photo ? ` style="background-image:url('${esc(photo)}')"` : ""}></div>
    <div class="rc-glow"></div>
    <a class="rc-link" href="${roomHref(r.id)}" aria-label="${esc(`${r.name}: ${status}`)}"></a>
    <div class="rc-top"><span class="rc-icon">${icon(roomIcon(r.name))}</span>
      ${st.lights.length ? `<button type="button" class="rc-quick${st.on.length ? " on" : ""}" aria-label="${esc(t(st.on.length ? "{name}: lights off" : "{name}: lights on", { name: r.name }))}"${attr({ act: "room-lights", id: r.id, level: st.on.length ? 0 : 1, key: `rq:${r.id}` })}>${icon(st.on.length ? "bulb" : "bulbOff")}</button>` : ""}</div>
    <div class="rc-bottom"><b>${esc(r.name)}</b><span>${esc(status)}</span>
      <div class="rc-badges">${st.climate ? badge(st.climate.heating ? "flame" : "thermo", temp(st.climate.current), false) : ""}${st.shades.length ? badge("blinds", open ? tn(open, "{n} open", "{n} open") : t("Closed")) : ""}${playing ? badge(playing.kind === "tv" ? "tv" : "music", playing.kind === "tv" ? tvTitle(playing) : sourceName(playing)) : ""}${st.locks.length ? badge(unlocked ? "unlock" : "lock", unlocked ? t("Unlocked") : t("Locked"), unlocked > 0) : ""}</div></div>
  </article>`;
}

function roomsPage(app) {
  const h = app.home;
  return `<div class="quick">
      ${h.lights.length ? `<button type="button" class="capsule" data-act="all-lights" data-level="0">${icon("bulbOff")}${t("All lights off")}</button>` : ""}
      ${h.shades.length ? `<button type="button" class="capsule" data-act="all-shades" data-position="0">${icon("down")}${t("Close all shades")}</button>` : ""}
      ${h.media.some((m) => m.on) ? `<button type="button" class="capsule" data-act="all-media-off">${icon("power")}${t("All music off")}</button>` : ""}
    </div>
    ${floorsOf(h).map((f) => `${f.name ? `<h2 class="floor-head">${esc(f.name)}</h2>` : ""}<div class="room-cards">${f.rooms.map((r) => roomCard(app, r)).join("")}</div>`).join("")}`;
}

// ---------- Home: pages you swipe between ----------

// Page names are English keys; show them with t(p.name).
export const HOME_PAGES = [
  { id: "overview", name: "Home", icon: "home", html: overviewBody },
  { id: "rooms", name: "Rooms", icon: "grid", html: roomsPage, show: (app) => app.home.rooms.length > 0 },
  { id: "heating", name: "Heating", icon: "thermo", html: (app) => heatingBody(app, tile), show: (app) => app.home.climate.length + app.home.modes.length + app.home.switches.length > 0 },
  { id: "security", name: "Security", icon: "shieldCheck", html: (app) => securityBody(app), show: (app) => app.home.security.length + app.home.locks.length + app.home.gates.length > 0 },
  { id: "music", name: "Music", icon: "music", html: (app) => mediaBody(app), show: (app) => app.home.media.length > 0 },
  { id: "cameras", name: "Cameras", icon: "camera", html: (app) => camerasBody(app), show: (app) => app.cameras.length > 0 },
];

export const homePages = (app) => HOME_PAGES.filter((p) => !p.show || p.show(app));

function homeView(app) {
  const h = app.home;
  const d = new Date();
  const pages = homePages(app);
  const index = Math.max(0, Math.min(app.homePage ?? 0, pages.length - 1));
  const nothing = !h.rooms.length && !h.lights.length && !h.scenes.length;
  return `<div class="paged">
    ${head(app, { eyebrow: fmtDate(d), title: greeting(d), sub: nothing ? "" : summary(h), home: true })}
    ${notice(app)}
    <nav class="page-tabs" role="tablist" aria-label="${t("Home pages")}">${pages.map((p, i) => `<button type="button" role="tab" aria-selected="${i === index}"${attr({ act: "home-page", i, key: `hp:${p.id}` })}>${icon(p.icon)}<span>${t(p.name)}</span></button>`).join("")}</nav>
    <div class="pager" id="pager">${pages.map((p, i) => `<section class="page" role="tabpanel" aria-label="${t(p.name)}"${attr({ page: i })}>${p.html(app)}</section>`).join("")}</div>
    <div class="page-dots" aria-hidden="true">${pages.map((p, i) => `<i class="${i === index ? "on" : ""}"></i>`).join("")}</div>
  </div>`;
}

function roomView(app) {
  const h = app.home;
  const room = roomOf(h, app.route.arg);
  if (!room) return homeView(app);
  const lights = h.lights.filter((l) => l.roomId === room.id);
  const shades = h.shades.filter((s) => s.roomId === room.id);
  const media = h.media.filter((m) => m.roomId === room.id);
  const scenes = h.scenes.filter((s) => s.roomId === room.id);
  const items = roomItems(h, room.id).filter(([k]) => k !== "media");
  const on = lights.filter(isOn).length;
  const sub = [lights.length ? (on ? t("{on} of {total} lights on", { on, total: lights.length }) : t("Lights off")) : "", ...media.filter((m) => m.on).map((m) => t("Playing {what}", { what: m.kind === "tv" ? tvTitle(m) : sourceName(m) }))].filter(Boolean).join(" · ");
  const eyebrow = [lights.length && tn(lights.length, "{n} light", "{n} lights"), shades.length && tn(shades.length, "{n} shade", "{n} shades"), media.length && t("media")].filter(Boolean).join(" · ") || t("Room");
  const quick = [
    lights.length ? `<button type="button" class="capsule"${attr({ act: "room-lights", id: room.id, level: on ? 0 : 1 })}>${icon(on ? "bulbOff" : "bulb")}${on ? t("action::Lights off") : t("action::Lights on")}</button>` : "",
    shades.length ? `<button type="button" class="capsule"${attr({ act: "room-shades", id: room.id, position: 1 })}>${icon("up")}${t("Open shades")}</button>
      <button type="button" class="capsule"${attr({ act: "room-shades", id: room.id, position: 0 })}>${icon("down")}${t("Close shades")}</button>` : "",
    // The room's photo becomes its background. A label opens the file picker without script.
    `<label class="capsule">${icon("camera")}${app.photoURL(room.id) ? t("Change photo") : t("Room photo")}<input type="file" accept="image/*" hidden${attr({ "photo-room": room.id })}></label>`,
    app.photoURL(room.id) ? `<button type="button" class="capsule"${attr({ act: "photo-remove", id: room.id })}>${icon("close")}${t("Remove photo")}</button>` : "",
  ].join("");
  const st = roomStats(app, room.id);
  const [h1, h2] = roomHues(h, room.id);
  const photo = app.photoURL(room.id);
  const playing = media.find((m) => m.on);
  const anyUnlocked = st.locks.some((l) => l.locked === false);
  const stat = (ic, color, label, value) => `<div class="hero-stat" style="--c:${color}"><span class="hs-icon">${icon(ic)}</span><span class="hs-text"><span>${label}</span><b>${esc(value)}</b></span></div>`;
  const hero = `<div class="room-hero${st.on.length ? " lit" : ""}" style="--rh1:${h1};--rh2:${h2};--glow:${st.avg.toFixed(2)}">
      <div class="rc-bg${photo ? " photo" : ""}"${photo ? ` style="background-image:url('${esc(photo)}')"` : ""}></div><div class="rc-glow"></div>
      <div class="hero-stats">
        ${st.climate ? stat(st.climate.heating ? "flame" : "thermo", "var(--orange)", t("Temperature"), temp(st.climate.current)) : ""}
        ${lights.length ? stat("bulb", "var(--yellow)", t("Lights"), on ? `${tn(on, "{n} on", "{n} on")} · ${pct(st.avg)}` : t("Off")) : ""}
        ${shades.length ? stat("blinds", "var(--teal)", t("Shades"), shades.filter(isOpen).length ? tn(shades.filter(isOpen).length, "{n} open", "{n} open") : t("Closed")) : ""}
        ${media.length ? stat(playing?.kind === "tv" ? "tv" : "music", "var(--purple)", playing?.kind === "tv" ? t("TV") : t("Music"), playing ? playingTitle(playing) : t("Off")) : ""}
        ${st.locks.length ? stat(anyUnlocked ? "unlock" : "lock", anyUnlocked ? "var(--orange)" : "var(--green)", t("Door"), anyUnlocked ? t("Unlocked") : t("Locked")) : ""}
      </div>
      ${quick ? `<div class="quick">${quick}</div>` : ""}
    </div>`;
  return `${head(app, { eyebrow, title: room.name, sub, back: "#home" })}
    ${notice(app)}
    ${hero}
    ${scenes.length ? sec(t("Scenes"), `<div class="tiles">${sceneTiles(scenes, app.pop)}</div>`) : ""}
    ${media.length ? sec(t("Media"), `<div class="widgets">${media.map((m) => zoneWidget(h, m)).join("")}</div>`) : ""}
    ${items.length ? sec(t("Accessories"), `<div class="tiles">${accessoryTiles(h, items, false)}</div>`) : ""}
    ${!items.length && !media.length && !scenes.length ? `<div class="empty">${icon(roomIcon(room.name))}<b>${t("Nothing here yet")}</b><span>${t("This room has no lights, shades or media.")}</span></div>` : ""}`;
}

function byRoom(home, list, kind) {
  const groups = new Map();
  for (const x of list) {
    const key = roomOf(home, x.roomId)?.id ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([kind, x]);
  }
  return [...groups].map(([roomId, items]) => sec(esc(roomOf(home, roomId)?.name ?? t("Other")), `<div class="tiles">${accessoryTiles(home, items, false)}</div>`, { href: roomId ? roomHref(roomId) : null })).join("");
}

function lightsView(app) {
  const h = app.home;
  const on = h.lights.filter(isOn).length;
  return `${head(app, { eyebrow: t("Lights"), title: on ? tn(on, "{n} light is on", "{n} lights are on") : t("All lights are off"),
    sub: t("{lights} in {rooms}", { lights: tn(h.lights.length, "{n} light", "{n} lights"), rooms: tn(h.rooms.length, "{n} room", "{n} rooms") }) })}
    <div class="quick"><button type="button" class="capsule" data-act="all-lights" data-level="0">${icon("bulbOff")}${t("Turn all off")}</button>
      <button type="button" class="capsule" data-act="all-lights" data-level="1">${icon("bulb")}${t("Turn all on")}</button></div>
    ${byRoom(h, h.lights, "light") || `<div class="empty">${icon("bulb")}<b>${t("No lights")}</b></div>`}`;
}

function shadesView(app) {
  const h = app.home;
  const open = h.shades.filter(isOpen).length;
  return `${head(app, { eyebrow: t("Shades"), title: open ? tn(open, "{n} shade is open", "{n} shades are open") : t("All shades are closed"), sub: tn(h.shades.length, "{n} shade", "{n} shades") })}
    <div class="quick"><button type="button" class="capsule" data-act="all-shades" data-position="1">${icon("up")}${t("Open all")}</button>
      <button type="button" class="capsule" data-act="all-shades" data-position="0">${icon("down")}${t("Close all")}</button></div>
    ${byRoom(h, h.shades, "shade") || `<div class="empty">${icon("blinds")}<b>${t("No shades")}</b></div>`}`;
}

function mediaView(app) {
  const playing = app.home.media.filter((m) => m.on).length;
  return `${head(app, { eyebrow: t("Media"), title: playing ? tn(playing, "Playing in {n} room", "Playing in {n} rooms") : t("Nothing playing"), sub: "" })}
    ${mediaBody(app)}`;
}

function mediaBody(app) {
  const h = app.home;
  const lead = h.media.find((m) => m.on && m.sourceId);
  return `${lead && h.media.length > 1 ? `<div class="quick"><button type="button" class="capsule"${attr({ act: "play-everywhere", id: lead.id })}>${icon("speakers")}${t("Play {source} everywhere", { source: esc(sourceName(lead)) })}</button>
      <button type="button" class="capsule" data-act="all-media-off">${icon("power")}${t("Turn all off")}</button></div>` : ""}
    ${h.media.length ? `<div class="widgets">${h.media.map((m) => zoneWidget(h, m)).join("")}</div>` : `<div class="empty">${icon("music")}<b>${t("No media rooms")}</b></div>`}`;
}

function securityView(app) {
  const h = app.home;
  const unlocked = h.locks.filter((l) => l.locked === false).length;
  const armed = h.security.filter((z) => z.mode === "armedAway" || z.mode === "armedHome").length;
  return `${head(app, { eyebrow: t("Security"), title: unlocked ? tn(unlocked, "{n} door is unlocked", "{n} doors are unlocked") : h.locks.length ? t("Everything is locked") : t("Security"),
    sub: h.security.length > 1 ? t("{a}/{b} zones armed", { a: armed, b: h.security.length }) : h.security[0] ? t("Alarm: {mode}", { mode: t(SECURITY_TITLES[h.security[0].mode] ?? "Unknown") }) : "" })}
    ${securityBody(app)}`;
}

function securityBody(app) {
  const h = app.home;
  const widgets = [
    ...(h.security.length > 1 ? [zonesWidget(h)] : h.security.map(securityWidget)),
    ...(h.gates.length > 1 ? [arrivalWidget(h)] : h.gates.map(gateWidget)),
  ];
  return `${widgets.length ? `<div class="widgets">${widgets.join("")}</div>` : ""}
    ${h.locks.length ? sec(t("Doors"), `<div class="tiles">${accessoryTiles(h, h.locks.map((l) => ["lock", l]), true)}</div>`) : ""}
    ${app.cameras.length ? sec(t("Cameras"), `<div class="cams">${cameraTiles(app.cameras, app.api)}</div>`) : ""}
    ${!widgets.length && !h.locks.length ? `<div class="empty">${icon("shield")}<b>${t("No security devices")}</b></div>` : ""}`;
}

function heatingView(app) {
  const h = app.home;
  const avg = averageTemp(h);
  const m = heatingMode(h);
  return `${head(app, { eyebrow: t("Heating"), title: avg != null ? temp(avg) : t("Heating"), sub: m ? `${m.name}: ${m.options.find((o) => o.id === m.value)?.name ?? ""}` : "" })}
    ${heatingBody(app, tile)}`;
}

function camerasView(app) {
  return `${head(app, { eyebrow: t("Cameras"), title: t("Cameras"), sub: app.cameras.length ? t("{n} live", { n: app.cameras.length }) : "" })}
    ${camerasBody(app)}`;
}

function camerasBody(app) {
  return `${app.cameras.length ? `<div class="quick"><button type="button" class="capsule" data-act="camera-wall">${icon("wall")}${t("Camera wall")}</button></div>` : ""}
    ${app.cameras.length ? `<div class="cams">${cameraTiles(app.cameras, app.api)}</div>` : `<div class="empty">${icon("camera")}<b>${t("No cameras yet")}</b><span>${t("Add them in Settings › System setup › Cameras.")}</span></div>`}`;
}

const VIEWS = { home: homeView, room: roomView, heating: heatingView, lights: lightsView, shades: shadesView, media: mediaView, security: securityView, cameras: camerasView };

/** Lets other modules add pages (Automations). */
export function registerView(name, render) {
  VIEWS[name] = render;
}

export function viewHTML(app) {
  return (VIEWS[app.route.name] ?? homeView)(app);
}

// ---------- StandBy ----------

export function standbyHTML(app) {
  const d = new Date();
  const h = app.home;
  const c = counts(h);
  const glance = [];
  glance.push(`<span>${icon("bulb")}${c.lightsOn ? tn(c.lightsOn, "{n} light on", "{n} lights on") : t("Lights off")}</span>`);
  if (h.locks.length) glance.push(`<span class="${c.unlocked.length ? "attn" : ""}">${icon(c.unlocked.length ? "unlock" : "lock")}${c.unlocked.length ? tn(c.unlocked.length, "{n} unlocked", "{n} unlocked") : t("Locked")}</span>`);
  for (const g of h.gates) glance.push(`<span class="${g.state === "open" ? "attn" : ""}">${icon("gate")}${t("{name} {state}", { name: esc(g.name), state: esc(t(GATE_TITLES[g.state] ?? "Ready").toLowerCase()) })}</span>`);
  const avgTemp = averageTemp(h);
  if (avgTemp != null) glance.push(`<span>${icon("thermo")}${esc(temp(avgTemp))}</span>`);
  if (h.security[0]) glance.push(`<span>${icon("shield")}${esc(t(SECURITY_TITLES[h.security[0].mode] ?? "Unknown"))}</span>`);
  // The big clock never shows AM/PM; Czech is 24-hour anyway.
  const clock = d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }).replace(/[\s\u202f]?[AP]M$/i, "");
  return `<div class="sb-inner"><div class="sb-date">${esc(fmtDate(d))}</div><div class="sb-clock">${esc(clock)}</div><div class="sb-glance">${glance.join("")}</div></div>`;
}
