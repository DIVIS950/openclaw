// Bridge between the no-server SnapSell page (e.g. you.github.io/…) and this extension.
// The page posts listings here; only pages you allowed in the extension popup are served.
(() => {
  if (window.snapsellBridge) return;
  window.snapsellBridge = true;
  const toPage = (msg) => window.postMessage({ snapsell: "ext", ...msg }, location.origin);

  window.addEventListener("message", async (e) => {
    const m = e.data;
    if (e.source !== window || m?.snapsell !== "page") return;
    if (m.type === "hello") {
      const r = await chrome.runtime.sendMessage({ type: "bridge-hello", origin: location.origin });
      toPage({ type: "hello", allowed: r.allowed, sites: r.sites });
    }
    if (m.type === "job") {
      const r = await chrome.runtime.sendMessage({ type: "direct-job", origin: location.origin, job: m.job, photos: m.photos });
      if (!r.ok) toPage({ type: "update", listingId: m.job.listingId, platform: m.job.platform, status: "error", message: r.error });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "job-update") toPage({ type: "update", ...msg.update });
  });
})();
