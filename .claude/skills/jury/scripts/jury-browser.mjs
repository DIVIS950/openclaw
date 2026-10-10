#!/usr/bin/env node
// App Jury browser — headless Playwright helper so every agent can really use the app.
//
//   node jury-browser.mjs scan <url> [--mobile] [--slow] [--crawl N] [--out DIR] [--state FILE]
//   node jury-browser.mjs run  <steps.json> [--mobile] [--slow] [--video] [--out DIR] [--state FILE] [--save-state FILE]
//   node jury-browser.mjs setup            # installs Playwright + Chromium into ~/.app-jury if missing
//
// scan  → loads the page, records timing, console errors, failed requests, visible controls,
//         takes a screenshot, optionally crawls same-origin links to find broken pages.
// run   → executes a list of steps (goto, click, fill, press, wait, screenshot, expect_text,
//         expect_url, offline, eval) and reports pass/fail per step with screenshots on failure.
//
// --video records the whole run to <out>/<name>.mp4 (or .webm if ffmpeg is unavailable) so you can watch where the user got stuck.
// Output: JSON on stdout (also saved to <out>/result.json). Exit code 0 = ran, 2 = setup problem.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const outDir = path.resolve(opt('out', 'app-jury-report/browser'));
fs.mkdirSync(outDir, { recursive: true });

const HOME_INSTALL = path.join(os.homedir(), '.app-jury');

async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const candidates = [
    () => req('playwright'),
    () => createRequire(path.join(process.cwd(), 'package.json'))('playwright'),
    () => createRequire(path.join(HOME_INSTALL, 'package.json'))('playwright'),
    () => { const g = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); return req(path.join(g, 'playwright')); },
  ];
  for (const c of candidates) { try { return c(); } catch { /* next */ } }
  return null;
}

async function setup() {
  console.error('Installing Playwright + Chromium into ' + HOME_INSTALL + ' (one time, ~1 min)…');
  fs.mkdirSync(HOME_INSTALL, { recursive: true });
  if (!fs.existsSync(path.join(HOME_INSTALL, 'package.json'))) fs.writeFileSync(path.join(HOME_INSTALL, 'package.json'), '{"name":"app-jury-browser","private":true}');
  execSync('npm install playwright@1.56.0 --no-audit --no-fund', { cwd: HOME_INSTALL, stdio: 'inherit' });
  execSync('npx playwright install chromium', { cwd: HOME_INSTALL, stdio: 'inherit' });
  console.error('Done.');
}

if (cmd === 'setup') { await setup(); process.exit(0); }
if (!['scan', 'run'].includes(cmd) || !args[1]) {
  console.error('Usage: jury-browser.mjs scan <url> | run <steps.json> | setup   (see header for flags)');
  process.exit(2);
}

let pw = await loadPlaywright();
if (!pw) { await setup(); pw = await loadPlaywright(); }
if (!pw) { console.error('Playwright not available. Run: node jury-browser.mjs setup'); process.exit(2); }

const mobile = flag('mobile');
const browser = await pw.chromium.launch({ headless: true }).catch(async (e) => {
  console.error('Chromium failed to launch (' + e.message.split('\n')[0] + '). Trying to install it…');
  await setup();
  return pw.chromium.launch({ headless: true });
});
const contextOpts = mobile
  ? { ...pw.devices['iPhone 14'], locale: 'cs-CZ' }
  : { viewport: { width: 1366, height: 900 }, locale: 'cs-CZ' };
if (opt('state') && fs.existsSync(opt('state'))) contextOpts.storageState = opt('state');
const video = flag('video');
if (video) contextOpts.recordVideo = { dir: path.join(outDir, 'video-raw'), size: { ...contextOpts.viewport } };
const context = await browser.newContext(contextOpts);
const page = await context.newPage();

// Slow mobile data (approx. "Slow 4G")
if (flag('slow')) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 200 * 1024 / 8 });
}

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => consoleErrors.push('Uncaught: ' + String(e.message).slice(0, 300)));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ url: r.url().slice(0, 200), status: r.status() }); });

const shot = async (name) => {
  const file = path.join(outDir, `${name}${mobile ? '-mobile' : ''}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
};

async function timings() {
  return page.evaluate(() => new Promise((res) => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    let lcp = null;
    try {
      new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) lcp = Math.round(e[e.length - 1].startTime); })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    setTimeout(() => res({
      domContentLoaded_ms: Math.round(nav.domContentLoadedEventEnd || 0),
      load_ms: Math.round(nav.loadEventEnd || 0),
      lcp_ms: lcp,
      transfer_kb: Math.round(performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
    }), 600);
  }));
}

async function controls() {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const txt = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().slice(0, 60);
    const pick = (sel, kind) => [...document.querySelectorAll(sel)].filter(vis).slice(0, 80).map((el) => {
      const r = el.getBoundingClientRect();
      return { kind, text: txt(el), tag: el.tagName.toLowerCase(), id: el.id || undefined, name: el.getAttribute('name') || undefined, href: el.getAttribute('href') || undefined, type: el.getAttribute('type') || undefined, w: Math.round(r.width), h: Math.round(r.height), small_tap_target: r.width < 44 || r.height < 44 };
    });
    return {
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()).slice(0, 5),
      buttons: pick('button, [role=button], input[type=submit]', 'button'),
      links: pick('a[href]', 'link'),
      inputs: pick('input:not([type=hidden]), textarea, select', 'input').map((i) => ({ ...i, has_label: !!(i.id && document.querySelector(`label[for="${i.id}"]`)) || !!i.text })),
      images_without_alt: [...document.images].filter((im) => vis(im) && !im.alt).length,
      text_sample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 800),
      horizontal_scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  });
}

async function openUrl(url, name) {
  const t0 = Date.now();
  let status = null, error = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    status = resp ? resp.status() : null;
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  } catch (e) { error = e.message.split('\n')[0]; }
  const wall_ms = Date.now() - t0;
  const r = { url, final_url: page.url(), status, error, wall_ms, timings: await timings().catch(() => null), page: await controls().catch(() => null), screenshot: await shot(name) };
  return r;
}

function findFfmpeg() {
  const tryCmd = (c) => { try { execSync(`"${c}" -version`, { stdio: 'ignore' }); return c; } catch { return null; } };
  if (tryCmd('ffmpeg')) return 'ffmpeg';
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright'), path.join(os.homedir(), 'AppData/Local/ms-playwright')].filter(Boolean);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((n) => n.startsWith('ffmpeg'))) {
      for (const bin of ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg-mac-arm64', 'ffmpeg-win64.exe', 'ffmpeg']) {
        const f = path.join(r, d, bin); if (fs.existsSync(f) && tryCmd(f)) return f;
      }
    }
  }
  return null;
}
function finalizeVideo(raw) {
  const base = path.join(outDir, `run${mobile ? '-mobile' : ''}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  const ff = findFfmpeg();
  if (ff) {
    try {
      execSync(`"${ff}" -y -loglevel error -i "${raw}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${base}.mp4"`, { stdio: 'ignore' });
      fs.rmSync(raw, { force: true }); try { fs.rmdirSync(path.dirname(raw)); } catch {}
      return base + '.mp4';
    } catch { /* fall through to webm */ }
  }
  fs.renameSync(raw, base + '.webm'); try { fs.rmdirSync(path.dirname(raw)); } catch {}
  return base + '.webm (opens in Chrome; install ffmpeg for .mp4)';
}

const result = { command: cmd, mobile, slow: flag('slow'), video: null, started: new Date().toISOString() };

try {
  if (cmd === 'scan') {
    const url = args[1];
    const main = await openUrl(url, 'scan-home');
    result.main = main;
    const crawlN = parseInt(opt('crawl', '0'), 10);
    if (crawlN > 0 && main.page) {
      const origin = new URL(page.url()).origin;
      const seen = new Set([page.url().split('#')[0]]);
      const queue = (main.page.links || []).map((l) => { try { return new URL(l.href, page.url()).href.split('#')[0]; } catch { return null; } })
        .filter((h) => h && h.startsWith(origin) && !seen.has(h));
      result.crawl = [];
      for (const href of queue.slice(0, crawlN)) {
        if (seen.has(href)) continue; seen.add(href);
        const r = await openUrl(href, 'crawl-' + result.crawl.length);
        result.crawl.push({ url: href, status: r.status, error: r.error, wall_ms: r.wall_ms, title: r.page?.title, console_errors_so_far: consoleErrors.length });
      }
    }
  } else {
    const steps = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    result.steps = [];
    let i = 0;
    for (const s of steps) {
      i++;
      const rec = { n: i, step: s, ok: true };
      const t0 = Date.now();
      try {
        // Selectors: CSS/text= selectors are used as-is; plain words match the way a user sees them
        // (button/link text, label, placeholder). "kind" decides what to look for first.
        const isCss = (sel) => /^(text=|#|\.|\[|xpath=|\/\/)/.test(sel) || sel.includes('>>');
        const loc = async (sel, kind) => {
          if (isCss(sel)) return page.locator(sel).first();
          const cands = kind === 'input'
            ? [page.getByLabel(sel, { exact: true }), page.getByPlaceholder(sel, { exact: true }), page.getByLabel(sel), page.getByPlaceholder(sel), page.getByRole('textbox', { name: sel }), page.getByRole('combobox', { name: sel }), page.getByRole('checkbox', { name: sel })]
            : [page.getByRole('button', { name: sel, exact: true }), page.getByRole('link', { name: sel, exact: true }), page.getByRole('button', { name: sel }), page.getByRole('link', { name: sel }), page.getByRole('menuitem', { name: sel }), page.getByRole('tab', { name: sel }), page.getByLabel(sel), page.getByText(sel, { exact: true }), page.getByText(sel)];
          for (const c of cands) { if (await c.count() > 0) return c.first(); }
          throw new Error(`Nothing on the page matches "${sel}"`);
        };
        if (s.goto) { const r = await openUrl(s.goto, `step${i}`); rec.status = r.status; rec.error = r.error; if (r.error) rec.ok = false; }
        else if (s.click) { await (await loc(s.click, 'click')).click({ timeout: s.timeout || 8000 }); await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}); }
        else if (s.dblclick) { await (await loc(s.dblclick, 'click')).dblclick({ timeout: s.timeout || 8000 }); }
        else if (s.fill !== undefined) { await (await loc(s.fill, 'input')).fill(String(s.value ?? ''), { timeout: s.timeout || 8000 }); }
        else if (s.select) { await (await loc(s.select, 'input')).selectOption(String(s.value ?? ''), { timeout: s.timeout || 8000 }); }
        else if (s.press) { await page.keyboard.press(s.press); }
        else if (s.wait) { await page.waitForTimeout(Number(s.wait)); }
        else if (s.expect_text) { await page.getByText(s.expect_text, { exact: false }).first().waitFor({ timeout: s.timeout || 8000 }); }
        else if (s.expect_no_text) { const n = await page.getByText(s.expect_no_text, { exact: false }).count(); if (n > 0) throw new Error(`"${s.expect_no_text}" is still on the page`); }
        else if (s.expect_url) { if (!page.url().includes(s.expect_url)) throw new Error(`URL is ${page.url()}`); }
        else if (s.offline !== undefined) { await context.setOffline(!!s.offline); }
        else if (s.reload) { await page.reload({ waitUntil: 'load' }); }
        else if (s.back) { await page.goBack({ waitUntil: 'load' }).catch(() => {}); }
        else if (s.viewport) { await page.setViewportSize(s.viewport); }
        else if (s.eval) { rec.value = await page.evaluate(s.eval); }
        else if (s.screenshot) { rec.screenshot = await shot(String(s.screenshot)); }
        else if (s.note) { /* just a comment */ }
        else throw new Error('Unknown step: ' + JSON.stringify(s));
      } catch (e) {
        rec.ok = false; rec.error = e.message.split('\n')[0].slice(0, 300);
        rec.screenshot = await shot(`step${i}-failed`);
      }
      rec.ms = Date.now() - t0;
      rec.url = page.url();
      result.steps.push(rec);
      if (!rec.ok && s.stop_on_fail !== false && s.required !== false) { result.stopped_at = i; break; }
    }
    result.passed = result.steps.filter((r) => r.ok).length;
    result.failed = result.steps.filter((r) => !r.ok).length;
    if (opt('save-state')) await context.storageState({ path: opt('save-state') });
  }
} catch (e) {
  result.fatal = e.message.split('\n')[0];
}

result.console_errors = [...new Set(consoleErrors)].slice(0, 40);
result.failed_requests = failedRequests.slice(0, 40);
result.finished = new Date().toISOString();
let rawVideo = null;
if (video) { try { rawVideo = await page.video().path(); } catch {} }
await context.close();
await browser.close();
if (video && rawVideo && fs.existsSync(rawVideo)) result.video = finalizeVideo(rawVideo);
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
