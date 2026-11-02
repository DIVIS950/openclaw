// Map page: saved places, branches found on the map and you. Also used to pick a
// place for a card (#pick-<id>) by moving the map under a fixed pin.

import { inkFor } from "../brands.js";
import { buzz, h, toast } from "../dom.js";
import { distanceMeters } from "../geo.js";
import { t } from "../i18n.js";
import { iconSvg } from "../icons.js";
import { invalidateBranches, startLocation } from "../location.js";
import { back, go } from "../nav.js";
import { addPlace, getCard, state } from "../state.js";

let leafletPromise = null;

function loadLeaflet() {
  leafletPromise ??= new Promise((resolve, reject) => {
    const base = new URL("../../vendor/leaflet/", import.meta.url);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("leaflet.css", base).href;
    document.head.append(css);
    const js = document.createElement("script");
    js.src = new URL("leaflet.js", base).href;
    js.addEventListener("load", () => resolve(globalThis.L));
    js.addEventListener("error", () => {
      leafletPromise = null;
      reject(new Error("Leaflet failed to load"));
    });
    document.head.append(js);
  });
  return leafletPromise;
}

function isDark() {
  const forced = document.documentElement.dataset.theme;
  if (forced) {
    return forced === "dark";
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/** @param {string | null} pickId card id when choosing a place, otherwise null */
export function createMapPage(pickId) {
  const pickCard = pickId ? getCard(pickId) : null;
  const mapEl = h("div", { class: "map", role: "application", "aria-label": t("map.title") });
  const meBtn = h(
    "button",
    {
      type: "button",
      class: "icon-btn raised",
      "aria-label": t("map.me"),
      onclick: () => {
        if (state.pos && map) {
          map.flyTo([state.pos.lat, state.pos.lon], Math.max(map.getZoom(), 16), { duration: 0.6 });
        } else {
          startLocation();
        }
      },
    },
    h("span", { html: iconSvg("locate-fixed") }),
  );

  const root = h(
    "div",
    { class: `page page-map${pickCard ? " is-picking" : ""}` },
    h(
      "header",
      { class: "appbar map-bar" },
      h("button", { type: "button", class: "icon-btn raised", onclick: () => back(), "aria-label": t("map.back") }, h("span", { html: iconSvg("chevron-left") })),
      h("h1", { class: "map-title" }, pickCard ? pickCard.name : t("map.title")),
      meBtn,
    ),
    mapEl,
    pickCard ? h("div", { class: "pick-pin", "aria-hidden": "true", html: iconSvg("map-pin") }) : null,
    pickCard
      ? h(
          "div",
          { class: "map-foot" },
          h("p", { class: "map-foot-hint" }, t("map.pickTitle")),
          h(
            "button",
            {
              type: "button",
              class: "btn-primary btn-big",
              onclick: async () => {
                if (!map) {
                  return;
                }
                const c = map.getCenter();
                await addPlace(pickCard.id, { lat: c.lat, lon: c.lng, label: "", source: "map" });
                buzz();
                toast(t("card.placeSaved"));
                invalidateBranches();
                back();
              },
            },
            h("span", { html: iconSvg("check") }),
            t("map.pickSave"),
          ),
        )
      : h(
          "div",
          { class: "map-legend" },
          h("span", null, h("span", { class: "lg lg-saved" }), t("map.legendSaved")),
          h("span", null, h("span", { class: "lg lg-branch" }), t("map.legendBranch")),
        ),
  );

  /** @type {any} */
  let map = null;
  let L = null;
  let layer = null;
  let meLayer = null;
  let tiles = null;
  let darkNow = null;
  let fitted = false;

  const setTiles = () => {
    const dark = isDark();
    if (dark === darkNow || !map) {
      return;
    }
    darkNow = dark;
    tiles?.remove();
    tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "rastertiles/voyager"}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
  };

  const marker = (lat, lon, cls, color, letter) =>
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: "",
        html: `<span class="mk ${cls}" style="--c:${color};--on:${inkFor(color)}">${letter}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
      keyboard: true,
    });

  const popup = (card) => {
    const wrap = h(
      "div",
      { class: "pop" },
      h("strong", null, card.name),
      h(
        "button",
        { type: "button", class: "btn-primary", onclick: () => go(`#card-${card.id}`) },
        h("span", { html: iconSvg("scan-barcode") }),
        t("map.open"),
      ),
    );
    return wrap;
  };

  const draw = () => {
    if (!map) {
      return;
    }
    setTiles();
    layer.clearLayers();
    const points = [];
    for (const card of state.cards) {
      // Initials are escaped by limiting them to letters and digits.
      const letter = (card.name.match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase();
      for (const place of card.places) {
        marker(place.lat, place.lon, "mk-saved", card.color, letter).bindPopup(popup(card)).addTo(layer);
        points.push([place.lat, place.lon]);
      }
      for (const b of state.branches[card.id] ?? []) {
        marker(b.lat, b.lon, "mk-branch", card.color, letter).bindPopup(popup(card)).addTo(layer);
        points.push([b.lat, b.lon]);
      }
    }
    meLayer.clearLayers();
    if (state.pos) {
      L.circle([state.pos.lat, state.pos.lon], {
        radius: Math.min(state.pos.accuracy, 500),
        className: "me-acc",
        interactive: false,
      }).addTo(meLayer);
      L.marker([state.pos.lat, state.pos.lon], {
        icon: L.divIcon({ className: "", html: '<span class="mk-me"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false,
      }).addTo(meLayer);
    }
    if (!fitted) {
      fitView(points);
    }
  };

  const fitView = (points) => {
    const pos = state.pos;
    if (pickCard) {
      const last = pickCard.places.at(-1);
      const center = last ?? pos;
      if (center) {
        map.setView([center.lat, center.lon], 17);
        fitted = true;
      }
      return;
    }
    if (pos) {
      const near = points.filter(([lat, lon]) => distanceMeters(pos, { lat, lon }) < 3000);
      if (near.length) {
        map.fitBounds(L.latLngBounds([...near, [pos.lat, pos.lon]]).pad(0.2), { maxZoom: 17 });
      } else {
        map.setView([pos.lat, pos.lon], 15);
      }
      fitted = true;
    } else if (points.length) {
      map.fitBounds(L.latLngBounds(points).pad(0.2), { maxZoom: 16 });
      fitted = true;
    }
  };

  const themeQuery = matchMedia("(prefers-color-scheme: dark)");
  const onTheme = () => setTiles();
  themeQuery.addEventListener("change", onTheme);

  return {
    root,
    async mounted() {
      try {
        L = await loadLeaflet();
      } catch {
        mapEl.append(h("p", { class: "map-error" }, t("search.error")));
        return;
      }
      if (!root.isConnected) {
        return;
      }
      map = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([50.0875, 14.4213], 13);
      layer = L.layerGroup().addTo(map);
      meLayer = L.layerGroup().addTo(map);
      draw();
      if (!state.pos && state.locStatus !== "denied") {
        startLocation();
      }
    },
    update: () => draw(),
    cleanup() {
      themeQuery.removeEventListener("change", onTheme);
      map?.remove();
      map = null;
    },
  };
}
