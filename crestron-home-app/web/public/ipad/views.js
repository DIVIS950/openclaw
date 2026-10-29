// Home View screens: pure functions from app state to HTML. homeview.js owns state and events.
import { icon, roomIcon, sceneIcon } from "../icons.js";
import { GATE_TITLES, homeScenes, pct, roomOf, SECURITY_TITLES } from "../shared/model.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const attr = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");

export const isOn = (l) => l.level > 0.005;
export const isOpen = (s) => s.position > 0.02;
export const sourceName = (m) => m.sources.find((s) => s.id === m.sourceId)?.name ?? "On";
export const roomHref = (id) => `#room-${encodeURIComponent(id)}`;

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

const fmtTime = (d) => {
  const parts = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).split(" ");
  return parts.length > 1 ? `${esc(parts[0])}<span class="ampm">${esc(parts.slice(1).join(" "))}</span>` : esc(parts[0]);
};
export const timeHTML = fmtTime;
export const fmtDate = (d) => d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

function greeting(d) {
  const h = d.getHours();
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening";
}

const SCENE_COLORS = ["var(--orange)", "var(--indigo)", "var(--blue)", "var(--pink)", "var(--purple)", "var(--teal)", "var(--green)", "var(--yellow)"];
const SOURCE_ART = [
  [/apple|tv\b/i, "#3a3a3c", "#8e8e93", "tv"],
  [/spotify/i, "#1ed760", "#0a8f6a", "music"],
  [/cable|sat|dish/i, "#3b6cff", "#6a3bff", "tv"],
  [/radio|fm|tuner/i, "#ff8a3d", "#ff3d77", "music"],
  [/sonos|airplay|music/i, "#ff5f7e", "#b05bff", "music"],
];
function art(m) {
  const n = sourceName(m);
  const [, a1, a2, ic] = SOURCE_ART.find(([re]) => re.test(n)) ?? [null, "#7a7bff", "#ff5fa2", "music"];
  return { a1, a2, ic };
}

function statusInfo(app) {
  const { connection, mode, message } = app.status;
  const system = { demo: "Demo house", crestronHome: "Crestron Home", customProgram: "Crestron" }[mode] ?? "Crestron";
  if (connection === "connected") return { label: app.transport === "local" ? "Demo in this browser" : system, dot: "" };
  if (connection === "connecting") return { label: "Connecting…", dot: "warn" };
  return { label: message || "Not connected", dot: "bad" };
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

function tile({ kind, id, on, color, iconName, name, state, room, toggleLabel, warn = false, offline = false, v, cls = "" }) {
  const k = `${kind}:${id}`;
  return `<div class="tile cat-${kind}${on ? " on" : ""}${warn ? " warn" : ""}${offline ? " offline" : ""}${cls}" style="--c:${color}${v != null ? `;--v:${v.toFixed(3)}` : ""}">
    <button class="tile-icon" type="button" aria-label="${esc(toggleLabel)}"${attr({ act: "toggle", kind, id, key: `t:${k}` })}>${icon(iconName)}</button>
    <button class="tile-body" type="button" aria-label="${esc(`${name}, ${state}. More controls`)}"${attr({ act: "detail", kind, id, key: `d:${k}` })}>
      ${room ? `<span class="tile-room">${esc(room)}</span>` : ""}<span class="tile-name">${esc(name)}</span><span class="tile-state">${esc(state)}</span>
    </button>
  </div>`;
}

export function lightState(l) {
  if (l.online === false) return "No response";
  if (!isOn(l)) return "Off";
  return l.dimmable ? pct(l.level) : "On";
}
export function shadeState(s) {
  if (s.position >= 0.98) return "Open";
  if (s.position <= 0.02) return "Closed";
  return `${pct(s.position)} open`;
}
const mediaIcon = (m) => (/tv|cable|apple/i.test(m.on ? sourceName(m) : m.name) ? "tv" : "speaker");

function accessoryTiles(home, items, showRoom) {
  const room = (x) => (showRoom ? roomOf(home, x.roomId)?.name ?? "" : "");
  return items.map(([kind, x]) => {
    switch (kind) {
      case "light":
        return tile({ kind, id: x.id, on: isOn(x), color: "var(--yellow)", iconName: "bulb", name: x.name, state: lightState(x), room: room(x),
          toggleLabel: `${x.name}: turn ${isOn(x) ? "off" : "on"}`, offline: x.online === false, v: x.dimmable ? x.level : 1 });
      case "shade":
        return tile({ kind, id: x.id, on: isOpen(x), color: "var(--teal)", iconName: "blinds", name: x.name, state: shadeState(x), room: room(x),
          toggleLabel: `${x.name}: ${isOpen(x) ? "close" : "open"}`, offline: x.online === false });
      case "media":
        // A media room is usually named after its room; call it TV or Speakers on the tile instead.
        return tile({ kind, id: x.id, on: x.on, color: "var(--purple)", iconName: mediaIcon(x), room: room(x),
          name: roomOf(home, x.roomId)?.name === x.name ? (/tv|cable|apple/i.test(x.sources.map((s) => s.name).join(" ")) ? "TV" : "Speakers") : x.name,
          state: x.on ? `${sourceName(x)}${x.hasVolume ? ` · ${x.muted ? "Muted" : pct(x.volume)}` : ""}` : "Off",
          toggleLabel: `${x.name}: turn ${x.on ? "off" : "on"}` });
      case "lock": {
        const unlocked = x.locked === false;
        return tile({ kind, id: x.id, on: x.locked !== null, warn: unlocked, color: unlocked ? "var(--orange)" : "var(--green)",
          iconName: unlocked ? "unlock" : "lock", name: x.name, room: room(x),
          state: x.locked === null ? "Unknown" : unlocked ? "Unlocked" : "Locked", toggleLabel: unlocked ? `Lock ${x.name}` : `Unlock ${x.name}` });
      }
      default: return "";
    }
  }).join("");
}

function roomItems(home, roomId) {
  const pick = (list, kind) => list.filter((x) => x.roomId === roomId).map((x) => [kind, x]);
  return [...pick(home.lights, "light"), ...pick(home.shades, "shade"), ...pick(home.media, "media"), ...pick(home.locks, "lock")];
}

function sceneTiles(scenes, popId) {
  return scenes.map((s, i) => `<button type="button" class="tile scene${s.active ? " on" : ""}${popId === s.id ? " pop" : ""}" style="--c:${SCENE_COLORS[i % SCENE_COLORS.length]}"${attr({ act: "scene", id: s.id, key: `s:${s.id}` })}>
      <span class="tile-icon" aria-hidden="true">${icon(sceneIcon(s))}</span>
      <span class="tile-body"><span class="tile-name">${esc(s.name)}</span><span class="tile-state">${s.active ? "Active" : "Scene"}</span></span>
    </button>`).join("");
}

// ---------- widgets ----------

export function gateControls(g) {
  if (g.state === "moving") {
    return `<div class="moving-bar"><span>Moving…</span></div>
      ${g.canStop ? `<div class="w-row"><button type="button" class="w-btn"${attr({ act: "gate", id: g.id, action: "stop", key: `g:${g.id}:stop` })}>${icon("stop")}Stop</button></div>` : ""}`;
  }
  if (g.state === "open") {
    return `<div class="w-row"><button type="button" class="w-btn primary"${attr({ act: "gate", id: g.id, action: g.separateOpenClose ? "close" : "trigger", key: `g:${g.id}:close` })}>${icon("closeIn")}Close ${esc(g.name)}</button></div>`;
  }
  // Opening is a deliberate slide all the way across, so a stray tap never opens the gate.
  return `<div class="slide" role="button" tabindex="0" aria-label="Open ${esc(g.name)}: slide right, or press Enter"${attr({ slide: "gate", id: g.id, action: g.separateOpenClose ? "open" : "trigger", key: `g:${g.id}:slide` })}>
      <span class="slide-fill"></span><span class="slide-text">slide to open</span><span class="slide-knob">${icon("arrowRight")}</span></div>`;
}

function gateWidget(g) {
  return `<div class="widget" style="--c:var(--blue)">
    <div class="w-top"><span class="w-glyph">${icon("gate")}</span>
      <div class="w-text"><div class="w-name">${esc(g.name)}</div><div class="w-state">${GATE_TITLES[g.state] ?? "Ready"}</div></div>
      <button type="button" class="w-more" aria-label="${esc(g.name)} controls"${attr({ act: "detail", kind: "gate", id: g.id })}>${icon("more")}</button></div>
    ${gateControls(g)}
  </div>`;
}

const ALARM_COLOR = { disarmed: "#8e8e93", armedHome: "var(--indigo)", armedAway: "var(--blue)", alarm: "var(--red)", unknown: "#8e8e93" };
function securityWidget(p) {
  const b = (label, ic, mode) => `<button type="button" aria-pressed="${p.mode === mode}"${attr({ act: "arm", id: p.id, mode, key: `a:${p.id}:${mode}` })}>${icon(ic)}${label}</button>`;
  return `<div class="widget" style="--c:${ALARM_COLOR[p.mode] ?? ALARM_COLOR.unknown}">
    <div class="w-top"><span class="w-glyph">${icon(p.mode === "disarmed" ? "shield" : p.mode === "alarm" ? "shieldAlert" : "shieldCheck")}</span>
      <div class="w-text"><div class="w-name">${esc(p.name)}</div><div class="w-state${p.mode === "alarm" ? " bad" : ""}">${SECURITY_TITLES[p.mode] ?? "Unknown"}</div></div></div>
    <div class="seg">${p.canArmAway ? b("Away", "away", "armedAway") : ""}${p.canArmHome ? b("Home", "home", "armedHome") : ""}${b("Off", "shield", "disarmed")}</div>
  </div>`;
}

export function hbar(m) {
  return `<div class="hbar" role="slider" tabindex="0" aria-label="${esc(m.name)} volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m.volume * 100)}" style="--v:${m.volume.toFixed(3)}"${attr({ hslider: "volume", id: m.id, key: `hv:${m.id}` })}>
    ${icon("mute")}<span class="hbar-track"><span class="hbar-fill"></span></span>${icon("volume")}</div>`;
}

function zoneWidget(home, m, others = []) {
  const room = roomOf(home, m.roomId)?.name ?? m.name;
  if (!m.on) {
    return `<div class="widget" style="--c:var(--purple)">
      <div class="w-top"><span class="w-glyph">${icon(mediaIcon(m))}</span>
        <div class="w-text"><div class="w-name">${esc(room)}</div><div class="w-state">Off</div></div>
        <button type="button" class="w-more" aria-label="${esc(m.name)} controls"${attr({ act: "detail", kind: "media", id: m.id })}>${icon("more")}</button></div>
      <div class="w-row"><button type="button" class="w-btn primary"${attr({ act: "toggle", kind: "media", id: m.id })}>${icon("power")}Turn on</button></div>
    </div>`;
  }
  const a = art(m);
  return `<div class="widget" style="--c:var(--purple)">
    <div class="np"><span class="art" style="--a1:${a.a1};--a2:${a.a2}">${icon(a.ic)}</span>
      <div class="w-text"><div class="w-state">${esc(sourceName(m))}</div>
        <div class="w-name">${esc(room)}${m.muted ? " · Muted" : `<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`}</div></div>
      <button type="button" class="w-more" aria-label="${esc(m.name)} controls"${attr({ act: "detail", kind: "media", id: m.id })}>${icon("more")}</button></div>
    ${m.hasVolume ? hbar(m) : ""}
    ${others.length ? `<a class="w-name" href="#media">Also playing in ${esc(others.map((o) => roomOf(home, o.roomId)?.name ?? o.name).join(", "))}</a>` : ""}
  </div>`;
}

function nowPlayingWidget(home) {
  const on = home.media.filter((m) => m.on);
  if (on.length) return zoneWidget(home, on[0], on.slice(1));
  if (!home.media.length) return "";
  return `<div class="widget" style="--c:var(--purple)">
    <div class="w-top"><span class="w-glyph">${icon("music")}</span>
      <div class="w-text"><div class="w-name">Media</div><div class="w-state">Nothing playing</div></div></div>
    <div class="w-row">${home.media.slice(0, 2).map((m) => `<button type="button" class="w-btn"${attr({ act: "toggle", kind: "media", id: m.id })}>${icon("power")}${esc(roomOf(home, m.roomId)?.name ?? m.name)}</button>`).join("")}</div>
  </div>`;
}

export function cameraPicture(c, api) {
  return c.demo
    ? `<div class="cam-demo ${esc(c.demo)}"></div>`
    : `<img alt="" data-cam="${esc(c.id)}" src="${esc(api)}cameras/${encodeURIComponent(c.id)}/snapshot?t=${Date.now()}">`;
}

function cameraTiles(cams, api) {
  const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return cams.map((c) => `<button type="button" class="cam" aria-label="${esc(c.name)} camera"${attr({ act: "camera", id: c.id })}>
    ${cameraPicture(c, api)}
    <span class="cam-pill name"><span class="live"></span>${esc(c.name)}</span>
    <span class="cam-pill time" data-cam-time>${now}</span></button>`).join("");
}

// ---------- page frame ----------

const sec = (title, body, { href, note = "", action = "" } = {}) => `<section class="sec">
    <div class="sec-head">${href ? `<a class="sec-title" href="${href}">${title}${icon("chevron")}</a>` : `<h2 class="sec-title">${title}</h2>`}${note ? `<span class="sec-note">${note}</span>` : ""}${action}</div>
    ${body}
  </section>`;

function head(app, { eyebrow, title, sub, back }) {
  const d = new Date();
  return `<header class="head">
    <div class="head-text">
      ${back ? `<a class="back-link" href="${back}">${icon("back")}Home</a>` : ""}
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1>${esc(title)}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
    </div>
    <div class="head-side">
      <button type="button" class="round-btn menu-btn" aria-label="Rooms and controls" data-act="menu">${icon("grid")}</button>
      <div class="head-time" data-clock>${fmtTime(d)}</div>
      ${app.askVisible ? `<button type="button" class="round-btn" aria-label="Ask Home" data-act="ask-open"><span class="orb"></span></button>` : ""}
      <button type="button" class="round-btn" aria-label="Settings" data-act="settings">${icon("gear")}</button>
    </div>
  </header>`;
}

function notice(app) {
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
  const rooms = h.rooms.map((r) => {
    const on = h.lights.filter((l) => l.roomId === r.id && isOn(l)).length;
    return item(roomHref(r.id), roomIcon(r.name), r.name, roomColor(h, r.id), on ? `${on} on` : "", cur("room", r.id));
  }).join("");
  const alarm = h.security[0];
  return `<div class="side-home"><span class="app-glyph">${icon("home")}</span>
      <div><div class="side-title">${esc(app.homeName)}</div><div class="side-sub"><span class="dot ${st.dot}"></span>${esc(st.label)}</div></div></div>
    ${item("#home", "home", "Home", "var(--orange)", "", cur("home"))}
    ${rooms ? `<div class="side-head">Rooms</div>${rooms}` : ""}
    <div class="side-head">Controls</div>
    ${h.lights.length ? item("#lights", "bulb", "Lights", "var(--yellow)", c.lightsOn ? `${c.lightsOn} on` : "Off", cur("lights")) : ""}
    ${h.shades.length ? item("#shades", "blinds", "Shades", "var(--teal)", c.shadesOpen ? `${c.shadesOpen} open` : "Closed", cur("shades")) : ""}
    ${h.media.length ? item("#media", "music", "Media", "var(--purple)", c.playing.length ? `${c.playing.length} playing` : "", cur("media")) : ""}
    ${h.security.length || h.locks.length || h.gates.length ? item("#security", "shieldCheck", "Security", "var(--indigo)",
      c.unlocked.length ? `${c.unlocked.length} unlocked` : alarm ? SECURITY_TITLES[alarm.mode] ?? "" : "", cur("security"), c.unlocked.length > 0) : ""}
    ${app.cameras.length ? item("#cameras", "camera", "Cameras", "var(--pink)", String(app.cameras.length), cur("cameras")) : ""}
    <div class="side-foot">
      ${app.askVisible ? `<button type="button" class="side-item side-btn" data-act="ask-open"><span class="orb"></span><span class="si-name">Ask Home</span></button>` : ""}
      <button type="button" class="side-item side-btn" data-act="settings" style="--c:#8e8e93"><span class="si-icon">${icon("gear")}</span><span class="si-name">Settings</span></button>
    </div>`;
}

// ---------- views ----------

function summary(home) {
  const c = counts(home);
  const parts = [];
  parts.push(c.lightsOn ? `${c.lightsOn} ${c.lightsOn === 1 ? "light" : "lights"} on` : "All lights off");
  if (c.unlocked.length) parts.push(`${c.unlocked.map((l) => l.name).join(" and ")} ${c.unlocked.length === 1 ? "is" : "are"} unlocked`);
  else if (home.locks.length) parts.push("Doors locked");
  if (c.playing.length) parts.push(`Playing in ${c.playing.map((m) => roomOf(home, m.roomId)?.name ?? m.name).join(" and ")}`);
  return parts.join(" · ");
}

function chips(app) {
  const h = app.home;
  const c = counts(h);
  const chip = (href, ic, color, title, val, attn = false) =>
    `<a class="chip${attn ? " attn" : ""}" href="${href}"><span class="chip-icon" style="--c:${color}">${icon(ic)}</span><span><div class="chip-title">${esc(title)}</div><div class="chip-val">${esc(val)}</div></span></a>`;
  const out = [];
  if (h.lights.length) out.push(chip("#lights", "bulb", "var(--yellow)", "Lights", c.lightsOn ? `${c.lightsOn} on` : "All off"));
  if (h.security.length) {
    const p = h.security[0];
    out.push(chip("#security", p.mode === "disarmed" ? "shield" : "shieldCheck", ALARM_COLOR[p.mode] ?? ALARM_COLOR.unknown, "Security", SECURITY_TITLES[p.mode] ?? "Unknown", p.mode === "alarm"));
  }
  if (h.locks.length) out.push(chip("#security", c.unlocked.length ? "unlock" : "lock", c.unlocked.length ? "var(--orange)" : "var(--green)", "Doors", c.unlocked.length ? `${c.unlocked.length} unlocked` : "Locked", c.unlocked.length > 0));
  for (const g of h.gates) out.push(chip("#security", "gate", "var(--blue)", g.name, GATE_TITLES[g.state] ?? "Ready", g.state === "open"));
  if (h.shades.length) out.push(chip("#shades", "blinds", "var(--teal)", "Shades", c.shadesOpen ? `${c.shadesOpen} open` : "Closed"));
  if (h.media.length) out.push(chip("#media", "music", "var(--purple)", "Media", c.playing.length ? `${c.playing.length} playing` : "Off"));
  return out.length ? `<nav class="chips" aria-label="House status">${out.join("")}</nav>` : "";
}

function homeView(app) {
  const h = app.home;
  const d = new Date();
  const widgets = [...h.gates.map(gateWidget), ...h.security.slice(0, 1).map(securityWidget), nowPlayingWidget(h)].filter(Boolean);
  const scenes = homeScenes(h);
  const rooms = h.rooms.map((r) => {
    const items = roomItems(h, r.id);
    return items.length ? sec(esc(r.name), `<div class="tiles">${accessoryTiles(h, items, false)}</div>`, { href: roomHref(r.id) }) : "";
  }).join("");
  const loose = [...h.lights, ...h.shades, ...h.media, ...h.locks].some((x) => !roomOf(h, x.roomId));
  const looseItems = loose ? [
    ...h.lights.filter((x) => !roomOf(h, x.roomId)).map((x) => ["light", x]), ...h.shades.filter((x) => !roomOf(h, x.roomId)).map((x) => ["shade", x]),
    ...h.media.filter((x) => !roomOf(h, x.roomId)).map((x) => ["media", x]), ...h.locks.filter((x) => !roomOf(h, x.roomId)).map((x) => ["lock", x]),
  ] : [];
  const nothing = !h.rooms.length && !h.lights.length && !h.scenes.length;
  return `${head(app, { eyebrow: fmtDate(d), title: greeting(d), sub: nothing ? "" : summary(h) })}
    ${notice(app)}
    ${chips(app)}
    ${widgets.length ? `<div class="widgets">${widgets.join("")}</div>` : ""}
    ${scenes.length ? sec("Scenes", `<div class="tiles">${sceneTiles(scenes, app.pop)}</div>`) : ""}
    ${app.cameras.length ? sec("Cameras", `<div class="cams">${cameraTiles(app.cameras.slice(0, 2), app.api)}</div>`, { href: app.cameras.length > 2 ? "#cameras" : null }) : ""}
    ${rooms}
    ${looseItems.length ? sec("Other", `<div class="tiles">${accessoryTiles(h, looseItems, false)}</div>`) : ""}
    ${nothing ? `<div class="empty">${icon("home")}<b>No devices yet</b><span>Open Settings to connect your Crestron system.</span></div>` : ""}`;
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
  const sub = [lights.length ? (on ? `${on} of ${lights.length} lights on` : "Lights off") : "", ...media.filter((m) => m.on).map((m) => `Playing ${sourceName(m)}`)].filter(Boolean).join(" · ");
  const eyebrow = [lights.length && `${lights.length} ${lights.length === 1 ? "light" : "lights"}`, shades.length && `${shades.length} ${shades.length === 1 ? "shade" : "shades"}`, media.length && "media"].filter(Boolean).join(" · ") || "Room";
  const quick = [
    lights.length ? `<button type="button" class="capsule"${attr({ act: "room-lights", id: room.id, level: on ? 0 : 1 })}>${icon(on ? "bulbOff" : "bulb")}${on ? "Lights off" : "Lights on"}</button>` : "",
    shades.length ? `<button type="button" class="capsule"${attr({ act: "room-shades", id: room.id, position: 1 })}>${icon("up")}Open shades</button>
      <button type="button" class="capsule"${attr({ act: "room-shades", id: room.id, position: 0 })}>${icon("down")}Close shades</button>` : "",
  ].join("");
  return `${head(app, { eyebrow, title: room.name, sub, back: "#home" })}
    ${notice(app)}
    ${quick ? `<div class="quick">${quick}</div>` : ""}
    ${scenes.length ? sec("Scenes", `<div class="tiles">${sceneTiles(scenes, app.pop)}</div>`) : ""}
    ${media.length ? sec("Media", `<div class="widgets">${media.map((m) => zoneWidget(h, m)).join("")}</div>`) : ""}
    ${items.length ? sec("Accessories", `<div class="tiles">${accessoryTiles(h, items, false)}</div>`) : ""}
    ${!items.length && !media.length && !scenes.length ? `<div class="empty">${icon(roomIcon(room.name))}<b>Nothing here yet</b><span>This room has no lights, shades or media.</span></div>` : ""}`;
}

function byRoom(home, list, kind) {
  const groups = new Map();
  for (const x of list) {
    const key = roomOf(home, x.roomId)?.id ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([kind, x]);
  }
  return [...groups].map(([roomId, items]) => sec(esc(roomOf(home, roomId)?.name ?? "Other"), `<div class="tiles">${accessoryTiles(home, items, false)}</div>`, { href: roomId ? roomHref(roomId) : null })).join("");
}

function lightsView(app) {
  const h = app.home;
  const on = h.lights.filter(isOn).length;
  return `${head(app, { eyebrow: "Lights", title: on ? `${on} ${on === 1 ? "light is" : "lights are"} on` : "All lights are off", sub: `${h.lights.length} lights in ${h.rooms.length} rooms` })}
    <div class="quick"><button type="button" class="capsule" data-act="all-lights" data-level="0">${icon("bulbOff")}Turn all off</button>
      <button type="button" class="capsule" data-act="all-lights" data-level="1">${icon("bulb")}Turn all on</button></div>
    ${byRoom(h, h.lights, "light") || `<div class="empty">${icon("bulb")}<b>No lights</b></div>`}`;
}

function shadesView(app) {
  const h = app.home;
  const open = h.shades.filter(isOpen).length;
  return `${head(app, { eyebrow: "Shades", title: open ? `${open} ${open === 1 ? "shade is" : "shades are"} open` : "All shades are closed", sub: `${h.shades.length} shades` })}
    <div class="quick"><button type="button" class="capsule" data-act="all-shades" data-position="1">${icon("up")}Open all</button>
      <button type="button" class="capsule" data-act="all-shades" data-position="0">${icon("down")}Close all</button></div>
    ${byRoom(h, h.shades, "shade") || `<div class="empty">${icon("blinds")}<b>No shades</b></div>`}`;
}

function mediaView(app) {
  const h = app.home;
  const playing = h.media.filter((m) => m.on).length;
  return `${head(app, { eyebrow: "Media", title: playing ? `Playing in ${playing} ${playing === 1 ? "room" : "rooms"}` : "Nothing playing", sub: "" })}
    ${h.media.length ? `<div class="widgets">${h.media.map((m) => zoneWidget(h, m)).join("")}</div>` : `<div class="empty">${icon("music")}<b>No media rooms</b></div>`}`;
}

function securityView(app) {
  const h = app.home;
  const unlocked = h.locks.filter((l) => l.locked === false).length;
  const widgets = [...h.security.map(securityWidget), ...h.gates.map(gateWidget)];
  return `${head(app, { eyebrow: "Security", title: unlocked ? `${unlocked} ${unlocked === 1 ? "door is" : "doors are"} unlocked` : h.locks.length ? "Everything is locked" : "Security", sub: h.security[0] ? `Alarm: ${SECURITY_TITLES[h.security[0].mode] ?? "Unknown"}` : "" })}
    ${widgets.length ? `<div class="widgets">${widgets.join("")}</div>` : ""}
    ${h.locks.length ? sec("Doors", `<div class="tiles">${accessoryTiles(h, h.locks.map((l) => ["lock", l]), true)}</div>`) : ""}
    ${app.cameras.length ? sec("Cameras", `<div class="cams">${cameraTiles(app.cameras, app.api)}</div>`) : ""}
    ${!widgets.length && !h.locks.length ? `<div class="empty">${icon("shield")}<b>No security devices</b></div>` : ""}`;
}

function camerasView(app) {
  return `${head(app, { eyebrow: "Cameras", title: "Cameras", sub: app.cameras.length ? `${app.cameras.length} live` : "" })}
    ${app.cameras.length ? `<div class="cams">${cameraTiles(app.cameras, app.api)}</div>` : `<div class="empty">${icon("camera")}<b>No cameras yet</b><span>Add them in Settings › System setup › Cameras.</span></div>`}`;
}

const VIEWS = { home: homeView, room: roomView, lights: lightsView, shades: shadesView, media: mediaView, security: securityView, cameras: camerasView };

export function viewHTML(app) {
  return (VIEWS[app.route.name] ?? homeView)(app);
}

// ---------- StandBy ----------

export function standbyHTML(app) {
  const d = new Date();
  const h = app.home;
  const c = counts(h);
  const glance = [];
  glance.push(`<span>${icon("bulb")}${c.lightsOn ? `${c.lightsOn} lights on` : "Lights off"}</span>`);
  if (h.locks.length) glance.push(`<span class="${c.unlocked.length ? "attn" : ""}">${icon(c.unlocked.length ? "unlock" : "lock")}${c.unlocked.length ? `${c.unlocked.length} unlocked` : "Locked"}</span>`);
  for (const g of h.gates) glance.push(`<span class="${g.state === "open" ? "attn" : ""}">${icon("gate")}${esc(g.name)} ${esc((GATE_TITLES[g.state] ?? "Ready").toLowerCase())}</span>`);
  if (h.security[0]) glance.push(`<span>${icon("shield")}${esc(SECURITY_TITLES[h.security[0].mode] ?? "")}</span>`);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  return `<div class="sb-inner"><div class="sb-date">${esc(fmtDate(d))}</div><div class="sb-clock">${esc(t)}</div><div class="sb-glance">${glance.join("")}</div></div>`;
}
