// Demo data so the app can be tried before scanning anything real.
// Everything is marked `sample` and can be removed in Settings.

import { gs1CheckDigit } from "./barcode.js";
import { savePurchase, saveCard, saveCoupon, state } from "./state.js";
import { isoDay } from "./util.js";

const DAY = 86_400_000;

/** Place a point `north`/`east` metres from `base`. */
function offset(base, north, east) {
  return {
    lat: base.lat + north / 111_320,
    lon: base.lon + east / (111_320 * Math.cos((base.lat * Math.PI) / 180)),
  };
}

export async function addDemo(now = Date.now()) {
  const base = state.pos ?? { lat: 50.08804, lon: 14.42076 };
  const ean = (body) => body + gs1CheckDigit(body);
  const place = (n, e) => [{ id: `s${Math.random().toString(36).slice(2, 9)}`, ...offset(base, n, e), label: "", source: "sample", at: now }];
  // Past visits around lunchtime, so "Usually now" has a habit to show.
  const lunch = (daysAgo) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(12, 10, 0, 0);
    return { t: d.getTime() };
  };

  const bb = await saveCard({
    name: "Bageterie Boulevard",
    code: ean("299004718263"),
    format: "ean13",
    color: "#1E1E1E",
    category: "bakery",
    places: place(6, -4),
    autoBranches: false,
    stamps: { goal: 8, count: 5, reward: "Bageta zdarma", redeemed: 1 },
    usage: [1, 2, 3, 6, 7].map(lunch),
    uses: 5,
    sample: true,
  });
  const albert = await saveCard({
    name: "Albert",
    code: ean("859400127734"),
    format: "ean13",
    color: "#003C8F",
    category: "grocery",
    places: place(240, 180),
    autoBranches: false,
    points: 380,
    pointsGoal: 500,
    sample: true,
  });
  const dm = await saveCard({
    name: "dm",
    code: "PB-3089-4410-7752",
    format: "qr",
    color: "#FFD23F",
    category: "beauty",
    places: place(-620, 410),
    autoBranches: false,
    points: 1240,
    expiry: isoDay(now + 12 * DAY),
    sample: true,
  });
  const costa = await saveCard({
    name: "Costa Coffee",
    code: "6061012345678901",
    format: "code128",
    color: "#6D1F37",
    category: "coffee",
    places: place(900, -1200),
    autoBranches: false,
    stamps: { goal: 10, count: 9, reward: "Káva zdarma", redeemed: 0 },
    sample: true,
  });

  await saveCoupon({ title: "Celý nákup", discount: "−20 %", cardId: dm.id, shop: "dm", code: "DM20NOV", format: "qr", expiry: isoDay(now + 2 * DAY), note: "Nad 300 Kč", sample: true });
  await saveCoupon({ title: "Ovoce a zelenina", discount: "−50 Kč", cardId: albert.id, shop: "Albert", code: ean("299000000456"), format: "ean13", expiry: isoDay(now + 9 * DAY), sample: true });
  await saveCoupon({ title: "Druhá bageta", discount: "1+1", cardId: bb.id, shop: "Bageterie Boulevard", code: "", format: "none", expiry: "", sample: true });
  await saveCoupon({ title: "Káva s sebou", discount: "−30 %", cardId: costa.id, shop: "Costa Coffee", code: "COSTA30", format: "code128", expiry: isoDay(now - 3 * DAY), used: true, usedAt: now - 4 * DAY, saved: 24, sample: true });

  // Six months of spending, so the stats screen has something to show.
  const shops = [
    [albert, [412, 238, 690, 155]],
    [bb, [139, 129, 149]],
    [dm, [324, 189]],
    [costa, [89, 95]],
  ];
  for (let m = 0; m < 6; m++) {
    for (const [card, amounts] of shops) {
      amounts.forEach((amount, i) => {
        const day = Math.min(27, 2 + i * 6 + ((m * 3) % 5));
        const at = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - m, day, 12).getTime();
        if (at <= now) {
          savePurchase({ cardId: card.id, shop: card.name, amount: Math.round(amount * (0.8 + ((m + i) % 4) * 0.12)), saved: i === 0 ? 15 : 0, at, sample: true });
        }
      });
    }
  }
}
