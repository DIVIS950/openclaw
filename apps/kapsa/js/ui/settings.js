// #settings: AI key, reminders, location, look, backup.

import { AI_MODELS, describeError, getApiKey, setApiKey, testKey } from "../ai.js";
import { t } from "../i18n.js";
import { invalidateBranches } from "../location.js";
import { buildBackup, parseBackup } from "../model.js";
import { back, go } from "../nav.js";
import { DEFAULT_SETTINGS, deleteCard, deleteCoupon, deletePurchase, saveCard, saveCoupon, savePurchase, state, updateSettings } from "../state.js";
import { cardsStore, couponsStore, kv, osmCache, purchasesStore } from "../store.js";
import { isoDay, offerFile } from "../util.js";
import { ConfirmButton, Icon, Page, Section, Seg, Toggle, html, toast } from "./kit.js";
import { formatDistance } from "../geo.js";
import { locale } from "../i18n.js";
import { useEffect, useRef, useState } from "../../vendor/preact.js";

export const APP_VERSION = "2.0.0";

/** @type {any} */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});

export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || /** @type {any} */ (navigator).standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function SettingsPage() {
  const s = state.settings;
  const file = useRef(null);
  const samples = state.cards.some((c) => c.sample) || state.coupons.some((c) => c.sample) || state.purchases.some((p) => p.sample);

  const exportBackup = () =>
    offerFile(`kapsa-${isoDay(Date.now())}.json`, "application/json", buildBackup(state.cards, state.coupons, state.purchases));

  const importBackup = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) {
      return;
    }
    const data = parseBackup(await f.text());
    if (!data) {
      toast(t("set.importError"));
      return;
    }
    for (const c of data.cards) {
      await saveCard(c);
    }
    for (const c of data.coupons) {
      await saveCoupon(c);
    }
    for (const p of data.purchases) {
      await savePurchase(p);
    }
    invalidateBranches();
    toast(t("set.imported", { n: data.cards.length + data.coupons.length + data.purchases.length }));
  };

  return html`<${Page} color="#111114" title=${t("set.title")} hero=${html`<h1 class="display sm">${t("set.title")}</h1>`}>
    <${Section} title=${t("set.install")}>
      <${InstallBlock} />
    <//>
    <${Section} title=${t("set.ai")}>
      <${AiSettings} />
    <//>
    <${Section} title=${t("set.reminders")}>
      <div class="stack">
        <button type="button" class="mini" onClick=${() => go("#reminders")}>
          <span class="mini-swatch" style=${{ "--c": "#FF4F9A", "--on": "#111114" }}><${Icon} name="bell" /></span>
          <span style="min-width:0"><span class="mini-name">${t("rm.title")}</span><span class="mini-label" style="text-transform:none;letter-spacing:0">${t("rm.notifyBody")}</span></span>
          <${Icon} name="chevron-right" />
        </button>
        <span class="label">${t("set.remindDays")}</span>
        <${Seg} value=${s.remindDays} options=${[1, 3, 7, 14].map((n) => [n, t("set.days", { n })])} onChange=${(v) => updateSettings({ remindDays: v })} />
      </div>
    <//>
    <${Section} title=${t("set.location")}>
      <div class="stack">
        <span class="label">${t("set.radius")}</span>
        <p class="hint">${t("set.radiusHint")}</p>
        <${Seg} value=${s.radius} options=${[50, 120, 250, 500].map((m) => [m, formatDistance(m, locale())])} onChange=${(v) => updateSettings({ radius: v })} />
        <${Toggle} id="set-autoopen" label=${t("set.autoOpen")} checked=${s.autoOpen} onChange=${(v) => updateSettings({ autoOpen: v })} />
        <${Toggle} id="set-habits" label=${t("set.habits")} meta=${t("set.habitsHint")} checked=${s.habits} onChange=${(v) => updateSettings({ habits: v })} />
        <${Toggle}
          id="set-osm"
          label=${t("set.osm")}
          meta=${t("set.osmHint")}
          checked=${s.osm}
          onChange=${async (v) => {
            await updateSettings({ osm: v });
            invalidateBranches();
          }}
        />
      </div>
    <//>
    <${Section} title=${t("set.look")}>
      <div class="stack">
        <span class="label">${t("set.language")}</span>
        <${Seg} value=${s.lang} options=${[["auto", t("set.langAuto")], ["cs", "Čeština"], ["en", "English"]]} onChange=${(v) => updateSettings({ lang: v })} />
        <span class="label">${t("set.theme")}</span>
        <${Seg}
          value=${s.theme}
          options=${[["system", t("set.themeSystem")], ["light", t("set.themeLight")], ["dark", t("set.themeDark")]]}
          onChange=${(v) => updateSettings({ theme: v })}
        />
        <span class="label">${t("set.currency")}</span>
        <${Seg} value=${s.currency} options=${["CZK", "EUR", "USD", "GBP", "PLN"].map((c) => [c, c])} onChange=${(v) => updateSettings({ currency: v })} />
      </div>
    <//>
    <${Section} title=${t("set.data")}>
      <div class="stack">
        <p class="hint">${t("set.backupHint")}</p>
        <div class="btn-row">
          <button type="button" class="btn" onClick=${exportBackup} disabled=${!state.cards.length}><${Icon} name="download" />${t("set.export")}</button>
          <button type="button" class="btn" onClick=${() => file.current?.click()}><${Icon} name="upload" />${t("set.import")}</button>
        </div>
        <input ref=${file} id="import-file" type="file" accept="application/json,.json" hidden onChange=${importBackup} />
        ${samples
          ? html`<button
              type="button"
              class="btn"
              onClick=${async () => {
                for (const c of state.cards.filter((x) => x.sample)) {
                  await deleteCard(c.id);
                }
                for (const c of state.coupons.filter((x) => x.sample)) {
                  await deleteCoupon(c.id);
                }
                for (const p of state.purchases.filter((x) => x.sample)) {
                  await deletePurchase(p.id);
                }
                toast(t("set.samplesRemoved"));
              }}
            >
              <${Icon} name="trash-2" />${t("set.removeSamples")}
            </button>`
          : null}
        <${ConfirmButton}
          label=${t("set.wipe")}
          confirm=${t("set.wipeConfirm")}
          onConfirm=${async () => {
            await Promise.all([cardsStore.clear(), couponsStore.clear(), purchasesStore.clear(), kv.clear(), osmCache.clear()]);
            await setApiKey("");
            state.cards = [];
            state.coupons = [];
            state.purchases = [];
            state.branches = {};
            await updateSettings({ ...DEFAULT_SETTINGS });
            toast(t("set.wiped"));
            back();
          }}
        />
      </div>
    <//>
    <${Section} title=${t("set.about")}>
      <p class="hint">${t("set.aboutBody")}</p>
      <p class="hint mono" style="margin-top:8px;font-size:12px">${t("set.version", { v: APP_VERSION })}</p>
    <//>
  <//>`;
}

function InstallBlock() {
  const [, setN] = useState(0);
  if (isStandalone()) {
    return html`<p class="hint" style="color:var(--green);font-weight:800">✓ ${t("set.installed")}</p>`;
  }
  return html`<div class="stack">
    <p class="hint">${t("set.installWhy")}</p>
    ${installPrompt
      ? html`<button
          type="button"
          class="btn lime"
          onClick=${async () => {
            installPrompt.prompt();
            await installPrompt.userChoice.catch(() => null);
            installPrompt = null;
            setN((n) => n + 1);
          }}
        >
          <${Icon} name="download" />${t("set.installButton")}
        </button>`
      : html`<p style="margin:0;font-weight:800">${isIos() ? t("set.installIos") : t("set.installAndroid")}</p>`}
  </div>`;
}

function AiSettings() {
  const [saved, setSaved] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState({ text: "", tone: "" });
  useEffect(() => {
    getApiKey().then(setSaved);
  }, []);
  const check = async () => {
    setStatus({ text: t("ai.checking"), tone: "" });
    try {
      await testKey(state.settings.aiModel);
      setStatus({ text: t("ai.keyOk"), tone: "ok" });
    } catch (err) {
      setStatus({ text: await describeError(err), tone: "bad" });
    }
  };
  const save = async () => {
    if (!value.trim()) {
      return;
    }
    await setApiKey(value);
    setSaved(value.trim());
    setValue("");
    toast(t("ai.keySaved"));
    check();
  };
  return html`<div class="stack">
    <p class="hint">${t("ai.settingsBody")}</p>
    ${saved
      ? html`<div class="row" style="flex-wrap:wrap">
          <span class="input mono" style="display:flex;align-items:center;flex:1 1 180px;overflow:hidden;text-overflow:ellipsis">${saved.slice(0, 10)}…${saved.slice(-4)}</span>
          <button type="button" class="btn sm" onClick=${check}>${t("ai.check")}</button>
          <button
            type="button"
            class="btn sm ghost danger-text"
            onClick=${async () => {
              await setApiKey("");
              setSaved("");
              setStatus({ text: "", tone: "" });
              toast(t("ai.keyRemoved"));
            }}
          >
            ${t("ai.removeKey")}
          </button>
        </div>`
      : html`<form
          class="code-row"
          onSubmit=${(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            id="ai-key"
            class="input mono"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk-ant-…"
            aria-label=${t("ai.keyLabel")}
            value=${value}
            onInput=${(e) => setValue(e.currentTarget.value)}
          />
          <button type="submit" class="btn violet">${t("ai.saveKey")}</button>
        </form>`}
    ${status.text
      ? html`<p class="hint" role="status" style=${{ fontWeight: 800, color: status.tone === "ok" ? "var(--green)" : status.tone === "bad" ? "var(--red)" : undefined }}>
          ${status.tone === "ok" ? "✓ " : ""}${status.text}
        </p>`
      : null}
    <p class="hint" style="font-size:13px">${t("ai.keyWhere")} <strong class="mono" style="user-select:all">platform.claude.com</strong></p>
    <span class="label">${t("ai.model")}</span>
    <${Seg} value=${state.settings.aiModel} options=${AI_MODELS.map((m) => [m.id, m.label])} onChange=${(v) => updateSettings({ aiModel: v })} />
    <p class="hint" style="font-size:13px">${t("ai.modelHint")}</p>
    <p class="hint" style="font-size:13px">${t("ai.privacy")}</p>
  </div>`;
}
