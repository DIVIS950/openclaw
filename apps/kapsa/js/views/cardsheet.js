// Card sheet: the scannable code at full brightness, plus places, sharing and delete.

import { categoryIcon } from "../brands.js";
import { cardFace, codePanel } from "../cardview.js";
import { buzz, copyText, h, mount, toast } from "../dom.js";
import { distanceMeters, formatDistance } from "../geo.js";
import { locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { startLocation } from "../location.js";
import { usualDayPart } from "../habits.js";
import { cleanPoints, encodeShare, expiryStatus } from "../model.js";
import { back, go, replace } from "../nav.js";
import {
  addPlace,
  deleteCard,
  forgetLearned,
  getCard,
  learnedFor,
  markUsed,
  removePlace,
  saveCard,
  state,
} from "../state.js";
import { showBigCode } from "./bigcode.js";

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
  const factsEl = h("div", { class: "facts" });

  // Main code, or the second one (e.g. from the back of the card).
  const codeHost = h("div", { class: "code-host" });
  const codes = [{ code: card.code, format: card.format }];
  if (card.code2) {
    codes.push({ code: card.code2, format: card.format2 || "code128" });
  }
  let which = 0;
  const showCode = () => {
    const c = codes[which];
    const shown = { ...card, ...c };
    mount(
      codeHost,
      codePanel(shown, {
        onCopy: c.code ? () => copyCode(c.code) : undefined,
        onEnlarge: c.format !== "none" && c.code ? () => showBigCode(el, shown) : undefined,
      }),
    );
    for (const [i, btn] of [...codeSwitch.children].entries()) {
      btn.setAttribute("aria-checked", String(i === which));
    }
  };
  const codeSwitch = h(
    "div",
    { class: "segmented code-switch", role: "radiogroup", hidden: codes.length < 2 },
    [t("card.code1"), t("card.code2")].map((label, i) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          onclick: () => {
            which = i;
            showCode();
          },
        },
        label,
      ),
    ),
  );
  const confirmEl = h("div", { class: "confirm", hidden: true });

  const copyCode = async (value) => {
    if (await copyText(value)) {
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
    codeSwitch,
    codeHost,
    h("p", { class: "hint" }, h("span", { html: iconSvg("sun") }), t("card.screenOn")),
    factsEl,
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

  /** Points, expiry and habit, with a quick way to change the points balance. */
  const renderFacts = (current) => {
    const exp = expiryStatus(current.expiry, Date.now());
    const part = state.settings.habits ? usualDayPart(current.usage) : null;
    const pointsBtn = h(
      "button",
      { type: "button", class: "fact is-action", onclick: () => editPoints(current) },
      h("span", { class: "fact-label" }, t("card.points")),
      h(
        "span",
        { class: "fact-value" },
        current.points === null || current.points === undefined
          ? t("card.pointsAdd")
          : new Intl.NumberFormat(locale()).format(current.points),
      ),
    );
    mount(
      factsEl,
      pointsBtn,
      exp
        ? h(
            "div",
            { class: `fact is-${exp.state}` },
            h("span", { class: "fact-label" }, exp.state === "expired" ? t("card.expiredOn") : t("card.validUntil")),
            h("span", { class: "fact-value" }, new Date(`${current.expiry}T12:00:00`).toLocaleDateString(locale())),
          )
        : null,
      part || current.uses
        ? h(
            "div",
            { class: "fact" },
            h("span", { class: "fact-label" }, part ? t("card.usually") : t("card.usedLabel")),
            h("span", { class: "fact-value" }, part ? t(`habit.${part}`) : t("card.timesUsed", { n: current.uses })),
          )
        : null,
    );
  };

  const editPoints = (current) => {
    const input = h("input", {
      id: "quick-points",
      class: "input mono",
      type: "text",
      inputmode: "numeric",
      autocomplete: "off",
      "aria-label": t("card.points"),
    });
    input.value = current.points === null || current.points === undefined ? "" : String(current.points);
    const save = async () => {
      const saved = await saveCard({ ...getCard(id), points: cleanPoints(input.value.trim() === "" ? null : input.value) });
      buzz();
      renderFacts(saved);
    };
    mount(
      factsEl,
      h(
        "form",
        {
          class: "points-edit",
          onsubmit: (e) => {
            e.preventDefault();
            save();
          },
        },
        input,
        h("button", { type: "submit", class: "btn-primary" }, h("span", { html: iconSvg("check") }), t("card.save")),
      ),
    );
    input.focus();
  };

  function update() {
    const current = getCard(id);
    if (!current) {
      return;
    }
    if (!factsEl.querySelector("form")) {
      renderFacts(current);
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
    const learned = learnedFor(current).map((p) =>
      h(
        "div",
        { class: "place is-learned" },
        h("span", { class: "place-icon", html: iconSvg("sparkles") }),
        h(
          "span",
          { class: "place-text" },
          h("span", { class: "place-label" }, t("card.learned")),
          h("span", { class: "place-meta" }, t("card.learnedMeta", { n: p.count })),
        ),
        pos ? h("span", { class: "place-dist" }, formatDistance(distanceMeters(pos, p), locale())) : null,
        h(
          "button",
          { type: "button", class: "icon-btn small", "aria-label": t("card.removePlace"), onclick: () => forgetLearned(id, p) },
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
    mount(placesEl, rows.length || learned.length ? [rows, learned] : h("p", { class: "muted" }, t("card.noPlaces")), branchLine);
  }

  showCode();
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
