import { distanceKm, findPlace, type Place } from "./geo";
import type { TransportMode } from "./delivery";

export type Parcel = {
  id: string;
  title: string;
  store: string;
  carrier: string;
  trackingNumber: string;
  from: Place;
  to: Place;
  mode: TransportMode;
  /** Epoch ms. */
  shippedAt: number;
  /** Carrier's promised latest delivery, epoch ms. */
  promisedBy: number;
  source: "order" | "gmail";
  /** For air parcels: pseudo flight used on the boarding pass. */
  flight?: { number: string; gate: string; seat: string };
};

export type ParcelEvent = { at: number; label: string; place: string; done: boolean };

const H = 36e5;

export function parcelProgress(p: Parcel, now = Date.now()) {
  // Delivery usually lands before the promise; estimate it at ~85% of the window.
  const expected = p.shippedAt + (p.promisedBy - p.shippedAt) * 0.85;
  return Math.max(0, Math.min(1, (now - p.shippedAt) / (expected - p.shippedAt)));
}

export function parcelStatus(p: Parcel, now = Date.now()) {
  const t = parcelProgress(p, now);
  if (t >= 1) return "Delivered";
  if (t > 0.9) return "Out for delivery";
  if (t > 0.1) return p.mode === "air" ? "In flight" : "On the road";
  return "Label created";
}

export function parcelEvents(p: Parcel, now = Date.now()): ParcelEvent[] {
  const span = p.promisedBy - p.shippedAt;
  const steps: [number, string, string][] = p.mode === "air"
    ? [
        [0, "Label created", p.from.city],
        [0.08, "Picked up by " + p.carrier, p.from.city],
        [0.2, `Departed ${p.from.iata}`, p.from.city],
        [0.55, `Landed at ${p.to.iata}`, p.to.city],
        [0.65, "Cleared customs", p.to.city],
        [0.82, "Out for delivery", p.to.city],
        [0.85, "Delivered", p.to.city],
      ]
    : [
        [0, "Label created", p.from.city],
        [0.08, "Picked up by " + p.carrier, p.from.city],
        [0.3, "Left sorting hub", p.from.city],
        [0.6, "Arrived at regional depot", p.to.city],
        [0.8, "Out for delivery", p.to.city],
        [0.85, "Delivered", p.to.city],
      ];
  return steps.map(([f, label, place]) => {
    const at = p.shippedAt + span * f;
    return { at, label, place, done: at <= now };
  });
}

/** Heuristic ETA used when Claude is not configured. */
export function heuristicEta(p: Parcel, now = Date.now()) {
  const expected = p.shippedAt + (p.promisedBy - p.shippedAt) * 0.85;
  const km = distanceKm(p.from.coords, p.to.coords);
  const confidence = p.mode === "air" ? (km > 5000 ? 0.72 : 0.8) : 0.88;
  return {
    eta: Math.max(expected, now + H),
    confidence,
    reasoning:
      p.mode === "air"
        ? `Flights on ${p.from.iata}→${p.to.iata} usually clear customs in under 12 h; ${p.carrier} has been on schedule this week.`
        : `${Math.round(km)} km by road via ${p.carrier}; no depot delays reported on this route.`,
  };
}

let seq = 0;
function makeId() {
  seq += 1;
  return `p${Date.now().toString(36)}${seq}`;
}

export function makeParcel(input: {
  title: string;
  store: string;
  carrier: string;
  from: Place;
  to: Place;
  mode: TransportMode;
  maxDays: number;
  source?: Parcel["source"];
  shippedAt?: number;
}): Parcel {
  const shippedAt = input.shippedAt ?? Date.now();
  const tn = (input.carrier.slice(0, 2).toUpperCase() + Math.random().toString().slice(2, 14)).replace(/\s/g, "");
  return {
    id: makeId(),
    title: input.title,
    store: input.store,
    carrier: input.carrier,
    trackingNumber: tn,
    from: input.from,
    to: input.to,
    mode: input.mode,
    shippedAt,
    promisedBy: shippedAt + Math.max(0.5, input.maxDays) * 24 * H,
    source: input.source ?? "order",
    flight:
      input.mode === "air"
        ? {
            number: `${input.carrier.slice(0, 2).toUpperCase()} ${100 + Math.floor(Math.random() * 899)}`,
            gate: `C${1 + Math.floor(Math.random() * 30)}`,
            seat: `${10 + Math.floor(Math.random() * 30)}${"ABCDEF"[Math.floor(Math.random() * 6)]}`,
          }
        : undefined,
  };
}

/** Parcels shown before the user has ordered anything, as if found in Gmail. */
export function demoParcels(home = "Prague"): Parcel[] {
  const to = findPlace(home) ?? findPlace("Prague")!;
  const now = Date.now();
  return [
    { ...makeParcel({ title: "Mechanical keyboard", store: "AliExpress", carrier: "Cainiao", from: findPlace("Shenzhen")!, to, mode: "air", maxDays: 9, source: "gmail", shippedAt: now - 3.2 * 24 * H }), id: "demo-air" },
    { ...makeParcel({ title: "Running shoes", store: "Zalando", carrier: "DPD", from: findPlace("Berlin")!, to, mode: "road", maxDays: 3, source: "gmail", shippedAt: now - 1.1 * 24 * H }), id: "demo-road" },
    { ...makeParcel({ title: "Film camera lens", store: "B&H Photo", carrier: "FedEx International Priority", from: findPlace("New York")!, to, mode: "air", maxDays: 4, source: "gmail", shippedAt: now - 0.6 * 24 * H }), id: "demo-air-2" },
  ];
}
