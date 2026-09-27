import { getProduct, getStore, offersFor, PRODUCTS, searchProducts } from "./data";
import { quoteDelivery } from "./delivery";
import { money } from "./format";
import { findPlace } from "./geo";
import { assessStore } from "./safety";

/** Rule-based stand-in for Claude so the assistant is useful with no API key. */
export function demoAnswer(question: string, city = "Prague", productId?: string): string {
  const q = question.toLowerCase();
  const product =
    (productId && getProduct(productId)) ||
    searchProducts(question)[0] ||
    PRODUCTS.find((p) => q.includes(p.brand.toLowerCase()) || q.includes(p.title.toLowerCase().split(" ")[0]));

  if (/scam|safe|legit|trust/.test(q) && !product) {
    return [
      "Here's how I check if a shop is safe:",
      "",
      "- **Domain age** — brand-new domains (weeks old) are a red flag",
      "- **HTTPS + company details** — real shops show an address and VAT/company ID",
      "- **Reviews** — thousands of reviews on independent sites, not just on the shop itself",
      "- **Payment** — card or PayPal with buyer protection; avoid bank-transfer-only shops",
      "- **Price** — more than ~40% under market is almost always too good to be true",
      "",
      "Open any product and I'll score every shop that sells it.",
    ].join("\n");
  }

  if (!product) {
    return `I couldn't find that in the demo catalog yet. Try **AirPods**, **Pixel**, **Switch 2**, **Dyson** or **LEGO**.\n\n_Demo mode — add an Anthropic API key and I'll search the whole web for you._`;
  }

  const to = findPlace(city) ?? findPlace("Prague")!;
  const rows = offersFor(product.id)
    .map((o) => {
      const store = getStore(o.storeId)!;
      const safety = assessStore(store, o.price, product.typicalPrice);
      const quotes = quoteDelivery(store.warehouse, to);
      const cheapest = quotes.reduce((a, b) => (a.price <= b.price ? a : b));
      const fastest = quotes.reduce((a, b) => (a.maxDays <= b.maxDays ? a : b));
      return { o, store, safety, cheapest, fastest };
    })
    .sort((a, b) => a.o.price + a.cheapest.price - (b.o.price + b.cheapest.price));

  const safe = rows.filter((r) => r.safety.level !== "danger");
  const best = safe[0];
  const fastest = [...safe].sort((a, b) => a.fastest.maxDays - b.fastest.maxDays)[0];
  const scams = rows.filter((r) => r.safety.level === "danger");

  const lines = [
    `**${product.brand} ${product.title}** — delivered to ${to.city}:`,
    "",
    ...safe.map(
      (r) =>
        `- **${r.store.name}** ${money(r.o.price)} + ${money(r.cheapest.price)} shipping · ${r.cheapest.maxDays === 0 ? "today" : `${r.cheapest.minDays}–${r.cheapest.maxDays} days`} · trust ${r.safety.score}/100`,
    ),
  ];
  if (scams.length) {
    lines.push("", ...scams.map((r) => `⚠️ **Avoid ${r.store.name}** (${money(r.o.price)}) — ${r.safety.flags.slice(0, 2).join("; ").toLowerCase()}. Very likely a scam.`));
  }
  lines.push(
    "",
    `**My pick:** ${best.store.name} at ${money(best.o.price + best.cheapest.price)} total.`,
    fastest && fastest !== best
      ? `Need it fast? **${fastest.store.name}** ${fastest.fastest.label.toLowerCase()} arrives in ${fastest.fastest.maxDays === 0 ? "hours" : `${fastest.fastest.maxDays} day${fastest.fastest.maxDays > 1 ? "s" : ""}`} for ${money(fastest.fastest.price)} extra.`
      : "",
    "",
    "_Demo mode — prices are sample data. Add an Anthropic API key for live web prices._",
  );
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
