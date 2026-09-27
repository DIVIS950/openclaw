export const money = (n: number, currency = "EUR") =>
  n === 0 ? "Free" : new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(n);

export const daysRange = (min: number, max: number) =>
  max === 0 ? "Today" : min === max ? `${min} day${min === 1 ? "" : "s"}` : `${min}–${max} days`;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ICU-independent date label so server and browser render identical text. */
export const dayLabel = (d: Date) => `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;

export function arrivalWindow(min: number, max: number, from = new Date()) {
  const fmt = dayLabel;
  const a = new Date(from.getTime() + min * 864e5);
  const b = new Date(from.getTime() + max * 864e5);
  return min === max ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
}

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
