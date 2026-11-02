// Home View extras: Edit Home, the favorites picker, the Automations page and its
// editor, the camera wall and the doorbell pop-up. HTML builders only; the handlers
// live in homeview.js.
import { icon, sceneIcon } from "../icons.js";
import { DAY_NAMES, describeAction, describeWhen, nextRun } from "../shared/automation.js";
import { roomOf } from "../shared/model.js";
import { registerSheet, sheetHead } from "./sheets.js";
import {
  attr, cameraPicture, esc, head, HOME_PARTS, minutesLeft, registerView, sec, upcomingRows,
} from "./views.js";

// ---------- Edit Home ----------

function editHomeSheet(app) {
  const shown = app.layout.map((id) => HOME_PARTS.find((p) => p.id === id)).filter(Boolean);
  const hidden = HOME_PARTS.filter((p) => !app.layout.includes(p.id));
  const row = (p, i) => `<div class="row ed-row">
      <button type="button" class="ed-btn remove" aria-label="Remove ${esc(p.name)}"${attr({ act: "layout-remove", part: p.id, key: `lr:${p.id}` })}>${icon("minus")}</button>
      <span class="row-icon" style="--c:var(--blue)">${icon(p.icon)}</span>
      <span class="grow">${esc(p.name)}<div class="note">${esc(p.about)}</div></span>
      <button type="button" class="ed-move" aria-label="Move ${esc(p.name)} up"${i === 0 ? " disabled" : ""}${attr({ act: "layout-move", part: p.id, dir: -1, key: `lu:${p.id}` })}>${icon("up")}</button>
      <button type="button" class="ed-move" aria-label="Move ${esc(p.name)} down"${i === shown.length - 1 ? " disabled" : ""}${attr({ act: "layout-move", part: p.id, dir: 1, key: `ld:${p.id}` })}>${icon("down")}</button>
    </div>`;
  const addRow = (p) => `<div class="row ed-row">
      <button type="button" class="ed-btn add" aria-label="Add ${esc(p.name)}"${attr({ act: "layout-add", part: p.id, key: `la:${p.id}` })}>${icon("plus")}</button>
      <span class="row-icon" style="--c:#8e8e93">${icon(p.icon)}</span>
      <span class="grow">${esc(p.name)}<div class="note">${esc(p.about)}</div></span>
    </div>`;
  return `${sheetHead("var(--blue)", "edit", "Edit Home", "Choose what this iPad shows on Home")}
    <div class="sheet-body" style="justify-items:stretch">
      <div class="list-label">On Home</div>
      <div class="list">${shown.length ? shown.map(row).join("") : `<div class="row"><span class="grow note">Nothing yet. Add something below.</span></div>`}</div>
      ${hidden.length ? `<div class="list-label">More to add</div><div class="list">${hidden.map(addRow).join("")}</div>` : ""}
      <div class="list">
        <button type="button" class="row" data-act="pick-favorites"><span class="row-icon" style="--c:var(--yellow)">${icon("star")}</span><span class="grow">Choose favorites<div class="note">${app.favorites.length ? `${app.favorites.length} chosen` : "None yet"}</div></span>${icon("chevron")}</button>
      </div>
      <div class="w-row"><button type="button" class="w-btn" data-act="layout-reset">Reset to standard</button><button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="sheet-close">Done</button></div>
    </div>`;
}

// ---------- favorites picker ----------

function favoritesSheet(app) {
  const h = app.home;
  const row = (kind, item, ic) => {
    const key = `${kind}:${item.id}`;
    const on = app.favorites.includes(key);
    return `<button type="button" class="row" aria-pressed="${on}"${attr({ act: "favorite", fav: key, key: `f:${key}` })}>
      <span class="row-icon" style="--c:${on ? "var(--yellow)" : "#8e8e93"}">${icon(ic)}</span><span class="grow">${esc(item.name)}</span>
      <span class="fav-star${on ? " on" : ""}">${icon(on ? "starFill" : "star")}</span></button>`;
  };
  const group = (title, rows) => (rows.length ? `<div class="list-label">${esc(title)}</div><div class="list">${rows.join("")}</div>` : "");
  const inRoom = (roomId) => [
    ...h.scenes.filter((x) => x.roomId === roomId).map((x) => row("scene", x, sceneIcon(x))),
    ...h.lights.filter((x) => x.roomId === roomId).map((x) => row("light", x, "bulb")),
    ...h.shades.filter((x) => x.roomId === roomId).map((x) => row("shade", x, "blinds")),
    ...h.media.filter((x) => x.roomId === roomId).map((x) => row("media", x, "music")),
    ...h.locks.filter((x) => x.roomId === roomId).map((x) => row("lock", x, "lock")),
  ];
  const wholeHouse = h.scenes.filter((x) => !roomOf(h, x.roomId)).map((x) => row("scene", x, sceneIcon(x)));
  return `${sheetHead("var(--yellow)", "star", "Favorites", "Tap to add or remove")}
    <div class="sheet-body" style="justify-items:stretch">
      ${group("Whole house", wholeHouse)}
      ${h.rooms.map((r) => group(r.name, inRoom(r.id))).join("")}
      <div class="w-row"><button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="sheet-close">Done</button></div>
    </div>`;
}

// ---------- Automations page ----------

export const TEMPLATES = [
  { name: "Lights off at bedtime", when: { type: "time", time: "23:00" }, days: [0, 1, 2, 3, 4, 5, 6], actions: [{ type: "lights", roomId: null, level: 0 }] },
  { name: "Close shades at sunset", when: { type: "sunset", offset: 0 }, days: [0, 1, 2, 3, 4, 5, 6], actions: [{ type: "shades", roomId: null, position: 0 }] },
  { name: "Open shades in the morning", when: { type: "time", time: "07:00" }, days: [1, 2, 3, 4, 5], actions: [{ type: "shades", roomId: null, position: 1 }] },
  { name: "Lock up at night", when: { type: "time", time: "22:30" }, days: [0, 1, 2, 3, 4, 5, 6], actions: [{ type: "lockAll" }] },
];

function automationsView(app) {
  const a = app.automations;
  const h = app.home;
  const now = new Date();
  const on = a.schedules.filter((s) => s.enabled).length;
  const cards = a.schedules.map((s) => {
    const next = nextRun(s, now, app.location);
    const needsPlace = s.when?.type !== "time" && !app.location;
    return `<div class="auto-card${s.enabled ? "" : " off"}">
      <button type="button" class="auto-main"${attr({ act: "schedule-edit", id: s.id, key: `se:${s.id}` })} aria-label="Edit ${esc(s.name)}">
        <span class="up-icon">${icon(s.when?.type === "time" ? "clock" : s.when?.type === "sunrise" ? "sunrise" : "moon")}</span>
        <span class="up-text"><b>${esc(s.name)}</b><span>${esc(describeWhen(s))}</span>
          <span class="auto-do">${esc(s.actions.map((x) => describeAction(x, h)).join(" · "))}</span>
          ${needsPlace ? `<span class="auto-warn">Set your town in Settings so it knows when the sun sets.</span>` : next ? `<span class="auto-next">Next: ${esc(next.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</span>` : ""}</span>
      </button>
      <button type="button" class="switch" role="switch" aria-checked="${s.enabled}" aria-label="${esc(s.name)} on or off"${attr({ act: "schedule-toggle", id: s.id, key: `st:${s.id}` })}></button>
    </div>`;
  }).join("");
  const templates = TEMPLATES.filter((t) => t.actions.every((x) => (x.type === "shades" ? h.shades.length : x.type === "lockAll" ? h.locks.length : h.lights.length)));
  const suggestions = templates.length
    ? `<div class="list-label">Ideas</div><div class="chips-wrap">${templates.map((t, i) => `<button type="button" class="capsule"${attr({ act: "schedule-template", i: TEMPLATES.indexOf(t), key: `tp:${i}` })}>${icon("plus")}${esc(t.name)}</button>`).join("")}</div>`
    : "";
  const timers = a.timers.length
    ? `<div class="upcoming">${upcomingRows(a.timers.map((t) => ({ at: t.at, ic: "timer", title: t.label, when: `in ${minutesLeft(t.at)}`, timerId: t.id })))}</div>`
    : `<div class="empty-row">${icon("timer")}<div><b>No timers running</b><span>Open any light, shade or music room and pick “Turn off in”.</span></div></div>`;
  return `${head(app, { eyebrow: "Automations", title: on ? `${on} ${on === 1 ? "schedule is" : "schedules are"} on` : "Automations", sub: "Schedules and timers run by themselves, even when nobody is using the app." })}
    <div class="auto-card vacation${a.vacation.enabled ? " active" : ""}">
      <div class="auto-main"><span class="up-icon">${icon("suitcase")}</span>
        <span class="up-text"><b>Vacation mode</b><span>Lights go on and off through the evening, as if someone were home. All off at 11:30 PM.</span>
        ${a.vacation.enabled && !app.location ? `<span class="auto-warn">Set your town in Settings so it starts at sunset.</span>` : ""}</span></div>
      <button type="button" class="switch" role="switch" aria-checked="${a.vacation.enabled}" aria-label="Vacation mode" data-act="vacation"></button>
    </div>
    ${sec("Schedules", cards ? `<div class="auto-list">${cards}</div>` : `<div class="empty-row">${icon("calendar")}<div><b>No schedules yet</b><span>For example: lights off at 11 PM, or shades closed at sunset.</span></div></div>`,
      { action: `<button type="button" class="capsule" data-act="schedule-new">${icon("plus")}New schedule</button>` })}
    ${suggestions}
    ${sec("Timers", timers)}`;
}

// ---------- schedule editor ----------

/** Everything an action can be, for the "Add" menu. Values are encoded as "type|roomId|value". */
function actionOptions(home) {
  const rooms = home.rooms.filter((r) => home.lights.some((l) => l.roomId === r.id));
  const shadeRooms = home.rooms.filter((r) => home.shades.some((s) => s.roomId === r.id));
  const opt = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
  return [
    home.scenes.length ? `<optgroup label="Scenes">${home.scenes.map((s) => opt(`scene|${s.id}|`, s.name)).join("")}</optgroup>` : "",
    home.lights.length ? `<optgroup label="Lights">${opt("lights||0", "All lights off")}${opt("lights||1", "All lights on")}
      ${rooms.map((r) => opt(`lights|${r.id}|0`, `${r.name} lights off`) + opt(`lights|${r.id}|1`, `${r.name} lights on`) + opt(`lights|${r.id}|0.3`, `${r.name} lights dim`)).join("")}</optgroup>` : "",
    home.shades.length ? `<optgroup label="Shades">${opt("shades||1", "Open all shades")}${opt("shades||0", "Close all shades")}
      ${shadeRooms.map((r) => opt(`shades|${r.id}|1`, `Open ${r.name} shades`) + opt(`shades|${r.id}|0`, `Close ${r.name} shades`)).join("")}</optgroup>` : "",
    `<optgroup label="Other">${home.media.length ? opt("mediaOff||", "Turn off all music and TV") : ""}${home.locks.length ? opt("lockAll||", "Lock all doors") : ""}</optgroup>`,
  ].join("");
}

export function decodeAction(value) {
  const [type, room, v] = String(value).split("|");
  switch (type) {
    case "scene": return { type, id: room };
    case "lights": return { type, roomId: room || null, level: Number(v) };
    case "shades": return { type, roomId: room || null, position: Number(v) };
    case "mediaOff": case "lockAll": return { type };
    default: return null;
  }
}

function scheduleSheet(app, spec) {
  const d = spec.draft;
  const w = d.when;
  const offsets = [-60, -30, -15, 0, 15, 30, 60];
  const offsetText = (o) => (o === 0 ? `At ${w.type}` : `${Math.abs(o)} min ${o < 0 ? "before" : "after"} ${w.type}`);
  return `${sheetHead("var(--green)", "calendar", d.id ? "Edit schedule" : "New schedule", "Runs by itself on the days you pick")}
    <form class="sheet-body sched" id="sched-form" style="justify-items:stretch">
      <label class="field"><span class="field-label">Name</span>
        <input class="text-input" id="sched-name" maxlength="60" autocomplete="off" placeholder="Lights off at bedtime" value="${esc(d.name)}"></label>
      <div class="field"><span class="field-label">When</span>
        <div class="mini-seg wide">${["time", "sunrise", "sunset"].map((t) => `<button type="button" aria-pressed="${w.type === t}"${attr({ act: "sched-when", v: t })}>${t === "time" ? "At a time" : t === "sunrise" ? "Sunrise" : "Sunset"}</button>`).join("")}</div>
        ${w.type === "time"
          ? `<input class="text-input" type="time" id="sched-time" value="${esc(w.time ?? "23:00")}" aria-label="Time">`
          : `<select class="text-input" id="sched-offset" aria-label="Before or after ${w.type}">${offsets.map((o) => `<option value="${o}"${(Number(w.offset) || 0) === o ? " selected" : ""}>${offsetText(o)}</option>`).join("")}</select>`}
        ${w.type !== "time" && !app.location ? `<p class="auto-warn">Set your town in Settings so it knows when the sun rises and sets.</p>` : ""}
      </div>
      <div class="field"><span class="field-label">Days</span>
        <div class="days">${DAY_NAMES.map((n, i) => `<button type="button" aria-pressed="${d.days.includes(i)}" aria-label="${n}"${attr({ act: "sched-day", d: i })}>${n[0]}</button>`).join("")}</div>
      </div>
      <div class="field"><span class="field-label">Do this</span>
        <div class="list">${d.actions.length ? d.actions.map((x, i) => `<div class="row"><span class="grow">${esc(describeAction(x, app.home))}</span>
          <button type="button" class="ed-btn remove" aria-label="Remove ${esc(describeAction(x, app.home))}"${attr({ act: "sched-action-remove", i })}>${icon("minus")}</button></div>`).join("")
          : `<div class="row"><span class="grow note">Add at least one thing to do.</span></div>`}</div>
        <div class="add-action"><select class="text-input" id="sched-add" aria-label="Choose an action"><option value="">Choose what to do…</option>${actionOptions(app.home)}</select>
          <button type="button" class="pill" data-act="sched-action-add">${icon("plus")}Add</button></div>
      </div>
      <p class="form-error" id="sched-error" role="alert" hidden></p>
      <div class="w-row">
        ${d.id ? `<button type="button" class="w-btn danger" data-act="schedule-delete">${icon("close")}Delete</button>` : ""}
        <button type="button" class="w-btn" data-act="sheet-close">Cancel</button>
        <button type="submit" class="w-btn primary" style="--c:var(--green)">Save</button>
      </div>
    </form>`;
}

// ---------- camera wall and doorbell ----------

export function cameraWallHTML(app) {
  return `<div class="overlay wall" role="dialog" aria-modal="true" aria-label="Camera wall">
    <div class="wall-grid" style="--n:${Math.min(3, Math.ceil(Math.sqrt(app.cameras.length)))}">
      ${app.cameras.map((c) => `<div class="wall-cam">${cameraPicture(c, app.api)}<span class="cam-pill name"><span class="live"></span>${esc(c.name)}</span></div>`).join("")}
    </div>
    <span class="cam-pill time wall-time" data-cam-time></span>
    <button type="button" class="wall-close" data-act="overlay-close" aria-label="Close camera wall">${icon("close")}</button>
  </div>`;
}

export function doorbellHTML(app, bell) {
  const cam = app.cameras.find((c) => c.id === bell.cameraId) ?? app.cameras[0];
  const lock = app.home.locks.find((l) => l.id === bell.lockId);
  const time = new Date(bell.ringAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ring = `<svg class="ring" viewBox="0 0 152 152" aria-hidden="true"><circle cx="76" cy="76" r="74"/></svg>`;
  return `<div class="overlay bell" role="alertdialog" aria-modal="true" aria-labelledby="bell-title">
    <div class="bell-card">
      <div class="bell-head"><span class="bell-icon">${icon("bell")}</span>
        <div><div class="bell-title" id="bell-title">${esc(bell.name)}</div><div class="bell-sub">Someone is at the door · ${esc(time)}</div></div></div>
      <div class="big-cam">${cam ? cameraPicture(cam, app.api) : `<div class="no-cam">${icon("camera")}<span>No camera linked to this doorbell</span></div>`}<span class="cam-pill time" data-cam-time></span></div>
      <div class="bell-actions">
        ${lock && lock.locked !== false ? `<div class="bell-hold"><button type="button" class="hold locked" data-hold="unlock" data-id="${esc(lock.id)}" aria-label="Unlock ${esc(lock.name)}: press and hold">${ring}${icon("lock")}</button><span>Hold to unlock ${esc(lock.name)}</span></div>` : ""}
        <button type="button" class="w-btn" data-act="overlay-close">Dismiss</button>
      </div>
    </div>
  </div>`;
}

registerView("automations", automationsView);
registerSheet("edit-home", editHomeSheet);
registerSheet("favorites", favoritesSheet);
registerSheet("schedule", scheduleSheet);

