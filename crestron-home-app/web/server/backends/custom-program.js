// For dealer-programmed (SIMPL) systems: connects as a touch panel over CIP and
// translates joins to and from the app's model using a join map (same format as
// the iOS app; see ../../../joinmap.example.json). Feedback joins default to the
// press join, the usual SIMPL convention.
import { CIPClient } from "./cip-client.js";

const SECTIONS = ["rooms", "lights", "shades", "scenes", "media", "locks", "security", "gates"];

export function parseJoinMap(text) {
  let map;
  try {
    map = typeof text === "string" ? JSON.parse(text) : text;
  } catch (err) {
    throw new Error(`The join map isn't valid JSON: ${err.message}`);
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("The join map must be a JSON object.");
  const out = {};
  for (const key of SECTIONS) {
    const list = map[key] ?? [];
    if (!Array.isArray(list)) throw new Error(`Join map: “${key}” must be a list.`);
    list.forEach((entry, i) => {
      if (!entry || typeof entry.name !== "string") throw new Error(`Join map: ${key} #${i + 1} needs a "name".`);
    });
    out[key] = list;
  }
  out.rooms.forEach((r, i) => { if (typeof r.id !== "string") throw new Error(`Join map: rooms #${i + 1} needs an "id".`); });
  return out;
}

export class CustomProgramBackend {
  pollMs = null; // the processor pushes join changes

  constructor({ host, ipId, port, joinMap }) {
    this.host = String(host ?? "").trim();
    this.map = parseJoinMap(joinMap);
    this.digital = new Map();
    this.analog = new Map();
    this.client = new CIPClient({ host: this.host, port, ipId });
    this.onChange = null;
    this.onStatus = null;
    this.publishTimer = null;
    this.client.on("digital", (join, value) => { this.digital.set(join, value); this.#schedulePublish(); });
    this.client.on("analog", (join, value) => { this.analog.set(join, value); this.#schedulePublish(); });
    this.client.on("state", (state, error) => {
      if (state === "connected") this.onStatus?.({ connection: "connected" });
      if (state === "failed") this.onStatus?.({ connection: "failed", message: error });
    });
  }

  async connect() {
    if (!this.host) throw new Error("Enter the processor address in Setup.");
    this.client.start();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (this.client.state === "connected") return;
      if (this.client.rejected) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const reason = this.client.lastError ?? `No answer from ${this.host} on the touch-panel port. Check the address and IP ID.`;
    if (this.client.rejected) this.client.stop();
    // Otherwise leave the client retrying in the background; the store reports the error.
    throw new Error(reason);
  }

  disconnect() {
    clearTimeout(this.publishTimer);
    this.client.stop();
  }

  async fetch() {
    return this.#snapshot();
  }

  #schedulePublish() {
    // A burst of joins arrives at once (the initial update); publish once.
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.onChange?.(this.#snapshot());
    }, 60);
  }

  #high(join) { return join ? this.digital.get(join) === true : false; }
  #level(join) { return join ? (this.analog.get(join) ?? 0) / 65535 : null; }

  #snapshot() {
    const m = this.map;
    return {
      rooms: m.rooms.map((r) => ({ id: r.id, name: r.name })),
      lights: m.lights.map((e, i) => ({
        id: `light-${i}`, name: e.name, roomId: e.room ?? null,
        level: e.level ? this.#level(e.level) : this.#high(e.onFeedback ?? e.on) ? 1 : 0,
        dimmable: Boolean(e.level), online: true,
      })),
      shades: m.shades.map((e, i) => ({
        id: `shade-${i}`, name: e.name, roomId: e.room ?? null,
        position: e.position ? this.#level(e.position) : 0.5,
        hasPosition: Boolean(e.position), canStop: Boolean(e.stop), online: true,
      })),
      scenes: m.scenes.map((e, i) => ({
        id: `scene-${i}`, name: e.name, roomId: e.room ?? null, kind: "other", active: this.#high(e.feedback ?? e.press),
      })),
      media: m.media.map((e, i) => {
        const sources = e.sources ?? [];
        const current = sources.findIndex((s) => this.#high(s.feedback ?? s.press));
        return {
          id: `media-${i}`, name: e.name, roomId: e.room ?? null,
          on: this.#high(e.powerFeedback ?? e.powerOn),
          volume: this.#level(e.volume) ?? 0,
          muted: this.#high(e.muteFeedback ?? e.mute),
          hasVolume: Boolean(e.volume),
          sources: sources.map((s, si) => ({ id: `src-${si}`, name: s.name })),
          sourceId: current >= 0 ? `src-${current}` : null,
        };
      }),
      locks: m.locks.map((e, i) => ({
        id: `lock-${i}`, name: e.name, roomId: e.room ?? null,
        locked: e.lockedFeedback ? this.#high(e.lockedFeedback) : null,
      })),
      security: m.security.map((e, i) => ({
        id: `security-${i}`, name: e.name,
        mode: this.#high(e.alarmFeedback) ? "alarm"
          : this.#high(e.armedAwayFeedback) ? "armedAway"
          : this.#high(e.armedHomeFeedback) ? "armedHome"
          : this.#high(e.disarmedFeedback) ? "disarmed" : "unknown",
        needsCode: Boolean(e.code), canArmHome: Boolean(e.armHome), canArmAway: Boolean(e.armAway),
      })),
      gates: m.gates.map((e, i) => ({
        id: `gate-${i}`, name: e.name,
        state: this.#high(e.openFeedback) ? "open"
          : this.#high(e.closedFeedback) ? "closed"
          : e.openFeedback && e.closedFeedback ? "moving" : "unknown",
        separateOpenClose: Boolean(e.open && e.close), canStop: Boolean(e.stop),
      })),
      sensors: [],
    };
  }

  async perform(cmd) {
    if (this.client.state !== "connected") throw new Error("Not connected to the processor yet.");
    const c = this.client;
    const toRaw = (v) => Math.round(Math.min(1, Math.max(0, v)) * 65535);
    switch (cmd.type) {
      case "setLight": {
        const e = this.#entry("lights", cmd.id);
        if (e.level) return c.setAnalog(e.level, toRaw(cmd.level));
        const wantOn = cmd.level > 0;
        if (e.off) return c.pulse(wantOn ? e.on : e.off);
        // With only an "on" join the button is a toggle.
        if (e.on && wantOn !== this.#high(e.onFeedback ?? e.on)) c.pulse(e.on);
        return;
      }
      case "setShade": {
        const e = this.#entry("shades", cmd.id);
        if (e.position) return c.setAnalog(e.position, toRaw(cmd.position));
        const join = cmd.position >= 0.5 ? e.open : e.close;
        if (join) c.pulse(join);
        return;
      }
      case "stopShade": {
        const e = this.#entry("shades", cmd.id);
        if (!e.stop) throw new Error("This shade has no stop join.");
        return c.pulse(e.stop);
      }
      case "recallScene":
        return c.pulse(this.#entry("scenes", cmd.id).press);
      case "mediaPower": {
        const e = this.#entry("media", cmd.id);
        const join = cmd.on ? e.powerOn : e.powerOff ?? e.powerOn;
        if (!join) throw new Error("No power join for this room.");
        return c.pulse(join);
      }
      case "mediaVolume": {
        const e = this.#entry("media", cmd.id);
        if (!e.volume) throw new Error("No volume join for this room.");
        return c.setAnalog(e.volume, toRaw(cmd.level));
      }
      case "mediaMute": {
        const e = this.#entry("media", cmd.id);
        if (!e.mute) throw new Error("No mute join for this room.");
        if (cmd.muted !== this.#high(e.muteFeedback ?? e.mute)) c.pulse(e.mute);
        return;
      }
      case "mediaSource": {
        const e = this.#entry("media", cmd.id);
        const source = (e.sources ?? [])[indexOf(cmd.sourceId)];
        if (!source) throw new Error("Unknown source.");
        return c.pulse(source.press);
      }
      case "setLock": {
        const e = this.#entry("locks", cmd.id);
        return c.pulse(cmd.locked ? e.lock : e.unlock);
      }
      case "setSecurity": {
        const e = this.#entry("security", cmd.id);
        if (e.code && cmd.code) c.setSerial(e.code, cmd.code);
        const join = { armedAway: e.armAway, armedHome: e.armHome, disarmed: e.disarm }[cmd.mode];
        if (!join) throw new Error("That security mode has no join.");
        return c.pulse(join);
      }
      case "gate": {
        const e = this.#entry("gates", cmd.id);
        const join = { open: e.open ?? e.trigger, close: e.close ?? e.trigger, stop: e.stop, trigger: e.trigger ?? e.open }[cmd.action];
        if (!join) throw new Error("That gate action has no join.");
        return c.pulse(join);
      }
    }
  }

  /** Ids look like "light-3": the number is the entry's position in the join map. */
  #entry(section, id) {
    const e = this.map[section][indexOf(id)];
    if (!e) throw new Error(`“${id}” isn't in the join map.`);
    return e;
  }
}

function indexOf(id) {
  const n = Number(String(id).split("-").pop());
  return Number.isInteger(n) ? n : -1;
}
