// One Samsung Tizen TV on the home Wi-Fi, driven the way Home Assistant does it
// (the samsungtvws protocol): remote keys and app launches over a WebSocket on port
// 8002, power state from the REST API on port 8001, and power-on by Wake-on-LAN.
//
// The first connection makes the TV show an "Allow Home Control?" prompt; once accepted
// it answers with a token that is kept in the config so later connections are silent.
import dgram from "node:dgram";
import http from "node:http";

import { TV_KEYS } from "../../public/shared/model.js";
import { MiniWebSocket } from "./ws-mini.js";

// Status messages are English keys; the app shows them with t().
export const MSG_LOOKING = "Looking for the TV…";
export const MSG_ALLOW = "Allow Home Control on the TV screen";

const KEY_CODES = {
  up: "KEY_UP", down: "KEY_DOWN", left: "KEY_LEFT", right: "KEY_RIGHT", ok: "KEY_ENTER", back: "KEY_RETURN",
  home: "KEY_HOME", menu: "KEY_MENU", exit: "KEY_EXIT", info: "KEY_INFO", guide: "KEY_GUIDE",
  chUp: "KEY_CHUP", chDown: "KEY_CHDOWN", volUp: "KEY_VOLUP", volDown: "KEY_VOLDOWN", mute: "KEY_MUTE", power: "KEY_POWER",
  play: "KEY_PLAY", pause: "KEY_PAUSE", stop: "KEY_STOP", rewind: "KEY_REWIND", fastForward: "KEY_FF",
  red: "KEY_RED", green: "KEY_GREEN", yellow: "KEY_YELLOW", blue: "KEY_BLUE",
};
for (let d = 0; d <= 9; d++) KEY_CODES[`num${d}`] = `KEY_${d}`;

const INPUTS = [
  { id: "hdmi1", name: "HDMI 1", key: "KEY_HDMI1" }, { id: "hdmi2", name: "HDMI 2", key: "KEY_HDMI2" },
  { id: "hdmi3", name: "HDMI 3", key: "KEY_HDMI3" }, { id: "hdmi4", name: "HDMI 4", key: "KEY_HDMI4" },
  { id: "tv", name: "TV", key: "KEY_TV" },
];

/** Tizen app ids of the usual streaming apps (the TV adds whatever else is installed). */
export const KNOWN_APPS = [
  { id: "app-netflix", name: "Netflix", appId: "11101200001" },
  { id: "app-youtube", name: "YouTube", appId: "111299001912" },
  { id: "app-prime", name: "Prime Video", appId: "3201512006785" },
  { id: "app-disney", name: "Disney+", appId: "3201901017640" },
  { id: "app-spotify", name: "Spotify", appId: "3201606009684" },
  { id: "app-appletv", name: "Apple TV", appId: "3201807016597" },
  { id: "app-max", name: "Max", appId: "3201601007230" },
];

/** Sends the magic packet that wakes a TV with Wake-on-LAN enabled (Samsung: "Power On with Mobile"). */
export function sendWakeOnLan(mac, { address = "255.255.255.255", port = 9 } = {}) {
  return new Promise((resolve, reject) => {
    const hex = String(mac ?? "").replace(/[^0-9a-f]/gi, "");
    if (hex.length !== 12) return reject(new Error("Add the TV's MAC address in Setup to turn it on from here."));
    const bytes = Buffer.from(hex, "hex");
    const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
    const sock = dgram.createSocket("udp4");
    sock.once("error", (err) => { sock.close(); reject(err); });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch {}
      sock.send(packet, 0, packet.length, port, address, (err) => {
        sock.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export class SamsungTVSource {
  /**
   * @param {object} o
   * @param {string} o.host - the TV's IP address
   * @param {string} [o.name] - shown in the app (the TV's own name when empty)
   * @param {string} [o.mac] - for Wake-on-LAN
   * @param {string} [o.room] - room id or name in the main system
   * @param {string} [o.token] - pairing token from an earlier connection
   * @param {{ http?: number, ws?: number }} [o.ports] - 8001 / 8002 on a real TV
   * @param {{ address?: string, port?: number }} [o.wol] - where the magic packet goes
   * @param {number} [o.pollMs] - how often to ask the TV for its power state
   * @param {() => void} [o.onChange] - the snapshot changed
   * @param {(s: { connection: string, message: string | null }) => void} [o.onStatus]
   * @param {(token: string) => void} [o.onToken] - a new pairing token to keep
   */
  constructor({ host, name = "", mac = "", room = null, token = "", appName = "Home Control", ports = {}, wol = {}, pollMs = 10000, onChange, onStatus, onToken, log }) {
    this.host = String(host ?? "").trim();
    this.name = String(name ?? "").trim();
    this.mac = String(mac ?? "").trim();
    this.room = room || null;
    this.token = String(token ?? "");
    this.appName = appName;
    this.ports = { http: ports.http ?? 8001, ws: ports.ws ?? 8002 };
    this.wol = wol;
    this.pollMs = pollMs;
    this.onChange = onChange ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.onToken = onToken ?? (() => {});
    this.log = log ?? (() => {});
    this.id = `stv:${this.host}`;
    // What we know about the TV.
    this.reachable = false;
    this.power = null; // "on" | "standby" | null (unknown)
    this.tvName = "";
    this.tvMac = "";
    this.apps = KNOWN_APPS.map((a) => ({ ...a }));
    this.sourceId = null;
    this.channel = null;
    this.muted = false;
    this.nowPlaying = null;
    // The remote-control socket.
    this.ws = null;
    this.ready = false; // ms.channel.connect received
    this.waiting = []; // { resolve, reject } for commands sent before the socket was ready
    this.authTimer = null;
    this.retryAt = 0;
    this.denied = false;
    this.pollTimer = null;
    this.lastJSON = "";
    this.powerHoldUntil = 0; // after KEY_POWER or Wake-on-LAN the TV takes a while to report the new state
    this.status = { connection: "connecting", message: MSG_LOOKING };
  }

  start() {
    if (!this.host) {
      this.#setStatus("failed", "Enter the TV's IP address in Setup.");
      return;
    }
    this.#poll();
    this.pollTimer = setInterval(() => this.#poll(), this.pollMs);
    this.pollTimer.unref?.();
  }

  stop() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.#disconnect();
  }

  /** The TV as a media zone, in a partial home (rooms come from the main system). */
  snapshot() {
    const on = this.power === "on";
    return {
      media: [{
        id: this.id, name: this.name || this.tvName || "Samsung TV", roomId: this.room,
        on, volume: 0, hasVolume: false, muted: on ? this.muted : false,
        sources: INPUTS.map(({ id, name }) => ({ id, name })), sourceId: on ? this.sourceId : null,
        playing: on, canTransport: true, nowPlaying: on ? this.nowPlaying : null,
        kind: "tv", canRemote: true, apps: this.apps.map(({ id, name }) => ({ id, name })),
        channel: on ? this.channel : null, origin: "samsungtv",
      }],
    };
  }

  async perform(cmd) {
    switch (cmd.type) {
      case "mediaPower":
        return cmd.on ? this.#wake() : this.#key("KEY_POWER").then(() => this.#assume({ power: "standby" }));
      case "mediaMute":
        await this.#key("KEY_MUTE");
        return this.#assume({ muted: cmd.muted });
      case "mediaVolume":
        throw new Error("This TV only has volume up and down; use the remote keys.");
      case "mediaSource": {
        const input = INPUTS.find((i) => i.id === cmd.sourceId);
        if (!input) throw new Error("Unknown input.");
        await this.#key(input.key);
        return this.#assume({ sourceId: input.id, channel: null, nowPlaying: null, power: "on" });
      }
      case "mediaTransport": {
        const code = { play: "KEY_PLAY", pause: "KEY_PAUSE", next: "KEY_FF", previous: "KEY_REWIND" }[cmd.action];
        if (!code) throw new Error("Unknown transport action.");
        return this.#key(code);
      }
      case "tvKey": {
        if (!TV_KEYS.includes(cmd.key)) throw new Error("Unknown key.");
        if (cmd.key === "power" && this.power !== "on") return this.#wake();
        await this.#key(KEY_CODES[cmd.key]);
        if (cmd.key === "mute") this.#assume({ muted: !this.muted });
        if (cmd.key === "power") this.#assume({ power: "standby" });
        if ((cmd.key === "chUp" || cmd.key === "chDown") && this.channel) {
          this.#assume({ channel: { number: Math.max(1, this.channel.number + (cmd.key === "chUp" ? 1 : -1)), name: "" }, sourceId: "tv" });
        }
        return;
      }
      case "mediaChannel": {
        const n = Number(cmd.channel);
        if (!Number.isInteger(n) || n <= 0) throw new Error("Bad channel.");
        for (const d of String(n)) {
          await this.#key(`KEY_${d}`);
          await delay(120);
        }
        await this.#key("KEY_ENTER");
        return this.#assume({ channel: { number: n, name: "" }, sourceId: "tv", nowPlaying: null, power: "on" });
      }
      case "tvApp":
        return this.#launch(cmd.appId);
      default:
        throw new Error("This TV can't do that.");
    }
  }

  // ---------- power state over REST ----------

  #poll() {
    const req = http.get({ host: this.host, port: this.ports.http, path: "/api/v2/", timeout: 2000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const info = JSON.parse(body);
          const dev = info.device ?? {};
          this.reachable = true;
          const polled = dev.PowerState === "on" ? "on" : "standby";
          if (Date.now() >= this.powerHoldUntil || this.power == null) this.power = polled;
          if (typeof dev.name === "string" && dev.name) this.tvName = dev.name;
          if (typeof dev.wifiMac === "string") this.tvMac = dev.wifiMac;
          // Keep the socket open while the TV is on, so keys answer at once.
          if (this.power === "on" && !this.ws && Date.now() >= this.retryAt) this.#connect();
          if (this.power !== "on") this.nowPlaying = null;
        } catch {
          this.reachable = false;
        }
        this.#update();
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => {
      this.reachable = false;
      if (this.power === "on" && Date.now() >= this.powerHoldUntil) this.power = "standby";
      this.#update();
    });
  }

  /** Optimistic state after a key the TV doesn't report back (or reports late). */
  #assume(fields) {
    if ("power" in fields) this.powerHoldUntil = Date.now() + 8000;
    Object.assign(this, fields);
    this.#update();
  }

  #update() {
    if (!this.reachable) this.#setStatus("connecting", MSG_LOOKING);
    else if (this.denied) this.#setStatus("failed", MSG_ALLOW);
    else if (this.power === "on" && this.ws && !this.ready && !this.token) this.#setStatus("connecting", MSG_ALLOW);
    else this.#setStatus("connected", null);
    const json = JSON.stringify(this.snapshot());
    if (json !== this.lastJSON) {
      this.lastJSON = json;
      this.onChange();
    }
  }

  #setStatus(connection, message) {
    if (this.status.connection === connection && this.status.message === message) return;
    this.status = { connection, message };
    this.onStatus(this.status);
  }

  // ---------- the remote-control socket ----------

  #connect() {
    if (this.ws) return;
    const name = Buffer.from(this.appName).toString("base64");
    const url = `wss://${this.host}:${this.ports.ws}/api/v2/channels/samsung.remote.control?name=${encodeURIComponent(name)}${this.token ? `&token=${encodeURIComponent(this.token)}` : ""}`;
    const ws = new MiniWebSocket(url, { rejectUnauthorized: false, timeout: 8000 });
    this.ws = ws;
    this.ready = false;
    ws.on("open", () => {
      // Without a token the TV now shows its Allow prompt and waits about 30 s.
      clearTimeout(this.authTimer);
      this.authTimer = setTimeout(() => { if (this.ws === ws && !this.ready) this.#failWaiting(new Error(MSG_ALLOW)); }, 35000);
      this.authTimer.unref?.();
      this.#update();
    });
    ws.on("message", (text) => this.#onMessage(ws, text));
    ws.on("error", (err) => this.log(`samsung tv ${this.host}: ${err.message}`));
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      clearTimeout(this.authTimer);
      this.#failWaiting(new Error(this.reachable ? "The TV closed the connection." : "The TV isn't reachable."));
      this.#update();
    });
  }

  #disconnect() {
    clearTimeout(this.authTimer);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    ws?.close();
    this.#failWaiting(new Error("Disconnected."));
  }

  #onMessage(ws, text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    switch (msg.event) {
      case "ms.channel.connect": {
        const token = msg.data?.token;
        if (typeof token === "string" && token && token !== this.token) {
          this.token = token;
          this.onToken(token);
        }
        this.ready = true;
        this.denied = false;
        clearTimeout(this.authTimer);
        for (const w of this.waiting.splice(0)) w.resolve(ws);
        // Ask which apps are installed; the answer arrives as ed.installedApp.get.
        try { ws.send(JSON.stringify({ method: "ms.channel.emit", params: { event: "ed.installedApp.get", to: "host" } })); } catch {}
        this.#update();
        return;
      }
      case "ms.channel.unauthorized":
        // Someone pressed Deny on the TV. Try again a minute later, not every poll.
        this.denied = true;
        this.token = "";
        this.retryAt = Date.now() + 60000;
        this.#failWaiting(new Error(MSG_ALLOW));
        ws.close();
        this.#update();
        return;
      case "ed.installedApp.get":
        this.#mergeApps(msg.data?.data);
        return;
      default:
        return; // clientConnect, touchEnable, launch acknowledgements…
    }
  }

  /** Adds the TV's installed apps to the known ones (the TV's own names win). */
  #mergeApps(list) {
    if (!Array.isArray(list)) return;
    const apps = this.apps.map((a) => ({ ...a }));
    for (const item of list) {
      const appId = String(item?.appId ?? "");
      const name = String(item?.name ?? "").trim();
      if (!appId || !name) continue;
      const known = apps.find((a) => a.appId === appId);
      if (known) known.name = name;
      else apps.push({ id: `app-${appId}`, name, appId });
    }
    this.apps = apps;
    this.#update();
  }

  /** The open, paired socket; connects first when needed. */
  #ready() {
    if (this.ws && this.ready) return Promise.resolve(this.ws);
    if (this.denied && Date.now() < this.retryAt) return Promise.reject(new Error(MSG_ALLOW));
    this.denied = false;
    if (!this.ws) this.#connect();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      this.waiting.push(entry);
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== entry);
        reject(new Error(this.token ? "The TV didn't answer. Is it on and on the same network?" : MSG_ALLOW));
      }, this.token ? 6000 : 35000);
      timer.unref?.();
      const done = entry.resolve;
      entry.resolve = (ws) => { clearTimeout(timer); done(ws); };
      const fail = entry.reject;
      entry.reject = (err) => { clearTimeout(timer); fail(err); };
    });
  }

  #failWaiting(err) {
    for (const w of this.waiting.splice(0)) w.reject(err);
  }

  async #key(code) {
    const ws = await this.#ready();
    ws.send(JSON.stringify({ method: "ms.remote.control", params: { Cmd: "Click", DataOfCmd: code, Option: "false", TypeOfRemote: "SendRemoteKey" } }));
  }

  async #launch(id) {
    const app = this.apps.find((a) => a.id === id || a.appId === id);
    const appId = app?.appId ?? (/^\d+$/.test(String(id)) ? String(id) : null);
    if (!appId) throw new Error("Unknown app.");
    const ws = await this.#ready();
    ws.send(JSON.stringify({ method: "ms.channel.emit", params: { event: "ed.apps.launch", to: "host", data: { action_type: "DEEP_LINK", appId } } }));
    this.#assume({ power: "on", sourceId: null, channel: null, nowPlaying: { title: app?.name ?? appId, artist: "App", album: this.name || this.tvName || "Samsung TV" } });
  }

  async #wake() {
    await sendWakeOnLan(this.mac || this.tvMac, this.wol);
    // The TV takes a few seconds; the next poll confirms. Show it as on meanwhile.
    this.#assume({ power: "on" });
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
