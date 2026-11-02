// Wallet screen: "you are here" card on top, then the stack of all cards.

import { gs1CheckDigit } from "../barcode.js";
import { normalizeName } from "../brands.js";
import { cardFace } from "../cardview.js";
import { h, mount } from "../dom.js";
import { formatDistance, rankCards } from "../geo.js";
import { dayPart, suggestNow } from "../habits.js";
import { locale, t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { startLocation } from "../location.js";
import { go } from "../nav.js";
import { extraPlaces, habitScores, saveCard, state } from "../state.js";

/** Build the wallet screen once; returns an `update()` that refreshes it from state. */
export function createHome() {
  let query = "";
  const status = h("div", { class: "loc-line", role: "status" });
  const hero = h("section", { class: "hero", "aria-live": "polite" });
  const list = h("ol", { class: "stack" });
  const count = h("span", { class: "count" });
  const search = h("input", {
    id: "wallet-search",
    class: "search",
    type: "search",
    autocomplete: "off",
    enterkeyhint: "search",
    oninput: (e) => {
      query = e.target.value;
      update();
    },
  });
  const searchWrap = h("label", { class: "search-wrap", hidden: true }, h("span", { html: iconSvg("search") }), search);
  const walletHead = h("div", { class: "wallet-head" }, h("h2", { class: "section-title" }, h("span", { class: "wallet-title" }), count), searchWrap);
  const wallet = h("section", { class: "wallet" }, walletHead, list);
  const empty = h("section", { class: "empty", hidden: true });
  const fab = h(
    "button",
    { type: "button", class: "fab", onclick: () => go("#add") },
    h("span", { html: iconSvg("plus") }),
    h("span", { class: "fab-label" }),
  );

  const aiBtn = h(
    "button",
    { type: "button", class: "icon-btn ai-btn", onclick: () => go("#ai") },
    h("span", { html: iconSvg("sparkles") }),
  );
  const mapBtn = h("button", { type: "button", class: "icon-btn", onclick: () => go("#map") }, h("span", { html: iconSvg("map") }));
  const settingsBtn = h(
    "button",
    { type: "button", class: "icon-btn", onclick: () => go("#settings") },
    h("span", { html: iconSvg("settings") }),
  );

  const root = h(
    "div",
    { class: "page page-home" },
    h(
      "header",
      { class: "appbar" },
      h("div", { class: "brand" }, h("span", { class: "logo-mark", "aria-hidden": "true" }), h("span", { class: "wordmark" }, "Kapsa")),
      h("div", { class: "appbar-actions" }, aiBtn, mapBtn, settingsBtn),
    ),
    h("main", { class: "home-main" }, status, hero, wallet, empty),
    fab,
  );

  function update() {
    aiBtn.setAttribute("aria-label", t("ai.title"));
    mapBtn.setAttribute("aria-label", t("map.title"));
    settingsBtn.setAttribute("aria-label", t("settings.title"));
    fab.querySelector(".fab-label").textContent = t("wallet.add");
    walletHead.querySelector(".wallet-title").textContent = t("wallet.title");
    search.placeholder = t("wallet.search");
    search.setAttribute("aria-label", t("wallet.search"));

    const hasCards = state.cards.length > 0;
    aiBtn.hidden = !hasCards;
    empty.hidden = hasCards;
    wallet.hidden = !hasCards;
    fab.hidden = !hasCards;
    renderStatus(status);
    if (!hasCards) {
      mount(hero);
      renderEmpty(empty);
      return;
    }

    const rows = rankCards(state.cards, state.pos, extraPlaces(), state.settings.radius, habitScores());
    renderHero(hero, rows);

    count.textContent = String(state.cards.length);
    searchWrap.hidden = state.cards.length < 6;
    const q = normalizeName(query);
    const visible = q ? rows.filter((r) => normalizeName(r.card.name).includes(q)) : rows;
    if (!visible.length) {
      mount(list, h("li", { class: "stack-empty" }, t("wallet.noResults", { q: query })));
      return;
    }
    mount(
      list,
      visible.map((row, i) =>
        h(
          "li",
          { class: "slot", style: { "--i": i } },
          cardFace(row.card, {
            tag: "button",
            distance: row.distance,
            here: row.here,
            attrs: {
              type: "button",
              onclick: () => go(`#card-${row.card.id}`),
              "aria-label": row.distance === null ? row.card.name : `${row.card.name}, ${formatDistance(row.distance, locale())}`,
            },
          }),
        ),
      ),
    );
  }

  return { root, update };
}

function renderStatus(el) {
  const s = state.locStatus;
  if (s === "on" && state.pos) {
    mount(el, h("span", { class: "dot is-on" }), t("loc.accuracy", { m: formatDistance(state.pos.accuracy, locale()) }));
  } else if (s === "searching") {
    mount(el, h("span", { class: "dot is-wait" }), t("loc.searching"));
  } else if (s === "denied") {
    mount(el, h("span", { class: "dot is-off" }), t("loc.off"));
  } else {
    mount(el);
  }
  el.hidden = !el.childNodes.length;
}

function renderHero(el, rows) {
  const here = rows.filter((r) => r.here);
  if (here.length) {
    const [top, ...others] = here;
    const open = () => go(`#card-${top.card.id}`);
    mount(
      el,
      h(
        "div",
        { class: "here" },
        h(
          "div",
          { class: "here-head" },
          h("span", { class: "eyebrow is-here" }, h("span", { class: "pulse" }), t("here.eyebrow")),
          h("span", { class: "here-dist" }, t("here.at", { d: formatDistance(top.distance ?? 0, locale()) })),
        ),
        cardFace(top.card, { tag: "button", attrs: { type: "button", class: "here-card", onclick: open, "aria-label": top.card.name } }),
        h(
          "button",
          { type: "button", class: "btn-primary btn-big", onclick: open },
          h("span", { html: iconSvg("scan-barcode") }),
          t("here.showCode"),
        ),
        others.length
          ? h(
              "div",
              { class: "also" },
              h("span", { class: "also-label" }, t("here.alsoHere")),
              others.map((r) =>
                h(
                  "button",
                  { type: "button", class: "chip", style: { "--c": r.card.color }, onclick: () => go(`#card-${r.card.id}`) },
                  h("span", { class: "chip-dot" }),
                  r.card.name,
                ),
              ),
            )
          : null,
      ),
    );
    return;
  }

  // No card for this exact spot: offer the card you usually use now, and the nearest one.
  const blocks = [];
  const suggestion = state.settings.habits ? suggestNow(state.cards, Date.now()) : null;
  if (suggestion) {
    blocks.push(quickRow(suggestion.card, t("habit.usuallyNow"), t(`habit.${dayPart(Date.now())}`), true));
  }
  if (state.locStatus === "on") {
    const nearest = rows.find((r) => r.distance !== null);
    if (nearest && nearest.card.id !== suggestion?.card.id) {
      blocks.push(quickRow(nearest.card, t("near.nearest"), formatDistance(nearest.distance ?? 0, locale()), false));
    }
  } else if (state.locStatus !== "searching") {
    blocks.push(locationCard());
  }
  mount(el, blocks);
}

/** One-line shortcut to a card: swatch, label, name, and a value on the right. */
function quickRow(card, label, meta, smart) {
  return h(
    "button",
    { type: "button", class: `nearest${smart ? " is-smart" : ""}`, onclick: () => go(`#card-${card.id}`) },
    h("span", { class: "nearest-swatch", style: { "--c": card.color } }),
    h(
      "span",
      { class: "nearest-text" },
      h("span", { class: "nearest-label" }, smart ? h("span", { html: iconSvg("sparkles") }) : null, label),
      h("span", { class: "nearest-name" }, card.name),
    ),
    h("span", { class: "nearest-dist" }, meta),
  );
}

function locationCard() {
  const denied = state.locStatus === "denied";
  const unavailable = state.locStatus === "unavailable";
  return h(
    "div",
    { class: "loc-card" },
    h("span", { class: "loc-icon", html: iconSvg(denied ? "locate-off" : "locate-fixed") }),
    h(
      "div",
      { class: "loc-copy" },
      h("strong", null, denied ? t("loc.off") : t("loc.turnOn")),
      h("p", null, denied ? t("loc.denied") : unavailable ? t("loc.unavailable") : t("loc.why")),
    ),
    denied ? null : h("button", { type: "button", class: "btn-primary", onclick: () => startLocation() }, t("loc.turnOn")),
  );
}

function renderEmpty(el) {
  mount(
    el,
    h(
      "div",
      { class: "empty-art", "aria-hidden": "true" },
      h("span", { class: "ea-card ea-1" }),
      h("span", { class: "ea-card ea-2" }),
      h("span", { class: "ea-pocket" }),
      h("span", { class: "ea-pin", html: iconSvg("map-pin") }),
    ),
    h("h1", { class: "empty-title" }, t("empty.title")),
    h("p", { class: "empty-body" }, t("empty.body")),
    h(
      "ol",
      { class: "steps" },
      [
        ["scan-barcode", "empty.step1"],
        ["map-pin", "empty.step2"],
        ["smartphone", "empty.step3"],
      ].map(([icon, key]) => h("li", null, h("span", { class: "step-icon", html: iconSvg(icon) }), h("span", null, t(key)))),
    ),
    h(
      "button",
      { type: "button", class: "btn-primary btn-big", onclick: () => go("#add") },
      h("span", { html: iconSvg("scan-barcode") }),
      t("empty.add"),
    ),
    h("button", { type: "button", class: "btn-link", onclick: addSamples }, t("empty.sample")),
  );
}

/** Example cards so the app can be tried before scanning anything real. */
async function addSamples() {
  if (!state.pos && state.locStatus !== "denied") {
    // Place the samples around the user so the "you're here" card shows up.
    startLocation();
    for (let waited = 0; !state.pos && waited < 6000 && state.locStatus !== "denied"; waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const base = state.pos ?? { lat: 50.08804, lon: 14.42076 };
  const offset = (north, east) => ({
    lat: base.lat + north / 111_320,
    lon: base.lon + east / (111_320 * Math.cos((base.lat * Math.PI) / 180)),
  });
  const ean = (body) => body + gs1CheckDigit(body);
  const samples = [
    { name: "Bageterie Boulevard", code: ean("299004718263"), format: "ean13", color: "#1E1E1E", category: "bakery", at: offset(6, -4) },
    { name: "Albert", code: ean("859400127734"), format: "ean13", color: "#003C8F", category: "grocery", at: offset(240, 180) },
    { name: "dm", code: "PB-3089-4410-7752", format: "qr", color: "#1D3A8A", category: "beauty", at: offset(-620, 410) },
    { name: "Starbucks", code: "6061012345678901", format: "code128", color: "#00704A", category: "coffee", at: offset(900, -1200) },
  ];
  for (const s of samples) {
    await saveCard({
      name: s.name,
      code: s.code,
      format: s.format,
      color: s.color,
      category: s.category,
      places: [{ id: `s${Math.random().toString(36).slice(2, 9)}`, ...s.at, label: "", source: "sample", at: Date.now() }],
      autoBranches: false,
      sample: true,
    });
  }
}
