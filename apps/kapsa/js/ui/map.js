// #map: saved places, branches found on the map and you. #pick-<id>: move the map under
// a fixed pin to save a place for a card.

import { inkFor } from "../brands.js";
import { distanceMeters } from "../geo.js";
import { t } from "../i18n.js";
import { invalidateBranches, startLocation } from "../location.js";
import { back, go } from "../nav.js";
import { addPlace, extraPlaces, getCard, state } from "../state.js";
import { buzz } from "../util.js";
import { Icon, html, toast } from "./kit.js";
import { useEffect, useRef } from "../../vendor/preact.js";

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

const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

/** Escape for the little HTML strings Leaflet markers take. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function MapPage({ pickId, tick }) {
  const pickCard = pickId ? getCard(pickId) : null;
  const el = useRef(null);
  const map = useRef(/** @type {any} */ (null));
  const layer = useRef(/** @type {any} */ (null));
  const fitted = useRef(false);

  const draw = () => {
    const L = globalThis.L;
    if (!map.current || !L) {
      return;
    }
    layer.current.clearLayers();
    const points = [];
    const extra = extraPlaces();
    const marker = (p, card, kind) => {
      const letter = esc((card.name.match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase());
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "",
          html: `<span class="mk ${kind}" style="--c:${esc(card.color)};--on:${inkFor(card.color)}">${letter}</span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
      });
      const pop = document.createElement("div");
      pop.className = "pop";
      const name = document.createElement("strong");
      name.textContent = card.name;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn sm lime";
      btn.textContent = t("map.open");
      btn.addEventListener("click", () => go(`#card-${card.id}`));
      pop.append(name, btn);
      m.bindPopup(pop).addTo(layer.current);
      points.push([p.lat, p.lon]);
    };
    for (const card of state.cards) {
      for (const p of card.places) {
        marker(p, card, "");
      }
      for (const b of extra[card.id] ?? []) {
        marker(b, card, "branch");
      }
    }
    if (state.pos) {
      L.circle([state.pos.lat, state.pos.lon], { radius: Math.min(state.pos.accuracy, 500), className: "me-acc", interactive: false }).addTo(layer.current);
      L.marker([state.pos.lat, state.pos.lon], {
        icon: L.divIcon({ className: "", html: '<span class="mk-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false,
      }).addTo(layer.current);
    }
    if (!fitted.current) {
      const pos = state.pos;
      if (pickCard) {
        const c = pickCard.places.at(-1) ?? pos;
        if (c) {
          map.current.setView([c.lat, c.lon], 17);
          fitted.current = true;
        }
      } else if (pos) {
        const near = points.filter(([lat, lon]) => distanceMeters(pos, { lat, lon }) < 3000);
        if (near.length) {
          map.current.fitBounds(L.latLngBounds([...near, [pos.lat, pos.lon]]).pad(0.2), { maxZoom: 17 });
        } else {
          map.current.setView([pos.lat, pos.lon], 15);
        }
        fitted.current = true;
      } else if (points.length) {
        map.current.fitBounds(L.latLngBounds(points).pad(0.2), { maxZoom: 16 });
        fitted.current = true;
      }
    }
  };

  useEffect(() => {
    let live = true;
    loadLeaflet()
      .then((L) => {
        if (!live) {
          return;
        }
        map.current = L.map(el.current, { zoomControl: false }).setView([50.0875, 14.4213], 13);
        const dark = isDark();
        L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "rastertiles/voyager"}/{z}/{x}/{y}{r}.png`, {
          maxZoom: 20,
          subdomains: "abcd",
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
        draw();
        if (!state.pos && state.locStatus !== "denied") {
          startLocation();
        }
      })
      .catch(() => {
        if (el.current) {
          el.current.innerHTML = `<p class="hint" style="padding:120px 24px;text-align:center">${esc(t("map.error"))}</p>`;
        }
      });
    return () => {
      live = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(draw, [tick]);

  const savePick = async () => {
    if (!map.current || !pickCard) {
      return;
    }
    const c = map.current.getCenter();
    await addPlace(pickCard.id, { lat: c.lat, lon: c.lng, label: "", source: "map" });
    buzz();
    toast(t("card.placeSaved"));
    invalidateBranches();
    back();
  };

  return html`<div class="page map-page" role="dialog" aria-modal="true" aria-label=${t("map.title")}>
    <div class="map" ref=${el}></div>
    <div class="map-top">
      <button type="button" class="ibtn boxed" aria-label=${t("common.back")} onClick=${() => back()}><${Icon} name="chevron-left" /></button>
      <h1 class="map-title">${pickCard ? pickCard.name : t("map.title")}</h1>
      <button
        type="button"
        class="ibtn boxed"
        aria-label=${t("map.me")}
        onClick=${() => {
          if (state.pos && map.current) {
            map.current.flyTo([state.pos.lat, state.pos.lon], Math.max(map.current.getZoom(), 16), { duration: 0.6 });
          } else {
            startLocation();
          }
        }}
      >
        <${Icon} name="locate-fixed" />
      </button>
    </div>
    ${pickCard
      ? html`<div class="pick-pin" aria-hidden="true"><${Icon} name="map-pin" /></div>
          <div class="map-foot">
            <p>${t("map.pickTitle")}</p>
            <button type="button" class="btn xl lime block" onClick=${savePick}><${Icon} name="check" />${t("map.pickSave")}</button>
          </div>`
      : null}
  </div>`;
}
