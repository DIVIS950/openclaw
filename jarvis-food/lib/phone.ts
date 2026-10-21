// Phone number rules. Restaurants: Czech numbers only. Customer (courier) phone: any E.164 number.

function stripFormatting(input: string): string {
  return input.trim().replace(/[\s\-./()]/g, "");
}

function toE164Czech(raw: string): string {
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;
  if (/^\d{9}$/.test(raw)) return `+420${raw}`;
  if (/^420\d{9}$/.test(raw)) return `+${raw}`;
  return raw;
}

// Czech numbering plan: 2xx-5xx landlines, 6xx/7xx mobiles, 910 VoIP.
// 8xx (free/shared-cost) and other 9xx (premium-rate) numbers are blocked on purpose.
const CZECH_CALLABLE = /^\+420(?:[2-7]\d{8}|910\d{6})$/;

/** Returns the restaurant number as +420XXXXXXXXX, or null if it is not an allowed Czech number. */
export function normalizeCzechPhone(input: string): string | null {
  const candidate = toE164Czech(stripFormatting(input));
  return CZECH_CALLABLE.test(candidate) ? candidate : null;
}

/** Returns the customer phone in E.164 form (9 digits are treated as Czech), or null. */
export function normalizeCustomerPhone(input: string): string | null {
  const candidate = toE164Czech(stripFormatting(input));
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}

/** "+420777123456" -> "+420 777 123 456" (easier to read on screen and for the voice agent). */
export function formatPhone(e164: string): string {
  const czech = /^\+420(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return czech ? `+420 ${czech[1]} ${czech[2]} ${czech[3]}` : e164;
}
