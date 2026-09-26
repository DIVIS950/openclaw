// SnapSell for Chrome: background worker.
// Every 30 s it tells your SnapSell server it's online (plus whether you're logged in to
// Facebook / Vinted here) and picks up the next listing to post. Posting happens in a normal
// Chrome tab, using your own session, by the content scripts in content/.

const POLL_MINUTES = 0.5;
const JOB_TIMEOUT_MS = 5 * 60_000;

async function config() {
  return chrome.storage.local.get(["server", "token", "busy", "busySince"]);
}

async function api(path, body) {
  const { server, token } = await config();
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Are you logged in to each site in this Chrome? Checked via the sites' session cookies. */
async function siteLogins() {
  const fb = await chrome.cookies.get({ url: "https://www.facebook.com", name: "c_user" });
  const vintedCookies = await chrome.cookies.getAll({ name: "access_token_web" });
  return { facebook: Boolean(fb), vinted: vintedCookies.some((c) => c.domain.includes("vinted")) };
}

async function setStatus(patch) {
  const { status = {} } = await chrome.storage.local.get("status");
  await chrome.storage.local.set({ status: { ...status, ...patch } });
}

async function poll() {
  const { server, token, busy, busySince } = await config();
  if (!server || !token) return;
  // Recover from a job that never reported back (tab closed, Chrome restarted).
  if (busy && Date.now() - (busySince ?? 0) < JOB_TIMEOUT_MS) return;
  const sites = await siteLogins();
  try {
    const { job, user } = await api("/api/ext/ping", { sites });
    await setStatus({ online: true, error: null, sites, user, lastPing: Date.now() });
    if (job) await runJob(job);
  } catch (e) {
    await setStatus({ online: false, error: String(e.message || e), sites, lastPing: Date.now() });
  }
}

async function report(job, status, message, url) {
  await setStatus({ current: status === "working" ? { ...summary(job), message } : null });
  await api(`/api/ext/jobs/${job.listingId}/${job.platform}`, { status, message, url }).catch(() => {});
}

function summary(job) {
  return { title: job.title, platform: job.platform, price: job.price, currency: job.currency, photo: job.photos[0] };
}

/** Download the listing's photos (the content script can't reach your server itself). */
async function fetchPhotos(job) {
  const { token } = await config();
  const out = [];
  for (const [i, url] of job.photos.entries()) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Couldn't download photo ${i + 1}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let j = 0; j < buf.length; j += 0x8000) bin += String.fromCharCode(...buf.subarray(j, j + 0x8000));
    out.push({ name: `photo-${i + 1}.jpg`, type: res.headers.get("content-type") || "image/jpeg", data: btoa(bin) });
  }
  return out;
}

function waitForTab(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function runJob(job) {
  await chrome.storage.local.set({ busy: true, busySince: Date.now() });
  let tabId;
  try {
    await report(job, "working", "Downloading photos");
    const photos = await fetchPhotos(job);
    const url =
      job.platform === "facebook"
        ? "https://www.facebook.com/marketplace/create/item"
        : `https://${job.vintedDomain}/items/new`;
    await report(job, "working", `Opening ${job.platform === "facebook" ? "Marketplace" : "Vinted"}`);
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    await waitForTab(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/common.js", `content/${job.platform}.js`] });

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ status: "error", message: "Took too long. Check the open tab." }), JOB_TIMEOUT_MS);
      const done = (r) => {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        chrome.tabs.onUpdated.removeListener(navListener);
        resolve(r);
      };
      const listener = (msg, sender) => {
        if (sender.tab?.id !== tabId) return;
        if (msg.type === "progress") void report(job, "working", msg.message);
        if (msg.type === "result") done(msg);
      };
      // A full page load after publishing kills the content script before it can report,
      // so leaving the create page after an auto-publish also counts as success.
      const navListener = (id, info) => {
        if (id !== tabId || !info.url || !job.autoPublish) return;
        const path = new URL(info.url).pathname;
        if (job.platform === "facebook" && !path.includes("/create/")) done({ status: "live", message: "Posted on Facebook Marketplace", url: "https://www.facebook.com/marketplace/you/selling" });
        if (job.platform === "vinted" && /\/items\/\d+/.test(path)) done({ status: "live", message: "Posted on Vinted", url: info.url });
      };
      chrome.runtime.onMessage.addListener(listener);
      chrome.tabs.onUpdated.addListener(navListener);
      chrome.tabs.sendMessage(tabId, { type: "fill", job, photos });
    });

    // Leave the filled-in form in front of you when it's waiting for your final click.
    if (result.status === "needs_review" || result.status === "error") {
      const t = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
    }
    await report(job, result.status, result.message, result.url);
  } catch (e) {
    await report(job, "error", String(e.message || e));
  } finally {
    await chrome.storage.local.set({ busy: false, busySince: 0 });
  }
}

chrome.alarms.create("poll", { periodInMinutes: POLL_MINUTES });
chrome.alarms.onAlarm.addListener((a) => a.name === "poll" && poll());
chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "poll-now") {
    poll().then(() => sendResponse({ ok: true }));
    return true;
  }
});
