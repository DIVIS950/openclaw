import { distanceKm, type Place } from "./geo";

export type DeliverySpeed = "economy" | "standard" | "express" | "sameday";
export type TransportMode = "air" | "road";

export type DeliveryQuote = {
  speed: DeliverySpeed;
  label: string;
  price: number;
  minDays: number;
  maxDays: number;
  mode: TransportMode;
  carrier: string;
};

/**
 * Quotes delivery options from a warehouse to the buyer. Long or
 * intercontinental routes fly; short ones go by road. Faster = pricier.
 */
export function quoteDelivery(from: Place, to: Place): DeliveryQuote[] {
  const km = distanceKm(from.coords, to.coords);
  const sameContinent = km < 2500;
  const quotes: DeliveryQuote[] = [];

  if (km < 60) {
    quotes.push({ speed: "sameday", label: "Same-day courier", price: 9.9, minDays: 0, maxDays: 0, mode: "road", carrier: "Wolt Drive" });
  }
  if (sameContinent) {
    const base = Math.ceil(km / 700);
    quotes.push(
      { speed: "economy", label: "Economy", price: 0, minDays: base + 3, maxDays: base + 6, mode: "road", carrier: "Packeta" },
      { speed: "standard", label: "Standard", price: round(3.9 + km / 400), minDays: base + 1, maxDays: base + 3, mode: "road", carrier: "DPD" },
      { speed: "express", label: "Express", price: round(12.9 + km / 150), minDays: 1, maxDays: 1 + (km > 900 ? 1 : 0), mode: km > 900 ? "air" : "road", carrier: "DHL Express" },
    );
  } else {
    quotes.push(
      { speed: "economy", label: "Economy air", price: round(2.5 + km / 3000), minDays: 12, maxDays: 25, mode: "air", carrier: "Cainiao" },
      { speed: "standard", label: "Standard air", price: round(9.9 + km / 900), minDays: 6, maxDays: 10, mode: "air", carrier: "UPS" },
      { speed: "express", label: "Priority air", price: round(24.9 + km / 350), minDays: 2, maxDays: 4, mode: "air", carrier: "FedEx International Priority" },
    );
  }
  return quotes;
}

const round = (n: number) => Math.round(n * 10) / 10;
