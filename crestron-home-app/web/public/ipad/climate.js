// Heating (Topení), the sauna and other switches, alarm zones and the arrival gates.
// Pure HTML builders plus the sheet for one room's thermostat; actions live in homeview.js.
import { icon } from "../icons.js";
import { t, tn, lang } from "../shared/i18n.js";
import { fmtTemp, floorsOf, GATE_TITLES, roomOf, SECURITY_TITLES } from "../shared/model.js";
import { attr, esc, gateControls, sec } from "./views.js";

export const temp = (v) => fmtTemp(v, lang());
const HEAT = "var(--orange)";
const COOL = "var(--teal)";

/** The house heating mode (Zapnuto / Individuální / Útlum / Vypnuto); null when there is none. */
export const heatingMode = (home) => home.modes.find((m) => m.kind === "heating") ?? null;
export const heatingOff = (home) => heatingMode(home)?.value === "off";

/** Average room temperature, for the sidebar, chips and StandBy. */
export function averageTemp(home) {
  const temps = home.climate.map((c) => c.current).filter((v) => typeof v === "number");
  return temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
}

export const roomClimate = (home, roomId) => home.climate.find((c) => c.roomId === roomId) ?? null;

// ---------- tiles ----------

export function climateState(c) {
  if (c.online === false) return t("No response");
  // Like Apple Home: the room temperature, and where it is heading while it heats.
  return c.heating && c.target != null ? `${temp(c.current)} → ${temp(c.target)}` : temp(c.current);
}

/** Tile fields for a thermostat (the tile itself is drawn by views.js). */
export function climateTile(home, c, showRoom) {
  const room = roomOf(home, c.roomId);
  // A thermostat is usually named after its room; then the room name alone is enough.
  const same = room && room.name === c.name;
  return {
    kind: "climate", id: c.id, on: Boolean(c.heating), color: c.heating ? HEAT : COOL, iconName: c.heating ? "flame" : "thermo",
    name: same ? (showRoom ? room.name : t("Temperature")) : c.name, state: climateState(c),
    room: showRoom && room && !same ? room.name : "",
    toggleLabel: t("{name} heating controls", { name: c.name }), offline: c.online === false,
  };
}

export function switchState(s) {
  const base = s.on ? t("On") : t("Off");
  return s.current != null ? `${base} · ${temp(s.current)}` : base;
}

const switchIcon = (s) => ({ sauna: "steam", motion: "motion", heating: "flame" })[s.kind] ?? "power";

export function switchTile(home, s, room) {
  return {
    kind: "switch", id: s.id, on: s.on, color: s.kind === "sauna" ? HEAT : "var(--green)", iconName: switchIcon(s),
    name: s.name, state: switchState(s), room: room ? roomOf(home, s.roomId)?.name ?? "" : "",
    toggleLabel: s.on ? t("Turn off {name}", { name: s.name }) : t("Turn on {name}", { name: s.name }),
  };
}

// ---------- widgets ----------

/** Zapnuto / Individuální / Útlum / Vypnuto. */
export function modeWidget(home, m) {
  const avg = averageTemp(home);
  const heatingRooms = home.climate.filter((c) => c.heating).length;
  const opt = m.options.find((o) => o.id === m.value);
  return `<div data-tilt class="widget mode-widget" style="--c:${m.value === "off" ? "#8e8e93" : HEAT}">
    <div class="w-top"><span class="w-glyph">${icon(m.value === "off" ? "thermo" : "flame")}</span>
      <div class="w-text"><div class="w-name">${esc(m.name)}</div><div class="w-state">${esc(opt?.name ?? "–")}</div></div>
      ${avg != null ? `<div class="w-temp" aria-label="${esc(t("Average {t}", { t: temp(avg) }))}">${esc(temp(avg))}</div>` : ""}</div>
    <div class="w-note">${esc(m.value === "off" ? t("Heating is off in the whole house") : heatingRooms ? tn(heatingRooms, "{n} room heating", "{n} rooms heating") : t("All rooms are warm"))}</div>
    <div class="seg">${m.options.map((o) => `<button type="button" aria-pressed="${m.value === o.id}"${attr({ act: "mode", id: m.id, value: o.id, key: `md:${m.id}:${o.id}` })}>${esc(o.name)}</button>`).join("")}</div>
  </div>`;
}

/** The sauna: its temperature, and a big on/off button. */
export function saunaWidget(s) {
  const warm = s.current != null && s.current >= 70;
  return `<div data-tilt class="widget sauna-widget${s.on ? " on" : ""}" style="--c:${s.on ? HEAT : "#8e8e93"}">
    <div class="w-top"><span class="w-glyph">${icon("steam")}</span>
      <div class="w-text"><div class="w-name">${esc(s.name)}</div><div class="w-state">${esc(s.on ? (warm ? t("Ready") : t("Heating up")) : t("Off"))}</div></div>
      ${s.current != null ? `<div class="w-temp">${esc(temp(s.current))}</div>` : ""}</div>
    ${s.on ? `<div class="sauna-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.min(100, ((s.current ?? 20) - 20) / 65 * 100)).toFixed(0)}%"></i></div>` : ""}
    <div class="w-row"><button type="button" class="w-btn${s.on ? "" : " primary"}" style="--c:${HEAT}"${attr({ act: "switch", id: s.id, key: `sw:${s.id}` })}>${icon("power")}${esc(s.on ? t("Turn off") : t("Turn on"))}</button>
      <button type="button" class="w-more" aria-label="${esc(t("More controls"))}"${attr({ act: "detail", kind: "switch", id: s.id })}>${icon("more")}</button></div>
  </div>`;
}

/** All alarm zones in one card, each armed or off with one tap (Dům, Garáž, Klub, Sauna). */
export function zonesWidget(home) {
  const armed = home.security.filter((z) => z.mode === "armedAway" || z.mode === "armedHome").length;
  const alarm = home.security.some((z) => z.mode === "alarm");
  const row = (z) => {
    const on = z.mode === "armedAway" || z.mode === "armedHome";
    const next = on || z.mode === "alarm" ? "disarmed" : z.canArmAway ? "armedAway" : "armedHome";
    return `<button type="button" class="zone${on ? " on" : ""}${z.mode === "alarm" ? " alarm" : ""}" aria-pressed="${on}"
      aria-label="${esc(`${z.name}: ${t(SECURITY_TITLES[z.mode] ?? "Unknown")}. ${on ? t("Disarm") : t("Arm")}`)}"${attr({ act: "arm", id: z.id, mode: next, key: `z:${z.id}` })}>
      <span class="zone-icon">${icon(on ? "lock" : z.mode === "alarm" ? "shieldAlert" : "unlock")}</span><b>${esc(z.name)}</b><span>${esc(t(SECURITY_TITLES[z.mode] ?? "Unknown"))}</span></button>`;
  };
  return `<div data-tilt class="widget zones-widget wide" style="--c:${alarm ? "var(--red)" : armed ? "var(--indigo)" : "#8e8e93"}">
    <div class="w-top"><span class="w-glyph">${icon(alarm ? "shieldAlert" : armed ? "shieldCheck" : "shield")}</span>
      <div class="w-text"><div class="w-name">${esc(t("Security zones"))}</div><div class="w-state${alarm ? " bad" : ""}">${esc(alarm ? t("Alarm") : armed ? tn(armed, "{n} zone armed", "{n} zones armed") : t("Disarmed"))}</div></div></div>
    <div class="zones">${home.security.map(row).join("")}</div>
  </div>`;
}

/** Every gate in one card. Opening still needs a full slide, so a stray tap never opens one. */
export function arrivalWidget(home) {
  const open = home.gates.filter((g) => g.state === "open" || g.state === "moving").length;
  return `<div data-tilt class="widget arrival-widget wide" style="--c:var(--blue)">
    <div class="w-top"><span class="w-glyph">${icon("gate")}</span>
      <div class="w-text"><div class="w-name">${esc(t("Arrival"))}</div><div class="w-state${open ? " warn" : ""}">${esc(open ? tn(open, "{n} open", "{n} open") : t("All closed"))}</div></div></div>
    <div class="arrivals">${home.gates.map((g) => `<div class="arrival">
        <div class="arrival-head"><b>${esc(g.name)}</b><span>${esc(t(GATE_TITLES[g.state] ?? "Ready"))}</span>
          <button type="button" class="w-more" aria-label="${esc(t("{name} controls", { name: g.name }))}"${attr({ act: "detail", kind: "gate", id: g.id })}>${icon("more")}</button></div>
        ${gateControls(g)}</div>`).join("")}</div>
  </div>`;
}

/** Small Home widget: average temperature, the house mode and the sauna. */
export function heatingSummaryWidget(home) {
  const m = heatingMode(home);
  const sauna = home.switches.find((s) => s.kind === "sauna");
  const avg = averageTemp(home);
  if (!m && !sauna && avg == null) return "";
  const opt = m?.options.find((o) => o.id === m.value);
  return `<div data-tilt class="widget heat-widget" style="--c:${heatingOff(home) ? "#8e8e93" : HEAT}">
    <a class="w-cover" href="#heating" aria-label="${esc(t("Heating"))}"></a>
    <div class="w-top"><span class="w-glyph">${icon("thermo")}</span>
      <div class="w-text"><div class="w-name">${esc(t("Heating"))}</div><div class="w-state">${esc(avg != null ? temp(avg) : opt?.name ?? "")}</div></div></div>
    <div class="heat-rows">
      ${m ? `<div class="heat-row">${icon("flame")}<span>${esc(m.name)}</span><b>${esc(opt?.name ?? "–")}</b></div>` : ""}
      ${sauna ? `<button type="button" class="heat-row btn${sauna.on ? " on" : ""}"${attr({ act: "switch", id: sauna.id, key: `hs:${sauna.id}` })}>${icon("steam")}<span>${esc(sauna.name)}</span><b>${esc(switchState(sauna))}</b></button>` : ""}
    </div>
  </div>`;
}

// ---------- the Heating page ----------

export function heatingBody(app, tileHTML) {
  const h = app.home;
  const widgets = [
    ...h.modes.map((m) => modeWidget(h, m)),
    ...h.switches.filter((s) => s.kind === "sauna").map(saunaWidget),
  ];
  // Thermostats grouped by floor, like the rest of the app.
  const floors = floorsOf(h).map(({ name, rooms }) => {
    const list = rooms.map((r) => h.climate.filter((c) => c.roomId === r.id)).flat();
    return list.length ? sec(esc(name || t("Other")), `<div class="tiles">${list.map((c) => tileHTML(climateTile(h, c, true))).join("")}</div>`) : "";
  }).join("");
  const loose = h.climate.filter((c) => !roomOf(h, c.roomId));
  const others = h.switches.filter((s) => s.kind !== "sauna");
  return `${heatingOff(h) ? `<div class="notice">${icon("alert")}<div>${esc(t("Heating is off in the whole house"))}</div></div>` : ""}
    ${widgets.length ? `<div class="widgets">${widgets.join("")}</div>` : ""}
    ${floors}
    ${loose.length ? sec(esc(t("Other")), `<div class="tiles">${loose.map((c) => tileHTML(climateTile(h, c, false))).join("")}</div>`) : ""}
    ${others.length ? sec(esc(t("Switches")), `<div class="tiles">${others.map((s) => tileHTML(switchTile(h, s, true))).join("")}</div>`) : ""}
    ${!h.climate.length && !widgets.length ? `<div class="empty">${icon("thermo")}<b>${esc(t("No heating"))}</b></div>` : ""}`;
}

// ---------- sheets ----------

const PRESETS = [18, 20, 21, 22, 23, 24];

export function climateSheet(app, c, sheetHead) {
  const room = roomOf(app.home, c.roomId);
  const step = c.step || 0.5;
  const pctOf = (v) => ((v - c.min) / (c.max - c.min)) * 100;
  const off = heatingOff(app.home);
  return `${sheetHead(c.heating ? HEAT : COOL, c.heating ? "flame" : "thermo", c.name, room && room.name !== c.name ? room.name : t("Heating"), app, `climate:${c.id}`, c.origin)}
    <div class="sheet-body">
      <div class="dial" style="--now:${pctOf(c.current ?? c.min).toFixed(1)};--set:${pctOf(c.target ?? c.min).toFixed(1)}">
        <div class="dial-ring" aria-hidden="true"></div>
        <div class="dial-text"><span>${esc(t("Target"))}</span><b data-live="climate:${esc(c.id)}">${esc(temp(c.target))}</b>
          <span class="dial-now">${icon(c.heating ? "flame" : "thermo")}${esc(t("Now {t}", { t: temp(c.current) }))}</span></div>
      </div>
      <div class="step-row">
        <button type="button" class="step" aria-label="${esc(t("Cooler"))}"${attr({ act: "climate-step", id: c.id, delta: -step, key: `cs:${c.id}:-` })}>${icon("minus")}</button>
        <span class="step-state${c.heating ? " heating" : ""}">${esc(off ? t("Heating is off in the whole house") : c.heating ? t("Heating on") : t("Not heating"))}</span>
        <button type="button" class="step" aria-label="${esc(t("Warmer"))}"${attr({ act: "climate-step", id: c.id, delta: step, key: `cs:${c.id}:+` })}>${icon("plus")}</button>
      </div>
      <div class="pills">${PRESETS.filter((v) => v >= c.min && v <= c.max).map((v) => `<button type="button" class="pill" aria-pressed="${c.target === v}"${attr({ act: "climate-set", id: c.id, target: v })}>${esc(temp(v))}</button>`).join("")}</div>
    </div>`;
}

export function switchSheet(app, s, sheetHead, timerPills) {
  const room = roomOf(app.home, s.roomId);
  return `${sheetHead(s.on ? (s.kind === "sauna" ? HEAT : "var(--green)") : "#8e8e93", switchIcon(s), s.name, room && room.name !== s.name ? room.name : "", app, `switch:${s.id}`, s.origin)}
    <div class="sheet-body">
      <div class="big-val">${esc(s.current != null ? temp(s.current) : s.on ? t("On") : t("Off"))}</div>
      ${s.kind === "sauna" && s.on ? `<p class="hint">${esc((s.current ?? 0) >= 70 ? t("The sauna is ready") : t("The sauna is heating up"))}</p>` : ""}
      <div class="list" style="width:100%"><div class="row"><span class="row-icon" style="--c:${s.kind === "sauna" ? HEAT : "var(--green)"}">${icon(switchIcon(s))}</span><span class="grow">${esc(s.name)}</span>
        <button type="button" class="switch" role="switch" aria-checked="${s.on}" aria-label="${esc(s.name)}"${attr({ act: "switch", id: s.id })}></button></div></div>
      ${s.on ? timerPills(t("Turn off"), t("{name} off", { name: s.name }), { type: "setSwitch", id: s.id, on: false }) : ""}
    </div>`;
}

