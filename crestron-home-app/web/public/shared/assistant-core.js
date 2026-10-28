// The parts of the home assistant shared by the home server (Claude API) and the
// browser demo (the artifact's `sample` capability): the instructions, the one tool,
// and the safety rules for which commands a person must confirm.
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

How to answer:
- One or two short, friendly sentences in the person's language. No lists, no markdown, no ids.
- Only say something happened if the tool result says it did.`;

export const CONTROL_TOOL_NAME = "control_home";

export const CONTROL_TOOL_DESCRIPTION =
  "Send one or more commands to the house. Each command needs `type` and the device `id` from the home state, plus the field its type uses: " +
  "setLight → level; setShade → position; stopShade → (nothing); recallScene → (nothing); mediaPower → on; mediaVolume → level; " +
  "mediaMute → muted; mediaSource → sourceId; setLock → locked; setSecurity → mode (armedAway or armedHome); gate → action (open, close, stop, trigger). " +
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
            enum: ["setLight", "setShade", "stopShade", "recallScene", "mediaPower", "mediaVolume", "mediaMute", "mediaSource", "setLock", "setSecurity", "gate"],
          },
          id: { type: "string", description: "Device, scene, media room, lock, alarm or gate id from the home state." },
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
export function homeForModel(home) {
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
  };
}

/** Short human description of a command, for the chat ("Pendants → 30%"). */
export function describeCommand(cmd, home) {
  const find = (list) => list.find((x) => x.id === cmd.id);
  const name = (item) => item?.name ?? cmd.id;
  const pct = (v) => `${Math.round(v * 100)}%`;
  switch (cmd.type) {
    case "setLight": return `${name(find(home.lights))} → ${cmd.level > 0 ? pct(cmd.level) : "off"}`;
    case "setShade": return `${name(find(home.shades))} → ${cmd.position >= 0.99 ? "open" : cmd.position <= 0.01 ? "closed" : pct(cmd.position)}`;
    case "stopShade": return `${name(find(home.shades))} → stop`;
    case "recallScene": return `Scene: ${name(find(home.scenes))}`;
    case "mediaPower": return `${name(find(home.media))} → ${cmd.on ? "on" : "off"}`;
    case "mediaVolume": return `${name(find(home.media))} volume → ${pct(cmd.level)}`;
    case "mediaMute": return `${name(find(home.media))} → ${cmd.muted ? "muted" : "unmuted"}`;
    case "mediaSource": {
      const zone = find(home.media);
      return `${name(zone)} → ${zone?.sources.find((s) => s.id === cmd.sourceId)?.name ?? cmd.sourceId}`;
    }
    case "setLock": return `${cmd.locked ? "Lock" : "Unlock"} ${name(find(home.locks))}`;
    case "setSecurity": return `${name(find(home.security))} → ${SECURITY_TITLES[cmd.mode]}`;
    case "gate": return `${name(find(home.gates))} → ${cmd.action}`;
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
