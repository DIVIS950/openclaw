// Full-screen code: white screen, barcode as large as the phone allows (turned
// sideways for long barcodes). Tap anywhere to close.

import { FORMATS, groupCode, renderBarcodeSvg } from "../barcode.js";
import { buzz, h } from "../dom.js";
import { t } from "../i18n.js";

/**
 * @param {HTMLElement} host element to attach to (inside the open sheet, so it stays on top)
 * @param {{ name: string, code: string, format: string }} card
 */
export async function showBigCode(host, card) {
  const def = FORMATS[card.format] ?? FORMATS.code128;
  const art = h("div", { class: `big-art${def.linear ? " is-linear" : " is-matrix"}` });
  const overlay = h(
    "div",
    { class: "bigcode", role: "dialog", "aria-modal": "true", "aria-label": card.name, tabindex: "-1" },
    h("p", { class: "big-name" }, card.name),
    art,
    h("p", { class: `big-num${def.linear ? " is-linear" : ""}` }, groupCode(card.code, card.format)),
    h("p", { class: "big-hint" }, t("card.tapToClose")),
  );
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  host.append(overlay);
  overlay.focus();
  buzz(10);
  const result = await renderBarcodeSvg(card.code, card.format);
  if (result) {
    art.innerHTML = result.svg;
    art.querySelector("svg")?.setAttribute("preserveAspectRatio", def.linear ? "none" : "xMidYMid meet");
  }
}
