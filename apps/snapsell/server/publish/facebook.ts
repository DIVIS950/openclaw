import { effectiveCondition, effectiveCopy, effectivePrice, type Condition } from "../../shared/types.ts";
import { connect, disconnect, firstVisible, humanFill, isConnected, newPage, pause } from "./browser.ts";
import type { Publisher } from "./types.ts";

const PROFILE = "facebook";
const CREATE_URL = "https://www.facebook.com/marketplace/create/item";

// Facebook renders form labels in the account's UI language; cover the common ones.
const LABELS = {
  title: /^(title|název|titel|titre|título|titolo|tytuł)$/i,
  price: /^(price|cena|preis|prix|precio|prezzo)$/i,
  description: /^(description|popis|beschreibung|descripción|descrizione|opis)$/i,
  condition: /^(condition|stav|zustand|état|estado|condizione|stan)$/i,
  category: /^(category|kategorie|catégorie|categoría|categoria|kategoria)$/i,
  next: /^(next|další|weiter|suivant|siguiente|avanti|dalej)$/i,
  publish: /^(publish|publikovat|veröffentlichen|publier|publicar|pubblica|opublikuj)$/i,
};

// Option order in Facebook's condition dropdown: New, Used - like new, Used - good, Used - fair.
const CONDITION_INDEX: Record<Condition, number> = { new: 0, like_new: 1, good: 2, fair: 3, poor: 3 };

export const facebook: Publisher = {
  platform: "facebook",

  async status() {
    const connected = await isConnected(PROFILE);
    return {
      platform: "facebook",
      connected,
      mode: "browser",
      detail: connected ? "Logged in via SnapSell browser" : "Log in once in the SnapSell browser window",
    };
  },

  connect: () =>
    connect(PROFILE, "https://www.facebook.com/login", async (ctx) =>
      (await ctx.cookies("https://www.facebook.com")).some((c) => c.name === "c_user"),
    ),

  disconnect: () => disconnect(PROFILE),

  async publish({ listing, settings, photoPaths, progress }) {
    const copy = effectiveCopy(listing, "facebook");
    const warnings: string[] = [];
    const page = await newPage(PROFILE);

    progress("Opening Marketplace");
    await page.goto(CREATE_URL, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) {
      return { status: "error", message: "Not logged in to Facebook. Connect it in Settings." };
    }

    progress("Uploading photos");
    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 20_000 });
    await fileInput.setInputFiles(photoPaths.slice(0, 10));
    await pause(page, 1500, 2500);

    const fill = async (label: RegExp, value: string, what: string) => {
      const field = await firstVisible(page, [
        page.getByLabel(label),
        page.getByRole("textbox", { name: label }),
      ]);
      if (!field) return warnings.push(`Couldn't find the ${what} field`);
      await humanFill(field, value);
      await pause(page);
    };

    progress("Filling in the listing");
    await fill(LABELS.title, copy.title, "title");
    await fill(LABELS.price, String(Math.round(effectivePrice(listing))), "price");

    // Category is a searchable dropdown; type the AI category and take the first match.
    const category = await firstVisible(page, [page.getByLabel(LABELS.category)], 4000);
    if (category) {
      await category.click();
      await pause(page);
      await page.keyboard.type(listing.analysis?.item.category ?? "", { delay: 40 });
      await pause(page, 800, 1200);
      const option = page.getByRole("option");
      if (await option.first().isVisible().catch(() => false)) await option.first().click();
      else warnings.push("Pick a category");
    } else warnings.push("Pick a category");

    const condition = await firstVisible(page, [page.getByLabel(LABELS.condition)], 4000);
    if (condition) {
      await condition.click();
      await pause(page);
      const options = page.getByRole("option");
      const idx = CONDITION_INDEX[effectiveCondition(listing)];
      if ((await options.count()) > idx) await options.nth(idx).click();
      else warnings.push("Pick the condition");
    } else warnings.push("Pick the condition");

    await fill(LABELS.description, copy.description, "description");

    if (!settings.autoPublish) {
      return {
        status: "needs_review",
        message: `Form filled in the SnapSell browser window. Check it and press Publish.${warnings.length ? ` ${warnings.join(". ")}.` : ""}`,
      };
    }

    progress("Publishing");
    for (const label of [LABELS.next, LABELS.next, LABELS.publish]) {
      const btn = await firstVisible(page, [page.getByRole("button", { name: label })], 5000);
      if (btn && (await btn.isEnabled())) {
        await btn.click();
        await pause(page, 1500, 2500);
      }
    }
    await page.waitForURL((u) => !u.pathname.includes("/create/"), { timeout: 30_000 }).catch(() => {});
    if (page.url().includes("/create/")) {
      return {
        status: "needs_review",
        message: `Facebook needs a hand: ${warnings.join(". ") || "finish the form"} in the open browser window.`,
      };
    }
    return { status: "live", message: "Posted on Marketplace", url: "https://www.facebook.com/marketplace/you/selling" };
  },
};
