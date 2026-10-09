const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SPARK_PATH = "M12 2l1.6 6.1L19 4.6l-3.5 5.4L22 12l-6.5 2 3.5 5.4-5.4-3.5L12 22l-1.6-6.1L5 19.4l3.5-5.4L2 12l6.5-2L5 4.6l5.4 3.5z";
const SPINNER = `<svg class="spinner" viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>`;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Everything from the network is escaped before it touches innerHTML.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? "") ? esc(u) : "#");
const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));

function fmtMoney(n, currency = "USD") {
  if (n == null || !Number.isFinite(n)) return "–";
  const opts = { style: "currency", currency, maximumFractionDigits: 2 };
  const fmt = (x) => new Intl.NumberFormat("en", opts).format(x);
  const abs = Math.abs(n);
  if (abs >= 1e12) return fmt(n / 1e12) + "T";
  if (abs >= 1e9) return fmt(n / 1e9) + "B";
  if (abs >= 1e6) return fmt(n / 1e6) + "M";
  return fmt(n);
}
const fmtPct = (n, ratio = false) => (n == null || !Number.isFinite(n) ? "–" : `${(ratio ? n * 100 : n).toFixed(1)}%`);
const fmtNum = (n) => (n == null || !Number.isFinite(n) ? "–" : n.toFixed(1));

function setStatus(el, html, isError = false) {
  el.hidden = !html;
  el.classList.toggle("error", isError);
  el.innerHTML = html || "";
}

// ---------- Small animation helpers ----------
async function typeText(el, text, cps = 220) {
  el.classList.add("caret");
  if (reducedMotion) el.textContent = text;
  else {
    const start = performance.now();
    await new Promise((done) => {
      const tick = (now) => {
        const n = Math.min(text.length, Math.floor(((now - start) / 1000) * cps));
        el.textContent = text.slice(0, n);
        n < text.length ? requestAnimationFrame(tick) : done();
      };
      requestAnimationFrame(tick);
    });
  }
  el.classList.remove("caret");
}

function countUp(el, to, format, ms = 900) {
  if (reducedMotion || !Number.isFinite(to)) return void (el.textContent = format(to));
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = format(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Tabs
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `tab-${tab.dataset.tab}`));
  }),
);

// ---------- Investor profile (remembered per browser) ----------
const profileEl = $("#profile");
try {
  const saved = JSON.parse(localStorage.getItem("advisor-profile") || "{}");
  for (const name of ["risk", "horizon"]) if (saved[name]) $(`[name=${name}]`, profileEl).value = saved[name];
} catch {}
profileEl.addEventListener("change", () => {
  try { localStorage.setItem("advisor-profile", JSON.stringify(profile())); } catch {}
});
const profile = () => ({ risk: $("[name=risk]", profileEl).value, horizon: $("[name=horizon]", profileEl).value });

// ---------- Analyze ----------
const results = $("#results");
const statusEl = $("#status");
let lastQuery = "";
let source;

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

const STEPS = [
  ["resolve", (q) => `Finding the stock behind “${q}”`],
  ["data", () => "Reading price, financials and news"],
  ["markets", () => "Checking Polymarket odds"],
  ["think", () => "Weighing it up for your profile"],
];

function analyze(query, symbol) {
  if (!query) return;
  lastQuery = query;
  source?.close();
  setStatus(statusEl, "");
  const btn = $("#search .send");
  btn.disabled = true;

  results.innerHTML = `
    <div class="card overview working reveal" id="ov">
      <div class="ov-head"><svg class="spark-icon" viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>AI Overview<span class="muted">${esc(profile().risk)} risk · ${esc(profile().horizon)}</span></div>
      <ul class="steps">${STEPS.map(([id, label]) => `<li data-step="${id}"><span class="dot"></span>${esc(label(query))}</li>`).join("")}</ul>
      <div class="skeleton"><i></i><i></i><i></i><i></i></div>
      <div class="ov-body" hidden></div>
    </div>
    <div id="slot-alts"></div><div id="slot-stock"></div><div id="slot-details"></div><div id="slot-markets"></div><div id="slot-news"></div><div id="slot-disclaimer"></div>`;

  const state = { query, resolved: null, stock: null, markets: [], analysis: null };
  const params = new URLSearchParams({ query, ...profile(), ...(symbol ? { symbol } : {}) });
  source = new EventSource(`/api/analyze?${params}`);
  const on = (name, fn) => source.addEventListener(name, (e) => fn(JSON.parse(e.data)));

  on("step", ({ id, state: s }) => {
    const li = $(`[data-step="${id}"]`, results);
    if (li) li.className = s;
  });
  on("resolved", (r) => {
    state.resolved = r;
    renderAlternatives(r);
  });
  on("stock", (s) => {
    state.stock = s;
    renderStock(s);
  });
  on("markets", (m) => {
    state.markets = m;
    renderMarkets(m, null);
  });
  on("analysis", (a) => {
    state.analysis = a;
    renderOverview(a);
    renderDetails(a);
    renderMarkets(state.markets, a.polymarketTake);
  });
  on("fail", ({ error }) => fail(error));
  on("done", () => {
    finish();
    if (state.resolved && !state.resolved.symbol) fail(state.resolved.note || "No listed stock found for that.");
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED || !state.analysis) fail("Connection lost. Try again.");
  };

  function finish() {
    source.close();
    btn.disabled = false;
    $("#ov")?.classList.remove("working");
  }
  function fail(msg) {
    finish();
    const ov = $("#ov");
    if (!ov) return setStatus(statusEl, esc(msg), true);
    $(".skeleton", ov)?.remove();
    const body = $(".ov-body", ov);
    body.hidden = false;
    body.innerHTML = `<p class="error">${esc(msg)}</p>`;
  }
}

function renderAlternatives(r) {
  const others = (r.tickers ?? []).filter((t) => t.symbol !== r.symbol);
  if (!r.note && !others.length) return;
  $("#slot-alts").innerHTML = `<div class="card reveal"><p class="muted" style="margin:0">${esc(r.note || `Other stocks linked to ${r.entityName}:`)}</p>
    ${others.length ? `<div class="chips" style="justify-content:flex-start">${others.map((t) => `<button class="chip" data-symbol="${esc(t.symbol)}" title="${esc(t.relation)}">${esc(t.symbol)} · ${esc(t.name)}</button>`).join("")}</div>` : ""}</div>`;
  $("#slot-alts").querySelectorAll("[data-symbol]").forEach((b) => b.addEventListener("click", () => analyze(lastQuery, b.dataset.symbol)));
}

async function renderOverview(a) {
  const ov = $("#ov");
  $(".skeleton", ov)?.remove();
  $(".steps", ov).classList.add("compact");
  const level = { Low: 1, Medium: 2, High: 3 }[a.confidence] ?? 0;
  const body = $(".ov-body", ov);
  body.hidden = false;
  body.innerHTML = `
    <div class="verdict"><span class="badge reveal ${esc(a.verdict)}">${esc(a.verdict)}</span>
      <span class="muted small">Confidence <span class="meter"><b></b><b></b><b></b></span> ${esc(a.confidence)}</span></div>
    <div class="headline"></div>
    <div class="explain"></div>
    <div class="advice" hidden>
      <div class="sub-h">What I’d do</div><ol class="plan"></ol>
      <div class="sub-h">Watch for</div><ul class="list watch"></ul>
      <p class="muted small" style="margin-top:12px"><strong>Who it fits:</strong> ${esc(a.whoIsItFor)}</p>
    </div>`;
  $$(".meter b", body).forEach((b, i) => setTimeout(() => b.classList.toggle("on", i < level), reducedMotion ? 0 : 250 + i * 180));

  await typeText($(".headline", body), a.headline, 90);
  for (const para of String(a.plainExplanation).split(/\n\s*\n/)) {
    const p = document.createElement("p");
    $(".explain", body).append(p);
    await typeText(p, para);
  }
  const advice = $(".advice", body);
  advice.hidden = false;
  advice.classList.add("reveal");
  for (const [sel, items] of [[".plan", a.actionPlan], [".watch", a.watchFor]]) {
    for (const t of items ?? []) {
      const li = document.createElement("li");
      li.className = "reveal";
      li.textContent = t;
      $(sel, body).append(li);
      await sleep(140);
    }
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
  const color = closes.at(-1) >= closes[0] ? "var(--good)" : "var(--bad)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="1 year price chart">
    <path class="area" d="${line}L${w},${h}L0,${h}Z" fill="${color}"/>
    <path class="line" d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="muted small" style="display:flex;justify-content:space-between"><span>${esc(history[0].date)}</span><span>1 year</span><span>${esc(history.at(-1).date)}</span></div>`;
}

const stat = (label, value) => `<div class="stat reveal"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;

function renderStock(stock) {
  const up = (stock.changePercent ?? 0) >= 0;
  const f = stock.financials, v = stock.valuation;
  const slot = $("#slot-stock");
  slot.innerHTML = `<div class="card reveal">
    <div class="stock-head">
      <div><div class="ticker">${esc(stock.symbol)} · ${esc(stock.exchange)}</div><h2 style="margin:2px 0 0">${esc(stock.name)}</h2>
        <div class="muted small">${esc([stock.profile.sector, stock.profile.industry].filter(Boolean).join(" · "))}</div></div>
      <div style="text-align:right"><div class="price"></div>
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
  $$(".stat", slot).forEach((el, i) => (el.style.animationDelay = `${150 + i * 60}ms`));
  const line = $(".spark .line", slot);
  if (line) line.style.setProperty("--len", Math.ceil(line.getTotalLength() * 1.5));
  countUp($(".price", slot), stock.price, (n) => fmtMoney(n, stock.currency));

  if (stock.news.length) {
    $("#slot-news").innerHTML = `<div class="card reveal"><h3>Recent news</h3><ul class="list">${stock.news
      .map((n) => `<li><a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted small">${esc(n.publisher)}</span></li>`)
      .join("")}</ul></div>`;
  }
}

const list = (items) => `<ul class="list">${(items ?? []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

function renderDetails(a) {
  const slot = $("#slot-details");
  slot.innerHTML = `
    <div class="two">
      <div class="card bull reveal"><h3>Reasons to be bullish</h3>${list(a.bullCase)}</div>
      <div class="card bear reveal"><h3>Reasons to be careful</h3>${list(a.bearCase)}</div>
    </div>
    <div class="card reveal"><h3>Valuation</h3><p>${esc(a.valuationTake)}</p><h3>Key risks</h3>${list(a.keyRisks)}</div>
    <div class="card reveal"><h3>Tips</h3>${list(a.tips)}</div>`;
  $("#slot-disclaimer").innerHTML = `<p class="disclaimer">${esc(a.disclaimer)}</p>`;
  // Hold these back until the overview has had a moment to type out.
  $$(".reveal", slot).forEach((el, i) => (el.style.animationDelay = `${1200 + i * 120}ms`));
}

function renderMarkets(markets, take) {
  $("#slot-markets").innerHTML = `<div class="card reveal"><h3>Polymarket odds</h3>
    <p class="muted small" style="margin-top:-4px">What prediction-market traders are betting. For information only.</p>
    ${take ? `<p>${esc(take)}</p>` : ""}
    ${markets.length ? markets.map(marketHtml).join("") : `<p class="muted">No open prediction markets found.</p>`}</div>`;
}

function marketHtml(m) {
  return `<div class="market">
    <div class="market-q"><div>${m.url ? `<a href="${safeUrl(m.url)}" target="_blank" rel="noopener">${esc(m.question)}</a>` : esc(m.question)}
      <div class="muted small">Volume ${fmtMoney(m.volume)}${m.endDate ? ` · ends ${esc(m.endDate.slice(0, 10))}` : ""}</div></div></div>
    ${m.outcomes.map((o) => {
      const pct = o.probability == null ? null : Math.round(o.probability * 100);
      return `<div class="outcome"><span>${esc(o.name)}</span><div class="bar"><i style="width:${pct ?? 0}%"></i></div><strong>${pct == null ? "–" : pct + "%"}</strong></div>`;
    }).join("")}</div>`;
}

// ---------- Ideas ----------
$("#ideas-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  const out = $("#ideas-out");
  btn.disabled = true;
  out.hidden = true;
  setStatus($("#ideas-status"), `${SPINNER}<span>Your advisor is searching today's market…</span>`);
  try {
    const res = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    setStatus($("#ideas-status"), "");
    out.innerHTML = markdown(data.markdown) + `<p class="disclaimer">${esc(data.disclaimer)}</p>`;
    out.hidden = false;
    $$(":scope > *", out).forEach((el, i) => {
      el.classList.add("reveal");
      el.style.animationDelay = `${i * 70}ms`;
    });
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
      if (!inList) { html += '<ul class="list">'; inList = true; }
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
