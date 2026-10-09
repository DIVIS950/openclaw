const $ = (sel) => document.querySelector(sel);
const SPINNER = '<svg class="spinner" viewBox="0 0 24 24"><path d="M12 2l1.6 6.1L19 4.6l-3.5 5.4L22 12l-6.5 2 3.5 5.4-5.4-3.5L12 22l-1.6-6.1L5 19.4l3.5-5.4L2 12l6.5-2L5 4.6l5.4 3.5z"/></svg>';

let config = { trading: { enabled: false, maxUsd: 0 } };
fetch("/api/config").then((r) => r.json()).then((c) => (config = c)).catch(() => {});

// Everything from the network is escaped before it touches innerHTML.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? "") ? esc(u) : "#");

function fmtMoney(n, currency = "USD") {
  if (n == null || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const opts = { style: "currency", currency, maximumFractionDigits: 2 };
  if (abs >= 1e12) return new Intl.NumberFormat("en", opts).format(n / 1e12) + "T";
  if (abs >= 1e9) return new Intl.NumberFormat("en", opts).format(n / 1e9) + "B";
  if (abs >= 1e6) return new Intl.NumberFormat("en", opts).format(n / 1e6) + "M";
  return new Intl.NumberFormat("en", opts).format(n);
}
const fmtPct = (n, ratio = false) => (n == null || !Number.isFinite(n) ? "–" : `${(ratio ? n * 100 : n).toFixed(1)}%`);
const fmtNum = (n) => (n == null || !Number.isFinite(n) ? "–" : n.toFixed(1));

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setStatus(el, html, isError = false) {
  el.hidden = !html;
  el.classList.toggle("error", isError);
  el.innerHTML = html || "";
}

// Tabs
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `tab-${tab.dataset.tab}`));
  }),
);

// ---------- Analyze ----------
const results = $("#results");
const statusEl = $("#status");
let lastQuery = "";

$("#examples").addEventListener("click", (e) => {
  if (e.target.matches(".chip")) {
    $("#query").value = e.target.textContent;
    analyze(e.target.textContent);
  }
});
$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  analyze($("#query").value.trim());
});

async function analyze(query, symbol) {
  if (!query) return;
  lastQuery = query;
  const btn = $("#search .send");
  btn.disabled = true;
  results.innerHTML = "";
  const steps = ["Finding the stock", "Reading the numbers and news", "Checking Polymarket odds", "Claude is thinking it through"];
  let i = 0;
  setStatus(statusEl, `${SPINNER}<span>${steps[0]}…</span>`);
  const timer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    setStatus(statusEl, `${SPINNER}<span>${steps[i]}…</span>`);
  }, 4000);
  try {
    const data = await api("/api/analyze", { query, symbol });
    setStatus(statusEl, "");
    render(data);
  } catch (err) {
    setStatus(statusEl, esc(err.message), true);
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
}

function sparkline(history) {
  if (history.length < 2) return "";
  const w = 800, h = 110, pad = 4;
  const closes = history.map((p) => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const x = (i) => (i / (closes.length - 1)) * w;
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = closes.at(-1) >= closes[0];
  const color = up ? "var(--good)" : "var(--bad)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="1 year price chart">
    <path d="${line}L${w},${h}L0,${h}Z" fill="${color}" opacity=".08"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="muted small" style="display:flex;justify-content:space-between"><span>${esc(history[0].date)}</span><span>1 year</span><span>${esc(history.at(-1).date)}</span></div>`;
}

const list = (items) => `<ul class="list">${(items ?? []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
const paragraphs = (text) => String(text ?? "").split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("");

function render({ resolved, stock, markets, analysis, message }) {
  const others = (resolved?.tickers ?? []).filter((t) => t.symbol !== stock?.symbol);
  let html = "";

  if (resolved?.note || others.length) {
    html += `<div class="card"><p class="muted" style="margin:0">${esc(resolved.note || `Stocks linked to ${resolved.entityName}:`)}</p>
      ${others.length ? `<div class="chips" style="justify-content:flex-start">${others.map((t) => `<button class="chip" data-symbol="${esc(t.symbol)}" title="${esc(t.relation)}">${esc(t.symbol)} · ${esc(t.name)}</button>`).join("")}</div>` : ""}</div>`;
  }
  if (!stock) {
    results.innerHTML = html + `<div class="card"><p>${esc(message)}</p></div>`;
    bindTickerChips();
    return;
  }

  const up = (stock.changePercent ?? 0) >= 0;
  const f = stock.financials, v = stock.valuation;
  html += `<div class="card">
    <div class="stock-head">
      <div><div class="ticker">${esc(stock.symbol)} · ${esc(stock.exchange)}</div><h2 style="margin:2px 0 0">${esc(stock.name)}</h2>
        <div class="muted small">${esc([stock.profile.sector, stock.profile.industry].filter(Boolean).join(" · "))}</div></div>
      <div style="text-align:right"><div class="price">${fmtMoney(stock.price, stock.currency)}</div>
        <div class="change ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${fmtPct(Math.abs(stock.changePercent ?? NaN))} today · ${fmtPct(stock.oneYearReturnPercent)} 1y</div></div>
    </div>
    ${sparkline(stock.history)}
    <div class="stats">
      ${stat("Market cap", fmtMoney(stock.marketCap, stock.currency))}
      ${stat("P/E (trailing)", fmtNum(v.trailingPE))}
      ${stat("P/E (forward)", fmtNum(v.forwardPE))}
      ${stat("Revenue growth", fmtPct(f.revenueGrowth, true))}
      ${stat("Profit margin", fmtPct(f.profitMargins, true))}
      ${stat("Dividend yield", fmtPct(v.dividendYield, true))}
      ${stat("52w range", `${fmtMoney(stock.fiftyTwoWeekLow, stock.currency)} – ${fmtMoney(stock.fiftyTwoWeekHigh, stock.currency)}`)}
      ${stat("Analyst target", fmtMoney(f.targetMeanPrice, stock.currency))}
    </div></div>`;

  if (analysis) {
    html += `<div class="card">
      <div class="verdict"><span class="badge ${esc(analysis.verdict)}">${esc(analysis.verdict)}</span>
        <span class="muted small">Confidence: ${esc(analysis.confidence)}</span></div>
      <div class="headline">${esc(analysis.headline)}</div>
      ${paragraphs(analysis.plainExplanation)}
      <p class="muted small"><strong>Who it fits:</strong> ${esc(analysis.whoIsItFor)}</p></div>
    <div class="two">
      <div class="card bull"><h3>Reasons to be bullish</h3>${list(analysis.bullCase)}</div>
      <div class="card bear"><h3>Reasons to be careful</h3>${list(analysis.bearCase)}</div>
    </div>
    <div class="card"><h3>Valuation</h3><p>${esc(analysis.valuationTake)}</p><h3>Key risks</h3>${list(analysis.keyRisks)}</div>
    <div class="card"><h3>Tips</h3>${list(analysis.tips)}</div>`;
  }

  html += `<div class="card"><h3>Polymarket odds</h3>${analysis ? `<p>${esc(analysis.polymarketTake)}</p>` : ""}
    ${markets.length ? markets.map(marketHtml).join("") : `<p class="muted">No open prediction markets found.</p>`}</div>`;

  if (stock.news.length) {
    html += `<div class="card"><h3>Recent news</h3><ul class="list">${stock.news
      .map((n) => `<li><a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted small">${esc(n.publisher)}</span></li>`)
      .join("")}</ul></div>`;
  }
  if (analysis) html += `<p class="disclaimer">${esc(analysis.disclaimer)}</p>`;

  results.innerHTML = html;
  bindTickerChips();
  results.querySelectorAll("[data-trade]").forEach((b) => b.addEventListener("click", () => openTrade(markets[Number(b.dataset.trade)])));
}

const stat = (label, value) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;

function marketHtml(m, idx) {
  const tradable = config.trading?.enabled && m.outcomes.some((o) => o.tokenId);
  return `<div class="market">
    <div class="market-q"><div>${m.url ? `<a href="${safeUrl(m.url)}" target="_blank" rel="noopener">${esc(m.question)}</a>` : esc(m.question)}
      <div class="muted small">Volume ${fmtMoney(m.volume)}${m.endDate ? ` · ends ${esc(m.endDate.slice(0, 10))}` : ""}</div></div>
      ${tradable ? `<button class="ghost sm" data-trade="${idx}">Trade</button>` : ""}</div>
    ${m.outcomes.map((o) => {
      const pct = o.probability == null ? null : Math.round(o.probability * 100);
      return `<div class="outcome"><span>${esc(o.name)}</span><div class="bar"><i style="width:${pct ?? 0}%"></i></div><strong>${pct == null ? "–" : pct + "%"}</strong></div>`;
    }).join("")}</div>`;
}

function bindTickerChips() {
  results.querySelectorAll("[data-symbol]").forEach((b) => b.addEventListener("click", () => analyze(lastQuery, b.dataset.symbol)));
}

// ---------- Trading ----------
const dialog = $("#trade-dialog");
const tradeForm = $("#trade-form");

function openTrade(market) {
  $("#trade-question").textContent = market.question;
  const sel = $("#trade-outcome");
  sel.innerHTML = market.outcomes.filter((o) => o.tokenId)
    .map((o) => `<option value="${esc(o.tokenId)}" data-price="${o.probability ?? ""}">${esc(o.name)} (${o.probability == null ? "–" : Math.round(o.probability * 100) + "¢"})</option>`)
    .join("");
  tradeForm.reset();
  tradeForm.price.value = sel.selectedOptions[0]?.dataset.price || "";
  $("#trade-limit").textContent = `(limit $${config.trading.maxUsd})`;
  $("#trade-error").hidden = true;
  updateCost();
  dialog.showModal();
}
$("#trade-outcome").addEventListener("change", (e) => {
  tradeForm.price.value = e.target.selectedOptions[0]?.dataset.price || "";
  updateCost();
});
tradeForm.addEventListener("input", updateCost);
function updateCost() {
  const cost = Number(tradeForm.price.value) * Number(tradeForm.size.value);
  $("#trade-cost").textContent = Number.isFinite(cost) ? `$${cost.toFixed(2)}` : "$0.00";
}
tradeForm.addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "submit") return;
  e.preventDefault();
  const btn = $("#trade-submit");
  btn.disabled = true;
  $("#trade-error").hidden = true;
  try {
    const r = await api("/api/trade", {
      tokenId: tradeForm.tokenId.value,
      side: tradeForm.side.value,
      price: Number(tradeForm.price.value),
      size: Number(tradeForm.size.value),
      confirm: tradeForm.confirm.checked,
    });
    dialog.close();
    alert(`Order ${r.status}. ID: ${r.orderId ?? "n/a"} · cost $${r.cost.toFixed(2)}`);
  } catch (err) {
    $("#trade-error").textContent = err.message;
    $("#trade-error").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Ideas ----------
$("#ideas-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  const out = $("#ideas-out");
  btn.disabled = true;
  out.hidden = true;
  setStatus($("#ideas-status"), `${SPINNER}<span>Claude is searching today's market…</span>`);
  try {
    const data = await api("/api/ideas", Object.fromEntries(new FormData(form)));
    setStatus($("#ideas-status"), "");
    out.innerHTML = markdown(data.markdown) + `<p class="disclaimer">${esc(data.disclaimer)}</p>`;
    out.hidden = false;
  } catch (err) {
    setStatus($("#ideas-status"), esc(err.message), true);
  } finally {
    btn.disabled = false;
  }
});

// Minimal Markdown: headings, bullets, bold, italics, links. Input is escaped first.
function markdown(src) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html = "", inList = false;
  for (const raw of String(src).split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (bullet) {
      if (!inList) { html += "<ul class=\"list\">"; inList = true; }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}
