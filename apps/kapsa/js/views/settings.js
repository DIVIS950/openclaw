// Settings page: language, appearance, location behaviour, backup and data.

import { h, mount, toast } from "../dom.js";
import { formatDistance } from "../geo.js";
import { locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { invalidateBranches } from "../location.js";
import { buildBackup, parseBackup } from "../model.js";
import { back } from "../nav.js";
import { DEFAULT_SETTINGS, deleteCard, saveCard, state, updateSettings } from "../state.js";
import { cardsStore, kv, osmCache } from "../store.js";

export const APP_VERSION = "1.0.1";

/** @type {any} */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || /** @type {any} */ (navigator).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function createSettingsPage() {
  const body = h("div", { class: "settings-body" });
  const root = h(
    "div",
    { class: "page page-settings" },
    h(
      "header",
      { class: "appbar" },
      h("button", { type: "button", class: "icon-btn", onclick: () => back(), "aria-label": t("map.back") }, h("span", { html: iconSvg("chevron-left") })),
      h("h1", { class: "page-title" }, t("settings.title")),
      h("span", { class: "bar-spacer" }),
    ),
    body,
  );
  const importInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, id: "import-file" });
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) {
      return;
    }
    const cards = parseBackup(await file.text());
    if (!cards) {
      toast(t("settings.importError"));
      return;
    }
    for (const card of cards) {
      await saveCard(card);
    }
    invalidateBranches();
    toast(t("settings.imported", { n: cards.length }));
  });

  let wipeOpen = false;

  const segmented = (id, value, options, onChange) =>
    h(
      "div",
      { class: "segmented", role: "radiogroup", id },
      options.map(([v, label]) =>
        h(
          "button",
          { type: "button", role: "radio", "aria-checked": String(v === value), onclick: () => onChange(v) },
          label,
        ),
      ),
    );

  const switchRow = (id, label, hint, checked, onChange) => {
    const input = h("input", { type: "checkbox", class: "switch-input", id });
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    return h(
      "label",
      { class: "toggle" },
      h("span", { class: "toggle-text" }, h("span", { class: "toggle-label" }, label), hint ? h("span", { class: "toggle-meta" }, hint) : null),
      input,
      h("span", { class: "switch", "aria-hidden": "true" }),
    );
  };

  const exportBackup = async () => {
    const json = buildBackup(state.cards);
    const name = `kapsa-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  let lastSig = "";

  /** Re-render only when something shown here changed (not on every GPS fix). */
  function update(force = false) {
    const s = state.settings;
    const samples = state.cards.filter((c) => c.sample);
    const sig = JSON.stringify([s, state.cards.length, samples.length, wipeOpen, Boolean(installPrompt)]);
    if (!force && sig === lastSig) {
      return;
    }
    lastSig = sig;
    const section = (title, ...children) => h("section", { class: "set-section" }, h("h2", { class: "set-title" }, title), ...children);

    let installBlock;
    if (isStandalone()) {
      installBlock = h("p", { class: "set-note is-ok" }, h("span", { html: iconSvg("check") }), t("settings.installed"));
    } else {
      installBlock = h(
        "div",
        { class: "set-stack" },
        h("p", { class: "set-note" }, t("settings.installWhy")),
        installPrompt
          ? h(
              "button",
              {
                type: "button",
                class: "btn-primary",
                onclick: async () => {
                  installPrompt.prompt();
                  await installPrompt.userChoice.catch(() => null);
                  installPrompt = null;
                  update();
                },
              },
              h("span", { html: iconSvg("download") }),
              t("settings.installButton"),
            )
          : h("p", { class: "set-note strong" }, isIos() ? t("settings.installIos") : t("settings.installAndroid")),
      );
    }

    mount(
      body,
      section(t("settings.install"), installBlock),
      section(
        t("settings.language"),
        segmented(
          "set-lang",
          s.lang,
          [
            ["auto", t("settings.langAuto")],
            ["cs", "Čeština"],
            ["en", "English"],
          ],
          (v) => updateSettings({ lang: v }),
        ),
      ),
      section(
        t("settings.theme"),
        segmented(
          "set-theme",
          s.theme,
          [
            ["system", t("settings.themeSystem")],
            ["light", t("settings.themeLight")],
            ["dark", t("settings.themeDark")],
          ],
          (v) => updateSettings({ theme: v }),
        ),
      ),
      section(
        t("settings.radius"),
        h("p", { class: "set-note" }, t("settings.radiusHint")),
        segmented(
          "set-radius",
          s.radius,
          [50, 120, 250, 500].map((m) => [m, formatDistance(m, locale())]),
          (v) => updateSettings({ radius: v }),
        ),
        switchRow("set-autoopen", t("settings.autoOpen"), null, s.autoOpen, (v) => updateSettings({ autoOpen: v })),
        switchRow("set-osm", t("settings.osm"), t("settings.osmHint"), s.osm, async (v) => {
          await updateSettings({ osm: v });
          invalidateBranches();
        }),
      ),
      section(
        t("settings.backup"),
        h("p", { class: "set-note" }, t("settings.backupHint")),
        h(
          "div",
          { class: "set-row" },
          h("button", { type: "button", class: "btn-outline", onclick: exportBackup, disabled: !state.cards.length }, h("span", { html: iconSvg("download") }), t("settings.export")),
          h("button", { type: "button", class: "btn-outline", onclick: () => importInput.click() }, h("span", { html: iconSvg("upload") }), t("settings.import")),
        ),
        importInput,
      ),
      section(
        t("settings.data"),
        samples.length
          ? h(
              "button",
              {
                type: "button",
                class: "btn-outline",
                onclick: async () => {
                  for (const c of samples) {
                    await deleteCard(c.id);
                  }
                  toast(t("settings.samplesRemoved"));
                },
              },
              h("span", { html: iconSvg("trash-2") }),
              t("settings.removeSamples"),
            )
          : null,
        wipeOpen
          ? h(
              "div",
              { class: "confirm" },
              h("p", null, t("settings.wipeConfirm")),
              h(
                "div",
                { class: "confirm-actions" },
                h("button", { type: "button", class: "btn-quiet", onclick: () => ((wipeOpen = false), update()) }, t("card.cancel")),
                h(
                  "button",
                  {
                    type: "button",
                    class: "btn-danger",
                    onclick: async () => {
                      await Promise.all([cardsStore.clear(), kv.clear(), osmCache.clear()]);
                      state.cards = [];
                      state.branches = {};
                      wipeOpen = false;
                      await updateSettings({ ...DEFAULT_SETTINGS });
                      toast(t("settings.wiped"));
                      back();
                    },
                  },
                  t("card.deleteYes"),
                ),
              ),
            )
          : h(
              "button",
              { type: "button", class: "btn-quiet is-danger", onclick: () => ((wipeOpen = true), update()) },
              h("span", { html: iconSvg("trash-2") }),
              t("settings.wipe"),
            ),
      ),
      section(
        t("settings.about"),
        h("p", { class: "set-note" }, t("settings.aboutBody")),
        h("p", { class: "set-note mono" }, t("settings.version", { v: APP_VERSION })),
      ),
    );
  }

  return { root, update };
}
