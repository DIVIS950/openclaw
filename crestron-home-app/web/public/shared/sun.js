// Sunrise and sunset for a place and day, worked out locally (NOAA's simplified
// equations, accurate to about a minute), so "at sunset" schedules need no internet.

const RAD = Math.PI / 180;

/**
 * @param {Date} date - any time on the local day wanted
 * @param {number} lat - degrees north
 * @param {number} lon - degrees east
 * @returns {{ sunrise: Date, sunset: Date } | null} null during polar day or night
 */
export function sunTimes(date, lat, lon) {
  const midnightUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = Math.round((midnightUTC - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const g = (2 * Math.PI / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosH > 1 || cosH < -1) return null;
  const hourAngle = Math.acos(cosH) / RAD;
  // Minutes after midnight UTC on that date; the local day can start on the UTC day before.
  const toDate = (minutes) => {
    let t = midnightUTC + minutes * 60000;
    const wanted = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    while (t < wanted) t += 86400000;
    while (t >= wanted + 86400000) t -= 86400000;
    return new Date(t);
  };
  return {
    sunrise: toDate(720 - 4 * (lon + hourAngle) - eqTime),
    sunset: toDate(720 - 4 * (lon - hourAngle) - eqTime),
  };
}
