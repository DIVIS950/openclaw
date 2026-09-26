import { effectiveCondition, effectiveCopy, effectivePrice, type Condition } from "../../shared/types.ts";
import { connect, disconnect, firstVisible, humanFill, isConnected, newPage, pause } from "./browser.ts";
import type { Publisher } from "./types.ts";

const PROFILE = "vinted";

// Vinted's condition list order: New with tags, New without tags, Very good, Good, Satisfactory.
const CONDITION_INDEX: Record<Condition, number> = { new: 0, like_new: 2, good: 3, fair: 4, poor: 4 };

export const vinted: Publisher = {
  platform: "vinted",

  async status(settings) {
    const connected = await isConnected(PROFILE);
    return {
      platform: "vinted",
      connected,
      mode: "browser",
      detail: connected ? `Logged in to ${settings.vintedDomain}` : `Log in once to ${settings.vintedDomain}`,
    };
  },

  connect: (settings) =>
    connect(PROFILE, `https://${settings.vintedDomain}/member/signup/select_type?ref_url=%2F`, async (ctx) =>
      (await ctx.cookies(`https://${settings.vintedDomain}`)).some(
        (c) => c.name === "access_token_web" || (c.name === "_vinted_fr_session" && c.value.length > 200),
      ),
    ),

  disconnect: () => disconnect(PROFILE),

  async publish({ listing, settings, photoPaths, progress }) {
    const copy = effectiveCopy(listing, "vinted");
    const warnings: string[] = [];
    const page = await newPage(PROFILE);
    const base = `https://${settings.vintedDomain}`;

    progress("Opening Vinted");
    await page.goto(`${base}/items/new`, { waitUntil: "domcontentloaded" });
    if (/signup|login/.test(page.url())) {
      return { status: "error", message: "Not logged in to Vinted. Connect it in Settings." };
    }

    progress("Uploading photos");
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 20_000 });
    await fileInput.setInputFiles(photoPaths.slice(0, 20));
    await pause(page, 1500, 2500);

    const byTestId = (id: string) => page.locator(`[data-testid="${id}"]`);

    progress("Filling in the listing");
    const title = await firstVisible(page, [byTestId("title--input"), page.locator('input[name="title"]')]);
    if (title) await humanFill(title, copy.title.slice(0, 100));
    else warnings.push("Couldn't find the title field");
    await pause(page);

    const desc = await firstVisible(page, [byTestId("description--input"), page.locator('textarea[name="description"]')]);
    if (desc) await humanFill(desc, copy.description);
    else warnings.push("Couldn't find the description field");
    await pause(page);

    // Category: open the picker and search for the AI category, take the first hit.
    const cat = await firstVisible(page, [byTestId("catalog-select-dropdown-input")], 4000);
    if (cat) {
      await cat.click();
      const search = await firstVisible(page, [byTestId("catalog-select-dropdown-search-input"), page.getByRole("searchbox")], 3000);
      if (search) {
        await search.fill(listing.analysis?.item.category ?? "");
        await pause(page, 1000, 1500);
        const hit = page.locator('[data-testid^="catalog-search-"] , [role="option"]').first();
        if (await hit.isVisible().catch(() => false)) await hit.click();
        else warnings.push("Pick a category");
      } else warnings.push("Pick a category");
    } else warnings.push("Pick a category");
    await pause(page);

    const brand = listing.analysis?.item.brand;
    const brandInput = brand ? await firstVisible(page, [byTestId("brand-select-dropdown-input")], 3000) : null;
    if (brand && brandInput) {
      await brandInput.click();
      const search = await firstVisible(page, [byTestId("brand-search--input"), page.getByRole("searchbox")], 3000);
      if (search) {
        await search.fill(brand);
        await pause(page, 1000, 1500);
        const hit = page.locator('[id^="brand-"], [role="option"]').first();
        if (await hit.isVisible().catch(() => false)) await hit.click();
      }
    }

    const cond = await firstVisible(page, [byTestId("status-select-dropdown-input")], 3000);
    if (cond) {
      await cond.click();
      await pause(page);
      const options = page.locator('[data-testid^="status-select-dropdown-row"], [role="option"]');
      const idx = CONDITION_INDEX[effectiveCondition(listing)];
      if ((await options.count()) > idx) await options.nth(idx).click();
      else warnings.push("Pick the condition");
    } else warnings.push("Pick the condition");

    const price = await firstVisible(page, [byTestId("price-input--input"), page.locator('input[name="price"]')]);
    if (price) await humanFill(price, String(Math.round(effectivePrice(listing))));
    else warnings.push("Couldn't find the price field");

    if (!settings.autoPublish) {
      return {
        status: "needs_review",
        message: `Form filled in the SnapSell browser window. Add size / package if asked, then press Upload.${warnings.length ? ` ${warnings.join(". ")}.` : ""}`,
      };
    }

    progress("Publishing");
    const save = await firstVisible(page, [byTestId("upload-form-save-button")], 5000);
    if (!save) return { status: "needs_review", message: "Couldn't find the Upload button. Finish in the browser window." };
    await save.click();
    await page.waitForURL(/\/items\/\d+/, { timeout: 30_000 }).catch(() => {});
    const m = page.url().match(/\/items\/(\d+)/);
    if (!m) {
      return {
        status: "needs_review",
        message: `Vinted needs a hand: ${warnings.join(". ") || "some required fields are missing"}. Finish in the browser window.`,
      };
    }
    return { status: "live", message: "Posted on Vinted", url: page.url() };
  },
};
