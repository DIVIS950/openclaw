// Weather and place search from Open-Meteo (free, no key needed).
const FAHRENHEIT_COUNTRIES = new Set(["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"]);

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`The weather service answered ${res.status}.`);
  return res.json();
}

/** Finds a town or city. Returns { place, lat, lon, unit } or null. */
export async function findPlace(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(query)}`;
  const hit = (await getJSON(url)).results?.[0];
  if (!hit) return null;
  return {
    place: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(", "),
    lat: hit.latitude,
    lon: hit.longitude,
    unit: FAHRENHEIT_COUNTRIES.has(hit.country_code) ? "F" : "C",
  };
}

/** Current weather and today's range. `code` is a WMO weather code. */
export async function fetchWeather({ lat, lon, unit }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,weather_code,is_day",
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    forecast_days: "1",
    timezone: "auto",
    temperature_unit: unit === "F" ? "fahrenheit" : "celsius",
  });
  const data = await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`);
  return {
    temp: Math.round(data.current.temperature_2m),
    code: data.current.weather_code,
    isDay: data.current.is_day === 1,
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    unit: unit === "F" ? "F" : "C",
    updatedAt: Date.now(),
  };
}
