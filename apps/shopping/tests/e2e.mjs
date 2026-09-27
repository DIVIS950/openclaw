// End-to-end check of the one-file web build (static/dist/orbit.html).
// Claude is replaced by a scripted stand-in so runs are free and repeatable.
// Usage: npm run test:e2e   (CHROMIUM_PATH overrides the browser binary)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "static/dist/e2e");
mkdirSync(out, { recursive: true });
const page = path.join(out, "index.html");
writeFileSync(
  page,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${readFileSync(path.join(root, "static/dist/orbit.html"), "utf8")}</body></html>`,
);

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath });

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

/** Scripted stand-in for the artifact runtime's Claude (`claude.use("sample")`). */
function mockClaude(mode) {
  if (mode === "absent") return;
  const o = (store, domain, price, city, extra = {}) => ({ store, domain, price, url: `https://${domain}/p`, warehouseCity: city, https: true, domainAgeYears: 15, rating: 4.6, reviews: 50000, returnsDays: 30, flags: [], ...extra });
  const products = [
    { title: "Pegasus 41", brand: "Nike", category: "Shoes", emoji: "👟", blurb: "Everyday neutral trainer.", specs: ["10 mm drop"], typicalPrice: 139, offers: [o("Zalando", "zalando.cz", 129.95, "Berlin"), o("SportisiMo", "sportisimo.cz", 124.9, "Prague"), o("Nike Outlet Sale", "nike-outletsale.shop", 39.9, "Singapore", { domainAgeYears: 0.1, rating: 2, reviews: 12, returnsDays: 0, flags: ["Domain 3 weeks old"] })] },
    { title: "Clifton 10", brand: "Hoka", category: "Shoes", emoji: "👟", blurb: "Max-cushion trainer.", specs: [], typicalPrice: 150, offers: [o("Amazon.de", "amazon.de", 139.5, "Leipzig"), o("Top4Running", "top4running.cz", 142, "Prague")] },
    { title: "Novablast 5", brand: "ASICS", category: "Shoes", emoji: "🏃", blurb: "Bouncy tempo shoe.", specs: [], typicalPrice: 140, offers: [o("Decathlon", "decathlon.cz", 129, "Prague"), o("ASICS", "asics.com", 140, "Amsterdam")] },
  ];
  const jsonl = "Here are the results:\n" + products.map((p) => JSON.stringify(p)).join("\n");
  const sample = async (input, opts = {}) => {
    const text = Array.isArray(input) ? "**SportisiMo** has the Pegasus 41 for about €125. Avoid *nike-outletsale.shop*." : jsonl;
    for (let i = 40; i < text.length + 40; i += 40) {
      await new Promise((r) => setTimeout(r, 15));
      opts.onText?.({ text: text.slice(0, i), delta: "" });
    }
    return { text, truncated: false, modelTierApplied: "default" };
  };
  window.claude = { use: async (n) => (n === "sample" ? sample : null) };
}

async function session(name, { viewport, scheme = "light", claude = "present" }, fn) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.addInitScript(mockClaude, claude);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  // Google Fonts may be unreachable in CI; only app errors count.
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => p.screenshot({ path: path.join(out, `${name}-${n}.png`), fullPage: true });
  const noOverflow = async (where) => {
    const [sw, w] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(sw <= w + 1, `${name}: no sideways scroll on ${where} (${sw}px in ${w}px)`);
  };
  await p.goto("file://" + page);
  await p.waitForSelector("text=What can I find for you?");
  try {
    await fn(p, { shot, noOverflow });
  } catch (e) {
    check(false, `${name}: ${e.message.split("\n")[0]}`);
    await shot("failure");
  }
  check(errors.length === 0, `${name}: no errors in the page${errors.length ? ` (${errors[0]})` : ""}`);
  await ctx.close();
}

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 860 };

await session("phone", { viewport: phone }, async (p, { shot, noOverflow }) => {
  await noOverflow("home");
  await shot("home");

  // Search any product
  await p.getByRole("link", { name: "Running shoes" }).first().click();
  await p.waitForSelector("text=Cheapest safe option");
  await p.waitForSelector("text=AI price estimates");
  check((await p.getByText("Novablast 5").count()) === 1, "search streams in all 3 results");
  check((await p.getByText(/1 risky shop hidden/).count()) === 1, "verdict hides the scam shop");
  check((await p.getByText(/SportisiMo/).count()) > 0, "verdict names the cheapest safe shop");
  await noOverflow("results");
  await shot("results");

  // Product page
  await p.getByRole("link", { name: "View deal" }).click();
  await p.waitForSelector("text=Delivered price");
  check((await p.getByText("Likely scam").count()) === 1, "scam offer is labelled on the product page");
  await p.getByRole("button", { name: "Save for later" }).click();
  check((await p.getByRole("button", { name: "Remove from saved" }).count()) === 1, "save button toggles");
  await p.getByRole("button", { name: /Zalando, .* delivered/ }).click();
  check((await p.getByText(/Zalando · /).count()) === 1, "tapping a price dot selects that shop");
  await noOverflow("product");
  await shot("product");

  // Checkout -> pay -> tracking
  await p.getByRole("link", { name: "Buy now" }).click();
  await p.getByPlaceholder("Full name").fill("Jana Novak");
  await p.getByPlaceholder("Street and number").fill("Vodickova 12");
  await p.getByPlaceholder("Postcode").fill("11000");
  await p.getByPlaceholder("1234 1234 1234 1234").fill("4242 4242 4242 4241");
  await p.getByPlaceholder("MM/YY").fill("12/30");
  await p.getByPlaceholder("CVC").fill("123");
  await p.getByRole("button", { name: /^Pay/ }).click();
  check((await p.getByText("That card number doesn't look right.").count()) === 1, "checkout rejects an invalid card");
  await p.getByPlaceholder("1234 1234 1234 1234").fill("4242 4242 4242 4242");
  await noOverflow("checkout");
  await shot("checkout");
  await p.getByRole("button", { name: /^Pay/ }).click();
  await p.waitForSelector("text=Journey", { timeout: 10000 });
  check((await p.getByText("Pegasus 41").count()) > 0, "tracking opens for the new order");
  await p.getByRole("button", { name: "Watch full trip" }).click();
  await p.waitForTimeout(3600);
  check((await p.getByText("Preview of the full trip").count()) === 1, "full-trip preview plays");
  await noOverflow("tracking");
  await shot("tracking");

  // Parcels from Gmail (demo)
  const tab = (name) => p.locator("nav").last().getByRole("link", { name });
  await tab("Parcels").click();
  await p.getByRole("button", { name: "Connect" }).click();
  await p.waitForSelector("text=Mechanical keyboard");
  check((await p.locator('a[href^="/track/"]').count()) === 4, "Gmail import adds 3 parcels next to the order");
  await p.getByText("Mechanical keyboard").click();
  await p.waitForSelector("text=Orbit Air · Boarding pass");
  check(true, "air parcel shows a boarding pass");
  await tab("Parcels").click();
  await p.getByText("Running shoes").click();
  await p.waitForSelector("text=On the road");
  check(true, "road parcel shows the driving van");
  await shot("road");

  // Saved item shows on home
  await tab("Home").click();
  check((await p.getByText("Saved for later").count()) === 1, "saved product appears on home");

  // Assistant
  await p.getByRole("button", { name: "Ask Orbit AI" }).click();
  await p.getByPlaceholder("Ask about any product or shop…").fill("best running shoe?");
  await p.getByRole("button", { name: "Send" }).click();
  await p.waitForSelector("text=has the Pegasus 41");
  check(true, "assistant answers through Claude");
  await shot("assistant");
});

await session("desktop-dark", { viewport: desktop, scheme: "dark" }, async (p, { shot, noOverflow }) => {
  await noOverflow("home");
  await shot("home");
  await p.getByRole("link", { name: "Sign in" }).click();
  await p.getByPlaceholder("Your name").fill("Jana Novak");
  await p.getByRole("button", { name: "Try the demo" }).click();
  await p.waitForSelector("text=Jana.");
  check(true, "demo sign-in greets the user by name");
  await p.getByRole("link", { name: "Profile" }).click();
  await p.getByPlaceholder("Street and number").fill("Vodickova 12");
  await p.getByRole("button", { name: "Save address" }).click();
  await p.getByRole("link", { name: "Search", exact: true }).click();
  await p.getByPlaceholder(/Search anything/).fill("running shoes");
  await p.keyboard.press("Enter");
  await p.waitForSelector("text=Cheapest safe option");
  await p.getByRole("link", { name: "View deal" }).click();
  await p.getByRole("link", { name: "Buy now" }).click();
  check((await p.getByText("Vodickova 12, ").count()) === 1, "checkout prefills the saved address");
  await noOverflow("checkout");
  await shot("checkout");
});

await session("no-claude", { viewport: phone, claude: "absent" }, async (p) => {
  await p.getByRole("link", { name: "Running shoes" }).first().click();
  await p.waitForSelector("text=Sample catalog", { timeout: 15000 });
  check(true, "without Claude, search falls back to the sample catalog");
  await p.getByRole("button", { name: "Ask Orbit AI" }).click();
  await p.getByRole("button", { name: "Cheapest safe AirPods Pro 3?" }).click();
  await p.waitForSelector("text=My pick");
  check(true, "without Claude, the assistant uses built-in answers");
});

await browser.close();
console.log(failures ? `\n${failures} check(s) failed — screenshots in ${out}` : `\nAll checks passed — screenshots in ${out}`);
process.exit(failures ? 1 : 0);
