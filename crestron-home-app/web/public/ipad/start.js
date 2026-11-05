// The start screen of the demo (claude.ai link or a browser with no server): "look around"
// or "connect my house". The second path does what a web page can do by itself, step by step:
// the message for the installer, the HomeView.ch5z file, and opening the processor's page,
// where the real setup guide (setup.js) takes over.
import { icon } from "../icons.js";
import { t } from "../shared/i18n.js";
import { attr, esc } from "./views.js";

const ROOMS_PAGE = "https://claude.ai/artifact/47rndwGgRHvAfKC2kqvWHs";
const ACTIONS_PAGE = "https://github.com/divis950/openclaw/actions/workflows/home-view-xpanel.yml";
const PACKAGE = "HomeView.ch5z";
const STEPS = ["installer", "file", "ipad"];

export function createStart(ctx) {
  const { app, prefs, openSheet, closeSheet, openGuideDemo, notify } = ctx;
  const saved = prefs.get("start", null) ?? {};
  const st = { open: false, view: "menu", step: 0, done: { ...(saved.done ?? {}) }, ip: saved.ip ?? "", dismissed: Boolean(saved.dismissed), download: "idle" };
  const root = document.createElement("div");
  root.id = "start-root";
  document.body.append(root);
  const persist = () => prefs.set("start", { done: st.done, ip: st.ip, dismissed: st.dismissed });

  /** First visit of the demo: the menu. Later visits: nothing, unless "connect my house" was started. */
  function init() {
    if (app.transport !== "local") return;
    if (!st.dismissed) open("menu");
    else if (Object.keys(st.done).length && !st.done.ipad) open("steps");
  }

  function open(view = "menu") {
    closeSheet();
    st.open = true;
    st.view = view;
    if (view === "steps") st.step = STEPS.findIndex((s) => !st.done[s]) === -1 ? STEPS.length - 1 : STEPS.findIndex((s) => !st.done[s]);
    render();
  }

  function close() {
    st.open = false;
    st.dismissed = true;
    persist();
    root.innerHTML = "";
    document.body.classList.remove("setup-open");
  }

  const ipOK = () => /^(\d{1,3}\.){3}\d{1,3}$/.test(st.ip.trim()) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(st.ip.trim());
  const canDownload = () => typeof window.claude?.use === "function";

  /** The package file: through the claude.ai download prompt when this page is the demo link, else GitHub. */
  async function download() {
    st.download = "busy";
    render();
    try {
      const dl = canDownload() ? await window.claude.use("downloads") : null;
      if (!dl) throw new Error("no-downloads");
      // The package travels as base64 text (the demo host serves no zip files); decode it here.
      const res = await fetch(`${PACKAGE}.b64.txt`, { cache: "no-store" });
      if (!res.ok) throw new Error("no-file");
      const bin = atob((await res.text()).replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await dl.save({ filename: PACKAGE, data: bytes });
      st.download = "ok";
      st.done.file = true;
      notify(t("Downloaded"), { ic: "check" });
    } catch (err) {
      st.download = err?.code === "declined" ? "idle" : "link";
    }
    persist();
    render();
  }

  // ---------- screens ----------

  function menuHTML() {
    return `<div class="start-hero">${icon("home")}</div>
      <h1 id="setup-title">${t("Home View")}</h1>
      <p class="setup-lead">${t("Your house on one iPad. Look around the demo house first, or start connecting your own.")}</p>
      <div class="start-choices">
        <button type="button" class="start-choice" data-act="start-demo"><span class="row-icon" style="--c:var(--orange)">${icon("play")}</span>
          <span class="grow"><b>${t("Look around the demo")}</b><div class="note">${t("A pretend house. Tap anything; nothing real moves.")}</div></span>${icon("chevron")}</button>
        <button type="button" class="start-choice" data-act="start-connect"><span class="row-icon" style="--c:var(--blue)">${icon("sliders")}</span>
          <span class="grow"><b>${t("Connect my house")}</b><div class="note">${t("Three steps: the installer, one file, the iPad. The app does what it can for you.")}</div></span>${icon("chevron")}</button>
      </div>`;
  }

  function tick(k) {
    return `<span class="setup-tick${st.done[k] ? " on" : ""}">${icon("check")}</span>`;
  }

  function stepHTML() {
    const name = STEPS[st.step];
    const count = `<div class="setup-count">${t("Step {n} of {total}", { n: st.step + 1, total: STEPS.length })}</div>`;
    if (name === "installer") {
      return `${count}<h1 id="setup-title">${t("The installer")}</h1>
        <p class="setup-lead">${t("Your installer adds the app to the Crestron program and fills in the join numbers. Everything is prepared; you only send it.")}</p>
        <div class="setup-actions">
          <button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="setup-message">${icon("send")}${t("Message for the installer")}</button>
          <a class="w-btn" href="${ROOMS_PAGE}" target="_blank" rel="noopener">${icon("grid")}${t("Rooms and devices page")}</a>
        </div>
        <p class="hint">${t("Share the Rooms and devices page with the installer as Contributor so he can type the numbers. He also sends you the processor's IP address and an IP ID.")}</p>
        <button type="button" class="row start-done" aria-pressed="${Boolean(st.done.installer)}"${attr({ act: "start-done", k: "installer" })}>${tick("installer")}<span class="grow">${t("Message sent")}</span></button>`;
    }
    if (name === "file") {
      const busy = st.download === "busy";
      return `${count}<h1 id="setup-title">${t("The file")}</h1>
        <p class="setup-lead">${t("HomeView.ch5z is the app itself. The installer loads it onto the processor once; updates are a new file.")}</p>
        <div class="setup-actions">
          ${canDownload() ? `<button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="start-download"${busy ? " disabled" : ""}>${busy ? '<span class="spin"></span>' : icon("down")}${t("Download HomeView.ch5z")}</button>` : ""}
          <a class="w-btn" href="${ACTIONS_PAGE}" target="_blank" rel="noopener">${icon("open")}${t("Newest file on GitHub")}</a>
        </div>
        ${st.download === "link" ? `<p class="setup-bad">${icon("alert")}${t("The download didn't start here. Use the GitHub link: Actions › Home View Web XPanel › Artifacts.")}</p>` : ""}
        <p class="hint">${t("Send the file to the installer. He loads it with Crestron Toolbox, or with:")} <code>npx ch5-cli deploy -H &lt;IP&gt; -t controlsystem HomeView.ch5z</code></p>
        <button type="button" class="row start-done" aria-pressed="${Boolean(st.done.file)}"${attr({ act: "start-done", k: "file" })}>${tick("file")}<span class="grow">${t("File sent to the installer")}</span></button>`;
    }
    return `${count}<h1 id="setup-title">${t("The iPad")}</h1>
      <p class="setup-lead">${t("When the installer says the file is loaded, type the processor's IP address. The app opens its page; the setup guide continues there (IP ID, join map, a test light).")}</p>
      <form class="setup-inline" id="start-ip-form"><input class="text-input" id="start-ip" inputmode="decimal" autocomplete="off" placeholder="192.168.1.20" value="${esc(st.ip)}" aria-label="${t("Processor IP address")}">
        <button type="submit" class="w-btn primary" style="--c:var(--blue);flex:none"${ipOK() ? "" : " disabled"}>${icon("open")}${t("Open the processor page")}</button></form>
      <p class="hint">${t("Safari will warn about the processor's certificate: tap Show details, then Visit website. Then add the page to the Home Screen.")}</p>
      <div class="setup-actions"><button type="button" class="pill" data-act="start-guide-demo">${icon("sliders")}${t("Show me what the guide looks like")}</button></div>`;
  }

  function render() {
    if (!st.open) return;
    document.body.classList.add("setup-open");
    const steps = st.view === "steps";
    const last = st.step === STEPS.length - 1;
    const foot = !steps ? "" : `<button type="button" class="w-btn" data-act="start-back">${icon("back")}${st.step ? t("Back") : t("Menu")}</button>
      <button type="button" class="w-btn primary" style="--c:var(--blue)" data-act="${last ? "start-finish" : "start-next"}">${last ? t("Done for now") : t("Next")}${last ? "" : icon("arrowRight")}</button>`;
    const focus = document.activeElement?.id;
    root.innerHTML = `<div class="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title"><div class="setup-card">
      <div class="setup-top"><span class="setup-eyebrow">${icon("sparkle")}<span>${steps ? t("Connect my house") : t("Welcome")}</span></span>
        <div class="setup-strip" aria-hidden="true">${steps ? STEPS.map((_, i) => `<i class="${i <= st.step ? "on" : ""}"></i>`).join("") : ""}</div>
        <button type="button" class="text-btn" data-act="start-close">${steps ? t("Continue later") : t("Skip")}</button></div>
      <div class="setup-body">${steps ? stepHTML() : menuHTML()}</div>
      ${foot ? `<div class="setup-foot">${foot}</div>` : ""}</div></div>`;
    if (focus) root.querySelector(`#${CSS.escape(focus)}`)?.focus({ preventScroll: true });
  }

  root.addEventListener("input", (e) => {
    if (e.target.id === "start-ip") { st.ip = e.target.value; persist(); root.querySelector("#start-ip-form button").disabled = !ipOK(); }
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "start-ip-form") return;
    e.preventDefault();
    if (!ipOK()) return;
    st.done.ipad = true;
    persist();
    window.open(`https://${st.ip.trim()}/`, "_blank", "noopener");
  });

  const actions = {
    "start-demo": () => close(),
    "start-close": () => close(),
    "start-connect": () => open("steps"),
    "start-open": () => open(Object.keys(st.done).length ? "steps" : "menu"),
    "start-next": () => { st.step = Math.min(STEPS.length - 1, st.step + 1); render(); },
    "start-back": () => { if (st.step) { st.step -= 1; render(); } else open("menu"); },
    "start-finish": () => close(),
    "start-done": (el) => { st.done[el.dataset.k] = !st.done[el.dataset.k]; persist(); render(); },
    "start-download": () => download(),
    "start-guide-demo": () => { close(); openGuideDemo(); },
  };

  return { init, open, close, actions, get isOpen() { return st.open; } };
}
