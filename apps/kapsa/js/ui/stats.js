// Stats tab: what you spent and saved this month, where, and the last six months.

import { describeError, hasApiKey } from "../ai.js";
import { locale, t } from "../i18n.js";
import { go } from "../nav.js";
import { byShop, monthOf, monthSummary, niceMax, trend } from "../stats.js";
import { deletePurchase, getCard, state } from "../state.js";
import { money, moneyShort, monthName } from "../util.js";
import { receiptToLog } from "./logsheet.js";
import { Icon, Section, cardTint, html, toast } from "./kit.js";
import { useRef, useState } from "../../vendor/preact.js";


export function StatsTab() {
  const [delta, setDelta] = useState(0);
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  const now = Date.now();
  const { year, month } = monthOf(now, delta);
  const cur = state.settings.currency;
  const sum = monthSummary(state.purchases, state.coupons, state.cards, year, month);
  const shops = byShop(state.purchases, state.cards, year, month);
  const series = trend(state.purchases, year, month, 6);
  const list = state.purchases.filter((p) => {
    const d = new Date(p.at);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  list.sort((a, b) => b.at - a.at);
  const hasAny = state.purchases.length > 0;

  const onReceipt = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) {
      return;
    }
    setBusy(true);
    try {
      await receiptToLog(f);
    } catch (err) {
      toast(await describeError(err), { ms: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return html`<div>
    <header class="hero">
      <div class="hero-inner">
        <div class="topbar">
          <h1 class="display sm">${t("st.title")}</h1>
        </div>
        <div class="hero-stack">
          <div class="month-nav">
            <button type="button" class="hbtn" aria-label=${t("st.prev")} onClick=${() => setDelta(delta - 1)}><${Icon} name="chevron-left" /></button>
            <span class="month-name">${monthName(year, month)}</span>
            <button type="button" class="hbtn" aria-label=${t("st.next")} disabled=${delta >= 0} onClick=${() => setDelta(Math.min(0, delta + 1))}>
              <${Icon} name="chevron-right" />
            </button>
          </div>
          <span class="label" style="color:inherit">${t("st.spent")}</span>
          <div class="bignum">${money(sum.spent, cur)}</div>
          <div class="kpis">
            <div class="kpi"><span class="kpi-l">${t("st.saved")}</span><span class="kpi-v">${money(sum.saved, cur)}</span></div>
            <div class="kpi"><span class="kpi-l">${t("st.visits")}</span><span class="kpi-v">${sum.visits}</span></div>
            <div class="kpi"><span class="kpi-l">${t("st.couponsUsed")}</span><span class="kpi-v">${sum.couponsUsed}</span></div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn primary" onClick=${() => go("#log")}><${Icon} name="plus" />${t("st.log")}</button>
            <button
              type="button"
              class="btn"
              disabled=${busy}
              onClick=${async () => {
                if (!(await hasApiKey())) {
                  toast(t("ai.needKey"), { action: t("ai.setup"), onAction: () => go("#settings"), ms: 6000 });
                  return;
                }
                file.current?.click();
              }}
            >
              ${busy ? html`<span class="orb"></span>` : html`<${Icon} name="receipt" />`}${busy ? t("ai.reading") : t("st.receipt")}
            </button>
          </div>
          <input ref=${file} id="stats-receipt" type="file" accept="image/*" capture="environment" hidden onChange=${onReceipt} />
        </div>
      </div>
    </header>

    ${!hasAny
      ? html`<${Section}>
          <div class="empty"><h2>${t("st.emptyTitle")}</h2><p>${t("st.emptyBody")}</p></div>
        <//>`
      : html`
          <${Section} title=${t("st.byShop")}>
            ${shops.length ? html`<${ShopBars} rows=${shops} total=${sum.spent} currency=${cur} />` : html`<p class="hint">${t("st.noneMonth")}</p>`}
          <//>
          <${Section} title=${t("st.trend")}>
            <div class="panel"><${Trend} key=${`${year}-${month}`} series=${series} currency=${cur} /></div>
          <//>
          <${Section} title=${t("st.recent")} count=${list.length || undefined}>
            ${list.length
              ? html`<div class="list">${list.map((p) => html`<${PurchaseRow} key=${p.id} p=${p} currency=${cur} />`)}</div>`
              : html`<p class="hint">${t("st.noneMonth")}</p>`}
          <//>
        `}
  </div>`;
}

/** Spending per shop: one hue for the bars (they show size); the shop's colour sits by its name. */
function ShopBars({ rows, total, currency }) {
  const max = rows[0]?.amount || 1;
  return html`<div class="panel hbars">
    ${rows.slice(0, 8).map(
      (r) => html`<div class="hbar" key=${r.key}>
        <div class="hbar-top">
          <span class="hbar-dot" style=${r.cardId ? cardTint(getCard(r.cardId)) : undefined}></span>
          <span class="hbar-name">${r.name}</span>
          <span class="hbar-v">${money(r.amount, currency)}</span>
          <span class="hbar-share">${t("st.share", { p: total ? Math.round((r.amount / total) * 100) : 0 })}</span>
        </div>
        <div class="hbar-track"><div class="hbar-fill" style=${{ width: `${Math.max(2, (r.amount / max) * 100)}%` }}></div></div>
      </div>`,
    )}
  </div>`;
}

/** Six months as columns; the selected month is highlighted; tap a column for its value. */
function Trend({ series, currency }) {
  const [sel, setSel] = useState(series.length - 1);
  const W = 320;
  const H = 160;
  const padL = 44;
  const padB = 24;
  const top = niceMax(Math.max(...series.map((s) => s.amount)));
  const plotW = W - padL;
  const plotH = H - padB;
  const band = plotW / series.length;
  const barW = Math.min(24, band * 0.5);
  const y = (v) => plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  const s = series[sel];
  const cx = padL + band * sel + band / 2;
  return html`<div class="trend">
    ${s ? html`<div class="trend-tip" style=${{ left: `${Math.min(80, Math.max(20, (cx / W) * 100))}%` }}>${monthName(s.year, s.month, false)} · ${money(s.amount, currency)}</div>` : null}
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${t("st.chartLabel")}>
      <g class="grid">${ticks.map((v) => html`<line x1=${padL} x2=${W} y1=${y(v)} y2=${y(v)} />`)}</g>
      <g class="axis">
        ${ticks.map((v) => html`<text x=${padL - 6} y=${y(v) + 4} text-anchor="end">${moneyShort(v, currency)}</text>`)}
        ${series.map(
          (m, i) => html`<text x=${padL + band * i + band / 2} y=${H - 6} text-anchor="middle">${monthName(m.year, m.month, false)}</text>`,
        )}
      </g>
      ${series.map((m, i) => {
        const x = padL + band * i + band / 2 - barW / 2;
        const h = Math.max(m.amount > 0 ? 2 : 0, plotH - y(m.amount));
        const r = Math.min(4, h);
        // Rounded data end on top, square at the baseline.
        const d = `M${x},${plotH} V${plotH - h + r} Q${x},${plotH - h} ${x + r},${plotH - h} H${x + barW - r} Q${x + barW},${plotH - h} ${x + barW},${plotH - h + r} V${plotH} Z`;
        return html`<path class=${`col${i === series.length - 1 ? " is-now" : ""}${i === sel ? " is-sel" : ""}`} d=${d} />`;
      })}
      ${series.map(
        (m, i) => html`<rect
          class="hit"
          x=${padL + band * i}
          y="0"
          width=${band}
          height=${plotH}
          tabindex="0"
          aria-label=${`${monthName(m.year, m.month)}: ${money(m.amount, currency)}`}
          onClick=${() => setSel(i)}
          onMouseEnter=${() => setSel(i)}
          onFocus=${() => setSel(i)}
        />`,
      )}
    </svg>
    <table class="sr">
      <caption>${t("st.chartLabel")}</caption>
      <tbody>${series.map((m) => html`<tr><th>${monthName(m.year, m.month)}</th><td>${money(m.amount, currency)}</td></tr>`)}</tbody>
    </table>
  </div>`;
}

function PurchaseRow({ p, currency }) {
  const [open, setOpen] = useState(false);
  const card = p.cardId ? getCard(p.cardId) : null;
  const d = new Date(p.at);
  return html`<div class="li" onClick=${() => setOpen(!open)} role="button" tabindex="0">
    <span class="li-icon" style=${cardTint(card)}><${Icon} name=${p.source === "receipt" ? "receipt" : "wallet"} /></span>
    <span class="li-text">
      <span class="li-title">${card?.name ?? p.shop ?? "—"}</span>
      <span class="li-sub">${d.toLocaleDateString(locale(), { day: "numeric", month: "short" })}${p.saved ? ` · ${t("st.saved").toLowerCase()} ${money(p.saved, currency)}` : ""}</span>
    </span>
    <span class="li-v">${money(p.amount, currency)}</span>
    ${open
      ? html`<button
          type="button"
          class="ibtn"
          aria-label=${t("common.delete")}
          style="color:var(--red)"
          onClick=${async (e) => {
            e.stopPropagation();
            await deletePurchase(p.id);
            toast(t("st.deleted"));
          }}
        >
          <${Icon} name="trash-2" />
        </button>`
      : html`<span></span>`}
  </div>`;
}
