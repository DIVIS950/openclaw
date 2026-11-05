// Web XPanel mode: the app runs on the Crestron processor itself (no home server) and talks
// to the program through Crestron's CrComLib and WebXPanel libraries, which the built page
// loads as globals before this module (see ../../xpanel/build.mjs). Join values go through
// the same join-map logic as the home server's CIP backend (../shared/joinmap.js), so a
// light behaves the same whichever way the joins travel.
import { t } from "../shared/i18n.js";
import { JoinMapHome, joinsUsed, runOps } from "../shared/joinmap.js";

const CONFIG_FILE = "xpanel-config.json";
const PREF_KEY = "hv.xpanel";
const PULSE_MS = 100;

/** True when the page was built as a Web XPanel, or opened with ?mode=xpanel for testing. */
export function isXPanelPage() {
  if (document.querySelector('meta[name="homeview-mode"]')?.content === "xpanel") return true;
  return new URLSearchParams(location.search).get("mode") === "xpanel";
}

/** "0a", "0x0A", "10" → "0A": two hex digits, upper case. Empty when it isn't one. */
export function normalizeIpId(v) {
  const m = /^(?:0x)?([0-9a-f]{1,2})$/i.exec(String(v ?? "").trim());
  return m ? m[1].toUpperCase().padStart(2, "0") : "";
}

/**
 * Settings: the package's xpanel-config.json (what the build baked in; may be missing),
 * overridden by what the person saved in this browser. { host, ipId, joinMapText, config }.
 */
export async function loadXPanelSettings() {
  let config = {};
  try {
    const res = await fetch(new URL(CONFIG_FILE, location.href), { cache: "no-store" });
    if (res.ok) config = (await res.json()) ?? {};
  } catch {}
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") ?? {}; } catch {}
  let joinMapText = typeof saved.joinMapText === "string" ? saved.joinMapText : "";
  if (!joinMapText && typeof config.joinMap === "string" && config.joinMap) {
    try {
      const res = await fetch(new URL(config.joinMap, location.href), { cache: "no-store" });
      if (res.ok) joinMapText = await res.text();
    } catch {}
  }
  return {
    host: String(saved.host ?? config.host ?? "").trim(),
    ipId: normalizeIpId(saved.ipId ?? config.ipId ?? ""),
    joinMapText,
    config,
  };
}

export function saveXPanelSettings({ host, ipId, joinMapText }) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ host, ipId, joinMapText })); } catch {}
}

export const libsPresent = () => Boolean(window.CrComLib?.subscribeState && window.WebXPanel?.default?.initialize);

// ---------- the one WebXPanel connection per page ----------

// WebXPanel can be initialized only once per page load and has no clean way to re-initialize
// with another host or IP ID. So: the connection state lives here, every engine instance
// listens to it, and a "reconnect" (new address, dropped link) is a page reload.
const link = { initialized: false, host: null, ipId: null, wasConnected: false, status: { connection: "idle", message: null }, listeners: new Set() };

export const reconnect = () => location.reload();

/** Whether these settings differ from the ones WebXPanel was started with (then a reload is needed). */
export const needsReload = (host, ipId) => link.initialized && (link.host !== (host || "") || link.ipId !== ipId);

function setLinkStatus(status) {
  if (status.connection === "connected") link.wasConnected = true;
  link.status = status;
  for (const fn of link.listeners) fn(status);
}

const failed = (kind, message, extra = {}) => ({ connection: "failed", kind, message, ...extra });

function initWebXPanel(host, ipId) {
  if (link.initialized) return;
  link.initialized = true;
  link.host = host || "";
  link.ipId = ipId;
  const X = window.WebXPanel;
  const E = X.WebXPanelEvents ?? {};
  const on = (name, fn) => { if (E[name]) X.default.addEventListener(E[name], (e) => fn(e?.detail ?? {})); };
  on("CONNECT_CIP", () => setLinkStatus({ connection: "connected", message: null }));
  on("DISCONNECT_CIP", () => setLinkStatus(link.wasConnected
    ? failed("dropped", t("The connection to the processor dropped."))
    : failed("ipid", t("The processor refused the panel. Check that this IP ID is in the program and not used by another panel."))));
  on("ERROR_WS", () => { if (!link.wasConnected) setLinkStatus(failed("unreachable", t("Can't reach the processor. Same Wi‑Fi? Right address?"))); });
  on("DISCONNECT_WS", () => {
    if (link.wasConnected) setLinkStatus(failed("dropped", t("The connection to the processor dropped.")));
    else if (link.status.connection !== "failed") setLinkStatus(failed("unreachable", t("Can't reach the processor. Same Wi‑Fi? Right address?")));
  });
  on("AUTHENTICATION_REQUIRED", () => setLinkStatus(failed("login", t("The processor asks for a login. Sign in on its page, then reload this one."))));
  on("AUTHENTICATION_FAILED", () => setLinkStatus(failed("login", t("The processor didn't accept the login. Sign in on its page, then reload this one."))));
  on("FETCH_TOKEN_FAILED", () => setLinkStatus(failed("login", t("The processor didn't hand out a connection token. Sign in on its page or check the address."))));
  // The processor's login page: the library tells us where; after signing in there, the page is reloaded.
  on("NOT_AUTHORIZED", ({ redirectTo }) => setLinkStatus(failed("login", t("You need to sign in on the processor page first."), { loginURL: redirectTo || null })));
  setLinkStatus({ connection: "connecting", message: null });
  // Inside the Crestron One app the container connects by itself; in a browser we start it.
  if (X.isActive !== false) {
    const cfg = { ipId: `0x${ipId}` };
    if (host) cfg.host = host;
    X.default.initialize(cfg);
  }
}

// ---------- the engine the app drives (same surface as DemoEngine) ----------

/**
 * @param {object} opts
 * @param {string} opts.host - processor address ("" = the page's own host)
 * @param {string} opts.ipId - two hex digits, e.g. "0A"
 * @param {object} opts.joinMap - a parsed join map (parseJoinMap)
 * @param {(snapshot) => void} opts.onChange - a join changed (debounced)
 * @param {(status) => void} opts.onStatus - { connection, message, kind?, loginURL? }
 */
export function createXPanelEngine({ host, ipId, joinMap, onChange, onStatus }) {
  const home = new JoinMapHome(joinMap);
  if (!libsPresent()) {
    // The page was opened outside the built package (plain file, home server with ?mode=xpanel).
    const status = failed("libs", t("Crestron's libraries aren't loaded. Open Home View from the processor (the built package)."));
    queueMicrotask(() => onStatus?.(status));
    return { snapshot: () => home.snapshot(), perform: async () => { throw new Error(status.message); }, stop() {}, ring() {}, get status() { return status; }, get map() { return home.map; } };
  }
  const C = window.CrComLib;
  const subs = [];
  let timer = null;
  let stopped = false;
  // A burst of joins arrives at once (the initial update): publish once.
  const changed = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => { timer = null; onChange?.(home.snapshot()); }, 60);
  };
  const sub = (type, name, fn) => subs.push([type, name, C.subscribeState(type, name, fn)]);
  const joins = joinsUsed(home.map);
  for (const j of joins.digital) sub("b", String(j), (v) => { home.setDigital(j, v); changed(); });
  for (const j of joins.analog) sub("n", String(j), (v) => { home.setAnalog(j, v); changed(); });
  for (const j of joins.serial) sub("s", String(j), (v) => { home.setSerial(j, v); changed(); });
  // The library's own "online" flag also covers the Crestron One app, where CONNECT_CIP may not reach us.
  sub("b", "Csig.All_Control_Systems_Online_fb", (v) => { if (v && link.status.connection !== "connected") setLinkStatus({ connection: "connected", message: null }); });
  const listener = (status) => { if (!stopped) onStatus?.(status); };
  link.listeners.add(listener);
  initWebXPanel(host, ipId);
  queueMicrotask(() => listener(link.status));

  // The joins travel to the program through publishEvent: "b" digital, "n" analog, "s" serial.
  const transport = {
    pulse(join) {
      C.publishEvent("b", String(join), true);
      setTimeout(() => C.publishEvent("b", String(join), false), PULSE_MS);
    },
    setAnalog(join, value) { C.publishEvent("n", String(join), Math.round(value)); },
    setSerial(join, text) { C.publishEvent("s", String(join), String(text)); },
  };

  return {
    snapshot: () => home.snapshot(),
    async perform(cmd) {
      if (link.status.connection !== "connected") throw new Error(t("Not connected to the processor yet."));
      await runOps(home.plan(cmd), transport);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      link.listeners.delete(listener);
      for (const [type, name, id] of subs) C.unsubscribeState(type, name, id);
    },
    ring() {}, // the real doorbell rings through its join
    get status() { return link.status; },
    get map() { return home.map; },
  };
}
