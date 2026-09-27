// ==UserScript==
// @name         SnapSell Vinted bot
// @namespace    snapsell
// @version      1.0.0
// @description  Fills in and uploads your SnapSell listing on Vinted, in your own Safari.
// @match        https://www.vinted.cz/*
// @match        https://www.vinted.sk/*
// @match        https://www.vinted.pl/*
// @match        https://www.vinted.de/*
// @match        https://www.vinted.at/*
// @match        https://www.vinted.fr/*
// @match        https://www.vinted.be/*
// @match        https://www.vinted.nl/*
// @match        https://www.vinted.lu/*
// @match        https://www.vinted.it/*
// @match        https://www.vinted.es/*
// @match        https://www.vinted.pt/*
// @match        https://www.vinted.co.uk/*
// @match        https://www.vinted.ie/*
// @match        https://www.vinted.lt/*
// @match        https://www.vinted.hu/*
// @match        https://www.vinted.ro/*
// @match        https://www.vinted.hr/*
// @match        https://www.vinted.gr/*
// @match        https://www.vinted.se/*
// @match        https://www.vinted.fi/*
// @match        https://www.vinted.dk/*
// @match        https://www.vinted.com/*
// @run-at       document-start
// @inject-into  content
// ==/UserScript==

// SnapSell opens Vinted's sell page with the listing packed into the link (#snapsell=…). The link's
// # part never leaves the phone, so nothing is sent anywhere but to Vinted itself, by this script.
(() => {
  const KEY = "snapsell-job";
  const m = /[#&]snapsell=([^&]+)/.exec(location.hash);
  if (m) {
    // Keep the job for this tab (it survives a detour through Vinted's login) and tidy the address bar.
    try {
      sessionStorage.setItem(KEY, decodeURIComponent(m[1]));
    } catch {
      // Too big for this tab's storage: still usable for this page load.
      window.__snapsellJob = decodeURIComponent(m[1]);
    }
    history.replaceState(null, "", location.pathname + location.search);
  }
  const raw = window.__snapsellJob || sessionStorage.getItem(KEY);
  // Started from the SnapSell bookmark instead of the Userscripts app: say something when there's nothing to do.
  const fromBookmark = window.__snapsellBookmark === true;
  if (!raw) {
    if (fromBookmark) alert("SnapSell: no listing here. In SnapSell tap \u201cPost on Vinted\u201d first, then tap this bookmark on the Vinted page.");
    return;
  }
  if (window.__snapsellBotRunning) return;
  window.__snapsellBotRunning = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = (min = 300, max = 800) => sleep(min + Math.random() * (max - min));
  async function waitFor(fn, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  }
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

  // React ignores plain .value writes: use the native setter and fire the events it listens to.
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function type(el, text) {
    el.focus();
    el.click();
    await pause(150, 300);
    setValue(el, "");
    let acc = "";
    for (const ch of text.slice(0, 24)) {
      acc += ch;
      setValue(el, acc);
      await sleep(20 + Math.random() * 40);
    }
    if (text.length > 24) setValue(el, text);
    el.blur();
    await pause();
  }
  function upload(input, photos) {
    const dt = new DataTransfer();
    photos.forEach((b64, i) => {
      const bytes = Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], `photo-${i + 1}.jpg`, { type: "image/jpeg" }));
    });
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // A small status bar at the top of Vinted, so you can see what the bot is doing.
  let bar;
  function say(text, tone = "work") {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.style.cssText =
        "position:fixed;left:10px;right:10px;top:10px;z-index:2147483647;padding:12px 14px;border-radius:14px;font:600 15px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)";
      document.body.append(bar);
    }
    const colors = { work: ["#17150f", "#fff"], ok: ["#1e6b45", "#fff"], stop: ["#fdf0d5", "#7a4b00"] };
    [bar.style.background, bar.style.color] = colors[tone];
    bar.textContent = `SnapSell bot: ${text}`;
  }

  // Vinted's condition list order: New with tags, New without tags, Very good, Good, Satisfactory.
  const CONDITION_INDEX = { new: 0, like_new: 2, good: 3, fair: 4, poor: 4 };

  async function searchSelect(openId, searchIds, text) {
    const open = byTestId(openId);
    if (!open || !text) return false;
    open.click();
    await pause(500, 900);
    const search = await waitFor(
      () => searchIds.map(byTestId).find(Boolean) || [...document.querySelectorAll('input[type="search"]')].find(visible),
      3000,
    );
    if (!search) return false;
    await type(search, text);
    await sleep(1200);
    const hit = await waitFor(
      () => [...document.querySelectorAll('[role="option"], [data-testid*="dropdown-row"], [data-testid^="catalog-search"]')].find(visible),
      3000,
    );
    if (!hit) return false;
    hit.click();
    await pause();
    return true;
  }

  async function run(job) {
    // Not on the sell page yet (e.g. Vinted asked to log in first): wait until it brings us there.
    if (!/\/items\/new/.test(location.pathname)) {
      say("log in to Vinted and open Sell. I'll carry on from there.", "stop");
      if (!(await waitFor(() => /\/items\/new/.test(location.pathname), 10 * 60 * 1000))) return;
      await sleep(1500);
    }
    sessionStorage.removeItem(KEY);
    const todo = [];

    say("adding photos…");
    const input = await waitFor(() => document.querySelector('input[type="file"]'), 20000);
    if (!input) return say("couldn't find Vinted's photo upload. Add the photos yourself.", "stop");
    upload(input, job.photos.slice(0, 20));
    await sleep(2500);

    say("writing title and description…");
    const title = await waitFor(() => byTestId("title--input") || document.querySelector('input[name="title"]'), 10000);
    if (title) await type(title, job.title.slice(0, 100));
    else todo.push("title");
    const desc = byTestId("description--input") || document.querySelector('textarea[name="description"]');
    if (desc) await type(desc, job.description);
    else todo.push("description");

    say("choosing category, brand and condition…");
    if (!(await searchSelect("catalog-select-dropdown-input", ["catalog-select-dropdown-search-input"], job.category))) todo.push("category");
    if (job.brand) await searchSelect("brand-select-dropdown-input", ["brand-search--input", "brand-select-dropdown-search-input"], job.brand);
    if (job.size && byTestId("size-select-dropdown-input")) {
      if (!(await searchSelect("size-select-dropdown-input", ["size-select-dropdown-search-input"], job.size))) todo.push("size");
    }
    const cond = byTestId("status-select-dropdown-input");
    if (cond) {
      cond.click();
      await pause(500, 900);
      const rows = [...document.querySelectorAll('[data-testid^="status-select-dropdown-row"], [role="option"]')].filter(visible);
      const row = rows[CONDITION_INDEX[job.condition] ?? 3];
      if (row) row.click();
      else todo.push("condition");
      await pause();
    } else todo.push("condition");

    say("setting the price…");
    const price = byTestId("price-input--input") || document.querySelector('input[name="price"]');
    if (price) await type(price, String(job.price));
    else todo.push("price");

    // Parcel size: take the smallest option if Vinted asks and nothing is picked yet.
    const parcel = [...document.querySelectorAll('[data-testid*="package-size"] input[type="radio"], input[name*="package"][type="radio"]')];
    if (parcel.length && !parcel.some((r) => r.checked)) {
      parcel[0].click();
      await pause();
    }

    const missing = todo.length ? ` Please add: ${todo.join(", ")}.` : "";
    if (!job.autoPublish || todo.length) {
      return say(`all filled in. Check it and tap Upload.${missing}`, "stop");
    }

    say("uploading…");
    const save = byTestId("upload-form-save-button") || [...document.querySelectorAll('button[type="submit"]')].find(visible);
    if (!save) return say("couldn't find the Upload button. Tap it yourself.", "stop");
    save.click();
    const done = await waitFor(() => /\/items\/\d+/.test(location.pathname), 30000);
    if (!done) return say("Vinted wants something more (maybe size or parcel size). Fix it and tap Upload.", "stop");
    say("posted on Vinted ✓", "ok");
  }

  let job;
  try {
    job = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(KEY);
    return;
  }
  const start = () => run(job).catch((e) => say(`stopped: ${e?.message || e}`, "stop"));
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
