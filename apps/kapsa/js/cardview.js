// The card face (as it looks in the wallet) and the scannable code panel.

import { FORMATS, groupCode, renderBarcodeSvg, shortCode } from "./barcode.js";
import { categoryIcon, inkFor } from "./brands.js";
import { h } from "./dom.js";
import { formatDistance } from "./geo.js";
import { locale, t } from "./i18n.js";
import { expiryStatus } from "./model.js";
import { iconSvg } from "./icons.js";

/**
 * Card face. `size` is "full" (wallet, hero) or "mini" (form preview, lists).
 * @param {import("./state.js").Card} card
 * @param {{ distance?: number | null, here?: boolean, size?: string, tag?: string, attrs?: Record<string, any> }} [opts]
 */
export function cardFace(card, opts = {}) {
  const ink = inkFor(card.color);
  const photo = card.photo;
  const chip =
    opts.distance === null || opts.distance === undefined
      ? null
      : h(
          "span",
          { class: `pcard-chip${opts.here ? " is-here" : ""}` },
          opts.here ? h("span", { class: "pulse", "aria-hidden": "true" }) : null,
          formatDistance(opts.distance, locale()),
        );
  const exp = expiryStatus(card.expiry, Date.now());
  const warn =
    exp && exp.state !== "ok"
      ? h("span", { class: `pcard-warn is-${exp.state}` }, exp.state === "expired" ? t("card.expired") : exp.days === 0 ? t("card.expiresToday") : t("card.expiresIn", { n: exp.days }))
      : null;
  const { class: extraClass, ...attrs } = opts.attrs ?? {};
  const classes = [
    "pcard",
    `pcard-${opts.size ?? "full"}`,
    photo ? "has-photo" : "",
    ink === "#FFFFFF" ? "on-dark" : "on-light",
    extraClass ?? "",
  ];
  return h(
    opts.tag ?? "div",
    {
      ...attrs,
      class: classes.filter(Boolean).join(" "),
      style: { "--c": card.color, "--on": ink, ...(photo ? { "--photo": `url("${photo}")` } : {}) },
    },
    // Name and distance sit on the top edge so they stay visible in the stacked wallet.
    h(
      "span",
      { class: "pcard-top" },
      h("span", { class: "pcard-name" }, card.name || "—"),
      chip ?? h("span", { class: "pcard-icon", html: iconSvg(categoryIcon(card.category)) }),
    ),
    h(
      "span",
      { class: "pcard-bottom" },
      h("span", { class: "pcard-num" }, shortCode(card.code)),
      card.sample ? h("span", { class: "pcard-sample" }, t("wallet.sample")) : null,
      warn,
      chip ? h("span", { class: "pcard-icon is-end", html: iconSvg(categoryIcon(card.category)) }) : null,
    ),
  );
}

/**
 * White panel with the barcode (or just the number) for the till scanner.
 * Barcode rendering is async; the panel shows the number straight away.
 * @param {import("./state.js").Card} card
 * @param {{ onCopy?: () => void, onEnlarge?: () => void }} [opts]
 */
export function codePanel(card, opts = {}) {
  const def = FORMATS[card.format] ?? FORMATS.code128;
  // Tapping the code opens it full screen (bigger and brighter for the till scanner).
  const art = opts.onEnlarge
    ? h("button", {
        type: "button",
        class: `code-art is-tappable${def.linear ? " is-linear" : " is-matrix"}`,
        "aria-label": t("card.enlarge"),
        onclick: opts.onEnlarge,
      })
    : h("div", { class: `code-art${def.linear ? " is-linear" : " is-matrix"}`, "aria-hidden": "true" });
  const panel = h(
    "div",
    { class: "code-panel" },
    card.format === "none" ? h("p", { class: "code-none" }, t("card.noCode")) : art,
    h(
      "div",
      { class: "code-row" },
      h("span", { class: `code-text${card.format === "none" ? " is-big" : ""}` }, groupCode(card.code, card.format)),
      opts.onCopy
        ? h(
            "button",
            { type: "button", class: "btn-ghost on-paper", onclick: opts.onCopy, "aria-label": t("card.copy") },
            h("span", { html: iconSvg("copy") }),
            h("span", null, t("card.copy")),
          )
        : null,
    ),
  );
  if (card.format !== "none") {
    renderBarcodeSvg(card.code, card.format).then((result) => {
      if (result) {
        art.innerHTML = result.svg;
        art.querySelector("svg")?.setAttribute("preserveAspectRatio", "xMidYMid meet");
      } else {
        art.replaceWith(h("p", { class: "code-none" }, t("card.noCode")));
      }
    });
  }
  return panel;
}
