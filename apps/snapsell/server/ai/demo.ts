import type { Analysis, AnalyzeEvent, Settings } from "../../shared/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Rough USD → local rates so demo prices look plausible in every currency.
const RATE: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, CZK: 23, PLN: 3.95 };

/** Converts a USD demo price and rounds it the way people price things (e.g. 3 790 Kč, 149 €). */
function local(usd: number, currency: string) {
  const v = usd * (RATE[currency] ?? 1);
  const step = v >= 1000 ? 100 : v >= 100 ? 10 : 1;
  return Math.round(v / step) * step - (v >= 100 ? step / 10 : 0);
}

/**
 * Canned analysis used when no Anthropic API key is configured, so the whole flow
 * (studio, editor, publishing) can be tried without spending anything.
 */
export async function demoAnalysis(
  photoCount: number,
  settings: Settings,
  emit: (e: AnalyzeEvent) => void,
): Promise<Analysis> {
  const c = settings.currency;
  const p = (usd: number) => local(usd, c);
  emit({ type: "stage", stage: "looking" });
  await sleep(1000);
  emit({ type: "stage", stage: "lens" });
  await sleep(700);
  emit({ type: "lens", matches: 14, bestGuess: "sony wh-1000xm4" });
  for (const [value, source] of [[142, "eBay"], [165, "eBay"], [150, "Vinted"], [185, "Facebook"], [158, "eBay"], [131, "Vinted"]] as const) {
    emit({ type: "price", value: p(value), currency: c, source });
    await sleep(180);
  }
  emit({ type: "stage", stage: "searching" });
  for (const q of [
    "Sony WH-1000XM4 used price",
    "Sony WH-1000XM4 sold listings",
    "WH-1000XM4 vinted",
  ]) {
    emit({ type: "search", query: q });
    await sleep(700);
  }
  emit({ type: "source", title: "Sony WH-1000XM4 for sale | eBay", url: "https://www.ebay.com/" });
  emit({ type: "source", title: "Sony WH-1000XM4 | Vinted", url: "https://www.vinted.com/" });
  await sleep(600);
  emit({ type: "stage", stage: "pricing" });
  await sleep(900);
  emit({ type: "stage", stage: "writing" });
  await sleep(900);

  return {
    item: {
      name: "Sony WH-1000XM4 Wireless Noise Cancelling Headphones",
      brand: "Sony",
      model: "WH-1000XM4",
      category: "Headphones",
      color: "Black",
      material: null,
      size: null,
      era: "2020",
    },
    confidence: 0.92,
    identificationNotes: "Demo mode: this is sample data. Add an Anthropic API key to analyze your real photos.",
    condition: "good",
    conditionNotes: "Light wear on the headband, ear pads intact, no visible cracks.",
    price: {
      currency: c,
      low: p(120),
      high: p(190),
      suggested: p(159),
      quickSale: p(135),
      demand: "high",
      reasoning:
        `Recent sold listings cluster between ${p(130)} and ${p(175)} ${c} for units in good condition. Complete sets with the case sell toward the top of the range.`,
    },
    comparables: [
      { title: "Sony WH-1000XM4 Black, with case", price: p(165), currency: c, source: "eBay sold", url: "https://www.ebay.com/", sold: true },
      { title: "Sony WH1000XM4 noise cancelling", price: p(142), currency: c, source: "eBay sold", url: "https://www.ebay.com/", sold: true },
      { title: "Sony XM4 headphones", price: p(150), currency: c, source: "Vinted", url: "https://www.vinted.com/", sold: false },
      { title: "Sony WH-1000XM4 like new", price: p(185), currency: c, source: "Facebook Marketplace", url: null, sold: false },
    ],
    title: "Sony WH-1000XM4 Wireless Noise Cancelling Headphones Black",
    description: "Sony WH-1000XM4 in good working condition. Industry-leading noise cancelling, 30h battery.",
    platforms: {
      ebay: {
        title: "Sony WH-1000XM4 Wireless Noise Cancelling Over-Ear Headphones Black Bluetooth",
        description:
          "Sony WH-1000XM4 Wireless Noise Cancelling Headphones - Black\n\nCONDITION\n- Good used condition, fully working\n- Light wear on the headband, ear pads intact\n\nFEATURES\n- Industry-leading active noise cancelling\n- Up to 30 hours battery life\n- Multipoint Bluetooth, touch controls\n\nINCLUDED\n- Headphones\n- Carrying case\n- USB-C cable\n\nShips fast and well packed.",
      },
      facebook: {
        title: "Sony WH-1000XM4 noise cancelling headphones",
        description:
          "Selling my Sony XM4 headphones. Work perfectly, noise cancelling is amazing.\nLight wear on the headband, pads are in great shape.\nComes with case and cable.\nPickup or shipping possible. Message me!",
      },
      vinted: {
        title: "Sony WH-1000XM4 headphones black",
        description:
          "Sony WH-1000XM4 wireless headphones in black. Fully working, great noise cancelling and battery. Small signs of use on the headband. Case and cable included.\n\n#sony #headphones #noisecancelling #wh1000xm4 #bluetooth",
      },
    },
    tags: ["sony", "wh-1000xm4", "headphones", "noise cancelling", "bluetooth", "wireless"],
    attributes: [
      { name: "Brand", value: "Sony" },
      { name: "Model", value: "WH-1000XM4" },
      { name: "Color", value: "Black" },
      { name: "Connectivity", value: "Bluetooth" },
      { name: "Type", value: "Over-ear" },
    ],
    crops: Array.from({ length: photoCount }, (_, photo) => ({ photo, x: 0.08, y: 0.08, w: 0.84, h: 0.84 })),
    photoTips: ["Add a photo of the ear pads close up", "Show the case and accessories together"],
    shipping: { weightKg: 0.6, packageSize: "medium" },
  };
}
