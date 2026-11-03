// Home View detail sheets (the card that opens over the page). Pure HTML builders.
import { icon } from "../icons.js";
import { GATE_TITLES, pct, roomOf, SECURITY_TITLES } from "../shared/model.js";
import { LANGS, lang, t, tn } from "../shared/i18n.js";
import { climateSheet, switchSheet } from "./climate.js";
import { art, attr, cameraPicture, esc, fmtDate, gateControls, isOn, lightState, shadeState, sourceName, transportRow } from "./views.js";

const closeBtn = () => `<button type="button" class="sheet-close" data-act="sheet-close" aria-label="${t("Close")}">${icon("close")}</button>`;

/** Card title row. With `favKey` ("light:l1"), a star adds or removes it from Favorites. */
export function sheetHead(color, ic, title, sub, app = null, favKey = null) {
  const fav = app && favKey ? app.favorites.includes(favKey) : false;
  const star = favKey
    ? `<button type="button" class="sheet-fav${fav ? " on" : ""}" aria-pressed="${fav}" aria-label="${fav ? t("Remove from Favorites") : t("Add to Favorites")}"${attr({ act: "favorite", fav: favKey })}>${icon(fav ? "starFill" : "star")}</button>`
    : "";
  return `<div class="sheet-head"><span class="w-glyph" style="--c:${color}">${icon(ic)}</span>
    <div><div class="sheet-title" id="sheet-title">${esc(title)}</div>${sub ? `<div class="sheet-sub">${esc(sub)}</div>` : ""}</div>${star}${closeBtn()}</div>`;
}

/** "Turn off in 15 min / 30 min / 1 h / 2 h". `verb` and `label` come already translated. */
export function timerPills(verb, label, command) {
  const opts = [[15, "15 min"], [30, "30 min"], [60, "1 h"], [120, "2 h"]];
  return `<div class="timer-row"><span class="timer-label">${icon("timer")}${esc(t("{verb} in", { verb }))}</span>
    ${opts.map(([m, t]) => `<button type="button" class="pill small"${attr({ act: "timer-add", minutes: m, label, cmd: JSON.stringify(command) })}>${t}</button>`).join("")}</div>`;
}

function vslider({ kind, id, value, cls, ic, label }) {
  return `<div class="vslider ${cls}${value > 0.04 ? " lit" : ""}" role="slider" tabindex="0" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}"
    style="--v:${value.toFixed(3)}" data-slider="${kind}" data-id="${esc(id)}" data-key="vs:${kind}:${esc(id)}">
    <span class="fill"></span><span class="vs-icon">${icon(ic)}</span></div>`;
}

const roomName = (home, x) => roomOf(home, x.roomId)?.name ?? "";

function lightSheet(app, l) {
  const presets = [[0, t("Off")], [0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "100%"]];
  const body = l.dimmable
    ? `${vslider({ kind: "light", id: l.id, value: l.level, cls: "light", ic: "bulb", label: t("{name} brightness", { name: l.name }) })}
       <div class="pills">${presets.map(([v, t]) => `<button type="button" class="pill" aria-pressed="${Math.abs(l.level - v) < 0.02}" data-act="light-set" data-id="${esc(l.id)}" data-level="${v}">${t}</button>`).join("")}</div>`
    : `${vslider({ kind: "light-switch", id: l.id, value: isOn(l) ? 1 : 0, cls: "light switch", ic: "bulb", label: t(isOn(l) ? "{name}, tap to turn off" : "{name}, tap to turn on", { name: l.name }) })}
       <p class="hint">${t(isOn(l) ? "Tap to turn off." : "Tap to turn on.")}</p>`;
  return `${sheetHead("var(--yellow)", "bulb", l.name, roomName(app.home, l), app, `light:${l.id}`)}
    <div class="sheet-body"><div class="big-val" data-live="light:${esc(l.id)}">${esc(lightState(l))}</div>${body}
      ${isOn(l) ? timerPills(t("Turn off"), t("{name} off", { name: l.name }), { type: "setLight", id: l.id, level: 0 }) : ""}</div>`;
}

function shadeSheet(app, s) {
  return `${sheetHead("var(--teal)", "blinds", s.name, roomName(app.home, s), app, `shade:${s.id}`)}
    <div class="sheet-body"><div class="big-val" data-live="shade:${esc(s.id)}">${esc(shadeState(s))}</div>
      ${s.hasPosition !== false ? vslider({ kind: "shade", id: s.id, value: s.position, cls: "shade", ic: "blinds", label: t("{name} position", { name: s.name }) }) : ""}
      <div class="pills">
        <button type="button" class="pill" data-act="shade-set" data-id="${esc(s.id)}" data-position="1">${icon("up")}${t("action::Open")}</button>
        ${s.canStop ? `<button type="button" class="pill" data-act="shade-stop" data-id="${esc(s.id)}">${icon("stop")}${t("Stop")}</button>` : ""}
        <button type="button" class="pill" data-act="shade-set" data-id="${esc(s.id)}" data-position="0">${icon("down")}${t("Close")}</button>
      </div>
      ${s.position > 0.02 ? timerPills(t("Close"), t("{name} closed", { name: s.name }), { type: "setShade", id: s.id, position: 0 }) : ""}</div>`;
}

function mediaSheet(app, m) {
  const sources = m.sources.map((s) => `<button type="button" class="row" data-act="media-source" data-id="${esc(m.id)}" data-source="${esc(s.id)}" aria-pressed="${m.on && m.sourceId === s.id}">
      <span class="grow">${esc(s.name)}</span>${m.on && m.sourceId === s.id ? `<span class="check">${icon("check")}</span>` : ""}</button>`).join("");
  const left = m.hasVolume
    ? `<div style="display:grid;justify-items:center;gap:14px">
        <div class="big-val" data-live="volume:${esc(m.id)}">${m.muted ? t("Muted") : pct(m.volume)}</div>
        ${vslider({ kind: "volume", id: m.id, value: m.volume, cls: "volume", ic: m.muted ? "mute" : "volume", label: t("{name} volume", { name: m.name }) })}
        <button type="button" class="pill" aria-pressed="${m.muted}" data-act="media-mute" data-id="${esc(m.id)}">${icon(m.muted ? "mute" : "volume")}${m.muted ? t("Unmute") : t("Mute")}</button>
      </div>`
    : "";
  const a = art(m);
  const np = m.on ? m.nowPlaying : null;
  const nowPlaying = m.on
    ? `<div class="np-card"><span class="art big" style="--a1:${a.a1};--a2:${a.a2}">${icon(a.ic)}</span>
        <div class="np-text"><b>${esc(np?.title || sourceName(m))}</b><span>${esc([np?.artist, np?.album].filter(Boolean).join(" · ") || (m.playing ? t("Playing") : t("Paused")))}</span></div>
        ${m.canTransport ? transportRow(m, true) : ""}</div>`
    : "";
  const others = app.home.media.filter((z) => z.id !== m.id);
  return `${sheetHead("var(--purple)", "music", m.name, m.on ? `${m.playing ? t("Playing") : t("Paused")} · ${sourceName(m)}` : t("Off"), app, `media:${m.id}`)}
    <div class="sheet-cols"${m.hasVolume ? "" : ' style="grid-template-columns:minmax(0,1fr)"'}>
      ${left}
      <div style="display:grid;gap:18px;width:100%">
        ${nowPlaying}
        ${m.on && m.sourceId && others.length ? `<button type="button" class="pill"${attr({ act: "play-everywhere", id: m.id })}>${icon("speakers")}${t("Play this in every room")}</button>` : ""}
        <div class="list"><div class="row"><span class="row-icon" style="--c:var(--purple)">${icon("power")}</span><span class="grow">${t("Power")}</span>
          <button type="button" class="switch" role="switch" aria-checked="${m.on}" aria-label="${esc(t("{name} power", { name: m.name }))}" data-act="media-power" data-id="${esc(m.id)}"></button></div></div>
        ${sources ? `<div class="list-label">${t("Source")}</div><div class="list">${sources}</div>` : ""}
        ${m.on ? timerPills(t("Sleep timer: off"), t("{name} off", { name: m.name }), { type: "mediaPower", id: m.id, on: false }) : ""}
      </div>
    </div>`;
}

function lockSheet(app, l) {
  const unlocked = l.locked === false;
  const ring = `<svg class="ring" viewBox="0 0 152 152" aria-hidden="true"><circle cx="76" cy="76" r="74"/></svg>`;
  const control = unlocked
    ? `<button type="button" class="hold unlocked" data-act="lock-now" data-id="${esc(l.id)}" aria-label="${esc(t("Lock {name}", { name: l.name }))}">${icon("unlock")}</button>
       <p class="hint">${t("Tap to lock.")}</p>`
    : `<button type="button" class="hold locked" data-hold="unlock" data-id="${esc(l.id)}" aria-label="${esc(t("Unlock {name}: press and hold", { name: l.name }))}">${ring}${icon("lock")}</button>
       <p class="hint">${t("Press and hold for a second to unlock.")}</p>`;
  return `${sheetHead(unlocked ? "var(--orange)" : "var(--green)", unlocked ? "unlock" : "lock", l.name, roomName(app.home, l), app, `lock:${l.id}`)}
    <div class="sheet-body"><div class="big-val">${l.locked === null ? t("Unknown") : unlocked ? t("Unlocked") : t("Locked")}</div>${control}</div>`;
}

function gateSheet(app, g) {
  const extra = [
    g.separateOpenClose && g.state !== "closed" ? `<button type="button" class="pill" data-act="gate" data-id="${esc(g.id)}" data-action="close">${icon("closeIn")}${t("Close")}</button>` : "",
    g.canStop ? `<button type="button" class="pill" data-act="gate" data-id="${esc(g.id)}" data-action="stop">${icon("stop")}${t("Stop")}</button>` : "",
  ].join("");
  return `${sheetHead("var(--blue)", "gate", g.name, t("Gate"))}
    <div class="sheet-body"><div class="big-val">${esc(t(GATE_TITLES[g.state] ?? "Ready"))}</div>
      <div style="width:100%;display:grid;gap:12px;--c:var(--blue)">${gateControls(g)}</div>
      ${extra && g.state !== "moving" ? `<div class="pills">${extra}</div>` : ""}</div>`;
}

function keypadSheet(app, k) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => `<button type="button" class="key" data-act="key" data-v="${n}">${n}</button>`).join("");
  const panel = app.home.security.find((p) => p.id === k.id);
  const prompt = { armedAway: "Enter your code to arm away", armedHome: "Enter your code to arm home", disarmed: "Enter your code to disarm" }[k.mode] ?? "Enter your code to continue";
  const button = { armedAway: "Arm away", armedHome: "Arm home", disarmed: "Disarm" }[k.mode] ?? "Continue";
  return `${sheetHead("var(--indigo)", "shield", panel?.name ?? t("part::Alarm"), panel ? t(SECURITY_TITLES[panel.mode] ?? "Unknown") : "")}
    <div class="sheet-body">
      <p class="hint" style="font-size:16px;color:var(--label)">${t(prompt)}</p>
      <div class="code-dots" id="code-dots" aria-live="polite">${dots(k.code)}</div>
      <div class="keypad">${keys}
        <button type="button" class="key text" data-act="key" data-v="clear">${t("Clear")}</button>
        <button type="button" class="key" data-act="key" data-v="0">0</button>
        <button type="button" class="key text" data-act="key" data-v="del" aria-label="${t("Delete")}">${icon("deleteKey")}</button>
      </div>
      <button type="button" class="w-btn primary" style="--c:var(--indigo);width:min(280px,100%);flex:none" data-act="key-enter" id="key-enter"${k.code ? "" : " disabled"}>${t(button)}</button>
    </div>`;
}

export const dots = (code) => Array.from({ length: Math.max(4, code.length) }, (_, i) => `<span class="${i < code.length ? "on" : ""}"></span>`).join("");

function confirmSheet(app, c) {
  return `${sheetHead(c.color ?? "var(--blue)", c.icon ?? "alert", c.title, "")}
    <div class="sheet-body"><p class="hint" style="font-size:16px">${esc(c.text)}</p>
      <div class="w-row" style="width:100%"><button type="button" class="w-btn" data-act="sheet-close">${t("Cancel")}</button>
        <button type="button" class="w-btn primary" style="--c:${c.color ?? "var(--blue)"}" data-act="confirm-yes">${esc(c.label)}</button></div></div>`;
}

function cameraSheet(app, cam) {
  return `${sheetHead("var(--pink)", "camera", cam.name, t("Live · {date}", { date: fmtDate(new Date()) }))}
    <div class="sheet-body"><div class="big-cam">${cameraPicture(cam, app.api)}<span class="cam-pill time" data-cam-time></span></div></div>`;
}

function settingsSheet(app) {
  const look = app.device.look;
  const seg = (v, label) => `<button type="button" aria-pressed="${look === v}" data-act="look" data-v="${v}">${label}</button>`;
  // Language names stay in their own language, so anyone can find theirs.
  const langs = Object.entries(LANGS).map(([v, label]) => `<button type="button" aria-pressed="${lang() === v}" lang="${v}" data-act="lang" data-v="${v}">${label}</button>`).join("");
  const mins = [2, 5, 10].map((m) => `<button type="button" aria-pressed="${app.device.saverMin === m}" data-act="saver-min" data-v="${m}">${m} min</button>`).join("");
  const s = app.status;
  const system = app.transport === "local" ? t("Demo in this browser") : { demo: t("Demo house"), crestronHome: "Crestron Home", customProgram: t("Custom program") }[s.mode] ?? "Crestron";
  const state = s.connection === "connected" ? t("Connected") : s.connection === "connecting" ? t("Connecting…") : t("Not connected");
  return `${sheetHead("#8e8e93", "gear", t("Settings"), t("This iPad"))}
    <div class="sheet-body" style="justify-items:stretch">
      <div class="list-label">${t("Display")}</div>
      <div class="list">
        <div class="row"><span class="row-icon" style="--c:var(--indigo)">${icon("moon")}</span><span class="grow">${t("Appearance")}</span>
          <div class="mini-seg">${seg("auto", t("Auto"))}${seg("light", t("Light"))}${seg("dark", t("Dark"))}</div></div>
        <div class="row"><span class="row-icon" style="--c:var(--blue)">${icon("sparkle")}</span><span class="grow">${t("Language")}</span>
          <div class="mini-seg" role="group" aria-label="${t("Language")}">${langs}</div></div>
        <div class="row"><span class="row-icon" style="--c:var(--orange)">${icon("desk")}</span><span class="grow">${t("Wall panel mode")}<div class="note">${t("Keeps the screen on and shows StandBy when idle")}</div></span>
          <button type="button" class="switch" role="switch" aria-checked="${app.device.wall}" aria-label="${t("Wall panel mode")}" data-act="wall"></button></div>
        ${app.device.wall ? `<div class="row"><span class="row-icon" style="--c:#000">${icon("moon")}</span><span class="grow">${t("StandBy after")}</span><div class="mini-seg">${mins}</div></div>` : ""}
        <button type="button" class="row" data-act="standby-now"><span class="row-icon" style="--c:#1c1c1e">${icon("sun")}</span><span class="grow">${t("Show StandBy now")}</span>${icon("chevron")}</button>
      </div>
      <div class="list-label">${t("Home screen")}</div>
      <div class="list">
        <button type="button" class="row" data-act="edit-home"><span class="row-icon" style="--c:var(--blue)">${icon("edit")}</span><span class="grow">${t("Edit Home")}<div class="note">${t("Add, remove and reorder what's on Home")}</div></span>${icon("chevron")}</button>
        <button type="button" class="row" data-act="pick-favorites"><span class="row-icon" style="--c:var(--yellow)">${icon("star")}</span><span class="grow">${t("Favorites")}<div class="note">${app.favorites.length ? tn(app.favorites.length, "{n} chosen", "{n} chosen") : t("None yet")}</div></span>${icon("chevron")}</button>
      </div>
      <div class="list-label">${t("Location")}</div>
      <div class="list">
        ${app.transport === "local"
          ? `<div class="row"><span class="row-icon" style="--c:var(--teal)">${icon("cloudSun")}</span><span class="grow">${esc(app.location?.place ?? t("Demo"))}<div class="note">${t("The demo house uses a sample place and sample weather")}</div></span></div>`
          : `<form class="row" id="loc-form"><span class="row-icon" style="--c:var(--teal)">${icon("cloudSun")}</span>
              <input class="text-input" id="loc-input" autocomplete="off" placeholder="${t("Town or city, for weather and sunset")}" value="${esc(app.location?.place ?? "")}" aria-label="${t("Town or city")}">
              <button type="submit" class="pill small">${t("Save")}</button></form>`}
      </div>
      ${app.home.doorbells.length ? `<div class="list-label">${t("Doorbell")}</div>
      <div class="list">${app.home.doorbells.map((b) => `<button type="button" class="row"${attr({ act: "doorbell-test", id: b.id })}><span class="row-icon" style="--c:var(--pink)">${icon("bell")}</span><span class="grow">${t("Test {name} doorbell", { name: esc(b.name) })}<div class="note">${t("Shows the doorbell pop-up on every screen")}</div></span>${icon("chevron")}</button>`).join("")}</div>` : ""}
      <div class="list-label">${t("System")}</div>
      <div class="list">
        <div class="row"><span class="row-icon" style="--c:var(--green)">${icon("wifi")}</span><span class="grow">${esc(system)}<div class="note">${esc(state)}</div></span></div>
        ${app.transport === "local" ? `<div class="row"><span class="row-icon" style="--c:var(--orange)">${icon("alert")}</span><span class="grow">${t("This is a demo house")}<div class="note">${t("Run the home server at home to connect your Crestron system")}</div></span></div>` : `<a class="row" href="../index.html#setup"><span class="row-icon" style="--c:var(--blue)">${icon("sliders")}</span><span class="grow">${t("System setup")}<div class="note">${t("Processor, join map, cameras and the AI key")}</div></span>${icon("chevron")}</a>
        <a class="row" href="../index.html"><span class="row-icon" style="--c:var(--pink)">${icon("grid")}</span><span class="grow">${t("Classic view")}</span>${icon("chevron")}</a>`}
      </div>
    </div>`;
}

// Sheets added by other modules: kind -> { render(app, spec), wide }.
const EXTRA = {};
export function registerSheet(kind, render, wide = false) {
  EXTRA[kind] = { render, wide };
}

export function sheetHTML(app, spec) {
  const h = app.home;
  const find = (list) => list.find((x) => x.id === spec.id);
  switch (spec.kind) {
    case "light": { const l = find(h.lights); return l && lightSheet(app, l); }
    case "shade": { const s = find(h.shades); return s && shadeSheet(app, s); }
    case "media": { const m = find(h.media); return m && mediaSheet(app, m); }
    case "lock": { const l = find(h.locks); return l && lockSheet(app, l); }
    case "gate": { const g = find(h.gates); return g && gateSheet(app, g); }
    case "climate": { const c = find(h.climate); return c && climateSheet(app, c, sheetHead); }
    case "switch": { const s = find(h.switches); return s && switchSheet(app, s, sheetHead, timerPills); }
    case "camera": { const c = app.cameras.find((x) => x.id === spec.id); return c && cameraSheet(app, c); }
    case "keypad": return keypadSheet(app, spec);
    case "confirm": return confirmSheet(app, spec);
    case "settings": return settingsSheet(app);
    default: return EXTRA[spec.kind]?.render(app, spec) ?? null;
  }
}

export const isWideSheet = (spec) => spec.kind === "media" || spec.kind === "camera" || Boolean(EXTRA[spec.kind]?.wide);
