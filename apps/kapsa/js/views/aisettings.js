// Settings block for Claude: the user's own API key (kept only on this phone), model
// choice, and a key check that spends no tokens.

import { AI_MODELS, describeError, getApiKey, setApiKey, testKey } from "../ai.js";
import { h, mount, toast } from "../dom.js";
import { t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { state, updateSettings } from "../state.js";

/** Built once and re-attached on every settings render, so typing isn't lost. */
export function createAiSettings() {
  const status = h("p", { class: "set-note", role: "status" });
  const keyInput = h("input", {
    id: "ai-key",
    class: "input mono",
    type: "password",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "sk-ant-…",
    "aria-label": t("ai.keyLabel"),
  });
  const models = h("div", { class: "segmented", role: "radiogroup", id: "ai-model", "aria-label": t("ai.model") });
  const keyRow = h("div", { class: "key-row" });
  let saved = "";

  const setStatus = (text, kind = "") => {
    status.className = `set-note${kind ? ` is-${kind}` : ""}`;
    mount(status, kind === "ok" ? h("span", { html: iconSvg("check") }) : null, text);
  };

  const check = async () => {
    setStatus(t("ai.checking"));
    try {
      await testKey(state.settings.aiModel);
      setStatus(t("ai.keyOk"), "ok");
    } catch (err) {
      setStatus(await describeError(err), "bad");
    }
  };

  const save = async () => {
    const value = keyInput.value.trim();
    if (!value) {
      return;
    }
    await setApiKey(value);
    saved = value;
    keyInput.value = "";
    toast(t("ai.keySaved"));
    renderKeyRow();
    check();
  };

  const remove = async () => {
    await setApiKey("");
    saved = "";
    setStatus("");
    renderKeyRow();
    toast(t("ai.keyRemoved"));
  };

  const renderKeyRow = () => {
    if (saved) {
      mount(
        keyRow,
        h("span", { class: "key-saved mono" }, `${saved.slice(0, 10)}…${saved.slice(-4)}`),
        h("button", { type: "button", class: "btn-outline", onclick: check }, t("ai.check")),
        h("button", { type: "button", class: "btn-quiet is-danger", onclick: remove }, t("ai.removeKey")),
      );
    } else {
      mount(
        keyRow,
        keyInput,
        h("button", { type: "button", class: "btn-primary", onclick: save }, t("ai.saveKey")),
      );
    }
  };

  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });

  const sync = () => {
    mount(
      models,
      AI_MODELS.map((m) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": String(m.id === state.settings.aiModel),
            onclick: () => updateSettings({ aiModel: m.id }),
          },
          m.label,
        ),
      ),
    );
  };

  const el = h(
    "div",
    { class: "set-stack wide" },
    h("p", { class: "set-note" }, t("ai.settingsBody")),
    keyRow,
    status,
    h("p", { class: "set-note small" }, t("ai.keyWhere"), " ", h("span", { class: "mono selectable" }, "platform.claude.com")),
    h("span", { class: "field-label" }, t("ai.model")),
    models,
    h("p", { class: "set-note small" }, t("ai.modelHint")),
    h("p", { class: "set-note small" }, t("ai.privacy")),
  );

  getApiKey().then((key) => {
    saved = key;
    renderKeyRow();
  });
  renderKeyRow();
  sync();
  return { el, sync };
}
