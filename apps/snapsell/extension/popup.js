const $ = (id) => document.getElementById(id);
const NAMES = { facebook: "Facebook Marketplace", vinted: "Vinted" };

async function render() {
  const { server, token, status = {} } = await chrome.storage.local.get(["server", "token", "status"]);
  const paired = Boolean(server && token);
  $("pair").hidden = paired;
  $("main").hidden = !paired;
  $("badge").hidden = !paired;
  if (!paired) {
    $("who").textContent = "Not connected";
    return;
  }
  $("who").textContent = status.user?.email ?? server;
  $("badge").classList.toggle("off", !status.online);
  $("badgeText").textContent = status.online ? "Online" : "Offline";
  $("error").hidden = !status.error;
  $("error").textContent = status.error ? `Can't reach SnapSell: ${status.error}` : "";

  const sites = status.sites ?? {};
  $("fb").classList.toggle("on", !!sites.facebook);
  $("vi").classList.toggle("on", !!sites.vinted);
  $("loginHint").hidden = !!(sites.facebook && sites.vinted);

  const cur = status.current;
  $("idle").hidden = !!cur;
  $("job").hidden = !cur;
  if (cur) {
    $("jobTitle").textContent = cur.title;
    $("jobWhere").textContent = `to ${NAMES[cur.platform]} · ${cur.price} ${cur.currency}`;
    $("jobMsg").textContent = cur.message ?? "";
  }
}

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
    render();
  }
});

$("unpair").addEventListener("click", async () => {
  await chrome.storage.local.remove(["server", "token", "status"]);
  render();
});

$("fb").addEventListener("click", () => chrome.tabs.create({ url: "https://www.facebook.com/marketplace" }));
$("vi").addEventListener("click", async () => {
  const { status } = await chrome.storage.local.get("status");
  chrome.tabs.create({ url: `https://${status?.user?.vintedDomain ?? "www.vinted.com"}/` });
});

chrome.storage.onChanged.addListener(render);
render();
chrome.runtime.sendMessage({ type: "poll-now" }).catch(() => {});
