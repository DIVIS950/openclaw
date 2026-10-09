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

// ---------- Rotating example word in the headline ----------
const rotator = $(".rotator");
const WORDS = ["Nvidia?", "the iPhone?", "Elon Musk?", "Coca-Cola?", "Ozempic?", "Tesla?"];
let wordIdx = 0;
if (!reducedMotion) setInterval(() => {
  if (document.body.classList.contains("searched")) return;
  wordIdx = (wordIdx + 1) % WORDS.length;
  rotator.innerHTML = `<span>${esc(WORDS[wordIdx])}</span>`;
}, 2400);

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
$(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  source?.close();
  document.body.classList.remove("searched");
  results.innerHTML = "";
  $("#query").value = "";
});

const STEPS = [
  ["resolve", (q) => `Finding the stock behind “${q}”`],
  ["data", () => "Reading price, financials and news"],
  ["markets", () => "Checking Polymarket odds"],
  ["think", () => "Weighing it up for you"],
];
const DETAIL_TABS = [["numbers", "Numbers"], ["pros", "Pros & cons"], ["odds", "Polymarket"], ["news", "News"]];

function analyze(query, symbol) {
  if (!query) return;
  lastQuery = query;
  source?.close();
  setStatus(statusEl, "");
  document.body.classList.add("searched");
  const btn = $("#search .send");
  btn.disabled = true;
  const p = profile();

  results.innerHTML = `
    <article class="card answer working reveal" id="ov">
      <div class="quote-row" id="quote"><div class="skeleton" style="flex:1;margin:0"><i style="width:40%"></i><i style="width:60%"></i></div></div>
      <div id="chart"></div>
      <div class="ai-label"><svg viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>AI Overview<span class="muted">${esc(p.risk)} risk · ${esc(p.horizon)}</span></div>
      <ul class="steps">${STEPS.map(([id, label]) => `<li data-step="${id}"><span class="dot"></span>${esc(label(query))}</li>`).join("")}</ul>
      <div class="skeleton" id="think-skel"><i></i><i></i><i></i></div>
      <div class="ov-body"></div>
      <div class="also" id="also" hidden></div>
    </article>
    <section class="card details reveal" id="details" style="animation-delay:.15s">
      <nav class="dtabs" role="tablist">${DETAIL_TABS.map(([id, label], i) => `<button class="dtab${i ? "" : " active"}" data-dtab="${id}" disabled>${label}</button>`).join("")}</nav>
      <div id="dpanel"></div>
    </section>
    <p class="disclaimer" id="disclaimer" hidden></p>`;

  const panels = {};
  let activeTab = "numbers";
  const setPanel = (id, html) => {
    panels[id] = html;
    $(`[data-dtab="${id}"]`, results).disabled = false;
    if (id === activeTab) showPanel(id);
  };
  const showPanel = (id) => {
    activeTab = id;
    $$(".dtab", results).forEach((t) => t.classList.toggle("active", t.dataset.dtab === id));
    $("#dpanel").innerHTML = `<div class="dpanel">${panels[id] ?? '<div class="skeleton"><i></i><i></i></div>'}</div>`;
  };
  showPanel("numbers");
  $$(".dtab", results).forEach((t) => t.addEventListener("click", () => showPanel(t.dataset.dtab)));

  const state = { resolved: null, analysis: null, markets: [] };
  const params = new URLSearchParams({ query, ...p, ...(symbol ? { symbol } : {}) });
  source = new EventSource(`/api/analyze?${params}`);
  const on = (name, fn) => source.addEventListener(name, (e) => fn(JSON.parse(e.data)));

  on("step", ({ id, state: s }) => {
    const li = $(`[data-step="${id}"]`, results);
    if (li) li.className = s;
  });
  on("resolved", (r) => {
    state.resolved = r;
    renderAlso(r);
  });
  on("stock", (s) => {
    renderQuote(s);
    setPanel("numbers", numbersHtml(s));
    setPanel("news", newsHtml(s.news));
  });
  on("markets", (m) => {
    state.markets = m;
    setPanel("odds", oddsHtml(m, null));
  });
  on("analysis", (a) => {
    state.analysis = a;
    renderAnswer(a);
    setPanel("pros", prosHtml(a));
    setPanel("odds", oddsHtml(state.markets, a.polymarketTake));
    const d = $("#disclaimer");
    d.textContent = a.disclaimer;
    d.hidden = false;
  });
  on("fail", ({ error }) => fail(error));
  on("done", () => {
    finish();
    if (state.resolved && !state.resolved.symbol) fail(state.resolved.note || "No listed stock found for that.");
  });
  source.onerror = () => {
    if (!state.analysis) fail("Connection lost. Try again.");
  };

  function finish() {
    source.close();
    btn.disabled = false;
    $("#ov")?.classList.remove("working");
  }
  function fail(msg) {
    finish();
    $("#think-skel")?.remove();
    $("#ov .ov-body").innerHTML = `<p class="error" style="margin-top:16px">${esc(msg)}</p>`;
    if (!state.analysis) $("#details")?.remove();
  }
}

function renderAlso(r) {
  const others = (r.tickers ?? []).filter((t) => t.symbol !== r.symbol);
  if (!others.length) return;
  const el = $("#also");
  el.hidden = false;
  el.innerHTML = `<span>Also linked:</span>${others.map((t) => `<button class="chip" data-symbol="${esc(t.symbol)}" title="${esc(t.relation)}">${esc(t.symbol)} · ${esc(t.name)}</button>`).join("")}`;
  $$("[data-symbol]", el).forEach((b) => b.addEventListener("click", () => analyze(lastQuery, b.dataset.symbol)));
}

function renderQuote(stock) {
  const up = (stock.changePercent ?? 0) >= 0;
  $("#quote").innerHTML = `
    <div class="reveal"><div class="ticker">${esc(stock.symbol)} · ${esc(stock.exchange)}</div><h2>${esc(stock.name)}</h2></div>
    <div class="reveal"><div class="price"></div>
      <div class="change ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${fmtPct(Math.abs(stock.changePercent ?? NaN))} today · <span class="${(stock.oneYearReturnPercent ?? 0) >= 0 ? "up" : "down"}">${fmtPct(stock.oneYearReturnPercent)} 1y</span></div></div>`;
  countUp($("#quote .price"), stock.price, (n) => fmtMoney(n, stock.currency));
  $("#chart").innerHTML = sparkline(stock.history);
  const line = $("#chart .line");
  if (line) line.style.setProperty("--len", Math.ceil(line.getTotalLength() * 1.5));
}

async function renderAnswer(a) {
  $("#think-skel")?.remove();
  $("#ov .steps").classList.add("gone");
  const level = { Low: 1, Medium: 2, High: 3 }[a.confidence] ?? 0;
  const body = $("#ov .ov-body");
  body.innerHTML = `
    <div class="verdict"><div class="big-verdict ${esc(a.verdict)}">${esc(a.verdict)}</div>
      <div class="conf"><span>Confidence · ${esc(a.confidence)}</span><span class="meter"><b></b><b></b><b></b></span></div></div>
    <p class="headline"></p>
    <div class="explain"></div>
    <div class="advice" hidden>
      <div class="box"><h3>What I’d do</h3><ol class="plan"></ol></div>
      <div class="box"><h3>Watch for</h3><ul class="list watch"></ul></div>
    </div>
    <p class="fit" hidden><strong>Fits:</strong> ${esc(a.whoIsItFor)}</p>`;
  $$(".meter b", body).forEach((b, i) => setTimeout(() => b.classList.toggle("on", i < level), reducedMotion ? 0 : 500 + i * 200));

  await sleep(350);
  await typeText($(".headline", body), a.headline, 80);
  for (const para of String(a.plainExplanation).split(/\n\s*\n/)) {
    const el = document.createElement("p");
    $(".explain", body).append(el);
    await typeText(el, para);
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
      await sleep(120);
    }
  }
  $(".fit", body).hidden = false;
}

function sparkline(history) {
  if (history.length < 2) return "";
  const w = 800, h = 70, pad = 3;
  const closes = history.map((p) => p.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const x = (i) => (i / (closes.length - 1)) * w;
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const color = closes.at(-1) >= closes[0] ? "var(--good)" : "var(--bad)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="1 year price chart">
    <path class="area" d="${line}L${w},${h}L0,${h}Z" fill="${color}"/>
    <path class="line" d="${line}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>
    <div class="muted small" style="display:flex;justify-content:space-between"><span>${esc(history[0].date)}</span><span>${esc(history.at(-1).date)}</span></div>`;
}

const stat = (label, value) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const list = (items) => `<ul class="list">${(items ?? []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

function numbersHtml(stock) {
  const f = stock.financials, v = stock.valuation;
  return `<div class="stats">
    ${stat("Market cap", fmtMoney(stock.marketCap, stock.currency))}
    ${stat("P/E (trailing)", fmtNum(v.trailingPE))}
    ${stat("P/E (forward)", fmtNum(v.forwardPE))}
    ${stat("Revenue growth", fmtPct(f.revenueGrowth, true))}
    ${stat("Profit margin", fmtPct(f.profitMargins, true))}
    ${stat("Dividend yield", fmtPct(v.dividendYield, true))}
    ${stat("52-week range", `${fmtMoney(stock.fiftyTwoWeekLow, stock.currency)} – ${fmtMoney(stock.fiftyTwoWeekHigh, stock.currency)}`)}
    ${stat("Analyst target", fmtMoney(f.targetMeanPrice, stock.currency))}
  </div>
  <p class="muted small" style="margin:12px 0 0">${esc([stock.profile.sector, stock.profile.industry].filter(Boolean).join(" · "))}</p>`;
}

function prosHtml(a) {
  return `<div class="two"><div class="bull"><h3>Reasons to like it</h3>${list(a.bullCase)}</div>
    <div class="bear"><h3>Reasons to be careful</h3>${list(a.bearCase)}</div></div>
    <h3 style="margin-top:18px">Valuation</h3><p style="margin:0">${esc(a.valuationTake)}</p>
    <h3 style="margin-top:18px">Key risks</h3>${list(a.keyRisks)}
    <h3 style="margin-top:18px">Tips</h3>${list(a.tips)}`;
}

function oddsHtml(markets, take) {
  return `<p class="muted small" style="margin:0 0 8px">What prediction-market traders are betting. For information only.</p>
    ${take ? `<p>${esc(take)}</p>` : ""}
    ${markets.length ? markets.map(marketHtml).join("") : `<p class="muted">No open prediction markets found.</p>`}`;
}

function marketHtml(m) {
  return `<div class="market">
    ${m.url ? `<a href="${safeUrl(m.url)}" target="_blank" rel="noopener">${esc(m.question)}</a>` : esc(m.question)}
    <div class="muted small">Volume ${fmtMoney(m.volume)}${m.endDate ? ` · ends ${esc(m.endDate.slice(0, 10))}` : ""}</div>
    ${m.outcomes.map((o) => {
      const pct = o.probability == null ? null : Math.round(o.probability * 100);
      return `<div class="outcome"><span>${esc(o.name)}</span><div class="bar"><i style="width:${pct ?? 0}%"></i></div><strong>${pct == null ? "–" : pct + "%"}</strong></div>`;
    }).join("")}</div>`;
}

function newsHtml(news) {
  if (!news.length) return `<p class="muted">No recent news found.</p>`;
  return `<ul class="list news">${news
    .map((n) => `<li><a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted small">${esc(n.publisher)}</span></li>`)
    .join("")}</ul>`;
}

// ---------- Ideas ----------
$("#ideas-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button");
  const out = $("#ideas-out");
  btn.disabled = true;
  out.hidden = true;
  setStatus($("#ideas-status"), `${SPINNER}<span>Checking today's market…</span>`);
  try {
    const res = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    setStatus($("#ideas-status"), "");
    out.innerHTML = markdown(data.markdown) + `<p class="disclaimer" style="text-align:left">${esc(data.disclaimer)}</p>`;
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
