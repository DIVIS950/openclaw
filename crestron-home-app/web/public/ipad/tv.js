// The TV remote: the detail card for a media zone with `canRemote` (a Samsung TV today).
// HTML builders plus the handlers for keys, the channel keypad and app launches.
// sheets.js opens it in place of the music card; homeview.js wires up the actions.
import { icon } from "../icons.js";
import { t } from "../shared/i18n.js";
import { pct, roomOf } from "../shared/model.js";
import { appColors, attr, esc, sourceName, tvApp, tvTitle } from "./views.js";

// Which system a device comes from, for the small badge on its card (English keys, shown with t()).
const ORIGIN_NAMES = { samsungtv: "Samsung", homekit: "Apple Home", crestron: "Crestron", demo: "Demo" };

/** "Samsung", "Apple Home"… for a device from another system than the main one; null otherwise. */
export function originLabel(app, origin) {
  if (!origin) return null;
  const main = app.transport === "local" || app.status?.mode === "demo" ? "demo" : "crestron";
  return origin === main ? null : t(ORIGIN_NAMES[origin] ?? origin);
}

// Keys that repeat while held, like on a real remote.
const REPEAT_KEYS = new Set(["volUp", "volDown", "chUp", "chDown", "up", "down", "left", "right"]);

/** "N" for Netflix, "D+" for Disney+, "PV" for Prime Video. */
function initials(name) {
  const words = String(name).trim().split(/\s+/);
  if (words.length > 1) return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const w = words[0] ?? "";
  return (w[0] ?? "?").toUpperCase() + (/\+$/.test(w) ? "+" : "");
}

export function tvSheet(app, m, { sheetHead, timerPills, vslider }) {
  const room = roomOf(app.home, m.roomId);
  const src = app.sources?.find((s) => s.id === m.id);
  const note = src && src.connection !== "connected" && src.message ? t(src.message) : null;
  const digits = app.sheet?.digits ?? "";
  const runningApp = tvApp(m);
  const key = (k, ic, label, cls = "") =>
    `<button type="button" class="tv-key${cls ? ` ${cls}` : ""}" aria-label="${esc(label)}"${attr({ act: "tv-key", id: m.id, k, key: `tv:${m.id}:${k}`, repeat: REPEAT_KEYS.has(k) ? 1 : null })}>${ic ? icon(ic) : `<span>${esc(label)}</span>`}</button>`;
  const rocker = (label, keys) => `<div class="tv-rocker"><span class="tv-label">${esc(label)}</span><div class="tv-rocker-keys">${keys.map(([k, ic, l]) => key(k, ic, l, "pill-key")).join("")}</div></div>`;
  const inputs = m.sources.map((s) => `<button type="button" class="pill small" aria-pressed="${m.on && m.sourceId === s.id}"${attr({ act: "media-source", id: m.id, source: s.id, key: `src:${m.id}:${s.id}` })}>${esc(s.name)}</button>`).join("");
  // "4 · Nova", "Netflix" or the input; under it the show or the kind of thing it is.
  const now = !m.on ? t("Off") : m.channel ? `${m.channel.number} · ${m.channel.name || t("Channel {n}", { n: m.channel.number })}` : runningApp || m.nowPlaying?.title || sourceName(m);
  const show = m.channel && m.nowPlaying?.title && m.nowPlaying.title !== m.channel.name ? m.nowPlaying.title : null;
  const nowDetail = m.on
    ? [show, runningApp ? t("App") : m.sourceId ? sourceName(m) : null].filter(Boolean).join(" · ")
    : t("Tap the power button to turn it on");
  const apps = m.apps.map((a) => {
    const c = appColors(a.name);
    const on = m.on && runningApp === a.name;
    return `<button type="button" class="tv-app${on ? " on" : ""}" aria-pressed="${on}" aria-label="${esc(t("Launch {name}", { name: a.name }))}"${attr({ act: "tv-app", id: m.id, app: a.id, key: `app:${m.id}:${a.id}` })}>
      <span class="tv-app-tile" style="--a1:${c.a1};--a2:${c.a2}">${esc(initials(a.name))}</span><span class="tv-app-name">${esc(a.name)}</span></button>`;
  }).join("");
  const digitBtn = (d) => `<button type="button" class="key tv-digit"${attr({ act: "tv-digit", id: m.id, d, key: `dg:${m.id}:${d}` })}>${d}</button>`;
  const volume = m.hasVolume
    ? `<div class="tv-volume"><div class="big-val" data-live="volume:${esc(m.id)}">${m.muted ? t("Muted") : pct(m.volume)}</div>
        ${vslider({ kind: "volume", id: m.id, value: m.volume, cls: "volume", ic: m.muted ? "mute" : "volume", label: t("{name} volume", { name: m.name }) })}
        <button type="button" class="pill" aria-pressed="${m.muted}" data-act="media-mute" data-id="${esc(m.id)}">${icon(m.muted ? "mute" : "volume")}${m.muted ? t("Unmute") : t("Mute")}</button></div>`
    : "";
  const state = m.on ? tvTitle(m) : t("Off");
  return `${sheetHead("var(--purple)", "tv", m.name, room ? `${room.name} · ${state}` : state, app, `media:${m.id}`, m.origin)}
    <div class="tv-sheet">
      ${note ? `<div class="notice tv-note">${icon("alert")}<div>${esc(note)}</div></div>` : ""}
      <div class="tv-top">
        <button type="button" class="tv-power${m.on ? " on" : ""}" aria-pressed="${m.on}" aria-label="${esc(t("{name} power", { name: m.name }))}"${attr({ act: "media-power", id: m.id, key: `pw:${m.id}` })}>${icon("power")}</button>
        <div class="tv-inputs"><span class="tv-label">${t("Input")}</span><div class="pills left">${inputs}</div></div>
      </div>
      <div class="tv-now${m.on ? " on" : ""}"><span class="tv-now-icon">${icon(m.channel ? "tv" : runningApp ? "appsGrid" : "play")}</span>
        <div class="tv-now-text"><b>${esc(now)}</b><span>${esc(nowDetail)}</span></div></div>
      <div class="tv-cols${m.hasVolume ? " with-volume" : ""}">
        ${volume}
        <div class="tv-remote">
          <div class="dpad" role="group" aria-label="${t("Remote")}">
            ${key("back", "back", t("Back"), "corner")}${key("up", "chevronUp", t("Up"))}${key("home", "home", t("tv::Home"), "corner")}
            ${key("left", "chevronLeft", t("Left"))}${key("ok", null, "OK", "ok")}${key("right", "chevronRight", t("Right"))}
            ${key("menu", "menu", t("Menu"), "corner")}${key("down", "chevronDown", t("Down"))}${key("info", "info", t("Info"), "corner")}
          </div>
          <div class="tv-rockers">
            ${m.hasVolume ? "" : rocker(t("Volume"), [["volDown", "minus", t("Quieter")], ["mute", m.muted ? "mute" : "volume", m.muted ? t("Unmute") : t("Mute")], ["volUp", "plus", t("Louder")]])}
            ${rocker(t("Program"), [["chDown", "minus", t("Previous channel")], ["chUp", "plus", t("Next channel")]])}
          </div>
          <div class="tv-transport">${key("play", "playFill", t("Play"), `tr${m.playing ? " main" : ""}`)}${key("pause", "pause", t("Pause"), `tr${m.playing ? "" : " main"}`)}${key("stop", "stop", t("Stop"), "tr")}</div>
        </div>
        <div class="tv-numbers">
          <div class="tv-entry${digits ? " on" : ""}" data-tv-entry aria-live="polite">${esc(digits ? t("Channel {n}", { n: digits }) : t("Enter a channel number"))}</div>
          <div class="keypad tv-keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digitBtn).join("")}
            <button type="button" class="key text tv-digit"${attr({ act: "tv-clear", id: m.id })}>${t("Clear")}</button>${digitBtn(0)}
            <button type="button" class="key text tv-digit ok"${attr({ act: "tv-ch-ok", id: m.id, key: `ok:${m.id}` })}>OK</button>
          </div>
        </div>
      </div>
      ${apps ? `<div class="tv-apps-head">${icon("appsGrid")}<span>${t("Apps")}</span></div><div class="tv-apps">${apps}</div>` : ""}
      ${m.on ? timerPills(t("Sleep timer: off"), t("{name} off", { name: m.name }), { type: "mediaPower", id: m.id, on: false }) : ""}
    </div>`;
}

/**
 * Handlers for the remote. Digits typed on the keypad build a channel number that is
 * sent on OK or 1.5 s after the last digit; held volume and channel keys repeat.
 * @param {{ app, send, notify, escText, renderSheet }} ctx
 */
export function createTvControls({ app, send, notify, escText, renderSheet }) {
  let entryTimer = null;
  let repeat = null; // { timer, interval } while a key is held

  const spec = () => (app.sheet?.kind === "media" ? app.sheet : null);
  const pressKey = (id, k) => send({ type: "tvKey", id, key: k });

  function showEntry() {
    const el = document.querySelector("[data-tv-entry]");
    if (!el) return;
    const digits = spec()?.digits ?? "";
    el.textContent = digits ? t("Channel {n}", { n: digits }) : t("Enter a channel number");
    el.classList.toggle("on", Boolean(digits));
  }

  function commit(id) {
    clearTimeout(entryTimer);
    const s = spec();
    const n = Number(s?.digits);
    if (s) s.digits = "";
    if (!s || !Number.isInteger(n) || n <= 0) return showEntry();
    send({ type: "mediaChannel", id, channel: n });
    notify(t("Channel {n}", { n }), { ic: "tv", color: "#bf5af2" });
    renderSheet();
  }

  function stopRepeat() {
    if (!repeat) return;
    clearTimeout(repeat.timer);
    clearInterval(repeat.interval);
    repeat = null;
  }

  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest?.('[data-act="tv-key"][data-repeat]');
    if (!el) return;
    stopRepeat();
    repeat = {
      timer: setTimeout(() => {
        repeat.interval = setInterval(() => {
          // Mark the button so the click on release doesn't add one more press.
          el.dataset.repeated = "1";
          pressKey(el.dataset.id, el.dataset.k);
        }, 250);
      }, 400),
    };
  });
  document.addEventListener("pointerup", stopRepeat);
  document.addEventListener("pointercancel", stopRepeat);

  const actions = {
    "tv-key": (el) => {
      if (el.dataset.repeated) {
        delete el.dataset.repeated;
        return;
      }
      const { id, k } = el.dataset;
      if (k === "ok" && spec()?.digits) return commit(id);
      pressKey(id, k);
    },
    "tv-digit": (el) => {
      const s = spec();
      if (!s) return;
      s.digits = `${s.digits ?? ""}${el.dataset.d}`.slice(0, 4);
      showEntry();
      clearTimeout(entryTimer);
      entryTimer = setTimeout(() => commit(el.dataset.id), 1500);
    },
    "tv-clear": () => {
      const s = spec();
      if (s) s.digits = "";
      clearTimeout(entryTimer);
      showEntry();
    },
    "tv-ch-ok": (el) => (spec()?.digits ? commit(el.dataset.id) : pressKey(el.dataset.id, "ok")),
    "tv-app": (el) => {
      const m = app.home.media.find((x) => x.id === el.dataset.id);
      const a = m?.apps.find((x) => x.id === el.dataset.app);
      if (!a) return;
      send({ type: "tvApp", id: m.id, appId: a.id });
      notify(t("Launching {name}", { name: escText(a.name) }), { ic: "appsGrid", color: "#bf5af2" });
    },
  };

  return {
    actions,
    /** Forgets typed digits and held keys when the card closes. */
    reset() {
      clearTimeout(entryTimer);
      stopRepeat();
    },
  };
}
