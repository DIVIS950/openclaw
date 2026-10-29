// Home View detail sheets (the card that opens over the page). Pure HTML builders.
import { icon } from "../icons.js";
import { GATE_TITLES, pct, roomOf, SECURITY_TITLES } from "../shared/model.js";
import { cameraPicture, esc, fmtDate, gateControls, isOn, lightState, shadeState, sourceName } from "./views.js";

const closeBtn = `<button type="button" class="sheet-close" data-act="sheet-close" aria-label="Close">${icon("close")}</button>`;

function sheetHead(color, ic, title, sub) {
  return `<div class="sheet-head"><span class="w-glyph" style="--c:${color}">${icon(ic)}</span>
    <div><div class="sheet-title" id="sheet-title">${esc(title)}</div>${sub ? `<div class="sheet-sub">${esc(sub)}</div>` : ""}</div>${closeBtn}</div>`;
}

function vslider({ kind, id, value, cls, ic, label }) {
  return `<div class="vslider ${cls}${value > 0.04 ? " lit" : ""}" role="slider" tabindex="0" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}"
    style="--v:${value.toFixed(3)}" data-slider="${kind}" data-id="${esc(id)}" data-key="vs:${kind}:${esc(id)}">
    <span class="fill"></span><span class="vs-icon">${icon(ic)}</span></div>`;
}

const roomName = (home, x) => roomOf(home, x.roomId)?.name ?? "";

function lightSheet(app, l) {
  const presets = [[0, "Off"], [0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "100%"]];
  const body = l.dimmable
    ? `${vslider({ kind: "light", id: l.id, value: l.level, cls: "light", ic: "bulb", label: `${l.name} brightness` })}
       <div class="pills">${presets.map(([v, t]) => `<button type="button" class="pill" aria-pressed="${Math.abs(l.level - v) < 0.02}" data-act="light-set" data-id="${esc(l.id)}" data-level="${v}">${t}</button>`).join("")}</div>`
    : `${vslider({ kind: "light-switch", id: l.id, value: isOn(l) ? 1 : 0, cls: "light switch", ic: "bulb", label: `${l.name}, tap to turn ${isOn(l) ? "off" : "on"}` })}
       <p class="hint">Tap to turn ${isOn(l) ? "off" : "on"}.</p>`;
  return `${sheetHead("var(--yellow)", "bulb", l.name, roomName(app.home, l))}
    <div class="sheet-body"><div class="big-val" data-live="light:${esc(l.id)}">${esc(lightState(l))}</div>${body}</div>`;
}

function shadeSheet(app, s) {
  return `${sheetHead("var(--teal)", "blinds", s.name, roomName(app.home, s))}
    <div class="sheet-body"><div class="big-val" data-live="shade:${esc(s.id)}">${esc(shadeState(s))}</div>
      ${s.hasPosition !== false ? vslider({ kind: "shade", id: s.id, value: s.position, cls: "shade", ic: "blinds", label: `${s.name} position` }) : ""}
      <div class="pills">
        <button type="button" class="pill" data-act="shade-set" data-id="${esc(s.id)}" data-position="1">${icon("up")}Open</button>
        ${s.canStop ? `<button type="button" class="pill" data-act="shade-stop" data-id="${esc(s.id)}">${icon("stop")}Stop</button>` : ""}
        <button type="button" class="pill" data-act="shade-set" data-id="${esc(s.id)}" data-position="0">${icon("down")}Close</button>
      </div></div>`;
}

function mediaSheet(app, m) {
  const sources = m.sources.map((s) => `<button type="button" class="row" data-act="media-source" data-id="${esc(m.id)}" data-source="${esc(s.id)}" aria-pressed="${m.on && m.sourceId === s.id}">
      <span class="grow">${esc(s.name)}</span>${m.on && m.sourceId === s.id ? `<span class="check">${icon("check")}</span>` : ""}</button>`).join("");
  const left = m.hasVolume
    ? `<div style="display:grid;justify-items:center;gap:14px">
        <div class="big-val" data-live="volume:${esc(m.id)}">${m.muted ? "Muted" : pct(m.volume)}</div>
        ${vslider({ kind: "volume", id: m.id, value: m.volume, cls: "volume", ic: m.muted ? "mute" : "volume", label: `${m.name} volume` })}
        <button type="button" class="pill" aria-pressed="${m.muted}" data-act="media-mute" data-id="${esc(m.id)}">${icon(m.muted ? "mute" : "volume")}${m.muted ? "Unmute" : "Mute"}</button>
      </div>`
    : "";
  return `${sheetHead("var(--purple)", "music", m.name, m.on ? `Playing ${sourceName(m)}` : "Off")}
    <div class="sheet-cols"${m.hasVolume ? "" : ' style="grid-template-columns:minmax(0,1fr)"'}>
      ${left}
      <div style="display:grid;gap:18px;width:100%">
        <div class="list"><div class="row"><span class="row-icon" style="--c:var(--purple)">${icon("power")}</span><span class="grow">Power</span>
          <button type="button" class="switch" role="switch" aria-checked="${m.on}" aria-label="${esc(m.name)} power" data-act="media-power" data-id="${esc(m.id)}"></button></div></div>
        ${sources ? `<div class="list-label">Source</div><div class="list">${sources}</div>` : ""}
      </div>
    </div>`;
}

function lockSheet(app, l) {
  const unlocked = l.locked === false;
  const ring = `<svg class="ring" viewBox="0 0 152 152" aria-hidden="true"><circle cx="76" cy="76" r="74"/></svg>`;
  const control = unlocked
    ? `<button type="button" class="hold unlocked" data-act="lock-now" data-id="${esc(l.id)}" aria-label="Lock ${esc(l.name)}">${icon("unlock")}</button>
       <p class="hint">Tap to lock.</p>`
    : `<button type="button" class="hold locked" data-hold="unlock" data-id="${esc(l.id)}" aria-label="Unlock ${esc(l.name)}: press and hold">${ring}${icon("lock")}</button>
       <p class="hint">Press and hold for a second to unlock.</p>`;
  return `${sheetHead(unlocked ? "var(--orange)" : "var(--green)", unlocked ? "unlock" : "lock", l.name, roomName(app.home, l))}
    <div class="sheet-body"><div class="big-val">${l.locked === null ? "Unknown" : unlocked ? "Unlocked" : "Locked"}</div>${control}</div>`;
}

function gateSheet(app, g) {
  const extra = [
    g.separateOpenClose && g.state !== "closed" ? `<button type="button" class="pill" data-act="gate" data-id="${esc(g.id)}" data-action="close">${icon("closeIn")}Close</button>` : "",
    g.canStop ? `<button type="button" class="pill" data-act="gate" data-id="${esc(g.id)}" data-action="stop">${icon("stop")}Stop</button>` : "",
  ].join("");
  return `${sheetHead("var(--blue)", "gate", g.name, "Gate")}
    <div class="sheet-body"><div class="big-val">${esc(GATE_TITLES[g.state] ?? "Ready")}</div>
      <div style="width:100%;display:grid;gap:12px;--c:var(--blue)">${gateControls(g)}</div>
      ${extra && g.state !== "moving" ? `<div class="pills">${extra}</div>` : ""}</div>`;
}

function keypadSheet(app, k) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => `<button type="button" class="key" data-act="key" data-v="${n}">${n}</button>`).join("");
  const panel = app.home.security.find((p) => p.id === k.id);
  const what = { armedAway: "arm away", armedHome: "arm home", disarmed: "disarm" }[k.mode] ?? "continue";
  return `${sheetHead("var(--indigo)", "shield", panel?.name ?? "Alarm", panel ? SECURITY_TITLES[panel.mode] : "")}
    <div class="sheet-body">
      <p class="hint" style="font-size:16px;color:var(--label)">Enter your code to ${what}</p>
      <div class="code-dots" id="code-dots" aria-live="polite">${dots(k.code)}</div>
      <div class="keypad">${keys}
        <button type="button" class="key text" data-act="key" data-v="clear">Clear</button>
        <button type="button" class="key" data-act="key" data-v="0">0</button>
        <button type="button" class="key text" data-act="key" data-v="del" aria-label="Delete">${icon("deleteKey")}</button>
      </div>
      <button type="button" class="w-btn primary" style="--c:var(--indigo);width:min(280px,100%);flex:none" data-act="key-enter" id="key-enter"${k.code ? "" : " disabled"}>${what[0].toUpperCase()}${what.slice(1)}</button>
    </div>`;
}

export const dots = (code) => Array.from({ length: Math.max(4, code.length) }, (_, i) => `<span class="${i < code.length ? "on" : ""}"></span>`).join("");

function confirmSheet(app, c) {
  return `${sheetHead(c.color ?? "var(--blue)", c.icon ?? "alert", c.title, "")}
    <div class="sheet-body"><p class="hint" style="font-size:16px">${esc(c.text)}</p>
      <div class="w-row" style="width:100%"><button type="button" class="w-btn" data-act="sheet-close">Cancel</button>
        <button type="button" class="w-btn primary" style="--c:${c.color ?? "var(--blue)"}" data-act="confirm-yes">${esc(c.label)}</button></div></div>`;
}

function cameraSheet(app, cam) {
  return `${sheetHead("var(--pink)", "camera", cam.name, `Live · ${fmtDate(new Date())}`)}
    <div class="sheet-body"><div class="big-cam">${cameraPicture(cam, app.api)}<span class="cam-pill time" data-cam-time></span></div></div>`;
}

function settingsSheet(app) {
  const look = app.device.look;
  const seg = (v, t) => `<button type="button" aria-pressed="${look === v}" data-act="look" data-v="${v}">${t}</button>`;
  const mins = [2, 5, 10].map((m) => `<button type="button" aria-pressed="${app.device.saverMin === m}" data-act="saver-min" data-v="${m}">${m} min</button>`).join("");
  const s = app.status;
  const system = app.transport === "local" ? "Demo in this browser" : { demo: "Demo house", crestronHome: "Crestron Home", customProgram: "Custom program" }[s.mode] ?? "Crestron";
  const state = s.connection === "connected" ? "Connected" : s.connection === "connecting" ? "Connecting…" : "Not connected";
  return `${sheetHead("#8e8e93", "gear", "Settings", "This iPad")}
    <div class="sheet-body" style="justify-items:stretch">
      <div class="list-label">Display</div>
      <div class="list">
        <div class="row"><span class="row-icon" style="--c:var(--indigo)">${icon("moon")}</span><span class="grow">Appearance</span>
          <div class="mini-seg">${seg("auto", "Auto")}${seg("light", "Light")}${seg("dark", "Dark")}</div></div>
        <div class="row"><span class="row-icon" style="--c:var(--orange)">${icon("desk")}</span><span class="grow">Wall panel mode<div class="note">Keeps the screen on and shows StandBy when idle</div></span>
          <button type="button" class="switch" role="switch" aria-checked="${app.device.wall}" aria-label="Wall panel mode" data-act="wall"></button></div>
        ${app.device.wall ? `<div class="row"><span class="row-icon" style="--c:#000">${icon("moon")}</span><span class="grow">StandBy after</span><div class="mini-seg">${mins}</div></div>` : ""}
        <button type="button" class="row" data-act="standby-now"><span class="row-icon" style="--c:#1c1c1e">${icon("sun")}</span><span class="grow">Show StandBy now</span>${icon("chevron")}</button>
      </div>
      <div class="list-label">System</div>
      <div class="list">
        <div class="row"><span class="row-icon" style="--c:var(--green)">${icon("wifi")}</span><span class="grow">${esc(system)}<div class="note">${esc(state)}</div></span></div>
        ${app.transport === "local" ? `<div class="row"><span class="row-icon" style="--c:var(--orange)">${icon("alert")}</span><span class="grow">This is a demo house<div class="note">Run the home server at home to connect your Crestron system</div></span></div>` : `<a class="row" href="../#setup"><span class="row-icon" style="--c:var(--blue)">${icon("sliders")}</span><span class="grow">System setup<div class="note">Processor, join map, cameras and the AI key</div></span>${icon("chevron")}</a>
        <a class="row" href="../"><span class="row-icon" style="--c:var(--pink)">${icon("grid")}</span><span class="grow">Classic view</span>${icon("chevron")}</a>`}
      </div>
    </div>`;
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
    case "camera": { const c = app.cameras.find((x) => x.id === spec.id); return c && cameraSheet(app, c); }
    case "keypad": return keypadSheet(app, spec);
    case "confirm": return confirmSheet(app, spec);
    case "settings": return settingsSheet(app);
    default: return null;
  }
}

export const isWideSheet = (spec) => spec.kind === "media" || spec.kind === "camera";
