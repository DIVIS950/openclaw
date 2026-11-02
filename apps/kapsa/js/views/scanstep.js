// Camera scan screen: live barcode reading, reading from a photo, and reading a
// whole card from one photo with Claude.

import { fromDetectorFormat } from "../barcode.js";
import { buzz, h, toast } from "../dom.js";
import { describeError, hasApiKey, readCardPhoto } from "../ai.js";
import { getLang, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { back, go } from "../nav.js";
import { CameraScanner, scanImageFile } from "../scanner.js";
import { state } from "../state.js";

/**
 * @param {{
 *   onCode: (code: string, format: string) => void,
 *   onManual: () => void,
 *   onAiCard: (reading: ReturnType<typeof import("../ai.js").mergeCardReading>, photo: Blob) => void,
 * }} handlers
 */
export function scanStep({ onCode, onManual, onAiCard }) {
  const video = h("video", { class: "scan-video", playsinline: true, muted: true, autoplay: true });
  const msg = h("p", { class: "scan-msg", hidden: true, role: "alert" });
  const hint = h("p", { class: "scan-hint" }, t("scan.starting"));
  const torchBtn = h(
    "button",
    { type: "button", class: "icon-btn on-dark", hidden: true, "aria-label": t("scan.torch"), "aria-pressed": "false" },
    h("span", { html: iconSvg("flashlight") }),
  );
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true, id: "scan-file" });
  const aiInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, id: "scan-ai-file" });
  const aiBusy = h(
    "div",
    { class: "scan-ai-busy", hidden: true, role: "status" },
    h("span", { class: "ai-orb", "aria-hidden": "true" }),
    h("span", null, t("ai.reading")),
  );
  let done = false;

  const finish = (raw) => {
    if (done) {
      return;
    }
    done = true;
    buzz([20, 40, 20]);
    scanner.stop();
    onCode(raw.rawValue.trim(), fromDetectorFormat(raw.format));
  };

  const scanner = new CameraScanner(video, finish);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) {
      return;
    }
    hint.textContent = t("scan.reading");
    try {
      const found = await scanImageFile(file);
      if (found) {
        finish(found);
        return;
      }
    } catch {
      // Fall through to the message below.
    }
    hint.textContent = t("scan.hint");
    msg.hidden = false;
    msg.textContent = t("scan.photoNone");
  });

  // Read the whole card (name, number, colour, expiry…) from one photo with Claude.
  // The phone also tries to decode the barcode itself, so the number is exact when it can be.
  const startAi = async () => {
    if (!(await hasApiKey())) {
      toast(t("ai.needKey"), { action: t("ai.setup"), onAction: () => go("#settings"), ms: 6000 });
      return;
    }
    aiInput.click();
  };
  aiInput.addEventListener("change", async () => {
    const file = aiInput.files?.[0];
    aiInput.value = "";
    if (!file) {
      return;
    }
    done = true;
    scanner.stop();
    msg.hidden = true;
    aiBusy.hidden = false;
    el.classList.add("is-reading");
    try {
      const detected = await scanImageFile(file).catch(() => null);
      const reading = await readCardPhoto(file, detected, { model: state.settings.aiModel, lang: getLang() });
      buzz([20, 40, 20]);
      onAiCard(reading, file);
    } catch (err) {
      aiBusy.hidden = true;
      el.classList.remove("is-reading");
      msg.hidden = false;
      msg.textContent = await describeError(err);
      done = false;
      if (!el.classList.contains("no-camera")) {
        scanner.start();
      }
    }
  });

  torchBtn.addEventListener("click", async () => {
    const on = await scanner.toggleTorch();
    torchBtn.setAttribute("aria-pressed", String(on));
    torchBtn.classList.toggle("is-on", on);
  });

  scanner.start().then((result) => {
    if (done) {
      scanner.stop();
      return;
    }
    if (result === "ok") {
      hint.textContent = t("scan.hint");
      torchBtn.hidden = !scanner.hasTorch();
    } else {
      hint.textContent = "";
      msg.hidden = false;
      msg.textContent = result === "denied" ? t("scan.cameraDenied") : t("scan.noCamera");
      el.classList.add("no-camera");
    }
  });

  const el = h(
    "div",
    { class: "scan" },
    h(
      "div",
      { class: "scan-view" },
      video,
      h("div", { class: "scan-shade", "aria-hidden": "true" }),
      h("div", { class: "scan-frame", "aria-hidden": "true" }, h("span", { class: "scan-laser" })),
      h(
        "div",
        { class: "sheet-bar on-dark" },
        h("button", { type: "button", class: "icon-btn on-dark", onclick: () => back(), "aria-label": t("card.close") }, h("span", { html: iconSvg("x") })),
        h("h2", { class: "sheet-title" }, t("scan.title")),
        torchBtn,
      ),
      h("div", { class: "scan-copy" }, hint, msg),
      aiBusy,
    ),
    h(
      "div",
      { class: "scan-actions" },
      h(
        "button",
        { type: "button", class: "btn-dark", onclick: () => fileInput.click() },
        h("span", { html: iconSvg("image") }),
        t("scan.fromPhoto"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn-dark",
          onclick: () => {
            done = true;
            scanner.stop();
            onManual();
          },
        },
        h("span", { html: iconSvg("keyboard") }),
        t("scan.manual"),
      ),
      h(
        "button",
        { type: "button", class: "btn-dark btn-ai", onclick: startAi },
        h("span", { html: iconSvg("sparkles") }),
        t("ai.readCard"),
      ),
    ),
    fileInput,
    aiInput,
  );

  return { el, cleanup: () => scanner.stop() };
}
