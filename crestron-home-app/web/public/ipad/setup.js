// "Průvodce nastavením": the full-screen, step-by-step guide that connects this iPad to the
// house (Web XPanel on the processor, or the home server), plus the Nápověda checklist in
// Settings. HTML builders and the step logic; homeview.js does the actual connecting.
import { icon } from "../icons.js";
import { t, tn } from "../shared/i18n.js";
import { joinMapSummary, parseJoinMap } from "../shared/joinmap.js";
import { registerSheet, sheetHead } from "./sheets.js";
import { attr, esc, isOn } from "./views.js";
import { normalizeIpId } from "./xpanel.js";

const STEPS = ["welcome", "checklist", "processor", "ipid", "joinmap", "connect", "test", "ipad", "done"];
const ROOMS_PAGE = "https://claude.ai/artifact/47rndwGgRHvAfKC2kqvWHs";
const CONNECT_TIMEOUT = 20000;
const IP_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*)$/i;

// What people see when it doesn't connect (from WEB-XPANEL.md). English keys, shown with t().
const TROUBLE = {
  unreachable: ["The page doesn't load at all", "Wrong IP, a different Wi‑Fi, or the program isn't loaded", "Try https://<IP>/ in Safari; check with the installer"],
  login: ["Not signed in / sent to a login page", "The processor has authentication on", "Sign in with the name and password from the installer, then reload the page"],
  ipid: ["IP ID not in the program / connection refused", "The XPanel on this IP ID is missing, or another panel already uses it", "The installer checks the IP ID"],
  joins: ["Connected, but nothing reacts", "The join numbers don't match", "The installer fixes the numbers on the shared page; you import the map again"],
  dropped: ["Works, then shows Disconnected after a while", "The iPad went to sleep or Wi‑Fi dropped", "Auto-Lock Never; the app reconnects by itself"],
};

// The prepared message for the installer (English key; the Czech text is in i18n-cs.js, after ../../ZPRAVA-PRO-INSTALATERA.md).
const INSTALLER_MESSAGE = "Hello,\n\nI'd like to use my own iPad app on our Crestron instead of Crestron Go. The app runs from the processor itself as an HTML5 Web XPanel and connects to the program like a touch panel. I'd need from you, please:\n\n1. A new XPanel in the program on a free IP ID (for example 0A), wired to the same signals as the current panel. Copying the existing panel's symbol to the new IP ID is usually enough; please don't reuse the IP ID of a panel that is already running. Turn on Web XPanel support on the symbol.\n\n2. The processor's IP address on the home network, and its type and firmware version (Web XPanel needs a 4-Series with firmware 2.500+ or a 3-Series with 1.7000+).\n\n3. The join numbers for the new XPanel filled into the shared page \"Rooms and devices\": https://claude.ai/artifact/47rndwGgRHvAfKC2kqvWHs — for every light, shade, scene, thermostat, gate, alarm zone and the sauna. The page makes a joinmap.json file that I import.\n\n4. Loading the file HomeView.ch5z that I'll send you onto the processor (Crestron Toolbox, or ch5-cli deploy -t controlsystem).\n\n5. If the processor has authentication on, a login for its web page.\n\nNothing else in the program needs to change; the current panel keeps working as it is.\n\nThank you";

const DEVICE_LISTS = ["lights", "shades", "scenes", "media", "locks", "security", "gates", "climate", "modes", "switches", "doorbells"];
export const deviceCount = (h) => DEVICE_LISTS.reduce((n, k) => n + (h[k]?.length ?? 0), 0);

/** The join map's own messages are English; say the usual ones in the app language. */
function describeMapError(err) {
  const m = String(err?.message ?? err);
  if (/valid JSON/.test(m)) return t("This isn't a valid JSON file. Export it again from the Rooms page.");
  if (/must be a JSON object/.test(m)) return t("The join map must be a JSON object with rooms, lights and the rest.");
  const list = /“(\w+)” must be a list/.exec(m);
  if (list) return t("Join map: “{key}” must be a list.", { key: list[1] });
  const name = /(\w+) #(\d+) needs a "name"/.exec(m);
  if (name) return t("Join map: {key} #{n} has no name.", { key: name[1], n: name[2] });
  if (/needs an "id"/.test(m)) return t("Join map: every room needs an id.");
  if (/needs a list of "options"/.test(m)) return t("Join map: every mode needs a list of options.");
  return m;
}

export function createSetup(ctx) {
  const { app, prefs, send, notify, openSheet, closeSheet, scheduleRender } = ctx;
  const saved = prefs.get("setup", null) ?? {};
  const st = {
    open: false, help: false, step: Math.max(0, STEPS.indexOf(saved.step)), ip: "", ipId: "", mapText: "", map: null, mapError: "", paste: false,
    verify: null, phase: "idle", log: [], failure: null, pin: "", pinNeeded: false, light: null, asked: null,
    ipad: saved.ipad ?? {}, done: Boolean(saved.done), timeout: null,
  };
  const root = document.createElement("div");
  root.id = "setup-root";
  document.body.append(root);

  const persist = () => { if (ctx.mode() !== "demo") prefs.set("setup", { done: st.done, step: STEPS[st.step], ipad: st.ipad }); };
  const stepName = () => STEPS[st.step];
  const connected = () => {
    const s = ctx.status();
    return s.connection === "connected" && (ctx.mode() === "xpanel" ? !app.demoHouse : s.mode !== "demo");
  };

  /** Home shows the "finish setup" banner while this is true. */
  const needed = () => !st.done && ctx.mode() !== "demo" && !connected();

  // ---------- opening ----------

  /** What this browser already knows (Web XPanel settings), unless the person typed something this session. */
  function fromSettings() {
    if (!st.ip) st.ip = app.xpanel?.host || (ctx.mode() === "xpanel" && /^https?:$/.test(location.protocol) ? location.hostname : "");
    if (!st.ipId) st.ipId = app.xpanel?.ipId || "";
    if (!st.mapText && app.xpanel?.joinMapText) setMap(app.xpanel.joinMapText);
  }

  function open(at = null) {
    closeSheet(); // opened from Settings: the sheet would sit over the guide
    st.open = true;
    st.help = false;
    if (ctx.mode() === "demo") st.done = false;
    fromSettings();
    const i = typeof at === "string" ? STEPS.indexOf(at) : at;
    goTo(i != null && i >= 0 ? i : 0);
  }

  function openHelp() {
    closeSheet();
    st.open = true;
    st.help = true;
    fromSettings();
    render();
  }

  function close() {
    st.open = false;
    clearTimeout(st.timeout);
    root.innerHTML = "";
    document.body.classList.remove("setup-open");
    persist();
    scheduleRender();
  }

  /** On first run: the guide opens by itself when the house isn't set up (never in the demo). */
  function init() {
    const mode = ctx.mode();
    if (mode === "demo" || st.done) return;
    const resume = STEPS.includes(saved.step) ? saved.step : null;
    if (mode === "xpanel" && (!app.xpanel?.joinMapText || resume === "connect")) open(resume ?? 0);
    else if (mode === "server" && ctx.status().mode === "demo") open(resume ?? 0);
  }

  function goTo(i) {
    st.step = Math.max(0, Math.min(STEPS.length - 1, i));
    st.asked = null;
    if (stepName() === "test") {
      // The light to try: the first one in the first room.
      const first = app.home.rooms[0];
      st.light = app.home.lights.find((l) => l.roomId === first?.id) ?? app.home.lights[0] ?? null;
    }
    persist();
    render();
    if (stepName() === "connect") startConnecting();
  }

  // ---------- the steps' data ----------

  function setMap(text) {
    st.mapText = text;
    st.mapError = "";
    st.map = null;
    if (!text.trim()) return;
    try {
      st.map = parseJoinMap(text);
      if (ctx.mode() === "xpanel") ctx.saveMap(text);
    } catch (err) {
      st.mapError = describeMapError(err);
    }
  }

  async function verifyHost() {
    const ip = st.ip.trim();
    if (!IP_RE.test(ip)) return;
    st.verify = "busy";
    render();
    let ok = false;
    if (ctx.mode() === "demo" || ip === location.hostname) {
      await new Promise((r) => setTimeout(r, 600));
      ok = true; // this page came from there (or it's the demo)
    } else {
      // Any answer counts, even an opaque one: the processor's web server is up at that address.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      try {
        await fetch(`https://${ip}/`, { mode: "no-cors", cache: "no-store", signal: ctl.signal });
        ok = true;
      } catch {}
      clearTimeout(timer);
    }
    st.verify = ok ? "ok" : "fail";
    render();
  }

  async function startConnecting() {
    clearTimeout(st.timeout);
    st.log = [t("log::Connecting…")];
    st.failure = null;
    st.phase = "connecting";
    st.pinNeeded = false;
    render();
    let result;
    try {
      result = await ctx.connect({ host: st.ip.trim(), ipId: st.ipId, joinMapText: st.mapText, pin: st.pin });
    } catch (err) {
      if (err?.code === "pin") {
        st.pinNeeded = true;
        st.phase = "pin";
      } else fail("unreachable", err?.message);
      return render();
    }
    if (result?.reloading) return;
    st.timeout = setTimeout(() => { if (st.phase === "connecting") fail("unreachable", t("The processor didn't answer in time.")); }, CONNECT_TIMEOUT);
    if (!result?.simulated) onStatus(ctx.status());
  }

  function fail(kind, message, loginURL = null) {
    clearTimeout(st.timeout);
    st.phase = "failed";
    st.failure = { kind: TROUBLE[kind] ? kind : "unreachable", message: message || t("Not connected"), loginURL };
    render();
  }

  /** homeview.js calls this with every status change; only the connect step listens. */
  function onStatus(s) {
    if (!st.open || st.help || stepName() !== "connect") return;
    // The home server may still report its demo house for a moment after the switch: that isn't the real one.
    const up = s.connection === "connected" && (ctx.mode() !== "server" || s.mode !== "demo");
    if (up && st.phase === "connecting") {
      clearTimeout(st.timeout);
      st.phase = "loading";
      st.log.push(t("Panel accepted"), t("Loading the state…"));
      render();
      setTimeout(() => {
        if (st.phase !== "loading") return;
        st.phase = "connected";
        st.log.push(t("Done: {n}", { n: tn(deviceCount(app.home), "{n} device", "{n} devices") }));
        render();
      }, 700);
    } else if (s.connection === "failed" && (st.phase === "connecting" || st.phase === "loading")) fail(s.kind, s.message, s.loginURL);
  }

  function finish() {
    st.done = true;
    persist();
    close();
    ctx.showDemoHouse(false);
    notify(t("Setup finished"), { ic: "check" });
  }

  // ---------- HTML ----------

  const tick = (on) => `<span class="setup-tick${on ? " on" : ""}">${icon(on ? "check" : "more")}</span>`;
  const checkRow = (ic, color, title, note, on = null) => `<div class="row"><span class="row-icon" style="--c:${color}">${icon(ic)}</span>
      <span class="grow">${esc(title)}${note ? `<div class="note">${esc(note)}</div>` : ""}</span>${on === null ? "" : tick(on)}</div>`;
  const field = (id, label, value, extra = "") => `<label class="field"><span class="field-label">${esc(label)}</span>
      <input class="text-input" id="${id}" value="${esc(value)}" autocomplete="off" autocapitalize="off" spellcheck="false"${extra}></label>`;
  const trouble = (kinds) => `<div class="setup-table"><div class="setup-trow th"><b>${t("What you see")}</b><span>${t("Cause")}</span><span>${t("What to do")}</span></div>
      ${kinds.map((k) => `<div class="setup-trow"><b>${esc(t(TROUBLE[k][0]))}</b><span>${esc(t(TROUBLE[k][1]))}</span><span>${esc(t(TROUBLE[k][2]))}</span></div>`).join("")}</div>`;
  const messageBtn = () => `<button type="button" class="pill" data-act="setup-message">${icon("send")}${t("Message for the installer")}</button>`;

  const STEP_HTML = {
    welcome: () => ({
      title: t("Welcome"), lead: t("In a few minutes this iPad will be talking to your house."),
      body: `<div class="setup-actions"><button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="setup-next">${t("Start")}</button>
        ${ctx.mode() === "xpanel" ? `<button type="button" class="w-btn" data-act="setup-demo-first">${t("Look at the demo first")}</button>` : ""}</div>`,
      foot: false,
    }),
    checklist: () => ({
      title: t("What you need from the installer"), lead: t("Three things. Ask for them in one message; the button below has it ready."),
      body: `<div class="list">
          ${checkRow("wifi", "var(--blue)", t("The processor's IP address"), t("For example 192.168.1.20"))}
          ${checkRow("grid", "var(--indigo)", t("IP ID"), t("Two hex digits, for example 0A: the panel's address in the program"))}
          ${checkRow("sliders", "var(--teal)", t("The file joinmap.json"), t("Made on the Rooms page from the join numbers"))}
        </div>
        <div class="pills left">${messageBtn()}<a class="pill" href="${ROOMS_PAGE}" target="_blank" rel="noopener">${icon("home")}${t("Rooms page")}</a></div>`,
      next: t("I have them"),
    }),
    processor: () => {
      const ok = IP_RE.test(st.ip.trim());
      const result = st.verify === "busy" ? `<span class="spin"></span>${t("Checking…")}`
        : st.verify === "ok" ? `<span class="setup-ok">${icon("check")}${t("The processor answers")}</span>`
        : st.verify === "fail" ? `<span class="setup-bad">${icon("alert")}${t("No answer. Same Wi‑Fi as the processor? VPN off? Right address?")}</span>` : "";
      return {
        title: t("Processor"), lead: t("The address of the Crestron processor on your home network."),
        body: `${field("setup-ip", t("IP address"), st.ip, ' inputmode="decimal" placeholder="192.168.1.20"')}
          <div class="setup-inline"><button type="button" class="pill" data-act="setup-verify"${ok && st.verify !== "busy" ? "" : " disabled"}>${icon("wifi")}${t("Check")}</button><span class="setup-result">${result}</span></div>`,
        can: ok,
      };
    },
    ipid: () => ({
      title: t("IP ID"), lead: t("The IP ID is the panel's address in the processor's program, two hex digits like 0A. The installer wrote it to you."),
      body: field("setup-ipid", t("IP ID"), st.ipId, ' maxlength="4" placeholder="0A" style="max-width:160px;text-transform:uppercase"'),
      can: Boolean(normalizeIpId(st.ipId)),
    }),
    joinmap: () => {
      const info = st.map ? joinMapSummary(st.map) : null;
      const result = st.mapError ? `<span class="setup-bad">${icon("alert")}${esc(st.mapError)}</span>`
        : info ? `<span class="setup-ok">${icon("check")}${esc(`${tn(info.devices, "{n} device", "{n} devices")} · ${tn(info.rooms, "{n} room", "{n} rooms")}`)}</span>` : "";
      return {
        title: t("Join map"), lead: t("The file joinmap.json from the installer: which join number is which light, shade or scene."),
        body: `<div class="pills left"><label class="pill">${icon("plus")}${t("Import a file")}<input type="file" id="setup-file" accept=".json,application/json" hidden></label>
            <button type="button" class="pill" data-act="setup-paste" aria-pressed="${st.paste}">${icon("edit")}${t("Paste")}</button></div>
          ${st.paste || (st.mapText && !st.map) ? `<textarea class="text-input" id="setup-map" rows="8" placeholder='{ "rooms": [ … ], "lights": [ … ] }' spellcheck="false">${esc(st.mapText)}</textarea>` : ""}
          <div class="setup-result">${result}</div>`,
        can: Boolean(st.map),
      };
    },
    connect: () => {
      const f = st.failure;
      const lines = st.log.map((l, i) => `<div>${i === st.log.length - 1 && (st.phase === "connecting" || st.phase === "loading") ? `<span class="spin"></span>` : `<span class="setup-ok">${icon("check")}</span>`}${esc(l)}</div>`);
      if (f) lines.push(`<div><span class="setup-bad">${icon("alert")}</span>${esc(f.message)}</div>`);
      return {
        title: t("Connecting"), lead: st.phase === "connected" ? t("The house is connected. Let's try something.") : t("Saving the settings and connecting to the processor."),
        body: `<div class="setup-log" aria-live="polite">${lines.join("")}</div>
          ${f ? `${trouble([f.kind])}<div class="pills left">
              <button type="button" class="pill" data-act="setup-retry">${icon("back")}${t("Try again")}</button>
              ${f.loginURL ? `<a class="pill" href="${esc(f.loginURL)}">${icon("lock")}${t("Sign in on the processor")}</a>` : ""}
              ${f.kind !== "login" ? messageBtn() : ""}</div>` : ""}
          ${st.pinNeeded ? `<div class="field"><span class="field-label">${t("Setup PIN")}</span><div class="setup-inline">
              <input class="text-input" id="setup-pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(st.pin)}" style="max-width:200px">
              <button type="button" class="pill" data-act="setup-retry">${t("Send")}</button></div><p class="hint">${t("Setup is protected. Enter the PIN set on the home server.")}</p></div>` : ""}`,
        can: st.phase === "connected",
      };
    },
    test: () => {
      const l = st.light;
      if (!l) return { title: t("Try it"), lead: t("There are no lights in the join map, so try anything else on the Home screen afterwards."), body: "", can: true };
      const room = app.home.rooms.find((r) => r.id === l.roomId)?.name ?? "";
      const on = isOn(l);
      const no = st.asked === "no";
      return {
        title: t("Try it"), lead: t("Tap the light and look at it in the house."),
        body: `<button type="button" class="setup-big${on ? " on" : ""}" aria-pressed="${on}"${attr({ act: "setup-light", id: l.id })}>
            <span class="tile-icon" style="--c:var(--yellow)">${icon(on ? "bulb" : "bulbOff")}</span>
            <span class="setup-big-text"><b>${esc(l.name)}</b><span>${esc(room ? `${room} · ` : "")}${on ? t("On") : t("Off")}</span></span></button>
          <div class="setup-ask"><span>${t("Did it come on?")}</span>
            <button type="button" class="pill" aria-pressed="${st.asked === "yes"}" data-act="setup-test-yes">${icon("check")}${t("Yes")}</button>
            <button type="button" class="pill" aria-pressed="${no}" data-act="setup-test-no">${icon("close")}${t("No")}</button></div>
          ${no ? `<div class="notice">${icon("alert")}<div>${esc(t("The join number doesn't match. Tell the installer that {light} in {room} doesn't react.", { light: l.name, room: room || t("the house") }))}</div></div>${trouble(["joins"])}<div class="pills left">${messageBtn()}</div>` : ""}`,
        can: true,
      };
    },
    ipad: () => {
      const row = (k, ic, title, how) => `<button type="button" class="row" aria-pressed="${Boolean(st.ipad[k])}"${attr({ act: "setup-ipad", k })}><span class="row-icon" style="--c:var(--indigo)">${icon(ic)}</span>
          <span class="grow">${esc(title)}<div class="note">${esc(how)}</div></span>${tick(Boolean(st.ipad[k]))}</button>`;
      return {
        title: t("Wall iPad"), lead: t("So the iPad stays awake and in the app."),
        body: `<div class="list"><div class="row"><span class="row-icon" style="--c:var(--orange)">${icon("desk")}</span><span class="grow">${t("Wall panel mode")}<div class="note">${t("Keeps the screen on and shows StandBy when idle")}</div></span>
            <button type="button" class="switch" role="switch" aria-checked="${app.device.wall}" aria-label="${t("Wall panel mode")}" data-act="setup-wall"></button></div></div>
          <div class="list-label">${t("In the iPad's Settings")}</div>
          <div class="list">${row("autolock", "sun", t("Auto-Lock: Never"), t("Settings › Display & Brightness › Auto-Lock"))}
            ${row("homescreen", "home", t("Add to Home Screen"), t("In Safari: Share › Add to Home Screen; then open it from the icon"))}
            ${row("guided", "lock", t("Guided Access"), t("Settings › Accessibility › Guided Access; triple-click the top button in the app"))}</div>`,
        can: true,
      };
    },
    done: () => ({
      title: t("Done"), lead: t("This iPad is ready. You'll find the guide again in Settings › Help."),
      body: `<div class="list">
          ${checkRow("wifi", "var(--blue)", t("Processor"), st.ip || t("This page's host"), true)}
          ${checkRow("grid", "var(--indigo)", t("IP ID"), st.ipId, Boolean(st.ipId))}
          ${checkRow("sliders", "var(--teal)", t("Join map"), st.map ? `${tn(joinMapSummary(st.map).devices, "{n} device", "{n} devices")}` : "", Boolean(st.map))}
          ${checkRow("check", "var(--green)", t("Connected"), connected() ? t("The house answers") : t("Not connected yet"), connected())}
        </div>`,
      next: t("Finish"),
    }),
  };

  function helpHTML() {
    const s = ctx.status();
    const summary = st.map ? joinMapSummary(st.map) : null;
    return `<div class="setup-count">${t("Help")}</div><h1 id="setup-title">${t("Is everything connected?")}</h1>
      <div class="list">
        ${checkRow("wifi", "var(--blue)", t("Processor"), st.ip || t("This page's host"), st.verify === "ok" || connected())}
        ${checkRow("grid", "var(--indigo)", t("IP ID"), st.ipId || t("Not set"), Boolean(st.ipId))}
        ${checkRow("sliders", "var(--teal)", t("Join map"), summary ? `${tn(summary.devices, "{n} device", "{n} devices")} · ${tn(summary.rooms, "{n} room", "{n} rooms")}` : st.mapError || t("Not imported"), Boolean(st.map))}
        ${checkRow("check", "var(--green)", t("Connected"), connected() ? t("The house answers") : s.message || t("Not connected"), connected())}
      </div>
      <div class="list-label">${t("When it doesn't connect")}</div>${trouble(Object.keys(TROUBLE))}
      <div class="pills left"><button type="button" class="pill" data-act="setup-restart">${icon("back")}${t("Run the guide again")}</button>
        <button type="button" class="pill" data-act="setup-go" data-step="processor">${icon("sliders")}${t("Change the connection")}</button>${messageBtn()}</div>`;
  }

  function render() {
    if (!st.open) return;
    document.body.classList.add("setup-open"); // sheets (the installer message) open above the guide
    const name = stepName();
    const spec = st.help ? null : STEP_HTML[name]();
    const total = STEPS.length;
    const body = st.help ? helpHTML() : `<div class="setup-count">${t("Step {n} of {total}", { n: st.step + 1, total })}</div>
      <h1 id="setup-title">${esc(spec.title)}</h1><p class="setup-lead">${esc(spec.lead)}</p>${spec.body}`;
    const foot = st.help ? `<span></span><button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="setup-later">${t("Close")}</button>`
      : spec.foot === false ? "" : `<button type="button" class="w-btn" data-act="setup-back"${st.step ? "" : " disabled"}>${icon("back")}${t("Back")}</button>
        <button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="${name === "done" ? "setup-finish" : "setup-next"}"${spec.can === false ? " disabled" : ""}>${esc(spec.next ?? t("Next"))}${name === "done" ? "" : icon("arrowRight")}</button>`;
    const focus = document.activeElement?.id;
    root.innerHTML = `<div class="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title"><div class="setup-card">
      <div class="setup-top"><span class="setup-eyebrow">${icon("sliders")}<span>${t("Setup guide")}</span></span>
        <div class="setup-strip" aria-hidden="true">${st.help ? "" : STEPS.map((_, i) => `<i class="${i <= st.step ? "on" : ""}"></i>`).join("")}</div>
        ${st.help ? "" : `<button type="button" class="text-btn" data-act="setup-later">${t("Continue later")}</button>`}</div>
      <div class="setup-body">${body}</div>
      ${foot ? `<div class="setup-foot">${foot}</div>` : ""}</div></div>`;
    if (focus) root.querySelector(`#${CSS.escape(focus)}`)?.focus({ preventScroll: true });
  }

  // ---------- the prepared message for the installer ----------

  registerSheet("installer-message", () => `${sheetHead("var(--blue)", "send", t("Message for the installer"), t("Copy it, or send it by e-mail"))}
    <div class="sheet-body" style="justify-items:stretch"><textarea class="text-input" id="installer-text" rows="12" readonly>${esc(t(INSTALLER_MESSAGE))}</textarea>
      <div class="pills"><button type="button" class="pill" data-act="setup-copy">${icon("edit")}${t("Copy")}</button>
        <a class="pill" href="mailto:?subject=${encodeURIComponent(t("Crestron: new XPanel for the iPad app"))}&body=${encodeURIComponent(t(INSTALLER_MESSAGE))}">${icon("send")}${t("E-mail")}</a>
        <a class="pill" href="${ROOMS_PAGE}" target="_blank" rel="noopener">${icon("home")}${t("Rooms page")}</a></div></div>`, true);

  // ---------- events ----------

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.id === "setup-ip") { st.ip = el.value; st.verify = null; refreshButtons(); }
    else if (el.id === "setup-ipid") { st.ipId = normalizeIpId(el.value) || st.ipId; if (!el.value.trim()) st.ipId = ""; refreshButtons(); }
    else if (el.id === "setup-map") { setMap(el.value); render(); }
    else if (el.id === "setup-pin") st.pin = el.value;
  });
  /** Enables Next and Check without rebuilding the inputs under the keyboard. */
  function refreshButtons() {
    const spec = STEP_HTML[stepName()]?.();
    const next = root.querySelector('[data-act="setup-next"]');
    if (next) next.disabled = spec?.can === false;
    const verify = root.querySelector('[data-act="setup-verify"]');
    if (verify) verify.disabled = !IP_RE.test(st.ip.trim());
    const result = root.querySelector(".setup-result");
    if (result && stepName() === "processor") result.innerHTML = "";
  }
  document.addEventListener("change", async (e) => {
    const input = e.target;
    if (input.id !== "setup-file" || !input.files?.[0]) return;
    const text = await input.files[0].text();
    input.value = "";
    st.paste = false;
    setMap(text);
    render();
  });

  const actions = {
    "setup-open": (el) => open(el?.dataset.step ?? (st.done ? 0 : st.step)), // the banner resumes where it stopped
    "setup-help": () => openHelp(),
    "setup-demo": () => open(0),
    "setup-restart": () => { st.done = false; open(0); },
    "setup-go": (el) => open(el.dataset.step),
    "setup-later": () => close(),
    "setup-next": () => goTo(st.step + 1),
    "setup-back": () => goTo(st.step - 1),
    "setup-finish": () => finish(),
    "setup-demo-first": () => { ctx.showDemoHouse(true); close(); notify(t("This is the demo house. Finish setup from the banner on Home."), { ic: "home" }); },
    "setup-verify": () => verifyHost(),
    "setup-paste": () => { st.paste = !st.paste; render(); },
    "setup-retry": () => startConnecting(),
    "setup-light": (el) => {
      const l = app.home.lights.find((x) => x.id === el.dataset.id);
      if (l) send({ type: "setLight", id: l.id, level: isOn(l) ? 0 : 1 });
    },
    "setup-test-yes": () => { st.asked = "yes"; render(); },
    "setup-test-no": () => { st.asked = "no"; render(); },
    "setup-wall": () => { ctx.toggleWall(); render(); },
    "setup-ipad": (el) => { st.ipad[el.dataset.k] = !st.ipad[el.dataset.k]; persist(); render(); },
    "setup-message": () => openSheet({ kind: "installer-message" }),
    "setup-copy": async () => {
      try {
        await navigator.clipboard.writeText(t(INSTALLER_MESSAGE));
        notify(t("Copied"), { ic: "check" });
      } catch {
        document.querySelector("#installer-text")?.select();
        notify(t("Select the text and copy it"), { ic: "edit" });
      }
    },
  };

  return {
    actions, init, open, openHelp, close, onStatus, needed,
    /** The house reported a change: the light on the test step (and the summary) are redrawn. */
    onHome() { if (st.open && !st.help && (stepName() === "test" || stepName() === "done")) render(); },
    get isOpen() { return st.open; },
  };
}
