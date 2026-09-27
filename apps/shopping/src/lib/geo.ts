export type LngLat = [number, number];

export type Place = {
  city: string;
  country: string;
  /** IATA code of the nearest cargo airport, used on the boarding pass. */
  iata: string;
  coords: LngLat;
};

// Small gazetteer so demo mode can "geocode" addresses without an API key.
export const PLACES: Place[] = [
  { city: "Prague", country: "CZ", iata: "PRG", coords: [14.42, 50.08] },
  { city: "Brno", country: "CZ", iata: "BRQ", coords: [16.61, 49.2] },
  { city: "Bratislava", country: "SK", iata: "BTS", coords: [17.11, 48.15] },
  { city: "Vienna", country: "AT", iata: "VIE", coords: [16.37, 48.21] },
  { city: "Berlin", country: "DE", iata: "BER", coords: [13.4, 52.52] },
  { city: "Munich", country: "DE", iata: "MUC", coords: [11.58, 48.14] },
  { city: "Leipzig", country: "DE", iata: "LEJ", coords: [12.37, 51.34] },
  { city: "Warsaw", country: "PL", iata: "WAW", coords: [21.01, 52.23] },
  { city: "Paris", country: "FR", iata: "CDG", coords: [2.35, 48.86] },
  { city: "Amsterdam", country: "NL", iata: "AMS", coords: [4.9, 52.37] },
  { city: "London", country: "GB", iata: "LHR", coords: [-0.13, 51.51] },
  { city: "Madrid", country: "ES", iata: "MAD", coords: [-3.7, 40.42] },
  { city: "Milan", country: "IT", iata: "MXP", coords: [9.19, 45.46] },
  { city: "New York", country: "US", iata: "JFK", coords: [-74.0, 40.71] },
  { city: "Los Angeles", country: "US", iata: "LAX", coords: [-118.24, 34.05] },
  { city: "Chicago", country: "US", iata: "ORD", coords: [-87.63, 41.88] },
  { city: "Toronto", country: "CA", iata: "YYZ", coords: [-79.38, 43.65] },
  { city: "Shenzhen", country: "CN", iata: "SZX", coords: [114.06, 22.54] },
  { city: "Shanghai", country: "CN", iata: "PVG", coords: [121.47, 31.23] },
  { city: "Tokyo", country: "JP", iata: "NRT", coords: [139.69, 35.69] },
  { city: "Seoul", country: "KR", iata: "ICN", coords: [126.98, 37.57] },
  { city: "Singapore", country: "SG", iata: "SIN", coords: [103.82, 1.35] },
  { city: "Dubai", country: "AE", iata: "DXB", coords: [55.27, 25.2] },
  { city: "Sydney", country: "AU", iata: "SYD", coords: [151.21, -33.87] },
  { city: "São Paulo", country: "BR", iata: "GRU", coords: [-46.63, -23.55] },
];

export function findPlace(city: string): Place | undefined {
  const q = city.trim().toLowerCase();
  if (!q) return undefined;
  return PLACES.find((p) => p.city.toLowerCase() === q) ?? PLACES.find((p) => p.city.toLowerCase().startsWith(q));
}

/** Great-circle distance in km. */
export function distanceKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
