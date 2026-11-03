// Schedules, timers and vacation mode. The same engine runs on the home server and,
// for the demo house, in the browser.
//
// automations = {
//   schedules: [{ id, name, enabled, when, days: [0..6] (0 = Sunday), actions: [action], lastRun: "YYYY-MM-DD" }],
//   timers:    [{ id, label, at (ms), actions: [action] }],
//   vacation:  { enabled, next (ms), offDay: "YYYY-MM-DD" },
// }
// when    = { type: "time", time: "23:00" } | { type: "sunrise" | "sunset", offset: minutes }
// action  = { type: "scene", id } | { type: "lights", roomId|null, level } | { type: "shades", roomId|null, position }
//         | { type: "mediaOff" } | { type: "lockAll" } | { type: "command", command }
import { locale, t } from "./i18n.js";
import { sunTimes } from "./sun.js";

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// English keys: show them with t(DAY_NAMES[d]).
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function emptyAutomations() {
  return { schedules: [], timers: [], vacation: { enabled: false, next: 0, offDay: "" } };
}

export function normalizeAutomations(a) {
  const base = emptyAutomations();
  return {
    schedules: Array.isArray(a?.schedules) ? a.schedules : base.schedules,
    timers: Array.isArray(a?.timers) ? a.timers : base.timers,
    vacation: { ...base.vacation, ...(a?.vacation ?? {}) },
  };
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const roomName = (home, id) => home.rooms.find((r) => r.id === id)?.name;

/** The house commands one action stands for, given the house as it is now. */
export function expandAction(action, home) {
  const inRoom = (list) => list.filter((x) => action.roomId == null || x.roomId === action.roomId);
  switch (action?.type) {
    case "scene": return [{ type: "recallScene", id: action.id }];
    case "lights": return inRoom(home.lights).map((l) => ({ type: "setLight", id: l.id, level: Number(action.level) || 0 }));
    case "shades": return inRoom(home.shades).map((s) => ({ type: "setShade", id: s.id, position: Number(action.position) || 0 }));
    case "mediaOff": return home.media.filter((m) => m.on).map((m) => ({ type: "mediaPower", id: m.id, on: false }));
    case "lockAll": return home.locks.filter((l) => l.locked !== true).map((l) => ({ type: "setLock", id: l.id, locked: true }));
    case "command": return action.command ? [action.command] : [];
    default: return [];
  }
}

/** Plain words for an action, in the app language: "Living Room lights off", "Scene: Good Night". */
export function describeAction(action, home) {
  const room = action?.roomId ? roomName(home, action.roomId) ?? t("Room") : null;
  switch (action?.type) {
    case "scene": return t("Scene: {name}", { name: home.scenes.find((s) => s.id === action.id)?.name ?? t("removed scene") });
    case "lights": {
      const pct = `${Math.round(action.level * 100)}%`;
      if (!(action.level > 0)) return room ? t("{room} lights off", { room }) : t("All lights off");
      if (action.level >= 1) return room ? t("{room} lights on", { room }) : t("All lights on");
      return room ? t("{room} lights to {pct}", { room, pct }) : t("All lights to {pct}", { pct });
    }
    case "shades":
      if (action.position >= 0.5) return room ? t("{room} shades open", { room }) : t("All shades open");
      return room ? t("{room} shades closed", { room }) : t("All shades closed");
    case "mediaOff": return t("Turn off all music and TV");
    case "lockAll": return t("Lock all doors");
    case "command": {
      const c = action.command ?? {};
      const find = (list) => list.find((x) => x.id === c.id)?.name ?? t("Device");
      if (c.type === "setLight") return t(c.level > 0 ? "{name} on" : "{name} off", { name: find(home.lights) });
      if (c.type === "setShade") return t(c.position >= 0.5 ? "{name} open" : "{name} closed", { name: find(home.shades) });
      if (c.type === "mediaPower") return t(c.on ? "{name} on" : "{name} off", { name: find(home.media) });
      if (c.type === "setSwitch") return t(c.on ? "{name} on" : "{name} off", { name: find(home.switches ?? []) });
      if (c.type === "setClimate") return `${find(home.climate ?? [])} ${String(c.target).replace(".", ",")} °C`;
      if (c.type === "setMode") {
        const m = (home.modes ?? []).find((x) => x.id === c.id);
        return `${m?.name ?? t("Mode")}: ${m?.options.find((o) => o.id === c.value)?.name ?? c.value}`;
      }
      return t("Device");
    }
    default: return t("Unknown action");
  }
}

/** When a schedule fires on the day of `date`, or null (no sun that day, bad time). */
export function triggerOn(schedule, date, place) {
  const when = schedule.when ?? {};
  if (when.type === "time") {
    const [h, m] = String(when.time ?? "").split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
  }
  if ((when.type === "sunrise" || when.type === "sunset") && place) {
    const sun = sunTimes(date, place.lat, place.lon);
    if (!sun) return null;
    return new Date(sun[when.type].getTime() + (Number(when.offset) || 0) * 60000);
  }
  return null;
}

/** The next time a schedule will run, looking a week ahead. */
export function nextRun(schedule, now, place) {
  if (!schedule.enabled) return null;
  const days = schedule.days?.length ? schedule.days : EVERY_DAY;
  for (let i = 0; i < 8; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!days.includes(day.getDay())) continue;
    const at = triggerOn(schedule, day, place);
    if (at && at > now && !(i === 0 && schedule.lastRun === dayKey(now))) return at;
  }
  return null;
}

/** "Every day at 11:00 PM", "Weekdays, 30 min after sunset" (Czech: "Každý den, 23:00"). */
export function describeWhen(schedule) {
  const when = schedule.when ?? {};
  const days = schedule.days?.length ? [...schedule.days].sort() : EVERY_DAY;
  const dayText = days.length === 7 ? t("Every day")
    : days.join() === "1,2,3,4,5" ? t("Weekdays")
    : days.join() === "0,6" ? t("Weekends")
    : days.map((d) => t(DAY_NAMES[d])).join(", ");
  if (when.type === "time") {
    const [h, m] = String(when.time ?? "0:0").split(":").map(Number);
    return t("{days} at {time}", { days: dayText, time: new Date(2000, 0, 1, h, m).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }) });
  }
  const offset = Number(when.offset) || 0;
  const sunrise = when.type === "sunrise";
  if (!offset) return t(sunrise ? "{days} at sunrise" : "{days} at sunset", { days: dayText });
  const key = offset < 0
    ? (sunrise ? "{days}, {n} min before sunrise" : "{days}, {n} min before sunset")
    : (sunrise ? "{days}, {n} min after sunrise" : "{days}, {n} min after sunset");
  return t(key, { days: dayText, n: Math.abs(offset) });
}

/**
 * Runs due schedules and timers and drives vacation mode. Call tick() about every 20 seconds.
 * @param {object} deps
 * @param {() => object} deps.getHome
 * @param {(cmd: object) => Promise<void>|void} deps.perform
 * @param {() => object} deps.getAutomations
 * @param {(automations: object) => void} deps.save - stores the changed automations
 * @param {() => ({lat, lon}|null)} deps.getPlace
 * @param {(text: string) => void} [deps.log]
 */
export class AutomationEngine {
  constructor(deps) {
    this.deps = deps;
  }

  async tick(now = new Date()) {
    const { getHome, getAutomations, save, getPlace } = this.deps;
    const a = normalizeAutomations(getAutomations());
    const home = getHome();
    const place = getPlace();
    const today = dayKey(now);
    let changed = false;

    for (const s of a.schedules) {
      if (!s.enabled || s.lastRun === today) continue;
      const days = s.days?.length ? s.days : EVERY_DAY;
      if (!days.includes(now.getDay())) continue;
      const at = triggerOn(s, now, place);
      // Run once the time has come, and not if the server was off for more than 10 minutes.
      if (at && now >= at && now - at < 10 * 60000) {
        s.lastRun = today;
        changed = true;
        await this.#run(s.actions, home, `Schedule “${s.name}”`);
      }
    }

    const due = a.timers.filter((t) => t.at <= now.getTime());
    if (due.length) {
      a.timers = a.timers.filter((t) => t.at > now.getTime());
      changed = true;
      for (const t of due) await this.#run(t.actions, home, `Timer “${t.label}”`);
    }

    if (a.vacation.enabled && place && home.lights.length) {
      changed = (await this.#vacation(a.vacation, home, now, place, today)) || changed;
    }

    if (changed) save(a);
  }

  /** Lights come on and go off at random through the evening, as if someone were home. */
  async #vacation(v, home, now, place, today) {
    const sun = sunTimes(now, place.lat, place.lon);
    const start = sun?.sunset ?? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30);
    if (now >= start && now < end) {
      if (now.getTime() < (v.next ?? 0)) return false;
      const light = home.lights[Math.floor(Math.random() * home.lights.length)];
      await this.deps.perform({ type: "setLight", id: light.id, level: light.level > 0.005 ? 0 : 0.7 });
      v.next = now.getTime() + (15 + Math.random() * 30) * 60000;
      return true;
    }
    if (now >= end && v.offDay !== today) {
      v.offDay = today;
      for (const l of home.lights) if (l.level > 0.005) await this.deps.perform({ type: "setLight", id: l.id, level: 0 });
      return true;
    }
    return false;
  }

  async #run(actions, home, what) {
    for (const action of actions ?? []) {
      for (const cmd of expandAction(action, home)) {
        try {
          await this.deps.perform(cmd);
        } catch (err) {
          this.deps.log?.(`${what}: ${describeAction(action, home)} failed: ${err.message}`);
        }
      }
    }
  }
}

/** Checks a schedule sent by the app before it is saved. Returns a problem or null. */
export function validateSchedule(s) {
  if (!s || typeof s !== "object") return "Bad schedule";
  if (typeof s.name !== "string" || !s.name.trim()) return "Give the schedule a name.";
  const w = s.when ?? {};
  if (w.type === "time") {
    if (!/^\d{1,2}:\d{2}$/.test(String(w.time))) return "Pick a time.";
  } else if (w.type !== "sunrise" && w.type !== "sunset") return "Pick when it runs.";
  if (!Array.isArray(s.days) || s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Pick the days.";
  if (!Array.isArray(s.actions) || !s.actions.length) return "Add at least one action.";
  if (s.actions.some((a) => !["scene", "lights", "shades", "mediaOff", "lockAll"].includes(a?.type))) return "Unknown action.";
  return null;
}
