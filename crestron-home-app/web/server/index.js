// Home server for the Home Control web app. Run it on any always-on computer on
// the home network (Mac, PC, Raspberry Pi, NAS):  node server/index.js
//
// It serves the web app, talks to the Crestron processor, and pushes live state
// to every open browser over Server-Sent Events. No npm packages needed.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DemoEngine } from "../public/shared/demo.js";
import { AutomationEngine, emptyAutomations, normalizeAutomations, validateSchedule } from "../public/shared/automation.js";
import { applyCommand, emptyHome, normalizeHome, stateKey, validateCommand } from "../public/shared/model.js";
import { CrestronHomeBackend } from "./backends/crestron-home.js";
import { CustomProgramBackend, parseJoinMap } from "./backends/custom-program.js";
import { assistantErrorMessage, runAssistant } from "./assistant.js";
import { fetchSnapshot } from "./camera.js";
import { fetchWeather, findPlace } from "./weather.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "..", "public");
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
// Optional PIN that protects the Setup page (token, join map, cameras).
const ADMIN_PIN = process.env.ADMIN_PIN ?? "";

// ---------- config ----------

function readExampleJoinMap() {
  try {
    return fs.readFileSync(path.join(ROOT, "..", "..", "joinmap.example.json"), "utf8");
  } catch {
    return "{}";
  }
}

const DEFAULT_CONFIG = {
  mode: "demo", // demo | crestronHome | customProgram
  homeName: "Home",
  host: "",
  token: "",
  ipId: "03",
  port: 41794,
  joinMap: readExampleJoinMap(),
  cameras: [], // { id, name, snapshotURL, username, password }
  assistantKey: "", // Anthropic API key for the AI assistant (or set ANTHROPIC_API_KEY)
  roomPhotos: {}, // roomId -> version (time of upload); the files live in data/photos
  location: null, // { place, lat, lon, unit } for weather and sunrise/sunset schedules
  automations: emptyAutomations(), // schedules, timers, vacation mode (see shared/automation.js)
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // The file holds the Web API token and camera passwords: owner-only.
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

let config = loadConfig();

/** What the Setup page sees: secrets are never sent back, only whether they're set. */
function publicConfig() {
  return {
    mode: config.mode,
    homeName: config.homeName,
    host: config.host,
    hasToken: Boolean(config.token),
    ipId: config.ipId,
    port: config.port,
    joinMap: config.joinMap,
    cameras: config.cameras.map(({ password, ...c }) => ({ ...c, hasPassword: Boolean(password) })),
    hasAssistantKey: Boolean(config.assistantKey),
    assistantFromEnv: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

const assistantAvailable = () => Boolean(config.assistantKey || process.env.ANTHROPIC_API_KEY);

// ---------- store ----------

let home = emptyHome();
let status = { connection: "idle", message: null };
let backend = null;
let loopTimer = null;
let generation = 0;
const recent = new Map(); // stateKey -> { cmd, at }
const clients = new Set();

function payload() {
  return {
    home,
    status: { ...status, mode: config.mode },
    homeName: config.homeName,
    cameras: cameraList(),
    assistant: { available: assistantAvailable() },
    roomPhotos: config.roomPhotos,
    location: config.location ? { place: config.location.place, lat: config.location.lat, lon: config.location.lon } : null,
    weather,
    automations: normalizeAutomations(config.automations),
  };
}

/** Cameras for the app. The demo house shows two pretend ones until real cameras are added. */
function cameraList() {
  if (config.mode === "demo" && !config.cameras.length) {
    return [{ id: "demo-drive", name: "Driveway", demo: "drive" }, { id: "demo-door", name: "Front Door", demo: "door" }];
  }
  return config.cameras.map((c) => ({ id: c.id, name: c.name }));
}

// ---------- weather ----------

let weather = null;

async function refreshWeather() {
  if (!config.location) {
    weather = null;
    return;
  }
  try {
    weather = await fetchWeather(config.location);
    broadcast();
  } catch (err) {
    console.error("weather:", err.message);
  }
}

// ---------- automations ----------

const automations = new AutomationEngine({
  getHome: () => home,
  perform: (cmd) => perform(cmd),
  getAutomations: () => config.automations,
  save: (a) => {
    config = { ...config, automations: a };
    saveConfig(config);
    broadcast();
  },
  getPlace: () => config.location,
  log: (text) => console.error("automation:", text),
});

function saveAutomations(next) {
  config = { ...config, automations: normalizeAutomations(next) };
  saveConfig(config);
  broadcast();
}

// Room ids come from the processor and can hold any character, so photo files are named by hash.
const photoFile = (roomId) => path.join(PHOTO_DIR, `${crypto.createHash("sha256").update(roomId).digest("hex").slice(0, 32)}.jpg`);

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("The photo is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function broadcast() {
  const data = `event: state\ndata: ${JSON.stringify(payload())}\n\n`;
  for (const res of clients) res.write(data);
}

function setStatus(connection, message = null) {
  if (status.connection === connection && status.message === message) return;
  status = { connection, message };
  broadcast();
}

/** Keep what someone just set for a few seconds; processors report the old value until the load gets there. */
function receive(raw) {
  const snapshot = normalizeHome(raw);
  // Doorbells in a join map name their camera; match it to a camera set up here.
  for (const bell of snapshot.doorbells) {
    if (!bell.cameraId && bell.cameraName) bell.cameraId = config.cameras.find((c) => c.name === bell.cameraName)?.id ?? null;
  }
  const now = Date.now();
  for (const [key, entry] of recent) if (now - entry.at > 3000) recent.delete(key);
  for (const { cmd } of recent.values()) applyCommand(snapshot, cmd);
  const changed = JSON.stringify(snapshot) !== JSON.stringify(home);
  home = snapshot;
  if (changed) broadcast();
}

function makeBackend(cfg) {
  switch (cfg.mode) {
    case "crestronHome":
      return new CrestronHomeBackend({ host: cfg.host, token: cfg.token });
    case "customProgram": {
      const ipId = parseInt(String(cfg.ipId).replace(/^0x/i, ""), 16);
      if (!(ipId >= 0x03 && ipId <= 0xfe)) throw new Error("The IP ID must be a hex number from 03 to FE (e.g. 03 or 1A).");
      return new CustomProgramBackend({ host: cfg.host, ipId, port: Number(cfg.port) || 41794, joinMap: cfg.joinMap });
    }
    default: {
      const engine = new DemoEngine((snap) => receive(snap));
      return {
        pollMs: null,
        connect: async () => {},
        disconnect: () => engine.stop(),
        fetch: async () => engine.snapshot(),
        perform: async (cmd) => engine.perform(cmd),
        ring: (id) => engine.ring(id),
      };
    }
  }
}

function connect() {
  generation += 1;
  const gen = generation;
  clearTimeout(loopTimer);
  backend?.disconnect();
  backend = null;
  recent.clear();
  home = emptyHome();
  try {
    backend = makeBackend(config);
  } catch (err) {
    setStatus("failed", err.message);
    return;
  }
  const b = backend;
  b.onChange = (snap) => gen === generation && receive(snap);
  b.onStatus = (s) => gen === generation && setStatus(s.connection, s.message ?? null);
  setStatus("connecting");

  let connected = false;
  const tick = async () => {
    if (gen !== generation) return;
    try {
      if (!connected) {
        await b.connect();
        connected = true;
      }
      const snap = await b.fetch();
      if (gen !== generation) return;
      receive(snap);
      setStatus("connected");
    } catch (err) {
      if (gen !== generation) return;
      setStatus("failed", err.message);
    }
    // Push backends only need the loop until the first connect succeeds.
    const wait = b.pollMs ?? (connected ? null : 5000);
    if (wait != null && gen === generation) loopTimer = setTimeout(tick, wait);
  };
  tick();
}

async function perform(cmd) {
  if (!backend) throw new Error("Not connected.");
  applyCommand(home, cmd);
  const key = stateKey(cmd);
  if (key) recent.set(key, { cmd, at: Date.now() });
  broadcast();
  await backend.perform(cmd);
}

// ---------- HTTP ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJSON(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function pinOK(req) {
  if (!ADMIN_PIN) return true;
  const given = Buffer.from(String(req.headers["x-admin-pin"] ?? ""));
  const want = Buffer.from(ADMIN_PIN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function serveStatic(req, res, pathname) {
  // Home View (the iPad design) is the main app; the classic view stays at /index.html.
  // Folders serve their index.html; "/ipad" needs its slash so the page's relative links work.
  if (pathname === "/" || pathname === "/ipad") {
    res.writeHead(302, { Location: "/ipad/" });
    return res.end();
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/(^|\/)$/, "$1index.html");
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJSON(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return sendJSON(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/api/state" && req.method === "GET") return sendJSON(res, 200, payload());

    if (p === "/api/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(`event: state\ndata: ${JSON.stringify(payload())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (p === "/api/command" && req.method === "POST") {
      const cmd = await readJSON(req);
      const problem = validateCommand(cmd);
      if (problem) return sendJSON(res, 400, { error: problem });
      await perform(cmd);
      return sendJSON(res, 200, { ok: true });
    }

    if (p === "/api/assistant" && req.method === "POST") {
      const body = await readJSON(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return sendJSON(res, 400, { error: "Say or type what you'd like to do." });
      if (!assistantAvailable()) return sendJSON(res, 503, { error: "Add an Anthropic API key in Setup › AI assistant to use the assistant." });
      if (!backend) return sendJSON(res, 503, { error: "The home server isn't connected to your system yet." });
      try {
        const result = await runAssistant({
          message,
          history: Array.isArray(body.history) ? body.history : [],
          getHome: () => home,
          perform,
          apiKey: config.assistantKey || undefined,
          addTimer: async ({ minutes, label, commands }) => {
            const current = normalizeAutomations(config.automations);
            saveAutomations({
              ...current,
              timers: [...current.timers, {
                id: crypto.randomUUID(), label, at: Date.now() + minutes * 60000,
                actions: commands.map((command) => ({ type: "command", command })),
              }].slice(-50),
            });
          },
          addSchedule: async (schedule) => {
            const current = normalizeAutomations(config.automations);
            saveAutomations({ ...current, schedules: [...current.schedules, { ...schedule, id: crypto.randomUUID(), lastRun: "" }].slice(-100) });
          },
          getContext: () => ({
            viewingRoom: typeof body.context?.room === "string" ? body.context.room.slice(0, 60) : undefined,
            now: new Date().toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }),
            weather: weather ?? undefined,
            automations: normalizeAutomations(config.automations),
          }),
        });
        return sendJSON(res, 200, result);
      } catch (err) {
        console.error("assistant:", err);
        return sendJSON(res, 502, { error: assistantErrorMessage(err) });
      }
    }

    if (p === "/api/config") {
      if (!pinOK(req)) return sendJSON(res, 401, { error: "Enter the setup PIN." });
      if (req.method === "GET") return sendJSON(res, 200, publicConfig());
      if (req.method === "PUT") {
        const body = await readJSON(req);
        const next = { ...config };
        if (["demo", "crestronHome", "customProgram"].includes(body.mode)) next.mode = body.mode;
        for (const key of ["homeName", "host", "ipId"]) if (typeof body[key] === "string") next[key] = body[key].trim();
        if (Number.isInteger(body.port) && body.port > 0 && body.port < 65536) next.port = body.port;
        // An empty token field means "keep the saved one".
        if (typeof body.token === "string" && body.token.trim()) next.token = body.token.trim();
        if (typeof body.assistantKey === "string" && body.assistantKey.trim()) next.assistantKey = body.assistantKey.trim();
        if (body.removeAssistantKey === true) next.assistantKey = "";
        if (typeof body.joinMap === "string") {
          if (next.mode === "customProgram") parseJoinMap(body.joinMap); // reject a broken map before saving
          next.joinMap = body.joinMap;
        }
        if (Array.isArray(body.cameras)) {
          next.cameras = body.cameras
            .filter((c) => c && typeof c.name === "string" && typeof c.snapshotURL === "string")
            .map((c) => {
              const old = config.cameras.find((o) => o.id === c.id);
              return {
                id: typeof c.id === "string" && c.id ? c.id : crypto.randomUUID(),
                name: c.name.trim() || "Camera",
                snapshotURL: c.snapshotURL.trim(),
                username: String(c.username ?? "").trim(),
                // Keep the saved password unless a new one was typed.
                password: typeof c.password === "string" && c.password ? c.password : old?.password ?? "",
              };
            });
        }
        // Only a change to how we reach the processor needs a reconnect (not the AI key or cameras).
        const reconnect = ["mode", "host", "token", "ipId", "port", "joinMap"].some((k) => next[k] !== config[k]);
        config = next;
        saveConfig(config);
        if (reconnect) connect();
        else broadcast();
        return sendJSON(res, 200, publicConfig());
      }
    }

    if (p === "/api/automations" && req.method === "PUT") {
      const body = await readJSON(req);
      const schedules = Array.isArray(body.schedules) ? body.schedules : [];
      for (const sch of schedules) {
        const problem = validateSchedule(sch);
        if (problem) return sendJSON(res, 400, { error: problem });
      }
      const current = normalizeAutomations(config.automations);
      saveAutomations({
        ...current,
        schedules: schedules.slice(0, 100).map((sch) => ({
          id: typeof sch.id === "string" && sch.id ? sch.id : crypto.randomUUID(),
          name: sch.name.trim().slice(0, 60), enabled: sch.enabled !== false, when: sch.when, days: sch.days, actions: sch.actions,
          lastRun: current.schedules.find((o) => o.id === sch.id)?.lastRun ?? "",
        })),
        vacation: typeof body.vacation?.enabled === "boolean" ? { ...current.vacation, enabled: body.vacation.enabled, next: 0 } : current.vacation,
      });
      return sendJSON(res, 200, { ok: true });
    }

    if (p === "/api/timers" && req.method === "POST") {
      const body = await readJSON(req);
      const minutes = Number(body.minutes);
      const cmd = body.command;
      if (!(minutes > 0 && minutes <= 24 * 60)) return sendJSON(res, 400, { error: "Pick how long." });
      const problem = validateCommand(cmd);
      if (problem) return sendJSON(res, 400, { error: problem });
      const current = normalizeAutomations(config.automations);
      saveAutomations({
        ...current,
        timers: [...current.timers, {
          id: crypto.randomUUID(), label: String(body.label ?? "Timer").slice(0, 80),
          at: Date.now() + minutes * 60000, actions: [{ type: "command", command: cmd }],
        }].slice(-50),
      });
      return sendJSON(res, 200, { ok: true });
    }

    const timer = p.match(/^\/api\/timers\/([\w-]+)$/);
    if (timer && req.method === "DELETE") {
      const current = normalizeAutomations(config.automations);
      saveAutomations({ ...current, timers: current.timers.filter((t) => t.id !== timer[1]) });
      return sendJSON(res, 200, { ok: true });
    }

    if (p === "/api/location" && req.method === "PUT") {
      const body = await readJSON(req);
      if (body.clear === true) {
        config = { ...config, location: null };
        saveConfig(config);
        weather = null;
        broadcast();
        return sendJSON(res, 200, { ok: true });
      }
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) return sendJSON(res, 400, { error: "Type a town or city." });
      let found;
      try {
        found = await findPlace(query);
      } catch {
        return sendJSON(res, 502, { error: "Couldn't reach the weather service. Check the internet connection." });
      }
      if (!found) return sendJSON(res, 404, { error: `Couldn't find “${query}”. Try the nearest city.` });
      config = { ...config, location: found };
      saveConfig(config);
      await refreshWeather();
      broadcast();
      return sendJSON(res, 200, { ok: true, place: found.place });
    }

    const bell = p.match(/^\/api\/doorbells\/([\w-]+)\/test$/);
    if (bell && req.method === "POST") {
      // Shows the doorbell pop-up on every screen, without anyone at the door.
      if (backend?.ring) backend.ring(bell[1]);
      else {
        const b = home.doorbells.find((d) => d.id === bell[1]);
        if (!b) return sendJSON(res, 404, { error: "Unknown doorbell" });
        b.ringAt = Date.now();
        broadcast();
      }
      return sendJSON(res, 200, { ok: true });
    }

    const photo = p.match(/^\/api\/rooms\/([^/]+)\/photo$/);
    if (photo) {
      const roomId = decodeURIComponent(photo[1]);
      const file = photoFile(roomId);
      if (req.method === "GET") {
        return fs.readFile(file, (err, data) => {
          if (err) return sendJSON(res, 404, { error: "No photo" });
          res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000, immutable" });
          res.end(data);
        });
      }
      if (req.method === "PUT") {
        // Only rooms the system knows, so the photo folder can't grow without bound.
        if (!home.rooms.some((r) => r.id === roomId)) return sendJSON(res, 404, { error: "Unknown room" });
        const data = await readBody(req, MAX_PHOTO_BYTES);
        // The app always sends a resized JPEG; refuse anything else.
        if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return sendJSON(res, 415, { error: "Send the photo as a JPEG." });
        fs.mkdirSync(PHOTO_DIR, { recursive: true });
        fs.writeFileSync(file, data);
        config = { ...config, roomPhotos: { ...config.roomPhotos, [roomId]: Date.now() } };
        saveConfig(config);
        broadcast();
        return sendJSON(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        fs.rmSync(file, { force: true });
        const { [roomId]: _gone, ...rest } = config.roomPhotos;
        config = { ...config, roomPhotos: rest };
        saveConfig(config);
        broadcast();
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 405, { error: "Method not allowed" });
    }

    const cam = p.match(/^\/api\/cameras\/([\w-]+)\/snapshot$/);
    if (cam && req.method === "GET") {
      const camera = config.cameras.find((c) => c.id === cam[1]);
      if (!camera) return sendJSON(res, 404, { error: "Unknown camera" });
      const shot = await fetchSnapshot(camera);
      res.writeHead(200, { "Content-Type": shot.type, "Cache-Control": "no-store" });
      return res.end(shot.body);
    }

    if (p.startsWith("/api/")) return sendJSON(res, 404, { error: "Not found" });
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, p);
    return sendJSON(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Home Control is running: open http://<this-computer's-ip>:${PORT} on your iPad or phone (classic view: /index.html)`);
  console.log(`Mode: ${config.mode}${ADMIN_PIN ? " · Setup is protected by ADMIN_PIN" : ""}`);
  connect();
  refreshWeather();
  setInterval(refreshWeather, 15 * 60000);
  setInterval(() => automations.tick().catch((err) => console.error("automation:", err.message)), 20000);
});
