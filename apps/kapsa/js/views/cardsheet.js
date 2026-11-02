// Card sheet: the scannable code at full brightness, plus places, sharing and delete.

import { categoryIcon } from "../brands.js";
import { cardFace, codePanel } from "../cardview.js";
import { buzz, copyText, h, mount, toast } from "../dom.js";
import { distanceMeters, formatDistance } from "../geo.js";
import { locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { startLocation } from "../location.js";
import { encodeShare } from "../model.js";
import { back, go, replace } from "../nav.js";
import { addPlace, deleteCard, getCard, markUsed, removePlace, state } from "../state.js";

/** @param {string} id */
export function createCardSheet(id) {
  const card = getCard(id);
  if (!card) {
    return null;
  }
  let wakeLock = null;
  const requestWake = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      wakeLock = null;
    }
  };
  const onVisible = () => {
    if (!document.hidden) {
      requestWake();
    }
  };
  requestWake();
  document.addEventListener("visibilitychange", onVisible);
  markUsed(id);

  const placesEl = h("div", { class: "places" });
  const confirmEl = h("div", { class: "confirm", hidden: true });

  const copy = async () => {
    if (await copyText(card.code)) {
      buzz();
      toast(t("card.copied"));
    }
  };

  const share = async () => {
    const url = `${location.origin}${location.pathname}#import=${encodeShare(getCard(id) ?? card)}`;
    const text = t("card.shareText", { name: card.name });
    try {
      if (navigator.share) {
        await navigator.share({ title: text, url });
        return;
      }
    } catch (err) {
      if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
        return;
      }
    }
    if (await copyText(url)) {
      toast(t("card.linkCopied"));
    }
  };

  const askDelete = () => {
    confirmEl.hidden = false;
    mount(
      confirmEl,
      h("p", null, t("card.deleteConfirm")),
      h(
        "div",
        { class: "confirm-actions" },
        h("button", { type: "button", class: "btn-quiet", onclick: () => (confirmEl.hidden = true) }, t("card.cancel")),
        h(
          "button",
          {
            type: "button",
            class: "btn-danger",
            onclick: async () => {
              await deleteCard(id);
              toast(t("card.deleted"));
              back();
            },
          },
          t("card.deleteYes"),
        ),
      ),
    );
    confirmEl.querySelector(".btn-danger")?.focus();
  };

  const addHere = async () => {
    if (!state.pos) {
      startLocation();
      toast(t("loc.searching"));
      return;
    }
    await addPlace(id, { lat: state.pos.lat, lon: state.pos.lon, label: "", source: "here" });
    buzz();
    toast(t("card.placeSaved"));
  };

  const el = h(
    "div",
    { class: "card-sheet", style: { "--c": card.color } },
    h(
      "div",
      { class: "sheet-bar" },
      h("button", { type: "button", class: "icon-btn", onclick: () => back(), "aria-label": t("card.close") }, h("span", { html: iconSvg("x") })),
      h(
        "div",
        { class: "sheet-bar-title" },
        h("span", { class: "sheet-title-icon", html: iconSvg(categoryIcon(card.category)) }),
        h("h2", { class: "sheet-title" }, card.name),
      ),
      h(
        "button",
        { type: "button", class: "icon-btn", onclick: () => replace(`#edit-${id}`), "aria-label": t("card.edit") },
        h("span", { html: iconSvg("pencil") }),
      ),
    ),
    card.photo ? cardFace(card, { size: "photo" }) : null,
    codePanel(card, { onCopy: card.code ? copy : undefined }),
    h("p", { class: "hint" }, h("span", { html: iconSvg("sun") }), t("card.screenOn")),
    card.note ? h("section", { class: "block" }, h("h3", { class: "block-title" }, t("card.note")), h("p", { class: "note" }, card.note)) : null,
    h(
      "section",
      { class: "block" },
      h("h3", { class: "block-title" }, t("card.places")),
      placesEl,
      h(
        "div",
        { class: "place-actions" },
        h("button", { type: "button", class: "btn-chip", onclick: addHere }, h("span", { html: iconSvg("locate-fixed") }), t("card.addHere")),
        h("button", { type: "button", class: "btn-chip", onclick: () => replace(`#find-${id}`) }, h("span", { html: iconSvg("search") }), t("card.addSearch")),
        h("button", { type: "button", class: "btn-chip", onclick: () => go(`#pick-${id}`) }, h("span", { html: iconSvg("map") }), t("card.addMap")),
      ),
    ),
    h(
      "div",
      { class: "sheet-foot" },
      h("button", { type: "button", class: "btn-quiet", onclick: share }, h("span", { html: iconSvg("share-2") }), t("card.share")),
      h("button", { type: "button", class: "btn-quiet is-danger", onclick: askDelete }, h("span", { html: iconSvg("trash-2") }), t("card.delete")),
    ),
    confirmEl,
  );

  function update() {
    const current = getCard(id);
    if (!current) {
      return;
    }
    const pos = state.pos;
    const branches = state.branches[id] ?? [];
    const rows = current.places.map((p) =>
      h(
        "div",
        { class: "place" },
        h("span", { class: "place-icon", html: iconSvg("map-pin") }),
        h(
          "span",
          { class: "place-text" },
          h("span", { class: "place-label" }, p.label || t("card.placeHere")),
          h("span", { class: "place-meta" }, new Date(p.at).toLocaleDateString(locale())),
        ),
        pos ? h("span", { class: "place-dist" }, formatDistance(distanceMeters(pos, p), locale())) : null,
        h(
          "button",
          { type: "button", class: "icon-btn small", "aria-label": t("card.removePlace"), onclick: () => removePlace(id, p.id) },
          h("span", { html: iconSvg("x") }),
        ),
      ),
    );
    let branchLine = null;
    if (current.autoBranches) {
      const text = !state.settings.osm
        ? t("card.branchesOff")
        : branches.length
          ? t("card.branches", { n: branches.length })
          : t("card.branchesNone");
      branchLine = h(
        "button",
        { type: "button", class: "branch-line", onclick: () => go("#map"), disabled: !branches.length },
        h("span", { class: "branch-ring", "aria-hidden": "true" }),
        h("span", null, text),
        branches.length && pos
          ? h(
              "span",
              { class: "place-dist" },
              formatDistance(Math.min(...branches.map((b) => distanceMeters(pos, b))), locale()),
            )
          : null,
      );
    }
    mount(placesEl, rows.length ? rows : h("p", { class: "muted" }, t("card.noPlaces")), branchLine);
  }

  update();

  return {
    el,
    update,
    cleanup() {
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock?.release?.().catch(() => {});
      wakeLock = null;
    },
  };
}
