// Shared by the browser app and the home server: the house data shape, and the
// optimistic "apply a command" logic. Mirrors HomeControl/Model/Models.swift.
//
// A home snapshot:
// {
//   rooms:    [{ id, name }]
//   lights:   [{ id, name, roomId, level 0..1, dimmable, online }]
//   shades:   [{ id, name, roomId, position 0..1 (1 = open), hasPosition, canStop, online }]
//   scenes:   [{ id, name, roomId, kind, active }]
//   media:    [{ id, name, roomId, on, volume 0..1, muted, hasVolume, sources: [{ id, name }], sourceId }]
//   locks:    [{ id, name, roomId, locked: true | false | null }]
//   security: [{ id, name, mode, needsCode, canArmHome, canArmAway }]
//   gates:    [{ id, name, state, separateOpenClose, canStop }]
//   sensors:  [{ id, name, roomId, kind, active }]
// }
//
// Commands are plain objects, e.g. { type: "setLight", id, level }.

export const COMMAND_TYPES = [
  "setLight", "setShade", "stopShade", "recallScene",
  "mediaPower", "mediaVolume", "mediaMute", "mediaSource",
  "setLock", "setSecurity", "gate",
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
  return { rooms: [], lights: [], shades: [], scenes: [], media: [], locks: [], security: [], gates: [], sensors: [] };
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
    case "setLock": return `lock:${cmd.id}`;
    case "setSecurity": return `security:${cmd.id}`;
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
    case "setLock":
      if ((item = find(home.locks))) item.locked = cmd.locked;
      break;
    case "setSecurity":
      if ((item = find(home.security))) item.mode = cmd.mode;
      break;
    case "gate":
      if ((item = find(home.gates))) item.state = cmd.action === "stop" ? "unknown" : "moving";
      break;
  }
  return home;
}

export function roomOf(home, roomId) {
  return home.rooms.find((r) => r.id === roomId) ?? null;
}

/** Whole-house scenes; falls back to the first few when every scene belongs to a room. */
export function homeScenes(home) {
  const global = home.scenes.filter((s) => !roomOf(home, s.roomId));
  return global.length ? global : home.scenes.slice(0, 8);
}
