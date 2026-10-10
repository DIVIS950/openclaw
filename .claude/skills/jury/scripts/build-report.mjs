#!/usr/bin/env node
// App Jury report — turns app-jury-report/verdict.json into report.html and appends the run to history.json.
//   node build-report.mjs [app-jury-report]
// verdict.json shape: see skills/test-app/references/report.md

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'app-jury-report');
const vPath = path.join(dir, 'verdict.json');
const hPath = path.join(dir, 'history.json');
if (!fs.existsSync(vPath)) { console.error('No verdict.json in ' + dir); process.exit(2); }
const v = JSON.parse(fs.readFileSync(vPath, 'utf8'));
let history = fs.existsSync(hPath) ? JSON.parse(fs.readFileSync(hPath, 'utf8')) : [];

// Append to history (idempotent on run_id)
v.run_id ||= (v.date || new Date().toISOString()).slice(0, 16);
if (!history.some((h) => h.run_id === v.run_id)) {
  history.push({ run_id: v.run_id, date: v.date, mode: v.mode, score: v.score, verdict: v.verdict, areas: v.areas, fixed: (v.fixed || []).length, open: (v.open || []).length, commit: v.commit || null });
  fs.writeFileSync(hPath, JSON.stringify(history, null, 2));
}
const prev = history.length > 1 ? history[history.length - 2] : null;
const delta = prev && typeof prev.score === 'number' && typeof v.score === 'number' ? +(v.score - prev.score).toFixed(1) : null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AREAS = [['users', 'Real users', 25], ['qa', 'QA', 15], ['bugs', 'Bug hunter', 15], ['security', 'Security', 15], ['ux', 'UX', 15], ['performance', 'Speed', 8], ['business', 'Business', 7]];
const sevClass = (s) => ({ Critical: 'crit', Major: 'major', Minor: 'minor' }[s] || 'minor');
const good = v.verdict === 'GOOD';

const bars = AREAS.map(([k, label, w]) => {
  const s = v.areas?.[k];
  const pct = typeof s === 'number' ? Math.max(0, Math.min(100, s * 10)) : 0;
  return `<div class="row"><span class="lbl">${label}<small>${w}%</small></span><div class="bar"><i style="width:${pct}%" class="${s >= 7.5 ? 'g' : s >= 5 ? 'y' : 'r'}"></i></div><b>${typeof s === 'number' ? s.toFixed(1) : '–'}</b></div>`;
}).join('');

const issues = (list, cls) => (list || []).length ? `<ul class="issues">${list.map((i) => `<li class="${cls}"><span class="sev ${sevClass(i.severity)}">${esc(i.severity || '')}</span><div><strong>${esc(i.title)}</strong>${i.detail ? `<p>${esc(i.detail)}</p>` : ''}${i.agent ? `<small>found by ${esc(i.agent)}</small>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">none</p>';

// History chart (inline SVG)
const W = 560, H = 160, P = 28;
const pts = history.map((h, i) => [P + (history.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (history.length - 1)), H - P - ((Number(h.score) || 0) / 10) * (H - 2 * P)]);
const chart = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Score history">
  <line x1="${P}" y1="${H - P - 0.75 * (H - 2 * P)}" x2="${W - P}" y2="${H - P - 0.75 * (H - 2 * P)}" class="goal"/><text x="${P + 4}" y="${H - P - 0.75 * (H - 2 * P) - 5}" class="tiny">7.5 = GOOD</text>
  ${[0, 5, 10].map((s) => `<text x="${P - 6}" y="${H - P - (s / 10) * (H - 2 * P) + 4}" text-anchor="end" class="tiny">${s}</text>`).join('')}
  ${pts.length > 1 ? `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="line"/>` : ''}
  ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" class="${history[i].verdict === 'GOOD' ? 'dg' : 'dr'}"><title>${esc(history[i].date)} · ${history[i].score}/10 · ${esc(history[i].verdict)}</title></circle><text x="${p[0]}" y="${H - 8}" text-anchor="middle" class="tiny">${esc(String(history[i].date || '').slice(5, 10))}</text>`).join('')}
</svg>`;

const videos = (v.videos || []).map((x) => `<li><a href="${esc(x.path)}">▶ ${esc(x.label || x.path)}</a></li>`).join('');
const disputes = (v.disputes || []).map((d) => `<li><strong>${esc(d.title)}</strong> <small>(${esc(d.between || '')})</small><p>${esc(d.ruling || '')}</p></li>`).join('');
const agents = (v.agents || []).map((a) => `<li><b>${a.score ?? '–'}</b><div><strong>${esc(a.name)}${a.persona ? ` <small>(${esc(a.persona)})</small>` : ''}</strong>${a.opinion ? `<p>“${esc(a.opinion)}”</p>` : ''}</div></li>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Jury — ${esc(v.app?.name || 'report')}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mut:#6b7280;--line:#e5e7eb;--g:#16a34a;--y:#d97706;--r:#dc2626;--acc:#2563eb}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1115;--card:#181b22;--ink:#e8eaf0;--mut:#9aa1ad;--line:#2a2f3a}}
:root[data-theme=dark]{--bg:#0f1115;--card:#181b22;--ink:#e8eaf0;--mut:#9aa1ad;--line:#2a2f3a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 60px}
.hero{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.hero h1{margin:0 0 4px;font-size:22px}.hero .meta{color:var(--mut);font-size:13px}
.verdict{text-align:center;padding:10px 18px;border-radius:12px;color:#fff;background:${good ? 'var(--g)' : 'var(--r)'};min-width:170px}
.verdict .big{font-size:34px;font-weight:800;line-height:1}.verdict .lab{font-weight:700;letter-spacing:.04em;font-size:13px}.verdict .d{font-size:12px;opacity:.9}
.reason{margin:14px 0 0;font-size:16px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-top:16px}
h2{margin:0 0 12px;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
.row{display:grid;grid-template-columns:120px 1fr 44px;gap:10px;align-items:center;margin:7px 0}.lbl small{display:block;color:var(--mut);font-size:11px}
.bar{height:10px;background:var(--line);border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;border-radius:6px}.bar .g{background:var(--g)}.bar .y{background:var(--y)}.bar .r{background:var(--r)}
.row b{text-align:right}
.issues{list-style:none;padding:0;margin:0}.issues li{display:flex;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.issues li:first-child{border-top:0}
.issues p{margin:2px 0 0;color:var(--mut);font-size:14px}.issues small{color:var(--mut);display:block;font-size:12px}
.sev{flex:0 0 auto;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;height:fit-content;color:#fff}.sev.crit{background:var(--r)}.sev.major{background:var(--y)}.sev.minor{background:var(--mut)}
.fixed .sev{opacity:.55}.fixed strong::after{content:" ✓ fixed";color:var(--g);font-weight:600}
.agents{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.agents li{display:flex;gap:10px;border:1px solid var(--line);border-radius:10px;padding:10px}.agents b{font-size:20px;min-width:30px}.agents p{margin:2px 0 0;color:var(--mut);font-size:13px}
.chart{width:100%;height:auto}.chart .line{fill:none;stroke:var(--acc);stroke-width:2.5}.chart .dg{fill:var(--g)}.chart .dr{fill:var(--r)}.chart .goal{stroke:var(--line);stroke-dasharray:4 4}.chart .tiny{font-size:10px;fill:var(--mut)}
.videos{list-style:none;padding:0;margin:0}.videos li{padding:6px 0}.videos a{color:var(--acc);text-decoration:none;font-weight:600}.muted{color:var(--mut)}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:640px){.two{grid-template-columns:1fr}.row{grid-template-columns:96px 1fr 40px}}
footer{color:var(--mut);font-size:12px;text-align:center;margin-top:24px}
</style></head><body><main>
<div class="hero">
  <div><h1>${esc(v.app?.name || 'App')}</h1><div class="meta">${esc(v.app?.url || '')}${v.app?.purpose ? ' · ' + esc(v.app.purpose) : ''}<br>${esc(v.date || '')} · ${esc(v.mode || 'full')} mode · ${v.rounds || 1} round${v.rounds > 1 ? 's' : ''}${v.commit ? ' · fixes on <code>' + esc(v.commit) + '</code>' : ''}</div>
  <p class="reason">${esc(v.main_reason || '')}</p></div>
  <div class="verdict"><div class="big">${typeof v.score === 'number' ? v.score.toFixed(1) : '–'}<small style="font-size:14px">/10</small></div><div class="lab">${good ? 'GOOD ✓' : 'NOT READY'}</div>${delta !== null ? `<div class="d">${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '='} ${delta} vs last run</div>` : ''}</div>
</div>
<section><h2>Scores by area</h2>${bars}</section>
<div class="two">
<section><h2>Still open (${(v.open || []).length})</h2>${issues(v.open, 'open')}</section>
<section class="fixed"><h2>Fixed this run (${(v.fixed || []).length})</h2>${issues(v.fixed, 'fixed')}</section>
</div>
${(v.worked_well || []).length ? `<section><h2>Worked well</h2><ul>${v.worked_well.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}
${agents ? `<section><h2>The jury</h2><ul class="agents">${agents}</ul></section>` : ''}
${videos ? `<section><h2>Watch the users</h2><ul class="videos">${videos}</ul></section>` : ''}
${disputes ? `<section><h2>Deliberation</h2><ul class="issues">${disputes}</ul></section>` : ''}
<section><h2>Score history (${history.length} run${history.length > 1 ? 's' : ''})</h2>${chart}</section>
<footer>Generated by App Jury · every issue listed has steps to reproduce or a file reference in verdict.md</footer>
</main></body></html>`;

fs.writeFileSync(path.join(dir, 'report.html'), html);
console.log(JSON.stringify({ report: path.join(dir, 'report.html'), history_runs: history.length, score: v.score, verdict: v.verdict, delta }, null, 2));
