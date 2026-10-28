// Crestron Home OS Web API (https://<processor>/cws/api). Endpoint paths and field
// names follow traffic captured from real processors by the open-source CH2HA project.
// Login sends the installer token once and gets back an `authkey` for later calls;
// the key idles out after ~10 minutes, and a 401/511 means "log in again".
import https from "node:https";

const RAW_MAX = 65535;
const IO_SCENE_TYPES = new Set(["genericio", "generic i/o", "i/o"]);
const ACTIVE_PRESENCE = new Set(["present", "occupied", "open", "on", "openoron"]);

class NotSupported extends Error {}

export class CrestronHomeBackend {
  pollMs = 4000;

  constructor({ host, token }) {
    this.host = String(host ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    this.token = String(token ?? "").trim();
    this.authKey = null;
    // Processors use self-signed certificates; this agent is only used for this one host.
    this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  }

  async connect() {
    if (!this.host || !this.token) throw new Error("Enter the processor address and Web API token in Setup.");
    await this.#login();
  }

  disconnect() {
    this.authKey = null;
    this.agent.destroy();
  }

  async fetch() {
    const [rooms, lights, shades, scenes, media, locks, security, sensorsRaw] = await Promise.all([
      this.#list("/rooms", "rooms", true),
      this.#list("/lights", "lights", true),
      this.#list("/shades", "shades"),
      this.#list("/scenes", "scenes"),
      this.#list("/mediarooms", "mediaRooms"),
      this.#list("/doorlocks", "doorLocks"),
      this.#list("/securitydevices", "securityDevices"),
      this.#list("/sensors", "sensors"),
    ]);
    const id = (v) => (v === undefined || v === null || v === "" ? null : String(v));
    const online = (d) => String(d.connectionStatus ?? "").toLowerCase() !== "offline";

    const sensors = sensorsRaw.filter((d) => id(d.id)).map((d) => ({
      id: id(d.id),
      name: d.name ?? "Sensor",
      roomId: id(d.roomId),
      kind: d.subType ?? "",
      active: ACTIVE_PRESENCE.has(String(d.presence ?? "").toLowerCase().replace(/[\s_]/g, "")),
    }));

    const home = {
      rooms: rooms.filter((d) => id(d.id)).map((d) => ({ id: id(d.id), name: d.name ?? `Room ${d.id}` })),
      lights: lights.filter((d) => id(d.id)).map((d) => ({
        id: id(d.id),
        name: d.name ?? "Light",
        roomId: id(d.roomId),
        level: Math.min(1, (Number(d.level) || 0) / RAW_MAX),
        dimmable: !String(d.subType ?? "").toLowerCase().includes("switch"),
        online: online(d),
      })),
      shades: shades.filter((d) => id(d.id)).map((d) => ({
        id: id(d.id),
        name: d.name ?? "Shade",
        roomId: id(d.roomId),
        position: Math.min(1, (Number(d.position) || 0) / RAW_MAX),
        hasPosition: true,
        canStop: false,
        online: online(d),
      })),
      scenes: [],
      gates: [],
      media: media.filter((d) => id(d.id)).map((d) => {
        const controls = (d.availableVolumeControls ?? []).map((v) => String(v).toLowerCase());
        return {
          id: id(d.id),
          name: d.name ?? "Media",
          roomId: id(d.roomId) ?? id(d.id),
          on: String(d.currentPowerState ?? "").toLowerCase() === "on",
          // Reads back on the 0-65535 scale; written as 0-100 (see perform()).
          volume: Math.min(1, (Number(d.currentVolumeLevel) || 0) / RAW_MAX),
          muted: String(d.currentMuteState ?? "").toLowerCase() === "muted",
          hasVolume: !controls.includes("none"),
          sources: (d.availableSources ?? []).filter((s) => id(s.id)).map((s) => ({ id: id(s.id), name: s.sourceName ?? `Source ${s.id}` })),
          sourceId: id(d.currentSourceId),
        };
      }),
      locks: locks.filter((d) => id(d.id)).map((d) => {
        // Firmware reports "Locked"/"Unlocked"; the docs show lowercase.
        const status = String(d.status ?? "").toLowerCase();
        return { id: id(d.id), name: d.name ?? "Lock", roomId: id(d.roomId), locked: status === "locked" ? true : status === "unlocked" ? false : null };
      }),
      security: security.filter((d) => id(d.id)).map((d) => ({
        id: id(d.id),
        name: d.name ?? "Security",
        mode: securityMode(d.currentState),
        needsCode: true,
        canArmHome: true,
        canArmAway: true,
      })),
      sensors,
    };

    for (const d of scenes) {
      if (!id(d.id)) continue;
      const name = d.name ?? "Scene";
      const type = String(d.type ?? "").toLowerCase();
      if (IO_SCENE_TYPES.has(type)) {
        // Relay / gate trigger. A sensor with a matching name gives open/closed status.
        const sensor = sensors.find((s) => s.name.toLowerCase().includes(name.toLowerCase()))
          ?? sensors.find((s) => s.name.toLowerCase().includes("gate"));
        home.gates.push({ id: id(d.id), name, state: sensor ? (sensor.active ? "open" : "closed") : "unknown", separateOpenClose: false, canStop: false });
      } else {
        home.scenes.push({ id: id(d.id), name, roomId: id(d.roomId), kind: sceneKind(type), active: d.status === true });
      }
    }
    return home;
  }

  async perform(cmd) {
    const raw = (v) => Math.round(Math.min(1, Math.max(0, v)) * RAW_MAX);
    const jsonId = (v) => (/^\d+$/.test(v) ? Number(v) : v);
    const seg = encodeURIComponent;
    switch (cmd.type) {
      case "setLight":
        return this.#call("POST", "/lights/SetState", { lights: [{ id: jsonId(cmd.id), level: raw(cmd.level), time: 0 }] });
      case "setShade":
        return this.#call("POST", "/shades/SetState", { shades: [{ id: jsonId(cmd.id), position: raw(cmd.position) }] });
      case "recallScene":
        return this.#call("POST", `/scenes/recall/${seg(cmd.id)}`);
      case "mediaPower":
        return this.#call("POST", `/mediarooms/${seg(cmd.id)}/power/${cmd.on ? "on" : "off"}`);
      case "mediaVolume":
        return this.#call("POST", `/mediarooms/${seg(cmd.id)}/volume/${Math.round(Math.min(1, Math.max(0, cmd.level)) * 100)}`);
      case "mediaMute":
        return this.#call("POST", `/mediarooms/${seg(cmd.id)}/${cmd.muted ? "mute" : "unmute"}`);
      case "mediaSource":
        return this.#call("POST", `/mediarooms/${seg(cmd.id)}/selectsource/${seg(cmd.sourceId)}`);
      case "setLock":
        return this.#call("POST", `/doorlocks/${cmd.locked ? "lock" : "unlock"}/${seg(cmd.id)}`);
      case "setSecurity": {
        const verb = { armedAway: "armaway", armedHome: "armhome", disarmed: "disarm" }[cmd.mode];
        return this.#call("POST", `/securitydevices/${verb}/${seg(cmd.id)}`, { code: cmd.code ?? "" });
      }
      case "gate":
        // Crestron Home gates are momentary I/O scenes: recalling one pulses the relay.
        if (cmd.action === "stop") throw new Error("Stopping the gate isn't supported by Crestron Home.");
        return this.#call("POST", `/scenes/recall/${seg(cmd.id)}`);
      default:
        throw new Error(`${cmd.type} isn't supported by Crestron Home.`);
    }
  }

  async #login() {
    const { status, text } = await this.#request("GET", "/login", null, { "Crestron-RestAPI-AuthToken": this.token });
    if (status !== 200) throw new Error(`Login failed (HTTP ${status}). Check the Web API token; it changes after some firmware updates.`);
    let json = {};
    try { json = JSON.parse(text); } catch {}
    // The docs say `AuthKey`; real processors send `authkey`.
    const key = json.authkey ?? json.AuthKey;
    if (!key) throw new Error("Login returned no auth key. Is the Web API enabled in Crestron Home?");
    this.authKey = key;
  }

  async #list(path, key, required = false) {
    try {
      const json = await this.#call("GET", path);
      return Array.isArray(json[key]) ? json[key] : [];
    } catch (err) {
      if (!required && (err instanceof NotSupported || err.httpStatus)) return [];
      throw err;
    }
  }

  async #call(method, path, body = null) {
    if (!this.authKey) await this.#login();
    let res = await this.#request(method, path, body);
    if (res.status === 401 || res.status === 511) {
      this.authKey = null;
      await this.#login();
      res = await this.#request(method, path, body);
    }
    // Unknown paths answer HTTP 200 with a text banner instead of a 404.
    if (res.text.includes("Pyng Rest API") || res.text.includes("Refer to the user")) throw new NotSupported(path);
    let json = null;
    try { json = res.text ? JSON.parse(res.text) : {}; } catch {}
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`The processor answered ${res.status}: ${json?.errorMessage ?? res.text.slice(0, 160)}`);
      err.httpStatus = res.status;
      throw err;
    }
    return json ?? {};
  }

  #request(method, path, body, extraHeaders = {}) {
    const payload = body ? JSON.stringify(body) : null;
    const [hostname, port] = this.host.split(":");
    const headers = { Accept: "application/json", ...extraHeaders };
    if (this.authKey && path !== "/login") headers["Crestron-RestAPI-AuthKey"] = this.authKey;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname, port: port ? Number(port) : 443, path: `/cws/api${path}`, method, headers, agent: this.agent, timeout: 10000 },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (err) => reject(new Error(`Can't reach the processor at ${this.host}: ${err.message}`)));
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function sceneKind(type) {
  if (type.includes("light")) return "lighting";
  if (type.includes("shade")) return "shades";
  if (type.includes("media")) return "media";
  if (type.includes("climate") || type.includes("thermostat")) return "climate";
  return "other";
}

function securityMode(state) {
  const s = String(state ?? "").toLowerCase();
  if (s.includes("alarm")) return "alarm";
  if (s.includes("away")) return "armedAway";
  if (s.includes("home") || s.includes("stay")) return "armedHome";
  if (s.includes("disarm")) return "disarmed";
  return "unknown";
}
