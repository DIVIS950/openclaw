// Extra card details in the form: points balance, expiry date, and a second code
// (for example the one on the back of the card).

import { FORMAT_ORDER, FORMATS, fromDetectorFormat, guessFormat } from "../barcode.js";
import { h, toast } from "../dom.js";
import { t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { cleanDate, cleanPoints } from "../model.js";
import { scanImageFile } from "../scanner.js";

/**
 * @param {{ points?: number | null, expiry?: string, code2?: string, format2?: string }} prefill
 */
export function extraFields(prefill) {
  const points = h("input", {
    id: "card-points",
    class: "input mono",
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    placeholder: "0",
  });
  points.value = prefill.points === null || prefill.points === undefined ? "" : String(prefill.points);

  const expiry = h("input", { id: "card-expiry", class: "input", type: "date" });
  expiry.value = prefill.expiry ?? "";

  const code2 = h("input", {
    id: "card-code2",
    class: "input mono",
    type: "text",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    placeholder: t("form.code2Placeholder"),
  });
  code2.value = prefill.code2 ?? "";
  const format2 = h(
    "select",
    { id: "card-format2", class: "input select", "aria-label": t("form.format") },
    FORMAT_ORDER.filter((k) => k !== "none").map((key) =>
      h("option", { value: key }, key === "auto" ? t("form.formatAuto") : FORMATS[key].label),
    ),
  );
  format2.value = prefill.code2 && prefill.format2 && prefill.format2 !== "none" ? prefill.format2 : "auto";

  const photo2 = h("input", { type: "file", accept: "image/*", hidden: true, id: "card-code2-photo" });
  photo2.addEventListener("change", async () => {
    const file = photo2.files?.[0];
    photo2.value = "";
    if (!file) {
      return;
    }
    const found = await scanImageFile(file).catch(() => null);
    if (found) {
      code2.value = found.rawValue.trim();
      format2.value = fromDetectorFormat(found.format);
    } else {
      toast(t("scan.photoNone"));
    }
  });

  const second = h(
    "details",
    { class: "more", open: Boolean(prefill.code2) },
    h("summary", null, h("span", { html: iconSvg("plus") }), t("form.code2")),
    h(
      "div",
      { class: "more-body" },
      h("p", { class: "muted small" }, t("form.code2Hint")),
      h("div", { class: "code-inputs" }, code2, format2),
      h(
        "button",
        { type: "button", class: "btn-outline", onclick: () => photo2.click() },
        h("span", { html: iconSvg("image") }),
        t("scan.fromPhoto"),
      ),
      photo2,
    ),
  );

  const el = h(
    "div",
    { class: "field" },
    h(
      "div",
      { class: "pair" },
      h("label", { class: "pair-item" }, h("span", { class: "field-label" }, t("form.points")), points),
      h("label", { class: "pair-item" }, h("span", { class: "field-label" }, t("form.expiry")), expiry),
    ),
    second,
  );

  return {
    el,
    values() {
      const c2 = code2.value.trim();
      return {
        points: cleanPoints(points.value.trim() === "" ? null : points.value),
        expiry: cleanDate(expiry.value),
        code2: c2,
        format2: c2 ? (format2.value === "auto" ? guessFormat(c2) : format2.value) : "none",
      };
    },
  };
}
