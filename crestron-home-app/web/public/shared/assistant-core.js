// The parts of the home assistant shared by the home server (Claude API) and the
// browser demo (the artifact's `sample` capability): the instructions, the one tool,
// and the safety rules for which commands a person must confirm.
import { describeAction, describeWhen, validateSchedule } from "./automation.js";
import { t } from "./i18n.js";
import { GATE_TITLES, SECURITY_TITLES, validateCommand } from "./model.js";

export const ASSISTANT_RULES = `You are the voice-and-chat assistant for a Crestron-controlled home, shown on wall iPads and phones.
You control the house only through the control_home tool. Each request includes the current home state as JSON; use the exact ids from it.

How to act:
- Do what was asked with as few tool calls as possible: put every command for one request in a single control_home call.
- Light levels, shade positions and volume are numbers from 0 to 1 (0 = off/closed, 1 = full/open). "Dim" means about 0.3; "turn on" means 1 unless a level is given.
- "All lights" / "the house" means every light. A room name means every light in that room. If a request is genuinely ambiguous, ask one short question instead of guessing.
- Scenes: prefer recalling a matching scene (for example "good night") over setting devices one by one.
- For questions ("is the front door locked?", "what's on?"), answer from the state without calling the tool.
- Unlocking doors and opening the gate need the person to confirm: request them with the tool anyway; the app shows a confirm button. Say that they need to tap it.
- You cannot disarm the alarm; tell the person to use the keypad.
- "Later" requests ("turn off the kitchen lights in 30 minutes", "sleep timer for an hour") use set_timer. Repeating requests ("every night at 11 close the shades", "weekdays at sunset turn on the patio lights") use create_schedule. Confirm what you set up in one sentence.
- "Here", "this room" and "in here" mean the room the person is looking at, given as viewingRoom in the state.
- Heating: each room thermostat has a current and a target temperature in °C; setClimate sets the target (steps of 0.5). "Warmer"/"colder" means ±1 °C. The whole-house heating mode is a mode (setMode with one of its option ids). The sauna and similar things are switches (setSwitch on/off).
- Rooms are grouped by floor (for example 1.NP, 2.NP, Suterén, Venek); "upstairs"/"nahoře" means the floors above 1.NP.
- Names in this house are Czech. Answer in appLanguage from the state (the language the app is set to), unless the person clearly writes in another language.

How to answer:
- One or two short, friendly sentences in the person's language. No lists, no markdown, no ids.
- Only say something happened if the tool result says it did.`;

export const CONTROL_TOOL_NAME = "control_home";
export const TIMER_TOOL_NAME = "set_timer";
export const SCHEDULE_TOOL_NAME = "create_schedule";

const COMMAND_ITEM = () => CONTROL_TOOL_SCHEMA.properties.commands.items;

export const TIMER_TOOL = {
  name: TIMER_TOOL_NAME,
  description: "Run commands once, later: after the given number of minutes (1 to 1440). Use it for \"in 30 minutes\", \"sleep timer\" and similar. " +
    "Only lights, shades, scenes, music, heating, the sauna and locking (never unlocking, the gate or the alarm) can be timed.",
  get schema() {
    return {
      type: "object",
      properties: {
        minutes: { type: "integer", minimum: 1, maximum: 1440 },
        label: { type: "string", description: "Short name shown in the app, e.g. \"Kitchen lights off\"." },
        commands: { type: "array", minItems: 1, items: COMMAND_ITEM() },
      },
      required: ["minutes", "label", "commands"],
      additionalProperties: false,
    };
  },
};

export const SCHEDULE_TOOL = {
  name: SCHEDULE_TOOL_NAME,
  description: "Create a repeating schedule that the home runs by itself. when.type is \"time\" (with time \"HH:MM\", 24-hour) or \"sunrise\"/\"sunset\" (with offset in minutes, negative = before). " +
    "days are 0-6 (0 = Sunday). Actions: scene (id), lights (roomId or null for all, level 0-1), shades (roomId or null, position 0 or 1), mediaOff, lockAll.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      when: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["time", "sunrise", "sunset"] },
          time: { type: "string", description: "HH:MM, 24-hour, for type time" },
          offset: { type: "integer", minimum: -180, maximum: 180 },
        },
        required: ["type"],
        additionalProperties: false,
      },
      days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, minItems: 1 },
      actions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["scene", "lights", "shades", "mediaOff", "lockAll"] },
            id: { type: "string", description: "scene id, for type scene" },
            roomId: { type: ["string", "null"], description: "room id, or null for the whole house" },
            level: { type: "number", minimum: 0, maximum: 1 },
            position: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["type"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "when", "days", "actions"],
    additionalProperties: false,
  },
};

export const CONTROL_TOOL_DESCRIPTION =
  "Send one or more commands to the house. Each command needs `type` and the device `id` from the home state, plus the field its type uses: " +
  "setLight → level; setShade → position; stopShade → (nothing); recallScene → (nothing); mediaPower → on; mediaVolume → level; " +
  "mediaMute → muted; mediaSource → sourceId; setLock → locked; setSecurity → mode (armedAway or armedHome); gate → action (open, close, stop, trigger); " +
  "setClimate → target (°C); setMode → value (an option id of that mode); setSwitch → on. " +
  "Returns one line per command saying whether it was done, needs the person to confirm, or was refused.";

export const CONTROL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    commands: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["setLight", "setShade", "stopShade", "recallScene", "mediaPower", "mediaVolume", "mediaMute", "mediaSource", "setLock", "setSecurity", "gate", "setClimate", "setMode", "setSwitch"],
          },
          id: { type: "string", description: "Device, scene, media room, lock, alarm, gate, thermostat, mode or switch id from the home state." },
          target: { type: "number", minimum: 5, maximum: 30, description: "Target temperature in °C (setClimate)." },
          value: { type: "string", description: "Option id (setMode)." },
          level: { type: "number", minimum: 0, maximum: 1 },
          position: { type: "number", minimum: 0, maximum: 1 },
          on: { type: "boolean" },
          muted: { type: "boolean" },
          sourceId: { type: "string" },
          locked: { type: "boolean" },
          mode: { type: "string", enum: ["armedAway", "armedHome", "disarmed"] },
          action: { type: "string", enum: ["open", "close", "stop", "trigger"] },
        },
        required: ["type", "id"],
        additionalProperties: false,
      },
    },
  },
  required: ["commands"],
  additionalProperties: false,
};

/** A compact view of the house for the model: names, ids and state, nothing else. */
export function homeForModel(home, extra = {}) {
  const room = (id) => home.rooms.find((r) => r.id === id)?.name ?? null;
  const pct = (v) => Math.round(v * 100);
  return {
    rooms: home.rooms.map((r) => r.name),
    lights: home.lights.map((l) => ({ id: l.id, name: l.name, room: room(l.roomId), level: pct(l.level), dimmable: l.dimmable })),
    shades: home.shades.map((s) => ({ id: s.id, name: s.name, room: room(s.roomId), openPercent: pct(s.position), canStop: s.canStop })),
    scenes: home.scenes.map((s) => ({ id: s.id, name: s.name, room: room(s.roomId) ?? "whole house", active: s.active })),
    media: home.media.map((m) => ({
      id: m.id, name: m.name, on: m.on, volume: pct(m.volume), muted: m.muted,
      source: m.sources.find((s) => s.id === m.sourceId)?.name ?? null,
      sources: m.sources.map((s) => ({ id: s.id, name: s.name })),
    })),
    locks: home.locks.map((l) => ({ id: l.id, name: l.name, room: room(l.roomId), locked: l.locked })),
    alarms: home.security.map((p) => ({ id: p.id, name: p.name, mode: SECURITY_TITLES[p.mode] })),
    gates: home.gates.map((g) => ({ id: g.id, name: g.name, state: GATE_TITLES[g.state], separateOpenClose: g.separateOpenClose })),
    roomIds: home.rooms.map((r) => ({ id: r.id, name: r.name, ...(r.floor ? { floor: r.floor } : {}) })),
    thermostats: (home.climate ?? []).map((c) => ({ id: c.id, name: c.name, room: room(c.roomId), current: c.current, target: c.target, heating: c.heating })),
    modes: (home.modes ?? []).map((m) => ({ id: m.id, name: m.name, value: m.value, options: m.options })),
    switches: (home.switches ?? []).map((w) => ({ id: w.id, name: w.name, kind: w.kind, room: room(w.roomId), on: w.on, ...(w.current != null ? { temperature: w.current } : {}) })),
    ...contextForModel(home, extra),
  };
}

/** Short human description of a command, for the chat ("Pendants → 30%"), in the app language. */
export function describeCommand(cmd, home) {
  const find = (list) => list.find((x) => x.id === cmd.id);
  const name = (item) => item?.name ?? cmd.id;
  const pct = (v) => `${Math.round(v * 100)}%`;
  switch (cmd.type) {
    case "setLight": return `${name(find(home.lights))} → ${cmd.level > 0 ? pct(cmd.level) : t("cmd::off")}`;
    case "setShade": return `${name(find(home.shades))} → ${cmd.position >= 0.99 ? t("cmd::open") : cmd.position <= 0.01 ? t("cmd::closed") : pct(cmd.position)}`;
    case "stopShade": return `${name(find(home.shades))} → ${t("cmd::stop")}`;
    case "recallScene": return t("Scene: {name}", { name: name(find(home.scenes)) });
    case "mediaPower": return `${name(find(home.media))} → ${cmd.on ? t("cmd::on") : t("cmd::off")}`;
    case "mediaVolume": return t("{name} volume → {pct}", { name: name(find(home.media)), pct: pct(cmd.level) });
    case "mediaMute": return `${name(find(home.media))} → ${cmd.muted ? t("cmd::muted") : t("cmd::unmuted")}`;
    case "mediaSource": {
      const zone = find(home.media);
      return `${name(zone)} → ${zone?.sources.find((s) => s.id === cmd.sourceId)?.name ?? cmd.sourceId}`;
    }
    case "setLock": return t(cmd.locked ? "Lock {name}" : "Unlock {name}", { name: name(find(home.locks)) });
    case "setSecurity": return `${name(find(home.security))} → ${t(SECURITY_TITLES[cmd.mode] ?? "Unknown")}`;
    case "gate": return `${name(find(home.gates))} → ${t(`gate::${cmd.action}`)}`;
    case "setClimate": return `${name(find(home.climate ?? []))} → ${String(cmd.target).replace(".", ",")} °C`;
    case "setMode": {
      const m = find(home.modes ?? []);
      return `${name(m)} → ${m?.options.find((o) => o.id === cmd.value)?.name ?? cmd.value}`;
    }
    case "setSwitch": return `${name(find(home.switches ?? []))} → ${cmd.on ? t("cmd::on") : t("cmd::off")}`;
    default: return String(cmd.type);
  }
}

/** Commands the AI may ask for but a person must confirm by tapping in the app. */
export function needsConfirmation(cmd, home) {
  if (cmd.type === "setLock" && cmd.locked === false) return true;
  if (cmd.type === "gate") {
    const gate = home.gates.find((g) => g.id === cmd.id);
    return cmd.action === "open" || (cmd.action === "trigger" && gate?.state !== "open");
  }
  return false;
}

/** Keeps only the fields a command type uses, so stray model fields never reach the house. */
export function cleanCommand(raw) {
  const keep = {
    setLight: ["level"], setShade: ["position"], mediaVolume: ["level"], mediaPower: ["on"], mediaMute: ["muted"],
    mediaSource: ["sourceId"], setLock: ["locked"], setSecurity: ["mode"], gate: ["action"],
    setClimate: ["target"], setMode: ["value"], setSwitch: ["on"],
  }[raw?.type] ?? [];
  const cmd = { type: raw?.type, id: raw?.id };
  for (const key of keep) cmd[key] = raw[key];
  return cmd;
}

/**
 * Applies one control_home call. Runs what is safe, holds back what needs a tap,
 * refuses disarming, and returns the result text for the model plus what to show.
 */
export async function applyControlCall(input, { getHome, perform }) {
  const done = [];
  const confirm = [];
  const failed = [];
  const lines = [];
  const commands = Array.isArray(input?.commands) ? input.commands : [];
  for (const raw of commands) {
    const cmd = cleanCommand(raw);
    const problem = validateCommand(cmd);
    const home = getHome();
    if (problem) {
      lines.push(`${cmd.type ?? "?"} ${cmd.id ?? ""}: rejected (${problem})`);
      continue;
    }
    const label = describeCommand(cmd, home);
    if (cmd.type === "setSecurity" && cmd.mode === "disarmed") {
      lines.push(`${label}: refused, disarming needs the keypad code`);
      continue;
    }
    if (needsConfirmation(cmd, home)) {
      confirm.push({ label, command: cmd });
      lines.push(`${label}: waiting for the person to tap Confirm in the app`);
      continue;
    }
    try {
      await perform(cmd);
      done.push(label);
      lines.push(`${label}: done`);
    } catch (err) {
      failed.push(`${label}: ${err.message}`);
      lines.push(`${label}: failed (${err.message})`);
    }
  }
  return { text: lines.length ? lines.join("\n") : "No commands were given.", isError: commands.length === 0, done, confirm, failed };
}

/** What the person is looking at, the time, the weather and what is already scheduled. */
function contextForModel(home, { viewingRoom, now, weather, automations, lang } = {}) {
  const out = {};
  if (lang) out.appLanguage = lang === "en" ? "English" : "Czech";
  if (viewingRoom) out.viewingRoom = viewingRoom;
  if (now) out.localTime = now;
  if (weather) out.weather = `${weather.temp}°${weather.unit}, high ${weather.high}°, low ${weather.low}°`;
  if (automations) {
    out.schedules = automations.schedules.map((s) => `${s.name} (${describeWhen(s)}${s.enabled ? "" : ", off"})`);
    out.timers = automations.timers.map((t) => `${t.label} in ${Math.max(1, Math.round((t.at - Date.now()) / 60000))} min`);
  }
  return out;
}

const TIMED_TYPES = new Set(["setLight", "setShade", "stopShade", "recallScene", "mediaPower", "mediaVolume", "mediaMute", "mediaSource", "setLock", "setClimate", "setMode", "setSwitch"]);

/** set_timer: checks the commands (nothing that opens the house) and hands them to addTimer. */
export async function applyTimerCall(input, { addTimer }) {
  const minutes = Math.round(Number(input?.minutes));
  const label = String(input?.label ?? "Timer").trim().slice(0, 80) || "Timer";
  if (!(minutes >= 1 && minutes <= 1440)) return { text: "Refused: minutes must be 1 to 1440.", isError: true, done: [], confirm: [], failed: [] };
  const commands = [];
  for (const raw of Array.isArray(input?.commands) ? input.commands : []) {
    const cmd = cleanCommand(raw);
    if (validateCommand(cmd) || !TIMED_TYPES.has(cmd.type) || (cmd.type === "setLock" && cmd.locked !== true)) {
      return { text: `Refused: ${cmd.type ?? "that command"} can't be put on a timer.`, isError: true, done: [], confirm: [], failed: [] };
    }
    commands.push(cmd);
  }
  if (!commands.length) return { text: "Refused: no commands.", isError: true, done: [], confirm: [], failed: [] };
  await addTimer({ minutes, label, commands });
  const when = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  return { text: `Timer set: ${label} in ${when}.`, isError: false, done: [t("Timer: {label} in {time}", { label, time: when })], confirm: [], failed: [] };
}

/** create_schedule: checks the schedule and hands it to addSchedule. Schedule actions can't open anything. */
export async function applyScheduleCall(input, { getHome, addSchedule }) {
  const schedule = {
    name: String(input?.name ?? "").trim().slice(0, 60),
    enabled: true,
    when: input?.when?.type === "time" ? { type: "time", time: String(input.when.time ?? "") } : { type: input?.when?.type, offset: Number(input?.when?.offset) || 0 },
    days: Array.isArray(input?.days) ? [...new Set(input.days)].sort() : [],
    actions: (Array.isArray(input?.actions) ? input.actions : []).map((a) => {
      switch (a?.type) {
        case "scene": return { type: "scene", id: String(a.id ?? "") };
        case "lights": return { type: "lights", roomId: a.roomId ?? null, level: Number(a.level) || 0 };
        case "shades": return { type: "shades", roomId: a.roomId ?? null, position: Number(a.position) >= 0.5 ? 1 : 0 };
        default: return { type: a?.type };
      }
    }),
  };
  const problem = validateSchedule(schedule);
  if (problem) return { text: `Refused: ${problem}`, isError: true, done: [], confirm: [], failed: [] };
  await addSchedule(schedule);
  const what = schedule.actions.map((a) => describeAction(a, getHome())).join(", ");
  return { text: `Schedule created: ${schedule.name}, ${describeWhen(schedule)}: ${what}.`, isError: false, done: [t("Schedule: {name} · {when}", { name: schedule.name, when: describeWhen(schedule) })], confirm: [], failed: [] };
}
