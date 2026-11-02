// Run with: node --test apps/kapsa/tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { fromDetectorFormat, groupCode, guessFormat, gs1CheckDigit, isValidGs1, shortCode } from "../js/barcode.js";
import { findBrand, inkFor, normalizeName, searchNamesFor, shopMatches, suggestBrands } from "../js/brands.js";
import { cellCenter, cellKey, distanceMeters, effectiveDistance, formatDistance, rankCards } from "../js/geo.js";
import { DICTS, detectLang, setLang, t } from "../js/i18n.js";
import { branchQuery, filterBranches, nearbyNames, overpassRegexEscape, parseElements } from "../js/osm.js";

test("distanceMeters matches a known distance", () => {
  // Prague: Old Town Square -> Wenceslas Square (about 830 m).
  const d = distanceMeters({ lat: 50.08746, lon: 14.42125 }, { lat: 50.08104, lon: 14.42662 });
  assert.ok(d > 780 && d < 860, `got ${d}`);
  assert.equal(distanceMeters({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }), 0);
});

test("grid cells round-trip and centres stay in their cell", () => {
  const p = { lat: 50.0875, lon: 14.4213 };
  const key = cellKey(p);
  assert.equal(cellKey(cellCenter(key)), key);
  assert.equal(cellKey({ lat: -33.86, lon: 151.2 }), cellKey(cellCenter(cellKey({ lat: -33.86, lon: 151.2 }))));
});

test("effectiveDistance gives some slack for GPS accuracy, capped", () => {
  assert.equal(effectiveDistance(100, 40), 80);
  assert.equal(effectiveDistance(10, 40), 0);
  assert.equal(effectiveDistance(1000, 5000), 925);
});

test("rankCards puts the card you are at first", () => {
  const pos = { lat: 50.0875, lon: 14.4213, accuracy: 20 };
  const near = { lat: 50.08755, lon: 14.4214 };
  const far = { lat: 50.1, lon: 14.45 };
  const cards = [
    { id: "a", name: "Albert", places: [far] },
    { id: "b", name: "Bageterie Boulevard", places: [near] },
    { id: "c", name: "No place", places: [], uses: 9 },
  ];
  const rows = rankCards(cards, pos, {}, 120);
  assert.deepEqual(
    rows.map((r) => r.card.id),
    ["b", "a", "c"],
  );
  assert.equal(rows[0].here, true);
  assert.equal(rows[1].here, false);
  assert.equal(rows[2].distance, null);
});

test("rankCards uses map branches when there is no saved place", () => {
  const pos = { lat: 50.0875, lon: 14.4213, accuracy: 15 };
  const cards = [{ id: "x", name: "dm", places: [] }];
  const rows = rankCards(cards, pos, { x: [{ lat: 50.0876, lon: 14.4213 }] }, 120);
  assert.equal(rows[0].here, true);
  assert.equal(rows[0].source, "branch");
});

test("rankCards without location sorts by recent use", () => {
  const cards = [
    { id: "a", name: "A", lastUsedAt: 1 },
    { id: "b", name: "B", lastUsedAt: 5 },
  ];
  assert.deepEqual(
    rankCards(cards, null, {}, 100).map((r) => r.card.id),
    ["b", "a"],
  );
});

test("formatDistance is readable in both languages", () => {
  assert.equal(formatDistance(7.4, "cs-CZ"), "7 m");
  assert.equal(formatDistance(347, "cs-CZ"), "350 m");
  assert.equal(formatDistance(1234, "cs-CZ"), "1,2 km");
  assert.equal(formatDistance(1234, "en-GB"), "1.2 km");
  assert.equal(formatDistance(15400, "en-GB"), "15 km");
});

test("GS1 check digits", () => {
  assert.equal(gs1CheckDigit("400638133393"), 1); // 4006381333931 is a well-known valid EAN-13
  assert.ok(isValidGs1("4006381333931"));
  assert.ok(!isValidGs1("4006381333932"));
  assert.ok(isValidGs1("96385074")); // EAN-8
});

test("guessFormat picks a sensible barcode type", () => {
  assert.equal(guessFormat("4006381333931"), "ean13");
  assert.equal(guessFormat("4006381333932"), "code128");
  assert.equal(guessFormat("96385074"), "ean8");
  assert.equal(guessFormat("ABC-123"), "code128");
  assert.equal(guessFormat("https://example.com/member/123"), "qr");
  assert.equal(guessFormat(""), "none");
});

test("detector formats map to ours", () => {
  assert.equal(fromDetectorFormat("ean_13"), "ean13");
  assert.equal(fromDetectorFormat("qr_code"), "qr");
  assert.equal(fromDetectorFormat("itf_14"), "itf");
  assert.equal(fromDetectorFormat("something_new"), "code128");
});

test("numbers are grouped for reading", () => {
  assert.equal(groupCode("4006381333931", "ean13"), "4 006381 333931");
  assert.equal(groupCode("6061012345678901", "code128"), "6061 0123 4567 8901");
  assert.equal(groupCode("PB-3089", "qr"), "PB-3089");
  assert.equal(shortCode("6061012345678901"), "•• 8901");
  assert.equal(shortCode("1234"), "1234");
});

test("shop names match branches on the map", () => {
  assert.ok(shopMatches("Albert", "Albert Supermarket"));
  assert.ok(shopMatches("Bageterie Boulevard", "Bageterie Boulevard"));
  assert.ok(shopMatches("Dr.Max", "Lékárna Dr. Max"));
  assert.ok(shopMatches("dm", "dm drogerie markt"));
  assert.ok(!shopMatches("dm", "Admiral"));
  assert.ok(!shopMatches("dm", "Dmitrij"));
  assert.ok(!shopMatches("Albert", "Billa"));
  assert.ok(shopMatches("Žabka", "Zabka"));
});

test("brand lookup and suggestions", () => {
  assert.equal(findBrand("bageterie boulevard")?.name, "Bageterie Boulevard");
  assert.equal(findBrand("Benzina")?.name, "Orlen");
  assert.equal(findBrand("Unknown Shop"), null);
  assert.ok(suggestBrands("bage").some((b) => b.name === "Bageterie Boulevard"));
  assert.ok(suggestBrands("max").some((b) => b.name === "Dr.Max"));
  assert.deepEqual(searchNamesFor({ name: "Benzina" }), ["Benzina", "Orlen", "Benzina Orlen"]);
  assert.equal(normalizeName("Lékárna Dr.Max"), "lekarna dr max");
});

test("ink colour has enough contrast", () => {
  assert.equal(inkFor("#FFE500"), "#14161A");
  assert.equal(inkFor("#003C8F"), "#FFFFFF");
  assert.equal(inkFor("#1E1E1E"), "#FFFFFF");
  assert.equal(inkFor("nonsense"), "#FFFFFF");
});

test("Overpass queries escape shop names", () => {
  assert.equal(overpassRegexEscape('Dr.Max (CZ) "x"'), 'Dr\\.Max \\(CZ\\) \\"x\\"');
  const q = branchQuery(["Albert", "Dr.Max"], { lat: 50.1, lon: 14.4 }, 2600);
  assert.match(q, /around:2600,50\.10000,14\.40000/);
  assert.match(q, /\^\(Albert\|Dr\\\.Max\)/);
});

test("Overpass results are parsed and filtered", () => {
  const json = {
    elements: [
      { type: "node", id: 1, lat: 50, lon: 14, tags: { name: "Albert Supermarket", shop: "supermarket", "addr:street": "Na Příkopě", "addr:housenumber": "12" } },
      { type: "way", id: 2, center: { lat: 50.001, lon: 14.001 }, tags: { name: "Billa", shop: "supermarket" } },
      { type: "node", id: 3, lat: 50.002, lon: 14.002, tags: { shop: "bakery" } },
    ],
  };
  const points = parseElements(json);
  assert.equal(points.length, 2);
  assert.equal(points[0].address, "Na Příkopě 12");
  assert.deepEqual(
    filterBranches(points, ["Albert"]).map((p) => p.id),
    ["node/1"],
  );
  const near = nearbyNames(points, { lat: 50.0011, lon: 14.0011 });
  assert.equal(near[0].name, "Billa");
});

test("both languages have the same keys and Czech plurals", () => {
  assert.deepEqual(Object.keys(DICTS.cs).toSorted(), Object.keys(DICTS.en).toSorted());
  setLang("cs");
  assert.equal(t("card.branches", { n: 1 }), "Na mapě: 1 pobočka v okolí");
  assert.equal(t("card.branches", { n: 3 }), "Na mapě: 3 pobočky v okolí");
  assert.equal(t("card.branches", { n: 7 }), "Na mapě: 7 poboček v okolí");
  setLang("en");
  assert.equal(t("card.branches", { n: 1 }), "On the map: 1 branch nearby");
  assert.equal(t("wallet.noResults", { q: "x" }), "No card matches “x”.");
  assert.equal(detectLang(["sk-SK", "en"]), "cs");
  assert.equal(detectLang(["de-DE", "en-US"]), "en");
});
