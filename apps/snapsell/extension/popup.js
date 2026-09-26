const $ = (id) => document.getElementById(id);
const NAMES = { facebook: "Facebook Marketplace", vinted: "Vinted" };

async function siteLogins() {
  const fb = await chrome.cookies.get({ url: "https://www.facebook.com", name: "c_user" });
  const vi = await chrome.cookies.getAll({ name: "access_token_web" });
  return { facebook: Boolean(fb), vinted: vi.some((c) => c.domain.includes("vinted")) };
}

async function render() {
  const { server, token, status = {}, allowed = [], pendingOrigin } = await chrome.storage.local.get([
    "server",
    "token",
    "status",
    "allowed",
    "pendingOrigin",
  ]);
  const paired = Boolean(server && token);

  // A no-server SnapSell page asked to use this Chrome.
  const pending = pendingOrigin && !allowed.includes(pendingOrigin) ? pendingOrigin : null;
  $("allow").hidden = !pending;
  $("allowOrigin").textContent = pending ?? "";

  $("allowedList").textContent = allowed.length ? allowed.join(", ") : "None yet. Open your SnapSell page and allow it here.";
  $("pairBox").hidden = paired;
  $("paired").hidden = !paired;
  $("pairedTo").textContent = paired ? `Server: ${server}` : "";

  $("badge").hidden = !paired;
  $("badge").classList.toggle("off", !status.online);
  $("badgeText").textContent = status.online ? "Online" : "Offline";
  $("who").textContent = status.user?.email ?? (allowed.length ? "Ready for your SnapSell page" : "Ready");
  $("error").hidden = !(paired && status.error);
  $("error").textContent = status.error ? `Can't reach the SnapSell server: ${status.error}` : "";

  const sites = await siteLogins();
  $("fb").classList.toggle("on", sites.facebook);
  $("vi").classList.toggle("on", sites.vinted);

  const cur = status.current;
  $("idle").hidden = !!cur;
  $("job").hidden = !cur;
  if (cur) {
    $("jobTitle").textContent = cur.title;
    $("jobWhere").textContent = `to ${NAMES[cur.platform]} · ${cur.price} ${cur.currency}`;
    $("jobMsg").textContent = cur.message ?? "";
  }
}

$("allowYes").addEventListener("click", async () => {
  const { allowed = [], pendingOrigin } = await chrome.storage.local.get(["allowed", "pendingOrigin"]);
  if (pendingOrigin && !allowed.includes(pendingOrigin)) allowed.push(pendingOrigin);
  await chrome.storage.local.set({ allowed, pendingOrigin: null });
});
$("allowNo").addEventListener("click", () => chrome.storage.local.set({ pendingOrigin: null }));

$("connect").addEventListener("click", async () => {
  const server = $("server").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  $("pairError").hidden = true;
  if (!/^https?:\/\//.test(server) || !token.startsWith("ss_")) {
    $("pairError").textContent = "Paste the address and the pairing code from SnapSell → Connections.";
    $("pairError").hidden = false;
    return;
  }
  $("connect").disabled = true;
  try {
    const res = await fetch(`${server}/api/ext/ping`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sites: {} }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    await chrome.storage.local.set({ server, token });
    await chrome.runtime.sendMessage({ type: "poll-now" });
  } catch (e) {
    $("pairError").textContent = `Couldn't connect: ${e.message}`;
    $("pairError").hidden = false;
  } finally {
    $("connect").disabled = false;
  }
});

$("unpair").addEventListener("click", () => chrome.storage.local.remove(["server", "token", "status"]));
$("fb").addEventListener("click", () => chrome.tabs.create({ url: "https://www.facebook.com/marketplace" }));
$("vi").addEventListener("click", async () => {
  const { status } = await chrome.storage.local.get("status");
  chrome.tabs.create({ url: `https://${status?.user?.vintedDomain ?? "www.vinted.com"}/` });
});

chrome.storage.onChanged.addListener(render);
render();
chrome.runtime.sendMessage({ type: "poll-now" }).catch(() => {});
