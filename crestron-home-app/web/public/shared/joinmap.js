// A dealer-programmed (SIMPL) Crestron system seen through a join map: the same code
// turns join values into the app's home snapshot and commands into join presses, whether
// the joins travel over CIP from the home server or over Crestron's Web XPanel from the
// browser. Pure logic: no sockets here. Feedback joins default to the press join, the
// usual SIMPL convention. See ../../../joinmap.example.json for the format.

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

/** "48 devices · 12 rooms" for a parsed map. */
export function joinMapSummary(map) {
  const devices = SECTIONS.filter((k) => k !== "rooms").reduce((n, k) => n + (map[k]?.length ?? 0), 0);
  return { devices, rooms: map.rooms?.length ?? 0 };
}

/** Every join the map reads, by kind, so a transport can subscribe to exactly those. */
export function joinsUsed(map) {
  const digital = new Set();
  const analog = new Set();
  const serial = new Set();
  const d = (j) => { if (j) digital.add(Number(j)); };
  const a = (j) => { if (j) analog.add(Number(j)); };
  const s = (j) => { if (j) serial.add(Number(j)); };
  for (const e of map.lights) { a(e.level); d(e.on); d(e.off); d(e.onFeedback); }
  for (const e of map.shades) { a(e.position); d(e.open); d(e.close); d(e.stop); }
  for (const e of map.scenes) { d(e.press); d(e.feedback); }
  for (const e of map.media) {
    d(e.powerOn); d(e.powerOff); d(e.powerFeedback); a(e.volume); d(e.mute); d(e.muteFeedback);
    d(e.play); d(e.pause); d(e.next); d(e.previous); d(e.playingFeedback); s(e.title); s(e.artist); s(e.album);
    for (const src of e.sources ?? []) { d(src.press); d(src.feedback); }
  }
  for (const e of map.locks) { d(e.lock); d(e.unlock); d(e.lockedFeedback); }
  for (const e of map.security) {
    d(e.armAway); d(e.armHome); d(e.disarm); d(e.toggle); s(e.code);
    d(e.armedAwayFeedback); d(e.armedHomeFeedback); d(e.disarmedFeedback); d(e.alarmFeedback);
  }
  for (const e of map.gates) { d(e.open); d(e.close); d(e.stop); d(e.trigger); d(e.openFeedback); d(e.closedFeedback); }
  for (const e of map.doorbells) d(e.ring);
  for (const e of map.climate) { a(e.current); a(e.target); d(e.heating); d(e.up); d(e.down); }
  for (const e of map.modes) { a(e.analog); for (const o of e.options ?? []) { d(o.press); d(o.feedback); } }
  for (const e of map.switches) { d(e.on); d(e.off); d(e.toggle); d(e.feedback); a(e.temperature); }
  return { digital: [...digital], analog: [...analog], serial: [...serial] };
}

/**
 * Join values in, home snapshot out; command in, join operations out.
 * Operations: { op: "pulse", join } (press then release), { op: "analog", join, value 0–65535 },
 * { op: "serial", join, text }, { op: "wait", ms }.
 */
export class JoinMapHome {
  constructor(map) {
    this.map = typeof map === "string" || !map?.rooms ? parseJoinMap(map) : map;
    this.digital = new Map();
    this.analog = new Map();
    this.serial = new Map();
    this.ringAt = new Map(); // doorbell index -> when its ring join last went high
  }

  setDigital(join, value) {
    const j = Number(join);
    const high = Boolean(value);
    const was = this.digital.get(j);
    this.digital.set(j, high);
    if (high && !was) this.map.doorbells.forEach((e, i) => { if (Number(e.ring) === j) this.ringAt.set(i, Date.now()); });
  }
  setAnalog(join, value) { this.analog.set(Number(join), Number(value) || 0); }
  setSerial(join, text) { this.serial.set(Number(join), String(text ?? "")); }

  high(join) { return join ? this.digital.get(Number(join)) === true : false; }
  level(join) { return join ? (this.analog.get(Number(join)) ?? 0) / 65535 : null; }
  text(join) { return join ? (this.serial.get(Number(join)) ?? "").trim() : ""; }
  /** Temperatures arrive as whole numbers: °C × scale (10 by default, so 215 = 21.5 °C). */
  temp(join, scale = 10) {
    if (!join || !this.analog.has(Number(join))) return null;
    const raw = this.analog.get(Number(join));
    // Analog joins are unsigned 16-bit; values above 32767 are negative temperatures.
    return Math.round(((raw > 32767 ? raw - 65536 : raw) / (scale || 10)) * 10) / 10;
  }
  #modeValue(e) {
    const opts = e.options ?? [];
    const hit = e.analog && this.analog.has(Number(e.analog))
      ? opts.find((o) => Number(o.value) === this.analog.get(Number(e.analog)))
      : opts.find((o) => this.high(o.feedback ?? o.press));
    return hit ? optionId(hit, opts.indexOf(hit)) : null;
  }

  snapshot() {
    const m = this.map;
    return {
      rooms: m.rooms.map((r) => ({ id: r.id, name: r.name, ...(r.floor ? { floor: String(r.floor) } : {}) })),
      lights: m.lights.map((e, i) => ({
        id: `light-${i}`, name: e.name, roomId: e.room ?? null, origin: "crestron",
        level: e.level ? this.level(e.level) : this.high(e.onFeedback ?? e.on) ? 1 : 0,
        dimmable: Boolean(e.level), online: true,
      })),
      shades: m.shades.map((e, i) => ({
        id: `shade-${i}`, name: e.name, roomId: e.room ?? null, origin: "crestron",
        position: e.position ? this.level(e.position) : 0.5,
        hasPosition: Boolean(e.position), canStop: Boolean(e.stop), online: true,
      })),
      scenes: m.scenes.map((e, i) => ({
        id: `scene-${i}`, name: e.name, roomId: e.room ?? null, kind: "other", active: this.high(e.feedback ?? e.press), origin: "crestron",
      })),
      media: m.media.map((e, i) => {
        const sources = e.sources ?? [];
        const current = sources.findIndex((s) => this.high(s.feedback ?? s.press));
        return {
          id: `media-${i}`, name: e.name, roomId: e.room ?? null, origin: "crestron",
          on: this.high(e.powerFeedback ?? e.powerOn),
          volume: this.level(e.volume) ?? 0,
          muted: this.high(e.muteFeedback ?? e.mute),
          hasVolume: Boolean(e.volume),
          sources: sources.map((s, si) => ({ id: `src-${si}`, name: s.name })),
          sourceId: current >= 0 ? `src-${current}` : null,
          // Optional transport buttons and track-name text joins.
          canTransport: Boolean(e.play || e.pause || e.next || e.previous),
          playing: e.playingFeedback ? this.high(e.playingFeedback) : this.high(e.powerFeedback ?? e.powerOn),
          nowPlaying: this.text(e.title) ? { title: this.text(e.title), artist: this.text(e.artist), album: this.text(e.album) } : null,
          ...(e.kind ? { kind: e.kind } : {}),
        };
      }),
      locks: m.locks.map((e, i) => ({
        id: `lock-${i}`, name: e.name, roomId: e.room ?? null, origin: "crestron",
        locked: e.lockedFeedback ? this.high(e.lockedFeedback) : null,
      })),
      security: m.security.map((e, i) => ({
        id: `security-${i}`, name: e.name, origin: "crestron",
        mode: this.high(e.alarmFeedback) ? "alarm"
          : this.high(e.armedAwayFeedback) ? "armedAway"
          : this.high(e.armedHomeFeedback) ? "armedHome"
          : this.high(e.disarmedFeedback) ? "disarmed"
          // A zone with one toggle button and one "armed" light: low means off.
          : e.toggle && e.armedAwayFeedback ? "disarmed" : "unknown",
        needsCode: Boolean(e.code), canArmHome: Boolean(e.armHome), canArmAway: Boolean(e.armAway || e.toggle),
      })),
      gates: m.gates.map((e, i) => ({
        id: `gate-${i}`, name: e.name, origin: "crestron",
        state: this.high(e.openFeedback) ? "open"
          : this.high(e.closedFeedback) ? "closed"
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
        id: `climate-${i}`, name: e.name, roomId: e.room ?? null, origin: "crestron",
        current: this.temp(e.current, e.scale), target: this.temp(e.target, e.scale),
        min: e.min ?? 5, max: e.max ?? 30, step: e.step ?? 0.5,
        heating: e.heating ? this.high(e.heating) : null, online: true,
      })),
      modes: m.modes.map((e, i) => ({
        id: `mode-${i}`, name: e.name, kind: e.kind ?? "other", value: this.#modeValue(e), origin: "crestron",
        options: (e.options ?? []).map((o, oi) => ({ id: optionId(o, oi), name: String(o.name ?? o.id ?? oi + 1) })),
      })),
      switches: m.switches.map((e, i) => ({
        id: `switch-${i}`, name: e.name, roomId: e.room ?? null, kind: e.kind ?? "other", origin: "crestron",
        on: this.high(e.feedback ?? e.on ?? e.toggle), current: this.temp(e.temperature, e.scale),
      })),
    };
  }

  /** The join operations for one command, in order. Throws when the map has no join for it. */
  plan(cmd) {
    const toRaw = (v) => Math.round(Math.min(1, Math.max(0, v)) * 65535);
    const pulse = (join) => ({ op: "pulse", join: Number(join) });
    const analog = (join, value) => ({ op: "analog", join: Number(join), value });
    switch (cmd.type) {
      case "setLight": {
        const e = this.#entry("lights", cmd.id);
        if (e.level) return [analog(e.level, toRaw(cmd.level))];
        const wantOn = cmd.level > 0;
        if (e.off) return [pulse(wantOn ? e.on : e.off)];
        // With only an "on" join the button is a toggle.
        return e.on && wantOn !== this.high(e.onFeedback ?? e.on) ? [pulse(e.on)] : [];
      }
      case "setShade": {
        const e = this.#entry("shades", cmd.id);
        if (e.position) return [analog(e.position, toRaw(cmd.position))];
        const join = cmd.position >= 0.5 ? e.open : e.close;
        return join ? [pulse(join)] : [];
      }
      case "stopShade": {
        const e = this.#entry("shades", cmd.id);
        if (!e.stop) throw new Error("This shade has no stop join.");
        return [pulse(e.stop)];
      }
      case "recallScene":
        return [pulse(this.#entry("scenes", cmd.id).press)];
      case "mediaPower": {
        const e = this.#entry("media", cmd.id);
        const join = cmd.on ? e.powerOn : e.powerOff ?? e.powerOn;
        if (!join) throw new Error("No power join for this room.");
        return [pulse(join)];
      }
      case "mediaVolume": {
        const e = this.#entry("media", cmd.id);
        if (!e.volume) throw new Error("No volume join for this room.");
        return [analog(e.volume, toRaw(cmd.level))];
      }
      case "mediaMute": {
        const e = this.#entry("media", cmd.id);
        if (!e.mute) throw new Error("No mute join for this room.");
        return cmd.muted !== this.high(e.muteFeedback ?? e.mute) ? [pulse(e.mute)] : [];
      }
      case "mediaSource": {
        const e = this.#entry("media", cmd.id);
        const source = (e.sources ?? [])[indexOf(cmd.sourceId)];
        if (!source) throw new Error("Unknown source.");
        return [pulse(source.press)];
      }
      case "mediaTransport": {
        const e = this.#entry("media", cmd.id);
        // A single play/pause button is common: use it for both when only one is mapped.
        const join = { play: e.play ?? e.pause, pause: e.pause ?? e.play, next: e.next, previous: e.previous }[cmd.action];
        if (!join) throw new Error("This room has no join for that button.");
        return [pulse(join)];
      }
      case "tvKey": {
        const e = this.#entry("media", cmd.id);
        const join = (e.keys ?? {})[cmd.key] ?? { volUp: e.volumeUp, volDown: e.volumeDown, mute: e.mute, play: e.play, pause: e.pause, power: e.powerOff }[cmd.key];
        if (!join) throw new Error("This room has no join for that button.");
        return [pulse(join)];
      }
      case "setLock": {
        const e = this.#entry("locks", cmd.id);
        return [pulse(cmd.locked ? e.lock : e.unlock)];
      }
      case "setSecurity": {
        const e = this.#entry("security", cmd.id);
        const ops = [];
        if (e.code && cmd.code) ops.push({ op: "serial", join: Number(e.code), text: String(cmd.code) });
        const join = { armedAway: e.armAway, armedHome: e.armHome, disarmed: e.disarm }[cmd.mode];
        if (join) return [...ops, pulse(join)];
        if (e.toggle) {
          // One button that arms and disarms: press it only when the state has to change.
          const armed = this.high(e.armedAwayFeedback) || this.high(e.armedHomeFeedback);
          return armed !== (cmd.mode !== "disarmed") ? [...ops, pulse(e.toggle)] : ops;
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
          return [analog(e.target, raw < 0 ? raw + 65536 : raw)];
        }
        // Only up/down buttons: press one of them once per step.
        const now = this.temp(e.target, scale);
        if (now == null || !e.up || !e.down) throw new Error("This thermostat has no setpoint join.");
        const presses = Math.min(50, Math.round(Math.abs(target - now) / step));
        const ops = [];
        for (let k = 0; k < presses; k++) {
          if (k) ops.push({ op: "wait", ms: 150 });
          ops.push(pulse(target > now ? e.up : e.down));
        }
        return ops;
      }
      case "setMode": {
        const e = this.#entry("modes", cmd.id);
        const opts = e.options ?? [];
        const o = opts.find((x, oi) => optionId(x, oi) === cmd.value);
        if (!o) throw new Error("Unknown option.");
        if (e.analog && o.value != null) return [analog(e.analog, Number(o.value))];
        if (!o.press) throw new Error("That option has no join.");
        return [pulse(o.press)];
      }
      case "setSwitch": {
        const e = this.#entry("switches", cmd.id);
        if (cmd.on && e.on) return [pulse(e.on)];
        if (!cmd.on && e.off) return [pulse(e.off)];
        const toggle = e.toggle ?? (e.off ? null : e.on);
        if (!toggle) throw new Error("This switch has no join for that.");
        return cmd.on !== this.high(e.feedback ?? e.on ?? e.toggle) ? [pulse(toggle)] : [];
      }
      case "gate": {
        const e = this.#entry("gates", cmd.id);
        const join = { open: e.open ?? e.trigger, close: e.close ?? e.trigger, stop: e.stop, trigger: e.trigger ?? e.open }[cmd.action];
        if (!join) throw new Error("That gate action has no join.");
        return [pulse(join)];
      }
      default:
        throw new Error(`This system can't do “${cmd.type}”.`);
    }
  }

  /** Ids look like "light-3": the number is the entry's position in the join map. */
  #entry(section, id) {
    const e = this.map[section][indexOf(id)];
    if (!e) throw new Error(`“${id}” isn't in the join map.`);
    return e;
  }
}

/** Runs the operations from plan() on a transport with pulse(join), setAnalog(join, v), setSerial(join, s). */
export async function runOps(ops, transport) {
  for (const o of ops) {
    if (o.op === "pulse") transport.pulse(o.join);
    else if (o.op === "analog") transport.setAnalog(o.join, o.value);
    else if (o.op === "serial") transport.setSerial(o.join, o.text);
    else if (o.op === "wait") await new Promise((r) => setTimeout(r, o.ms));
  }
}

/** An option's id: its own "id", or its position ("1", "2"…). */
export function optionId(o, i) {
  return String(o.id ?? i + 1);
}

export function indexOf(id) {
  const n = Number(String(id).split("-").pop());
  return Number.isInteger(n) ? n : -1;
}
