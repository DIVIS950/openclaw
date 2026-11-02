// Handlers for the Home View extras: favorites, Edit Home, music, timers, schedules,
// vacation mode, location, the camera wall and the doorbell pop-up.
import { AutomationEngine, emptyAutomations, EVERY_DAY, normalizeAutomations, validateSchedule } from "../shared/automation.js";
import { cameraWallHTML, decodeAction, doorbellHTML, TEMPLATES } from "./extras.js";
import { DEFAULT_LAYOUT, HOME_PARTS } from "./views.js";

const $ = (s) => document.querySelector(s);

/**
 * @param {object} ctx - what the main module shares: app, prefs, send, notify, escText,
 *   openSheet, closeSheet, renderSheet, scheduleRender, wake
 */
export function createFeatures(ctx) {
  const { app, prefs, send, notify, escText, openSheet, closeSheet, renderSheet, scheduleRender } = ctx;
  let localEngine = null;
  let overlay = null; // { kind: "wall" } | { kind: "bell", id, ringAt }
  let overlayTimer = null;
  const seenRings = new Map(); // doorbell id -> ringAt already shown
  let firstState = true;

  // ---------- per-iPad choices: what Home shows, and favorites ----------

  const known = new Set(HOME_PARTS.map((p) => p.id));
  app.layout = (prefs.get("layout", null) ?? DEFAULT_LAYOUT).filter((id) => known.has(id));
  app.favorites = prefs.get("favorites", []);
  app.automations = emptyAutomations();
  app.weather = null;
  app.location = null;

  const saveLayout = () => { prefs.set("layout", app.layout); scheduleRender(); renderSheet(); };
  const saveFavorites = () => { prefs.set("favorites", app.favorites); scheduleRender(); renderSheet(); };

  // ---------- automations: the home server keeps them, or this browser for the demo ----------

  async function api(path, method, body) {
    const res = await fetch(`${app.api}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `The home server answered ${res.status}.`);
    return json;
  }

  async function saveAutomations(next) {
    const before = app.automations;
    app.automations = normalizeAutomations(next);
    scheduleRender();
    if (app.transport === "local") return;
    try {
      await api("automations", "PUT", { schedules: app.automations.schedules, vacation: { enabled: app.automations.vacation.enabled } });
    } catch (err) {
      app.automations = before;
      scheduleRender();
      notify(escText(err.message), { error: true });
      throw err;
    }
  }

  function startLocal() {
    // A sample place and weather so every part of the demo can be tried.
    // The demo place sits in the viewer's own time zone, so sunrise and sunset look right.
    const fahrenheit = /-US$/.test(navigator.language);
    app.location = { place: "Demo town", lat: 40, lon: -new Date().getTimezoneOffset() / 4, unit: fahrenheit ? "F" : "C" };
    const hour = new Date().getHours();
    app.weather = fahrenheit
      ? { temp: 64, code: 2, isDay: hour >= 7 && hour < 18, high: 68, low: 55, unit: "F" }
      : { temp: 18, code: 2, isDay: hour >= 7 && hour < 18, high: 20, low: 13, unit: "C" };
    app.automations = normalizeAutomations({
      schedules: [{ id: "demo-1", name: "Lights off at bedtime", enabled: true, when: { type: "time", time: "23:00" }, days: EVERY_DAY, actions: [{ type: "lights", roomId: null, level: 0 }] }],
    });
    localEngine = new AutomationEngine({
      getHome: () => app.home,
      perform: (cmd) => send(cmd),
      getAutomations: () => app.automations,
      save: (a) => { app.automations = normalizeAutomations(a); scheduleRender(); },
      getPlace: () => app.location,
    });
    setInterval(() => localEngine.tick(), 20000);
  }

  function receive(p) {
    app.weather = p.weather ?? null;
    app.location = p.location ?? null;
    app.automations = normalizeAutomations(p.automations);
    checkDoorbells();
  }

  // ---------- doorbell and camera wall ----------

  function checkDoorbells() {
    for (const bell of app.home.doorbells ?? []) {
      if (!bell.ringAt || seenRings.get(bell.id) === bell.ringAt) continue;
      seenRings.set(bell.id, bell.ringAt);
      // Old rings from before this screen opened are not news.
      if (firstState || Date.now() - bell.ringAt > 60000) continue;
      showOverlay({ kind: "bell", id: bell.id, ringAt: bell.ringAt });
      ctx.wake();
    }
    firstState = false;
  }

  function showOverlay(spec) {
    overlay = spec;
    clearTimeout(overlayTimer);
    if (spec.kind === "bell") overlayTimer = setTimeout(closeOverlay, 90000);
    renderOverlay();
  }

  function renderOverlay() {
    const root = $("#overlay-root");
    if (!overlay) {
      root.innerHTML = "";
      return;
    }
    if (overlay.kind === "wall") root.innerHTML = cameraWallHTML(app);
    else {
      const bell = app.home.doorbells.find((b) => b.id === overlay.id);
      root.innerHTML = bell ? doorbellHTML(app, { ...bell, ringAt: overlay.ringAt }) : "";
    }
  }

  function closeOverlay() {
    overlay = null;
    clearTimeout(overlayTimer);
    renderOverlay();
  }

  // ---------- the schedule being edited ----------

  /** Copies what was typed into the draft, so a re-render keeps it. */
  function syncDraft() {
    const d = app.sheet?.kind === "schedule" ? app.sheet.draft : null;
    if (!d) return null;
    const name = $("#sched-name");
    if (name) d.name = name.value;
    const time = $("#sched-time");
    if (time && d.when.type === "time") d.when.time = time.value || d.when.time;
    const offset = $("#sched-offset");
    if (offset && d.when.type !== "time") d.when.offset = Number(offset.value) || 0;
    return d;
  }

  const editSchedule = (draft) => openSheet({ kind: "schedule", draft: structuredClone(draft) });

  async function submitSchedule() {
    const d = syncDraft();
    if (!d) return;
    const draft = { ...d, name: d.name.trim() };
    const problem = validateSchedule(draft);
    if (problem) {
      const err = $("#sched-error");
      err.textContent = problem;
      err.hidden = false;
      return;
    }
    const list = app.automations.schedules.filter((s) => s.id !== draft.id);
    const saved = { ...draft, id: draft.id ?? (crypto.randomUUID?.() ?? String(Date.now())), enabled: draft.enabled !== false };
    const i = app.automations.schedules.findIndex((s) => s.id === draft.id);
    if (i >= 0) list.splice(i, 0, saved);
    else list.push(saved);
    try {
      await saveAutomations({ ...app.automations, schedules: list });
      closeSheet();
      notify(`${escText(saved.name)} saved`, { ic: "calendar", color: "#30d158" });
    } catch {}
  }

  async function addTimer(minutes, label, command) {
    if (app.transport === "local") {
      app.automations.timers.push({ id: String(Date.now()), label, at: Date.now() + minutes * 60000, actions: [{ type: "command", command }] });
      scheduleRender();
    } else {
      try {
        await api("timers", "POST", { minutes, label, command });
      } catch (err) {
        return notify(escText(err.message), { error: true });
      }
    }
    notify(`${escText(label)} in ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`, { ic: "timer", color: "#ff9f0a" });
  }

  async function cancelTimer(id) {
    app.automations.timers = app.automations.timers.filter((t) => t.id !== id);
    scheduleRender();
    if (app.transport === "local") return;
    try {
      await api(`timers/${encodeURIComponent(id)}`, "DELETE");
    } catch (err) {
      notify(escText(err.message), { error: true });
    }
  }

  async function submitLocation() {
    const input = $("#loc-input");
    const query = input?.value.trim() ?? "";
    if (!query) return;
    try {
      const res = await api("location", "PUT", { query });
      notify(`Location set to ${escText(res.place)}`, { ic: "cloudSun", color: "#40c8e0" });
    } catch (err) {
      notify(escText(err.message), { error: true });
    }
  }

  // ---------- actions ----------

  const actions = {
    favorite: (el) => {
      const key = el.dataset.fav;
      const has = app.favorites.includes(key);
      app.favorites = has ? app.favorites.filter((k) => k !== key) : [...app.favorites, key];
      saveFavorites();
      if (app.sheet?.kind !== "favorites") notify(has ? "Removed from Favorites" : "Added to Favorites", { ic: "star", color: "#ffb300" });
    },
    "pick-favorites": () => openSheet({ kind: "favorites" }),
    "edit-home": () => openSheet({ kind: "edit-home" }),
    "layout-remove": (el) => { app.layout = app.layout.filter((id) => id !== el.dataset.part); saveLayout(); },
    "layout-add": (el) => { app.layout = [...app.layout, el.dataset.part]; saveLayout(); },
    "layout-move": (el) => {
      const i = app.layout.indexOf(el.dataset.part);
      const j = i + Number(el.dataset.dir);
      if (i < 0 || j < 0 || j >= app.layout.length) return;
      [app.layout[i], app.layout[j]] = [app.layout[j], app.layout[i]];
      saveLayout();
    },
    "layout-reset": () => { app.layout = [...DEFAULT_LAYOUT]; saveLayout(); },

    transport: (el) => send({ type: "mediaTransport", id: el.dataset.id, action: el.dataset.action }),
    "play-everywhere": (el) => {
      const lead = app.home.media.find((m) => m.id === el.dataset.id);
      if (!lead?.sourceId) return;
      const name = lead.sources.find((s) => s.id === lead.sourceId)?.name ?? "Music";
      for (const m of app.home.media) {
        if (m.id === lead.id) continue;
        const same = m.sources.find((s) => s.name === name);
        if (same) send({ type: "mediaSource", id: m.id, sourceId: same.id });
        if (m.hasVolume && lead.hasVolume) send({ type: "mediaVolume", id: m.id, level: lead.volume });
      }
      notify(`${escText(name)} in every room`, { ic: "speakers", color: "#bf5af2" });
    },
    "all-media-off": () => {
      for (const m of app.home.media) if (m.on) send({ type: "mediaPower", id: m.id, on: false });
    },

    "timer-add": (el) => {
      let command;
      try { command = JSON.parse(el.dataset.cmd); } catch { return; }
      addTimer(Number(el.dataset.minutes), el.dataset.label, command);
    },
    "timer-cancel": (el) => cancelTimer(el.dataset.id),
    vacation: () => {
      const enabled = !app.automations.vacation.enabled;
      saveAutomations({ ...app.automations, vacation: { ...app.automations.vacation, enabled, next: 0 } })
        .then(() => notify(enabled ? "Vacation mode on" : "Vacation mode off", { ic: "suitcase", color: "#30d158" }))
        .catch(() => {});
    },

    "schedule-new": () => editSchedule({ name: "", enabled: true, when: { type: "time", time: "23:00" }, days: [...EVERY_DAY], actions: [] }),
    "schedule-template": (el) => editSchedule({ ...TEMPLATES[Number(el.dataset.i)], enabled: true }),
    "schedule-edit": (el) => {
      const s = app.automations.schedules.find((x) => x.id === el.dataset.id);
      if (s) editSchedule(s);
    },
    "schedule-toggle": (el) => {
      const schedules = app.automations.schedules.map((s) => (s.id === el.dataset.id ? { ...s, enabled: !s.enabled } : s));
      saveAutomations({ ...app.automations, schedules }).catch(() => {});
    },
    "schedule-delete": () => {
      const id = app.sheet?.draft?.id;
      if (!id) return;
      saveAutomations({ ...app.automations, schedules: app.automations.schedules.filter((s) => s.id !== id) })
        .then(() => { closeSheet(); notify("Schedule deleted", { ic: "calendar", color: "#ff453a" }); })
        .catch(() => {});
    },
    "sched-when": (el) => {
      const d = syncDraft();
      if (!d) return;
      d.when = el.dataset.v === "time" ? { type: "time", time: d.when.time ?? "23:00" } : { type: el.dataset.v, offset: d.when.offset ?? 0 };
      renderSheet();
    },
    "sched-day": (el) => {
      const d = syncDraft();
      if (!d) return;
      const day = Number(el.dataset.d);
      d.days = d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort();
      renderSheet();
    },
    "sched-action-add": () => {
      const d = syncDraft();
      const action = decodeAction($("#sched-add")?.value);
      if (!d || !action) return;
      d.actions.push(action);
      renderSheet();
    },
    "sched-action-remove": (el) => {
      const d = syncDraft();
      if (!d) return;
      d.actions.splice(Number(el.dataset.i), 1);
      renderSheet();
    },

    "doorbell-test": async (el) => {
      closeSheet();
      if (app.transport === "local") return ctx.ringDemo(el.dataset.id);
      try {
        await api(`doorbells/${encodeURIComponent(el.dataset.id)}/test`, "POST");
      } catch (err) {
        notify(escText(err.message), { error: true });
      }
    },
    "camera-wall": () => showOverlay({ kind: "wall" }),
    "overlay-close": () => closeOverlay(),
  };

  document.addEventListener("submit", (e) => {
    if (e.target.id === "sched-form") {
      e.preventDefault();
      submitSchedule();
    } else if (e.target.id === "loc-form") {
      e.preventDefault();
      submitLocation();
    }
  });

  return {
    actions,
    startLocal,
    receive,
    checkDoorbells,
    closeOverlay,
    get overlayOpen() { return Boolean(overlay); },
    renderOverlay,
  };
}
