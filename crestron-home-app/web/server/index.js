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
import { applyCommand, emptyHome, stateKey, validateCommand } from "../public/shared/model.js";
import { CrestronHomeBackend } from "./backends/crestron-home.js";
import { CustomProgramBackend, parseJoinMap } from "./backends/custom-program.js";
import { fetchSnapshot } from "./camera.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "..", "public");
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
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
  };
}

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
    cameras: config.cameras.map((c) => ({ id: c.id, name: c.name })),
  };
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
function receive(snapshot) {
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
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
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
        config = next;
        saveConfig(config);
        connect();
        return sendJSON(res, 200, publicConfig());
      }
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
  console.log(`Home Control is running: open http://<this-computer's-ip>:${PORT} on your iPad or phone`);
  console.log(`Mode: ${config.mode}${ADMIN_PIN ? " · Setup is protected by ADMIN_PIN" : ""}`);
  connect();
});
