import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { DATA_DIR } from "../store.ts";

/**
 * Each marketplace gets its own persistent browser profile under data/browser/<name>.
 * You log in once in a real, visible window; the session is reused for later postings.
 */
const PROFILES_DIR = path.join(DATA_DIR, "browser");
const open = new Map<string, BrowserContext>();

function profileDir(name: string) {
  return path.join(PROFILES_DIR, name);
}

export async function isConnected(name: string) {
  try {
    await fs.access(path.join(profileDir(name), ".snapsell-connected"));
    return true;
  } catch {
    return false;
  }
}

async function markConnected(name: string, connected: boolean) {
  const marker = path.join(profileDir(name), ".snapsell-connected");
  if (connected) await fs.writeFile(marker, new Date().toISOString());
  else await fs.rm(marker, { force: true });
}

/** Opens (or reuses) a visible browser window bound to the platform's profile. */
export async function openBrowser(name: string): Promise<BrowserContext> {
  const existing = open.get(name);
  if (existing) {
    try {
      existing.pages();
      return existing;
    } catch {
      open.delete(name);
    }
  }
  await fs.mkdir(profileDir(name), { recursive: true });
  const base = {
    headless: process.env.SNAPSELL_HEADLESS === "1",
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  let ctx: BrowserContext;
  const executablePath = process.env.SNAPSELL_CHROME_PATH;
  if (executablePath) {
    ctx = await chromium.launchPersistentContext(profileDir(name), { ...base, executablePath });
  } else {
    // Prefer the installed Google Chrome (looks like a normal browser to the sites), fall
    // back to Playwright's bundled Chromium.
    try {
      ctx = await chromium.launchPersistentContext(profileDir(name), { ...base, channel: "chrome" });
    } catch {
      ctx = await chromium.launchPersistentContext(profileDir(name), base);
    }
  }
  ctx.on("close", () => open.delete(name));
  open.set(name, ctx);
  return ctx;
}

export async function newPage(name: string): Promise<Page> {
  const ctx = await openBrowser(name);
  const blank = ctx.pages().find((p) => p.url() === "about:blank");
  return blank ?? (await ctx.newPage());
}

/**
 * Opens the login page and waits (up to 5 minutes) until the session cookie shows up,
 * then closes the window. `loggedIn` inspects the context's cookies.
 */
export async function connect(
  name: string,
  loginUrl: string,
  loggedIn: (ctx: BrowserContext) => Promise<boolean>,
) {
  const ctx = await openBrowser(name);
  const page = await newPage(name);
  await page.goto(loginUrl);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (await loggedIn(ctx).catch(() => false)) {
      await markConnected(name, true);
      await page.waitForTimeout(1500);
      await ctx.close();
      return true;
    }
    await page.waitForTimeout(2000).catch(() => {});
    if (!open.has(name)) break; // user closed the window
  }
  return false;
}

export async function disconnect(name: string) {
  await open.get(name)?.close().catch(() => {});
  await markConnected(name, false);
  await fs.rm(profileDir(name), { recursive: true, force: true });
}

/** Returns the first locator among candidates that becomes visible. */
export async function firstVisible(page: Page, candidates: Locator[], timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      const l = c.first();
      if (await l.isVisible().catch(() => false)) return l;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

/** Types like a person: small random delays make automation less brittle on React forms. */
export async function humanFill(target: Locator, text: string) {
  await target.click();
  await target.fill("");
  await target.pressSequentially(text.slice(0, 40), { delay: 25 + Math.random() * 30 });
  if (text.length > 40) await target.fill(text);
}

export const pause = (page: Page, min = 300, max = 900) =>
  page.waitForTimeout(min + Math.random() * (max - min));
