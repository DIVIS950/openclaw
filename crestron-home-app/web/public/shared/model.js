// Shared by the browser app and the home server: the house data shape, and the
// optimistic "apply a command" logic. Mirrors HomeControl/Model/Models.swift.
//
// A home snapshot:
// {
//   rooms:    [{ id, name, floor }]   (floor: optional name like "1.NP", used to group rooms)
//   lights:   [{ id, name, roomId, level 0..1, dimmable, online }]
//   shades:   [{ id, name, roomId, position 0..1 (1 = open), hasPosition, canStop, online }]
//   scenes:   [{ id, name, roomId, kind, active }]
//   media:    [{ id, name, roomId, on, volume 0..1, muted, hasVolume, sources: [{ id, name }], sourceId,
//               playing, canTransport, nowPlaying: { title, artist, album } | null,
//               kind: "tv" | "audio", canRemote (TV remote keys), apps: [{ id, name }], channel: { number, name } | null }]
//   locks:    [{ id, name, roomId, locked: true | false | null }]
//   security: [{ id, name, mode, needsCode, canArmHome, canArmAway }]
//   gates:    [{ id, name, state, separateOpenClose, canStop }]
//   sensors:  [{ id, name, roomId, kind, active }]
//   doorbells: [{ id, name, cameraId, lockId, ringAt }]  (ringAt: time of the last ring, ms)
//   climate:  [{ id, name, roomId, current °C | null, target °C | null, min, max, step, heating: bool | null, online }]
//   modes:    [{ id, name, kind, value, options: [{ id, name }] }]  (e.g. the house heating mode)
//   switches: [{ id, name, roomId, kind, on, current °C | null }]  (sauna, motion-sensor lights, pumps…)
// }
// Every device may carry `origin`: "crestron" | "homekit" | "samsungtv" | "demo" (which system it comes from).
// Devices from several systems live in one home; ids are unique across systems (each origin prefixes its own).
//
// Commands are plain objects, e.g. { type: "setLight", id, level }.

export const COMMAND_TYPES = [
  "setLight", "setShade", "stopShade", "recallScene",
  "mediaPower", "mediaVolume", "mediaMute", "mediaSource", "mediaTransport",
  "setLock", "setSecurity", "gate",
  "setClimate", "setMode", "setSwitch",
  "tvKey", "tvApp", "mediaChannel",
];

/** Remote-control keys a TV may accept (tvKey.key). */
export const TV_KEYS = [
  "up", "down", "left", "right", "ok", "back", "home", "menu", "exit", "info", "guide",
  "chUp", "chDown", "volUp", "volDown", "mute", "power",
  "play", "pause", "stop", "rewind", "fastForward",
  "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9",
  "red", "green", "yellow", "blue",
];

export const SECURITY_TITLES = {
  disarmed: "Disarmed",
  armedHome: "Armed home",
  armedAway: "Armed away",
  alarm: "Alarm",
  unknown: "Unknown",
};

export const GATE_TITLES = {
  open: "Open",
  closed: "Closed",
  moving: "Moving",
  unknown: "Ready",
};

export const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
export const pct = (v) => `${Math.round(clamp01(v) * 100)}%`;

export function emptyHome() {
  return {
    rooms: [], lights: [], shades: [], scenes: [], media: [], locks: [], security: [], gates: [], sensors: [], doorbells: [],
    climate: [], modes: [], switches: [],
  };
}

/** Fills in lists and fields that older backends leave out, so the app can rely on them. */
export function normalizeHome(home) {
  const h = { ...emptyHome(), ...(home ?? {}) };
  for (const key of Object.keys(emptyHome())) if (!Array.isArray(h[key])) h[key] = [];
  for (const m of h.media) {
    m.playing ??= m.on;
    m.canTransport ??= false;
    m.nowPlaying ??= null;
    m.kind ??= /\btv\b|telev/i.test(m.name) ? "tv" : "audio";
    m.canRemote ??= false;
    if (!Array.isArray(m.apps)) m.apps = [];
    m.channel ??= null;
  }
  for (const c of h.climate) {
    c.min ??= 5;
    c.max ??= 30;
    c.step ??= 0.5;
    c.current ??= null;
    c.target ??= null;
    c.heating ??= null;
  }
  for (const m of h.modes) if (!Array.isArray(m.options)) m.options = [];
  for (const s of h.switches) s.current ??= null;
  return h;
}

/** Key of the control a command changes; null for momentary commands (scenes, gate pulses). */
export function stateKey(cmd) {
  switch (cmd.type) {
    case "setLight": return `light:${cmd.id}`;
    case "setShade": return `shade:${cmd.id}`;
    case "mediaPower": return `power:${cmd.id}`;
    case "mediaVolume": return `volume:${cmd.id}`;
    case "mediaMute": return `mute:${cmd.id}`;
    case "mediaSource": return `source:${cmd.id}`;
    case "mediaTransport": return cmd.action === "play" || cmd.action === "pause" ? `playing:${cmd.id}` : null;
    case "setLock": return `lock:${cmd.id}`;
    case "setSecurity": return `security:${cmd.id}`;
    case "setClimate": return `climate:${cmd.id}`;
    case "setMode": return `mode:${cmd.id}`;
    case "setSwitch": return `switch:${cmd.id}`;
    case "tvApp": return `source:${cmd.id}`;
    case "mediaChannel": return `channel:${cmd.id}`;
    default: return null;
  }
}

/** Rejects anything that isn't a well-formed command (the server checks this before acting). */
export function validateCommand(cmd) {
  if (!cmd || typeof cmd !== "object" || !COMMAND_TYPES.includes(cmd.type)) return "Unknown command";
  if (typeof cmd.id !== "string" || !cmd.id) return "Missing id";
  const num = (k) => typeof cmd[k] === "number" && Number.isFinite(cmd[k]);
  switch (cmd.type) {
    case "setLight": return num("level") ? null : "Missing level";
    case "setShade": return num("position") ? null : "Missing position";
    case "mediaVolume": return num("level") ? null : "Missing level";
    case "mediaPower": return typeof cmd.on === "boolean" ? null : "Missing on";
    case "mediaMute": return typeof cmd.muted === "boolean" ? null : "Missing muted";
    case "mediaSource": return typeof cmd.sourceId === "string" ? null : "Missing sourceId";
    case "setLock": return typeof cmd.locked === "boolean" ? null : "Missing locked";
    case "setSecurity": return ["disarmed", "armedHome", "armedAway"].includes(cmd.mode) ? null : "Bad mode";
    case "gate": return ["open", "close", "stop", "trigger"].includes(cmd.action) ? null : "Bad action";
    case "mediaTransport": return ["play", "pause", "next", "previous"].includes(cmd.action) ? null : "Bad action";
    case "setClimate": return num("target") ? null : "Missing target";
    case "setMode": return typeof cmd.value === "string" && cmd.value ? null : "Missing value";
    case "setSwitch": return typeof cmd.on === "boolean" ? null : "Missing on";
    case "tvKey": return TV_KEYS.includes(cmd.key) ? null : "Bad key";
    case "tvApp": return typeof cmd.appId === "string" && cmd.appId ? null : "Missing appId";
    case "mediaChannel": return Number.isInteger(cmd.channel) && cmd.channel > 0 ? null : "Bad channel";
    default: return null;
  }
}

/** Optimistic local update: show what the user asked for before the processor confirms. Mutates `home`. */
export function applyCommand(home, cmd) {
  const find = (list) => list.find((x) => x.id === cmd.id);
  let item;
  switch (cmd.type) {
    case "setLight":
      if ((item = find(home.lights))) item.level = clamp01(cmd.level);
      break;
    case "setShade":
      if ((item = find(home.shades))) item.position = clamp01(cmd.position);
      break;
    case "recallScene":
      if ((item = find(home.scenes))) item.active = true;
      break;
    case "mediaPower":
      if ((item = find(home.media))) item.on = cmd.on;
      break;
    case "mediaVolume":
      if ((item = find(home.media))) item.volume = clamp01(cmd.level);
      break;
    case "mediaMute":
      if ((item = find(home.media))) item.muted = cmd.muted;
      break;
    case "mediaSource":
      if ((item = find(home.media))) { item.sourceId = cmd.sourceId; item.on = true; }
      break;
    case "mediaTransport":
      if ((item = find(home.media)) && (cmd.action === "play" || cmd.action === "pause")) item.playing = cmd.action === "play";
      break;
    case "setLock":
      if ((item = find(home.locks))) item.locked = cmd.locked;
      break;
    case "setSecurity":
      if ((item = find(home.security))) item.mode = cmd.mode;
      break;
    case "gate":
      if ((item = find(home.gates))) item.state = cmd.action === "stop" ? "unknown" : "moving";
      break;
    case "setClimate":
      if ((item = find(home.climate ?? []))) item.target = clampTarget(item, cmd.target);
      break;
    case "setMode":
      if ((item = find(home.modes ?? [])) && item.options.some((o) => o.id === cmd.value)) item.value = cmd.value;
      break;
    case "setSwitch":
      if ((item = find(home.switches ?? []))) item.on = cmd.on;
      break;
    case "tvKey":
      if ((item = find(home.media))) {
        if (cmd.key === "mute") item.muted = !item.muted;
        else if (cmd.key === "volUp" && item.hasVolume) item.volume = clamp01(item.volume + 0.05);
        else if (cmd.key === "volDown" && item.hasVolume) item.volume = clamp01(item.volume - 0.05);
        else if (cmd.key === "play") item.playing = true;
        else if (cmd.key === "pause") item.playing = false;
      }
      break;
    case "tvApp":
      if ((item = find(home.media))) { item.on = true; item.sourceId = null; item.playing = true; }
      break;
    case "mediaChannel":
      if ((item = find(home.media))) item.channel = { number: cmd.channel, name: item.channel?.number === cmd.channel ? item.channel.name : "" };
      break;
  }
  return home;
}

/** Keeps a thermostat target inside its range, on its step (0.5 °C by default). */
export function clampTarget(c, value) {
  const step = c.step || 0.5;
  const v = Math.round(Number(value) / step) * step;
  return Math.min(c.max ?? 30, Math.max(c.min ?? 5, Number.isFinite(v) ? v : c.min ?? 5));
}

/** "21,5 °C" (Czech) or "21.5 °C". */
export function fmtTemp(v, lang = "cs") {
  if (v == null || !Number.isFinite(Number(v))) return "–";
  const n = Math.round(Number(v) * 10) / 10;
  return `${n.toLocaleString(lang === "cs" ? "cs-CZ" : "en-US", { maximumFractionDigits: 1 })} °C`;
}

/** Floors in the order their rooms appear; rooms without a floor go last under "". */
export function floorsOf(home) {
  const order = [];
  for (const r of home.rooms) if (!order.includes(r.floor ?? "")) order.push(r.floor ?? "");
  return order.sort((a, b) => (a === "") - (b === "")).map((name) => ({ name, rooms: home.rooms.filter((r) => (r.floor ?? "") === name) }));
}

export function roomOf(home, roomId) {
  return home.rooms.find((r) => r.id === roomId) ?? null;
}

/** Whole-house scenes; falls back to the first few when every scene belongs to a room. */
export function homeScenes(home) {
  const global = home.scenes.filter((s) => !roomOf(home, s.roomId));
  return global.length ? global : home.scenes.slice(0, 8);
}
