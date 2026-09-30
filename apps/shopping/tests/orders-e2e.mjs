// End-to-end test of the real order flow against a fake Stripe:
// order → payment reserved → admin places it (charge) → shipped → delivered,
// plus cancellation. Builds the app with test keys, so it takes about a minute.
// Usage: npm run test:orders   (CHROMIUM_PATH overrides the browser binary)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startFakeStripe } from "./fake-stripe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "static/dist/orders-e2e");
mkdirSync(out, { recursive: true });
rmSync(path.join(root, ".data"), { recursive: true, force: true });

const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env,
  ORBIT_TEST: "1",
  ORBIT_FILE_DB: "1",
  STRIPE_API_BASE: "http://127.0.0.1:12111",
  STRIPE_SECRET_KEY: "sk_test_fake",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_fake",
  ADMIN_PASSWORD: "correct horse battery",
  AUTH_SECRET: "test-secret-please-change-0123456789",
  NEXT_TELEMETRY_DISABLED: "1",
};

let failures = 0;
const errors = [];
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

const run = (args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn("npx", args, { cwd: root, env, stdio: opts.quiet ? "ignore" : "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited ${code}`))));
  });

const { server: stripe, intents } = await startFakeStripe();
if (!process.env.SKIP_BUILD) await run(["next", "build"], { quiet: true });
// Own process group, so stopping it also stops the server process npx starts.
const app = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: root, env, stdio: "ignore", detached: true });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

const orderBody = (overrides = {}) => ({
  customer: { name: "Jana Novak", email: "jana@example.com", phone: "+420 600 000 000" },
  address: { line1: "Vodickova 12", city: "Prague", zip: "11000", country: "Czechia" },
  item: { productId: "x-nike-pegasus-41", offerId: "x-nike-pegasus-41__s-zalando-cz", title: "Pegasus 41", brand: "Nike", store: "Zalando", domain: "zalando.cz", url: "https://www.zalando.cz/p", price: 129.95, fromCity: "Berlin" },
  speed: "standard",
  coupon: { code: "RUN10", description: "10% off running" },
  ...overrides,
});

const createOrder = async (body) => {
  const r = await fetch(`${BASE}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
const getOrder = async (id, token) => {
  const r = await fetch(`${BASE}/api/orders/${id}`, { headers: { "x-order-token": token } });
  return { status: r.status, data: r.ok ? await r.json() : null };
};

try {
  await waitForServer();

  // --- API: validation and creation
  const bad = await createOrder(orderBody({ customer: { name: "J", email: "x", phone: "1" } }));
  check(bad.status === 400, "rejects an order with bad contact details");

  const { status, data: created } = await createOrder(orderBody());
  check(status === 200 && created.clientSecret?.startsWith("pi_fake"), "creates an order with a payment to approve");
  const pi = [...intents.values()].at(-1);
  check(pi.capture_method === "manual" && pi.amount === Math.round(created.authorized * 100), "payment is reserve-only (manual capture) for the exact total");

  check((await getOrder(created.id, "wrong-token")).status === 404, "another person's token can't read the order");
  check((await getOrder(created.id, created.token)).data?.status === "pending_payment", "order waits for the payment");
  check(!("token" in (await getOrder(created.id, created.token)).data) && !("paymentIntentId" in (await getOrder(created.id, created.token)).data), "order API hides the token and payment id");

  // Customer approves (Apple Pay / card) → Stripe holds the money.
  await fetch(`http://127.0.0.1:12111/__authorize/${pi.id}`, { method: "POST" });
  check((await getOrder(created.id, created.token)).data?.status === "held", "after approval the order shows payment reserved");

  // --- Browser: customer page + admin
  const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({ executablePath });
  globalThis.__browser = browser;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(
    ([id, token]) => {
      if (!localStorage.getItem("orbit.v1")) localStorage.setItem("orbit.v1", JSON.stringify({ myOrders: [{ id, token, title: "Nike Pegasus 41", createdAt: Date.now() }] }));
    },
    [created.id, created.token],
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/order/${created.id}?placed=1`);
  await page.waitForSelector("text=Your card is not charged yet.");
  check((await page.getByRole("heading", { name: "Order placed" }).count()) === 1, "customer sees the 'Order placed' moment after paying");
  await page.screenshot({ path: path.join(out, "customer-placed.png"), fullPage: true });
  await page.getByRole("button", { name: "Got it" }).click();
  await page.waitForSelector("text=Order placed", { state: "detached" });
  check(true, "customer sees 'Payment reserved' on the order page");
  await page.screenshot({ path: path.join(out, "customer-held.png"), fullPage: true });

  // Admin actions without signing in are refused (server action checks the cookie).
  const admin = await ctx.newPage();
  admin.on("pageerror", (e) => errors.push(`admin: ${e.message}`));
  admin.on("console", (m) => m.type() === "error" && console.log("  admin console:", m.text().slice(0, 300)));
  await admin.goto(`${BASE}/admin`);
  await admin.getByLabel("Password").fill("nope");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await admin.waitForSelector("text=Wrong password.");
  check(true, "admin rejects a wrong password");
  await admin.getByLabel("Password").fill(env.ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await admin.waitForSelector("text=Needs you");
  check((await admin.getByText("Try coupon").count()) === 1, "admin sees the coupon to try");
  await admin.screenshot({ path: path.join(out, "admin-needs-you.png"), fullPage: true });

  // Coupon worked: charge less than reserved. Charging more is refused.
  await admin.getByLabel("Shop order number").fill("ZAL-123456");
  await admin.getByLabel("Final amount to charge").fill(String(created.authorized + 5));
  await admin.getByRole("button", { name: /charge customer/ }).click();
  await admin.waitForSelector("text=The amount must be between");
  check(true, "admin can't charge more than the customer approved");
  const final = Math.round((created.authorized - 13) * 100) / 100;
  await admin.getByLabel("Final amount to charge").fill(String(final));
  await admin.getByRole("button", { name: /charge customer/ }).click();
  // The card moves to "Ordered" and shows the shop order number and the charge.
  await admin.waitForSelector("text=Shop order: ZAL-123456");
  check((await admin.getByText(`${final.toFixed(2)} EUR`).count()) >= 1, "admin sees the amount charged");
  check(pi.status === "succeeded" && pi.amount_received === Math.round(final * 100), "customer is charged the final (lower) price");

  await admin.reload();
  await admin.getByLabel("Carrier").fill("DPD");
  await admin.getByLabel("Tracking number").fill("01234567890123");
  await admin.getByRole("button", { name: "Mark shipped" }).click();
  await admin.waitForSelector("text=Tracking: DPD 01234567890123");
  check(true, "admin adds the tracking number");

  await page.reload();
  await page.waitForSelector("text=Track at DPD");
  check((await page.getByText(/You saved/).count()) === 1, "customer sees the saving and the carrier link");
  check((await page.locator("svg[aria-label^='Map of parcel route']").count()) === 1, "customer sees the animated map once shipped");
  await page.screenshot({ path: path.join(out, "customer-shipped.png"), fullPage: true });

  await admin.reload();
  await admin.getByRole("button", { name: "Mark delivered" }).click();
  await admin.waitForSelector("text=Delivered ·");
  check((await getOrder(created.id, created.token)).data?.status === "delivered", "order ends as delivered");

  // --- Cancellation releases the hold
  const { data: second } = await createOrder(orderBody({ coupon: undefined }));
  const pi2 = [...intents.values()].at(-1);
  await fetch(`http://127.0.0.1:12111/__authorize/${pi2.id}`, { method: "POST" });
  await getOrder(second.id, second.token);
  await admin.reload();
  await admin.getByLabel("Cancel reason").fill("Sold out at the shop");
  await admin.getByRole("button", { name: /Cancel · release money/ }).click();
  await admin.waitForSelector("text=Cancelled ·");
  check(pi2.status === "canceled" && pi2.amount_received === 0, "cancelling releases the money; nothing charged");
  check((await getOrder(second.id, second.token)).data?.status === "cancelled", "customer sees the order cancelled");

  // Checkout page renders with payments on.
  await page.goto(`${BASE}/checkout?offer=${encodeURIComponent("airpods-pro-3__alza")}&speed=standard`);
  await page.waitForSelector("text=Reserved now");
  check((await page.getByText("Payments aren't switched on yet.").count()) === 0, "checkout shows the payment step when Stripe is configured");

  check(errors.length === 0, `no page errors${errors.length ? ` (${errors[0]})` : ""}`);
  await browser.close();
} catch (e) {
  check(false, e.message.split("\n")[0]);
  if (typeof errors !== "undefined") console.log(errors.slice(0, 3).join("\n"));
  // Save what every open page looked like, to see why.
  for (const [i, p] of (globalThis.__browser?.contexts().flatMap((c) => c.pages()) ?? []).entries()) {
    await p.screenshot({ path: path.join(out, `failure-${i}.png`), fullPage: true }).catch(() => {});
  }
} finally {
  try {
    process.kill(-app.pid, "SIGTERM");
  } catch {}
  stripe.close();
}

console.log(failures ? `\n${failures} check(s) failed — screenshots in ${out}` : `\nAll order-flow checks passed — screenshots in ${out}`);
process.exit(failures ? 1 : 0);
