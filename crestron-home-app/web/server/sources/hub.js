// Extra device sources beside the main Crestron backend (Samsung TVs today). Each one
// contributes a partial home; the hub merges those into the main snapshot and routes
// commands by id prefix ("stv:…"). A source that fails only affects its own devices.
import { applyCommand, emptyHome, stateKey } from "../../public/shared/model.js";
import { SamsungTVSource } from "./samsungtv.js";

export class SourceHub {
  /**
   * @param {object} o
   * @param {() => void} o.onChange - a source's devices or status changed
   * @param {(host: string, token: string) => void} o.onToken - a TV handed out a pairing token
   * @param {(text: string) => void} [o.log]
   * @param {object} [o.options] - passed to every source (ports, wol…), for tests
   */
  constructor({ onChange, onToken, log, options = {} }) {
    this.onChange = onChange;
    this.onToken = onToken;
    this.log = log ?? ((text) => console.error(text));
    this.options = options;
    this.entries = []; // { source, home, status }
    this.recent = new Map(); // stateKey -> { cmd, at }, like the main store
  }

  /** (Re)creates the sources from config.samsungTVs; the old ones are stopped first. */
  configure(tvs) {
    this.stop();
    for (const tv of Array.isArray(tvs) ? tvs : []) {
      const entry = { source: null, home: emptyHome(), status: { connection: "connecting", message: null } };
      try {
        entry.source = new SamsungTVSource({
          ...this.options,
          host: tv.host, name: tv.name, mac: tv.mac, room: tv.room ?? null, token: tv.token ?? "",
          ports: { ...this.options.ports, ...(tv.httpPort ? { http: tv.httpPort } : {}), ...(tv.wsPort ? { ws: tv.wsPort } : {}) },
          onChange: () => this.#refresh(entry),
          onStatus: (s) => { entry.status = s; this.onChange(); },
          onToken: (token) => this.onToken(tv.host, token),
          log: this.log,
        });
        entry.status = entry.source.status;
        entry.source.start();
        this.#refresh(entry, false);
      } catch (err) {
        entry.status = { connection: "failed", message: err.message };
        this.log(`samsung tv ${tv.host}: ${err.message}`);
      }
      this.entries.push(entry);
    }
    this.onChange();
  }

  stop() {
    for (const e of this.entries) e.source?.stop();
    this.entries = [];
  }

  #refresh(entry, notify = true) {
    const snap = { ...emptyHome(), ...entry.source.snapshot() };
    // Keep what someone just pressed for a few seconds, like the main store does.
    const now = Date.now();
    for (const [key, r] of this.recent) if (now - r.at > 3000) this.recent.delete(key);
    for (const { cmd } of this.recent.values()) applyCommand(snap, cmd);
    entry.home = snap;
    if (notify) this.onChange();
  }

  /** The main home plus every source's devices. Rooms stay the main system's. */
  merge(home) {
    if (!this.entries.length) return home;
    const media = [...home.media];
    for (const e of this.entries) for (const m of e.home.media) media.push({ ...m, roomId: resolveRoom(home, m.roomId) });
    return { ...home, media };
  }

  #entryFor(id) {
    const s = String(id);
    return this.entries.find((e) => e.source && (s === e.source.id || s.startsWith(`${e.source.id}:`)));
  }

  owns(id) {
    return Boolean(this.#entryFor(id));
  }

  async perform(cmd) {
    const entry = this.#entryFor(cmd.id);
    if (!entry) throw new Error("Unknown device.");
    applyCommand(entry.home, cmd);
    const key = stateKey(cmd);
    if (key) this.recent.set(key, { cmd, at: Date.now() });
    this.onChange();
    await entry.source.perform(cmd);
  }

  /** One line per source for the app: which device, and whether it is paired and reachable. */
  statuses() {
    return this.entries.map((e) => ({
      id: e.source?.id ?? "", name: e.home.media[0]?.name ?? "Samsung TV", origin: "samsungtv",
      connection: e.status.connection, message: e.status.message ?? null,
    }));
  }
}

/** A TV's room from the config: a room id, or a room name, in the main system; else none. */
function resolveRoom(home, room) {
  if (!room) return null;
  const want = String(room).trim().toLowerCase();
  const hit = home.rooms.find((r) => r.id === room) ?? home.rooms.find((r) => String(r.name).trim().toLowerCase() === want);
  return hit?.id ?? null;
}
