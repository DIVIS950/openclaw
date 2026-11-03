// For dealer-programmed (SIMPL) systems: connects as a touch panel over CIP and
// translates joins to and from the app's model using a join map (same format as
// the iOS app; see ../../../joinmap.example.json). Feedback joins default to the
// press join, the usual SIMPL convention.
import { CIPClient } from "./cip-client.js";

const SECTIONS = ["rooms", "lights", "shades", "scenes", "media", "locks", "security", "gates", "doorbells", "climate", "modes", "switches"];

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
  out.modes.forEach((m, i) => {
    if (!Array.isArray(m.options) || !m.options.length) throw new Error(`Join map: modes #${i + 1} needs a list of "options".`);
  });
  return out;
}

export class CustomProgramBackend {
  pollMs = null; // the processor pushes join changes

  constructor({ host, ipId, port, joinMap }) {
    this.host = String(host ?? "").trim();
    this.map = parseJoinMap(joinMap);
    this.digital = new Map();
    this.analog = new Map();
    this.serial = new Map();
    this.ringAt = new Map(); // doorbell index -> when its ring join last went high
    this.client = new CIPClient({ host: this.host, port, ipId });
    this.onChange = null;
    this.onStatus = null;
    this.publishTimer = null;
    this.client.on("digital", (join, value) => { this.digital.set(join, value); this.#schedulePublish(); });
    this.client.on("analog", (join, value) => { this.analog.set(join, value); this.#schedulePublish(); });
    this.client.on("serial", (join, text) => { this.serial.set(join, text); this.#schedulePublish(); });
    this.client.on("digital", (join, value) => {
      if (!value) return;
      this.map.doorbells.forEach((e, i) => { if (e.ring === join) this.ringAt.set(i, Date.now()); });
    });
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
  #text(join) { return join ? (this.serial.get(join) ?? "").trim() : ""; }
  /** Temperatures arrive as whole numbers: °C × scale (10 by default, so 215 = 21.5 °C). */
  #temp(join, scale = 10) {
    if (!join || !this.analog.has(join)) return null;
    const raw = this.analog.get(join);
    // Analog joins are unsigned 16-bit; values above 32767 are negative temperatures.
    return Math.round(((raw > 32767 ? raw - 65536 : raw) / (scale || 10)) * 10) / 10;
  }
  #modeValue(e) {
    const opts = e.options ?? [];
    const hit = e.analog && this.analog.has(e.analog)
      ? opts.find((o) => Number(o.value) === this.analog.get(e.analog))
      : opts.find((o) => this.#high(o.feedback ?? o.press));
    return hit ? optionId(hit, opts.indexOf(hit)) : null;
  }

  #snapshot() {
    const m = this.map;
    return {
      rooms: m.rooms.map((r) => ({ id: r.id, name: r.name, ...(r.floor ? { floor: String(r.floor) } : {}) })),
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
          // Optional transport buttons and track-name text joins.
          canTransport: Boolean(e.play || e.pause || e.next || e.previous),
          playing: e.playingFeedback ? this.#high(e.playingFeedback) : this.#high(e.powerFeedback ?? e.powerOn),
          nowPlaying: this.#text(e.title) ? { title: this.#text(e.title), artist: this.#text(e.artist), album: this.#text(e.album) } : null,
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
          : this.#high(e.disarmedFeedback) ? "disarmed"
          // A zone with one toggle button and one "armed" light: low means off.
          : e.toggle && e.armedAwayFeedback ? "disarmed" : "unknown",
        needsCode: Boolean(e.code), canArmHome: Boolean(e.armHome), canArmAway: Boolean(e.armAway || e.toggle),
      })),
      gates: m.gates.map((e, i) => ({
        id: `gate-${i}`, name: e.name,
        state: this.#high(e.openFeedback) ? "open"
          : this.#high(e.closedFeedback) ? "closed"
          : e.openFeedback && e.closedFeedback ? "moving" : "unknown",
        separateOpenClose: Boolean(e.open && e.close), canStop: Boolean(e.stop),
      })),
      sensors: [],
      doorbells: m.doorbells.map((e, i) => ({
        id: `doorbell-${i}`, name: e.name,
        cameraId: null, cameraName: e.camera ?? null,
        lockId: (() => { const li = m.locks.findIndex((l) => l.name === e.lock); return li >= 0 ? `lock-${li}` : null; })(),
        ringAt: this.ringAt.get(i) ?? null,
      })),
      climate: m.climate.map((e, i) => ({
        id: `climate-${i}`, name: e.name, roomId: e.room ?? null,
        current: this.#temp(e.current, e.scale), target: this.#temp(e.target, e.scale),
        min: e.min ?? 5, max: e.max ?? 30, step: e.step ?? 0.5,
        heating: e.heating ? this.#high(e.heating) : null, online: true,
      })),
      modes: m.modes.map((e, i) => ({
        id: `mode-${i}`, name: e.name, kind: e.kind ?? "other", value: this.#modeValue(e),
        options: (e.options ?? []).map((o, oi) => ({ id: optionId(o, oi), name: String(o.name ?? o.id ?? oi + 1) })),
      })),
      switches: m.switches.map((e, i) => ({
        id: `switch-${i}`, name: e.name, roomId: e.room ?? null, kind: e.kind ?? "other",
        on: this.#high(e.feedback ?? e.on ?? e.toggle), current: this.#temp(e.temperature, e.scale),
      })),
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
      case "mediaTransport": {
        const e = this.#entry("media", cmd.id);
        // A single play/pause button is common: use it for both when only one is mapped.
        const join = { play: e.play ?? e.pause, pause: e.pause ?? e.play, next: e.next, previous: e.previous }[cmd.action];
        if (!join) throw new Error("This room has no join for that button.");
        return c.pulse(join);
      }
      case "setLock": {
        const e = this.#entry("locks", cmd.id);
        return c.pulse(cmd.locked ? e.lock : e.unlock);
      }
      case "setSecurity": {
        const e = this.#entry("security", cmd.id);
        if (e.code && cmd.code) c.setSerial(e.code, cmd.code);
        const join = { armedAway: e.armAway, armedHome: e.armHome, disarmed: e.disarm }[cmd.mode];
        if (join) return c.pulse(join);
        if (e.toggle) {
          // One button that arms and disarms: press it only when the state has to change.
          const armed = this.#high(e.armedAwayFeedback) || this.#high(e.armedHomeFeedback);
          if (armed !== (cmd.mode !== "disarmed")) c.pulse(e.toggle);
          return;
        }
        throw new Error("That security mode has no join.");
      }
      case "setClimate": {
        const e = this.#entry("climate", cmd.id);
        const scale = e.scale || 10;
        const step = e.step || 0.5;
        const target = Math.min(e.max ?? 30, Math.max(e.min ?? 5, Math.round(cmd.target / step) * step));
        if (e.target && e.targetWritable !== false) {
          const raw = Math.round(target * scale);
          return c.setAnalog(e.target, raw < 0 ? raw + 65536 : raw);
        }
        // Only up/down buttons: press one of them once per step.
        const now = this.#temp(e.target, scale);
        if (now == null || !e.up || !e.down) throw new Error("This thermostat has no setpoint join.");
        const presses = Math.min(50, Math.round(Math.abs(target - now) / step));
        for (let k = 0; k < presses; k++) {
          c.pulse(target > now ? e.up : e.down);
          await new Promise((r) => setTimeout(r, 150));
        }
        return;
      }
      case "setMode": {
        const e = this.#entry("modes", cmd.id);
        const opts = e.options ?? [];
        const o = opts.find((x, oi) => optionId(x, oi) === cmd.value);
        if (!o) throw new Error("Unknown option.");
        if (e.analog && o.value != null) return c.setAnalog(e.analog, Number(o.value));
        if (!o.press) throw new Error("That option has no join.");
        return c.pulse(o.press);
      }
      case "setSwitch": {
        const e = this.#entry("switches", cmd.id);
        if (cmd.on && e.on) return c.pulse(e.on);
        if (!cmd.on && e.off) return c.pulse(e.off);
        const toggle = e.toggle ?? (e.off ? null : e.on);
        if (!toggle) throw new Error("This switch has no join for that.");
        if (cmd.on !== this.#high(e.feedback ?? e.on ?? e.toggle)) c.pulse(toggle);
        return;
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

/** An option's id: its own "id", or its position ("1", "2"…). */
function optionId(o, i) {
  return String(o.id ?? i + 1);
}

function indexOf(id) {
  const n = Number(String(id).split("-").pop());
  return Number.isInteger(n) ? n : -1;
}
