// Smaller sheets: address search for a card's place, and the shared-card import.

import { cardFace } from "../cardview.js";
import { buzz, h, mount, toast } from "../dom.js";
import { distanceMeters, formatDistance } from "../geo.js";
import { getLang, locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { invalidateBranches } from "../location.js";
import { decodeShare } from "../model.js";
import { back, replace } from "../nav.js";
import { searchAddress } from "../osm.js";
import { addPlace, getCard, saveCard, state } from "../state.js";

/** #find-<id>: search an address and save it as a place of the card. */
export function createFindSheet(id) {
  const card = getCard(id);
  if (!card) {
    return null;
  }
  const results = h("div", { class: "results", "aria-live": "polite" });
  const input = h("input", {
    id: "find-query",
    class: "input",
    type: "search",
    autocomplete: "street-address",
    enterkeyhint: "search",
    placeholder: t("search.placeholder"),
  });
  input.value = card.name;
  let abort = null;

  const run = async (e) => {
    e?.preventDefault();
    const q = input.value.trim();
    if (!q) {
      return;
    }
    abort?.abort();
    abort = new AbortController();
    mount(results, h("p", { class: "muted" }, "…"));
    try {
      const rows = await searchAddress(q, state.pos, getLang(), abort.signal);
      if (!rows.length) {
        mount(results, h("p", { class: "muted" }, t("search.none")));
        return;
      }
      mount(
        results,
        rows.map((r) =>
          h(
            "button",
            {
              type: "button",
              class: "result",
              onclick: async () => {
                await addPlace(id, { lat: r.lat, lon: r.lon, label: [r.label, r.detail].filter(Boolean).join(", "), source: "search" });
                buzz();
                toast(t("card.placeSaved"));
                invalidateBranches();
                replace(`#card-${id}`);
              },
            },
            h("span", { class: "result-icon", html: iconSvg("map-pin") }),
            h("span", { class: "result-text" }, h("span", { class: "result-label" }, r.label), h("span", { class: "result-detail" }, r.detail)),
            state.pos ? h("span", { class: "place-dist" }, formatDistance(distanceMeters(state.pos, r), locale())) : null,
          ),
        ),
      );
    } catch (err) {
      if (err?.name !== "AbortError") {
        mount(results, h("p", { class: "field-error" }, t("search.error")));
      }
    }
  };

  const el = h(
    "div",
    { class: "find-sheet" },
    h(
      "div",
      { class: "sheet-bar" },
      h(
        "button",
        { type: "button", class: "icon-btn", onclick: () => replace(`#card-${id}`), "aria-label": t("map.back") },
        h("span", { html: iconSvg("chevron-left") }),
      ),
      h("h2", { class: "sheet-title" }, t("search.title")),
      h("span", { class: "bar-spacer" }),
    ),
    h(
      "form",
      { class: "find-form", onsubmit: run },
      h("label", { class: "visually-hidden", for: "find-query" }, t("search.title")),
      input,
      h("button", { type: "submit", class: "btn-primary" }, h("span", { html: iconSvg("search") }), t("search.go")),
    ),
    results,
    h("p", { class: "fineprint" }, "© OpenStreetMap"),
  );
  queueMicrotask(() => input.select());
  return { el, cleanup: () => abort?.abort() };
}

/** #import=<data>: confirm adding a card someone shared. */
export function createImportSheet(data) {
  const card = decodeShare(data ?? "");
  if (!card) {
    queueMicrotask(() => {
      toast(t("import.invalid"));
      replace("");
    });
    return null;
  }
  const el = h(
    "div",
    { class: "import-sheet" },
    h(
      "div",
      { class: "sheet-bar" },
      h("button", { type: "button", class: "icon-btn", onclick: () => replace(""), "aria-label": t("card.close") }, h("span", { html: iconSvg("x") })),
      h("h2", { class: "sheet-title" }, t("import.title")),
      h("span", { class: "bar-spacer" }),
    ),
    cardFace({ ...card, id: "import", photo: null }, { size: "full" }),
    h(
      "button",
      {
        type: "button",
        class: "btn-primary btn-big",
        onclick: async () => {
          const saved = await saveCard({ ...card, uses: 0, lastUsedAt: 0 });
          buzz();
          toast(t("card.saved"));
          invalidateBranches();
          replace(`#card-${saved.id}`);
        },
      },
      h("span", { html: iconSvg("plus") }),
      t("import.add"),
    ),
    h("button", { type: "button", class: "btn-link", onclick: () => back() }, t("card.cancel")),
  );
  return { el };
}
