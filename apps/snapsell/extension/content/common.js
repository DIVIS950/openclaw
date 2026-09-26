// Shared helpers for filling marketplace forms like a person would.
// Loaded into the marketplace tab right before the site-specific script.
(() => {
  if (window.snapsell) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = (min = 300, max = 800) => sleep(min + Math.random() * (max - min));

  /** Polls until fn() returns something truthy (or times out → null). */
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

  /** React/Vue ignore plain .value writes; use the native setter and fire the events they listen to. */
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
    // Type the first characters one by one, then set the rest at once.
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

  /** Put photos (base64 from the background worker) into a file input. */
  function upload(input, photos) {
    const dt = new DataTransfer();
    for (const p of photos) {
      const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], p.name, { type: p.type }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** Finds a text field whose visible label, aria-label or placeholder matches. */
  function fieldByLabel(re) {
    const fields = [...document.querySelectorAll("input, textarea")].filter(visible);
    for (const f of fields) {
      const names = [
        f.getAttribute("aria-label"),
        f.getAttribute("placeholder"),
        f.closest("label")?.innerText?.split("\n")[0],
        ...(f.getAttribute("aria-labelledby") || "")
          .split(" ")
          .map((id) => id && document.getElementById(id)?.innerText),
      ].filter(Boolean);
      if (names.some((n) => re.test(n.trim()))) return f;
    }
    return null;
  }

  /** Finds a clickable element (button, link, combobox…) by its visible text or aria-label. */
  function clickableByText(re, root = document) {
    const els = [...root.querySelectorAll('button, [role="button"], [role="combobox"], label, a, [role="option"], [role="menuitem"], li')];
    return els.find((el) => visible(el) && (re.test((el.getAttribute("aria-label") || "").trim()) || re.test((el.innerText || "").trim().split("\n")[0])));
  }

  const progress = (message) => chrome.runtime.sendMessage({ type: "progress", message });
  const result = (status, message, url) => chrome.runtime.sendMessage({ type: "result", status, message, url });

  /** Registers the site's fill(job, photos) routine for the background worker's message. */
  function onFill(fill) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type !== "fill") return;
      fill(msg.job, msg.photos).catch((e) => result("error", String(e?.message || e)));
    });
  }

  window.snapsell = { sleep, pause, waitFor, visible, setValue, type, upload, fieldByLabel, clickableByText, progress, result, onFill };
})();
