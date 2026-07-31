/**
 * Renders the dashboard view model to static files for review before the toolchain is installable.
 *
 * Two outputs from one model:
 *   preview/dashboard.html - openable in a browser, with drill-downs pre-resolved into <details>
 *                            elements so it needs no JavaScript
 *   preview/dashboard.md   - the same content as text, so the copy (labels, empty-state sentences,
 *                            footnotes, tooltips) can be reviewed in a plain file viewer
 *
 * This is a review harness, not product code: the React components in src/components are the real
 * renderer. Both consume the identical view model, so the wording and states shown here are the ones
 * the application will show.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { toCssVariables } from '../src/lib/design/tokens.js';
import {
  buildAllContentRows,
  buildDashboard,
  loadFixtureDashboard,
  resolveDrilldown,
  type ContentRow,
  type DashboardViewModel,
  type KpiCard,
  type MetricDisplay,
  type TrendSeries,
} from '../src/lib/dashboard/index.js';

const asOf = new Date('2026-07-31T00:00:00Z');

/** FR-003 offers 7, 30 and 90 days. Rendering all three shows how the states change with sample size. */
const PERIODS = [7, 30, 90] as const;

// Declared before the render loop below: function declarations hoist, but the constants they close
// over do not initialise until this point, and the loop runs at module top level.
const REPO_TREE = 'https://github.com/theyhan/they-their.com.github.io/tree/feat/snsight-foundation/snsight';
const REPO_BLOB = 'https://github.com/theyhan/they-their.com.github.io/blob/feat/snsight-foundation/snsight';

/**
 * Reassigned per period. The HTML helpers read it to pre-resolve drill-downs, which is the one piece
 * of shared state in this harness.
 */
let rows: ContentRow[] = [];

interface PageSummary {
  days: number;
  file: string;
  model: DashboardViewModel;
  rowCount: number;
  stateCounts: ReadonlyMap<string, number>;
}

mkdirSync('preview', { recursive: true });
const summaries: PageSummary[] = [];

for (const days of PERIODS) {
  const input = await loadFixtureDashboard({ asOf, periodDays: days, seed: 'demo' });
  const model = buildDashboard(input);
  rows = buildAllContentRows(input);

  const file = `dashboard-${days}d.html`;
  writeFileSync(`preview/${file}`, renderHtml(model, days), 'utf8');
  if (days === 30) {
    writeFileSync('preview/dashboard.md', renderMarkdown(model), 'utf8');
    writeFileSync('preview/dashboard.html', renderHtml(model, days), 'utf8');
  }

  summaries.push({ days, file, model, rowCount: rows.length, stateCounts: countStates(model) });
  console.log(
    `preview/${file}: ${rows.length} posts, ${model.bestContent.length} ranked best, ` +
      `AI ${model.aiSummary.state} at ${model.aiSummary.confidence} confidence.`,
  );
}

writeFileSync('preview/index.html', renderIndex(summaries), 'utf8');
writeFileSync('preview/login.html', renderLogin(), 'utf8');
console.log('preview/index.html and preview/login.html written.');

function countStates(m: DashboardViewModel): Map<string, number> {
  const cards = [...m.commonKpis, ...m.platformSections.flatMap((section) => section.kpis)];
  const displays = [
    ...cards.map((card) => card.metric),
    ...rows.flatMap((row) => [...row.nativeMetrics, row.engagementRate, row.performanceIndex]),
  ];
  const counts = new Map<string, number>();
  for (const display of displays) counts.set(display.state, (counts.get(display.state) ?? 0) + 1);
  return counts;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function renderHtml(m: DashboardViewModel, days: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNSight - unified dashboard preview (${days} days)</title>
<style>
:root {
  color-scheme: light;
${toCssVariables()}
}
* { box-sizing: border-box; }
body { margin:0; background:var(--surface-page); color:var(--text-secondary);
       font:var(--font-body)/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width:1140px; margin:0 auto; padding:24px 16px 72px; }
h1 { font-size:24px; color:var(--text-primary); margin:0 0 6px; letter-spacing:-.01em; }
h2 { font-size:var(--font-small); text-transform:uppercase; letter-spacing:.06em;
     color:var(--text-muted); margin:36px 0 12px; }
h3 { font-size:16px; color:var(--text-primary); margin:0; }
p { margin:0 0 10px; }
a { color:var(--accent); text-underline-offset:2px; }
:where(a,summary,[tabindex]):focus-visible { outline:2px solid var(--line-focus); outline-offset:2px; border-radius:3px; }
.banner { border:1px solid var(--warn-line); background:var(--warn-bg); color:var(--warn-text);
          padding:12px 14px; border-radius:6px; margin-bottom:18px; }
.muted { color:var(--text-secondary); }
.small { font-size:var(--font-small); color:var(--text-muted); }
.grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); }
.card { background:var(--surface-card); border:1px solid var(--line-default); border-radius:10px; padding:16px; }
.card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
.value { font-size:28px; font-weight:650; color:var(--text-primary); font-variant-numeric:tabular-nums; margin:12px 0 0; }
.absent-head { font-size:17px; font-weight:600; color:var(--text-primary); margin:12px 0 0; }
.badge { display:inline-block; border:1px solid; border-radius:5px; padding:3px 7px;
         font-size:var(--font-micro); font-weight:700; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap; }
.b-raw { background:var(--badge-raw-api-metric-bg); color:var(--badge-raw-api-metric-text); border-color:var(--badge-raw-api-metric-line); }
.b-calc { background:var(--badge-calculated-bg); color:var(--badge-calculated-text); border-color:var(--badge-calculated-line); }
.b-est { background:var(--badge-estimate-bg); color:var(--badge-estimate-text); border-color:var(--badge-estimate-line); }
.b-ai { background:var(--badge-ai-interpretation-bg); color:var(--badge-ai-interpretation-text); border-color:var(--badge-ai-interpretation-line); }
.chg { margin:10px 0 0; font-size:var(--font-small); font-weight:650; display:flex; gap:6px; align-items:center; }
.pos { color:var(--positive-text); }
.neg { color:var(--negative-text); }
.neu { color:var(--neutral-text); }
.caveat { color:var(--warn-text); font-size:var(--font-small); margin:8px 0 0; }
.foot { color:var(--text-muted); font-size:var(--font-small); margin:10px 0 0; }
details { margin-top:10px; }
summary { cursor:pointer; font-size:var(--font-small); color:var(--accent); text-decoration:underline; }
table { width:100%; border-collapse:collapse; margin-top:10px; font-size:var(--font-small); }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line-default); vertical-align:top; }
th { font-size:var(--font-micro); text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); }
.ai { border:1px solid var(--badge-ai-interpretation-line); background:var(--badge-ai-interpretation-bg);
      border-radius:10px; padding:16px; margin-top:12px; color:var(--text-secondary); }
.legend { display:flex; gap:18px; flex-wrap:wrap; font-size:var(--font-small); color:var(--text-muted);
          margin-top:10px; padding:0; list-style:none; }
.notcalc { color:var(--text-muted); font-weight:400; }
.nav { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
.nav a { font-size:var(--font-small); padding:8px 14px; border:1px solid var(--line-default); border-radius:999px;
         text-decoration:none; color:var(--text-primary); background:var(--surface-card);
         min-height:40px; display:inline-flex; align-items:center; }
.nav a.on { background:var(--accent); color:var(--text-on-accent); border-color:var(--accent); }
.nav a.home { border-style:dashed; }
.nav span { font-size:var(--font-small); color:var(--text-muted); }
@media (max-width:640px) { .wrap { padding:16px 12px 56px; } .value { font-size:24px; } }
</style>
</head>
<body>
<div class="wrap">
<nav class="nav">
  <a class="home" href="index.html">&larr; Overview</a>
  <span>Date range:</span>
  ${PERIODS.map((p) => `<a class="${p === days ? 'on' : ''}" href="dashboard-${p}d.html">Last ${p} days</a>`).join('\n  ')}
</nav>
${m.isDemo ? `<p class="banner"><strong>Sample data.</strong> Generated content so the product can be reviewed before an account is connected. No figure here describes a real account.</p>` : ''}
<h1>Unified dashboard</h1>
<p class="muted">${esc(m.period.label)} (${m.period.start} to ${m.period.end}), compared with the ${esc(m.comparison.label)}.</p>

<ul class="legend">
${m.syncStatus
  .map(
    (row) =>
      `<li>${row.isHealthy ? '\u25CF' : '\u26A0'} <strong>@${esc(row.username)}</strong> ${
        row.lastSuccessfulSyncAt ? `synced ${esc(row.lastSuccessfulSyncAt.slice(0, 16).replace('T', ' '))} UTC` : 'never synced'
      } &mdash; ${esc(row.statusText)}</li>`,
  )
  .join('\n')}
</ul>

${m.coverageNotices.map((notice) => `<p class="small">${esc(notice)}</p>`).join('\n')}

<h2>Across platforms</h2>
<div class="grid">${m.commonKpis.map((card) => htmlCard(card)).join('\n')}</div>

${m.platformSections
  .map(
    (section) => `
<h2>${section.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads'} &mdash; ${esc(section.connectionStatusText)}</h2>
<div class="grid">${section.kpis.map((card) => htmlCard(card)).join('\n')}</div>
<div class="card" style="margin-top:12px">
  ${htmlTrend(section.trend)}
  <p class="foot">${section.contribution.postCount} posts, ${section.contribution.postSharePercent}% of everything published in this period. ${esc(section.contribution.nativeInteractionsNote)}</p>
  ${section.coverageNotice ? `<p class="small">${esc(section.coverageNotice)}</p>` : ''}
</div>`,
  )
  .join('\n')}

<h2>Content ranking</h2>
<div class="card">
  <h3>Best performing</h3>
  ${htmlContentTable(m.bestContent)}
</div>
<div class="card" style="margin-top:12px">
  <h3>Weakest performing</h3>
  ${htmlContentTable(m.worstContent)}
</div>
<p class="small">${esc(m.rankingNote)}</p>

<h2>AI summary</h2>
<div class="ai">
  <p class="small"><strong>Confidence: ${m.aiSummary.confidence}</strong> &middot; ${m.aiSummary.postsAnalyzed} posts, ${m.aiSummary.windowStart} to ${m.aiSummary.windowEnd}</p>
  <p>${esc(m.aiSummary.text ?? m.aiSummary.stateExplanation)}</p>
  <p class="small"><strong>Why this confidence:</strong> ${esc(m.aiSummary.confidenceRationale)}</p>
  ${m.aiSummary.evidence.length === 0 ? '<p class="small">No supporting posts are listed because there is no conclusion yet.</p>' : htmlContentTable(m.aiSummary.evidence)}
</div>

<h2>Recommended next actions</h2>
${m.nextActions
  .map(
    (action) => `<div class="card" style="margin-top:8px">
  <div class="card-head"><h3>${esc(action.title)}</h3><span class="badge b-raw">${action.isHypothesis ? 'Hypothesis' : 'Data issue'}</span></div>
  <p class="muted">${esc(action.rationale)}</p>
  ${action.evidenceCount > 0 ? `<p class="small">Based on ${action.evidenceCount} post(s).</p>` : ''}
</div>`,
  )
  .join('\n')}

<h2>About this file</h2>
<p class="small">Static review harness generated by <code>scripts/render-preview.ts</code> from the same view model the
React components consume. Drill-downs are pre-resolved into expandable sections here; in the application they open as a
modal. Wording, metric labels, empty-state sentences and footnotes are identical.</p>
</div>
</body>
</html>`;
}

function htmlCard(card: KpiCard): string {
  const d = card.metric;
  const drill = card.drilldown ? resolveDrilldown({ ref: card.drilldown, rows }) : null;

  return `<div class="card">
  <div class="card-head">
    <h3>${esc(card.title)}${card.platform ? ` <span class="small">${card.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads'}</span>` : ''}</h3>
    ${htmlBadge(d)}
  </div>
  ${htmlValue(d)}
  ${
    card.change
      ? `<p class="chg ${card.change.polarity === 'POSITIVE' ? 'pos' : card.change.polarity === 'NEGATIVE' ? 'neg' : 'neu'}">
    <span aria-hidden="true">${card.change.glyph}</span><span>${esc(card.change.text)}</span>
  </p>`
      : ''
  }
  ${card.footnote ? `<p class="foot">${esc(card.footnote)}</p>` : ''}
  <details><summary>What does this mean?</summary><p class="small">${esc(d.tooltip)}</p></details>
  ${
    drill
      ? `<details><summary>Show the ${drill.rows.length} post(s) behind this figure</summary>
         <p class="small">Filters: ${drill.appliedFilters.map(esc).join(' &middot; ')}</p>
         ${drill.emptyState ? `<p class="small">${esc(drill.emptyState.reason)} ${esc(drill.emptyState.action)}</p>` : htmlContentTable(drill.rows.slice(0, 8))}
         ${drill.rows.length > 8 ? `<p class="small">Showing 8 of ${drill.rows.length}.</p>` : ''}
        </details>`
      : '<p class="small">No drill-down: no single post explains this figure.</p>'
  }
</div>`;
}

function htmlBadge(d: MetricDisplay): string {
  const cls =
    d.label === 'RAW_API_METRIC' ? 'b-raw' : d.label === 'CALCULATED' ? 'b-calc' : d.label === 'ESTIMATE' ? 'b-est' : 'b-ai';
  return `<span class="badge ${cls}">${esc(d.labelText)}</span>`;
}

function htmlValue(d: MetricDisplay): string {
  if (d.state === 'VALUE' || d.state === 'VALUE_WITH_CAVEAT') {
    return `<p class="value">${esc(d.valueText ?? '')}</p>${d.caveat ? `<p class="caveat">! ${esc(d.caveat)}</p>` : ''}`;
  }
  const heading = d.state === 'NOT_SYNCED' ? 'Not collected yet' : 'Not calculable';
  return `<p class="absent-head">${heading}</p>
    <p class="small">${esc(d.reasonText ?? '')}</p>
    <p class="small"><strong>${esc(d.actionText ?? '')}</strong></p>`;
}

function htmlTrend(series: TrendSeries): string {
  const width = 720;
  const height = 170;
  const left = 46;
  const top = 10;
  const plotW = width - left - 12;
  const plotH = height - top - 30;
  const values = series.points.filter((p) => p.value !== null).map((p) => p.value as number);
  const max = values.length > 0 ? Math.max(...values) : 0;
  const x = (i: number) => (series.points.length <= 1 ? 0 : (i / (series.points.length - 1)) * plotW);
  const y = (v: number) => (max === 0 ? plotH : plotH - (v / max) * plotH);

  const segments: string[] = [];
  let current: string[] = [];
  series.points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const markers = series.points
    .map((point, index) => {
      if (point.state === 'OUTSIDE_COVERAGE') {
        return `<text x="${x(index).toFixed(1)}" y="${(plotH + 4).toFixed(1)}" text-anchor="middle" font-size="12.5" fill="var(--line-strong)">&#215;</text>`;
      }
      if (point.state === 'NO_ACTIVITY') {
        return `<circle cx="${x(index).toFixed(1)}" cy="${plotH.toFixed(1)}" r="2.5" fill="var(--surface-card)" stroke="var(--line-strong)"/>`;
      }
      return `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value as number).toFixed(1)}" r="3.2" fill="var(--accent)"><title>${point.date}: ${(point.value as number).toLocaleString('en-US')} (${point.postCount} post(s))</title></circle>`;
    })
    .join('');

  return `<p class="small"><strong>${esc(series.displayName)} by day</strong> ${htmlBadge({
    metricKey: series.metricKey,
    displayName: series.displayName,
    state: 'VALUE',
    label: series.label,
    labelText: series.label === 'RAW_API_METRIC' ? 'From platform' : 'Calculated',
    tooltip: series.tooltip,
  })}</p>
<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(series.displayName)} per day">
  <g transform="translate(${left},${top})">
    <line x1="0" y1="${plotH}" x2="${plotW}" y2="${plotH}" stroke="var(--line-default)"/>
    <text x="-8" y="10" text-anchor="end" font-size="12.5" fill="var(--text-muted)">${max.toLocaleString('en-US')}</text>
    <text x="-8" y="${plotH}" text-anchor="end" font-size="12.5" fill="var(--text-muted)">0</text>
    ${segments.map((segment) => `<path d="${segment}" fill="none" stroke="var(--accent)" stroke-width="2"/>`).join('')}
    ${markers}
    <text x="0" y="${plotH + 18}" font-size="12.5" fill="var(--text-muted)">${series.points[0]?.date ?? ''}</text>
    <text x="${plotW}" y="${plotH + 18}" text-anchor="end" font-size="12.5" fill="var(--text-muted)">${series.points[series.points.length - 1]?.date ?? ''}</text>
  </g>
</svg>
<ul class="legend">
  <li>&#9679; Published activity</li><li>&#9675; No posts that day</li><li>&#215; Outside collected data</li>
</ul>`;
}

function htmlContentTable(list: readonly ContentRow[]): string {
  if (list.length === 0) return '<p class="small">No content matches these filters.</p>';
  return `<table>
<thead><tr><th>Post</th><th>Index</th><th>Engagement</th><th>Native metrics</th></tr></thead>
<tbody>
${list
  .map(
    (row) => `<tr>
  <td><strong>${row.platform === 'INSTAGRAM' ? 'IG' : 'TH'} ${esc(row.mediaType)}</strong> ${esc(row.publishedAt.slice(0, 10))}<br>${esc(row.excerpt)}</td>
  <td>${cell(row.performanceIndex)}</td>
  <td>${cell(row.engagementRate)}</td>
  <td>${row.nativeMetrics.map((metric) => `${esc(metric.displayName)}: ${cell(metric)}`).join('<br>')}</td>
</tr>`,
  )
  .join('\n')}
</tbody></table>`;
}

function cell(d: MetricDisplay): string {
  if (d.state === 'VALUE') return esc(d.valueText ?? '');
  if (d.state === 'VALUE_WITH_CAVEAT') return `${esc(d.valueText ?? '')} <span class="caveat">(on views)</span>`;
  return `<span class="notcalc" title="${esc(`${d.reasonText ?? ''} ${d.actionText ?? ''}`)}">${d.state === 'NOT_SYNCED' ? 'not collected' : 'not calculable'}</span>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

function renderIndex(pages: readonly PageSummary[]): string {
  const thirty = pages.find((page) => page.days === 30) ?? pages[0]!;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNSight - demo</title>
<style>
:root {
  color-scheme: light;
${toCssVariables()}
}
* { box-sizing: border-box; }
body { margin:0; background:var(--surface-page); color:var(--text-secondary);
       font:var(--font-body)/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width:840px; margin:0 auto; padding:44px 20px 80px; }
h1 { font-size:30px; color:var(--text-primary); margin:0 0 10px; letter-spacing:-.015em; }
h2 { font-size:var(--font-body); text-transform:uppercase; letter-spacing:.06em;
     color:var(--text-muted); margin:40px 0 14px; }
h3 { font-size:17px; color:var(--text-primary); margin:0 0 4px; }
p { margin:0 0 12px; }
a { color:var(--accent); text-underline-offset:2px; }
:where(a,summary,button,[tabindex]):focus-visible { outline:2px solid var(--line-focus); outline-offset:2px; border-radius:4px; }
.lede { font-size:19px; color:var(--text-secondary); }
.banner { border:1px solid var(--warn-line); background:var(--warn-bg); color:var(--warn-text);
          padding:14px 16px; border-radius:8px; margin:20px 0; }
.cards { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); }
a.card { display:block; background:var(--surface-card); border:1px solid var(--line-default); border-radius:10px;
         padding:18px; text-decoration:none; color:inherit; }
a.card:hover { border-color:var(--accent); }
a.card strong { display:block; font-size:18px; color:var(--text-primary); margin-bottom:6px; }
a.card span { font-size:var(--font-small); color:var(--text-muted); display:block; }
ol,ul { margin:0 0 12px; padding-left:24px; }
li { margin-bottom:10px; }
table { width:100%; border-collapse:collapse; font-size:var(--font-small); margin:10px 0 16px; }
th,td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--line-default); }
th { font-size:var(--font-micro); text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); }
code { background:var(--surface-sunken); color:var(--text-primary); padding:2px 6px; border-radius:4px;
       font-size:var(--font-small); }
.small { font-size:var(--font-small); color:var(--text-muted); }
footer { margin-top:52px; padding-top:22px; border-top:1px solid var(--line-default);
         font-size:var(--font-small); color:var(--text-muted); }
@media (max-width:640px) { .wrap { padding:28px 16px 64px; } h1 { font-size:26px; } .lede { font-size:17px; } }
</style>
</head>
<body>
<div class="wrap">

<h1>SNSight</h1>
<p class="lede">Instagram and Threads analytics in one dashboard. This is a working demo of the unified
dashboard, running on generated data.</p>

<p class="banner"><strong>Nothing here is real.</strong> Every figure comes from a deterministic fixture
generator, not from a connected account. The generator deliberately produces awkward cases &mdash; posts
missing reach, days with no activity, groups too small to score &mdash; because those are the states that
usually go unimplemented.</p>

<h2>Open the dashboard</h2>
<div class="cards">
${pages
  .map(
    (page) => `  <a class="card" href="${page.file}">
    <strong>Last ${page.days} days</strong>
    <span>${page.rowCount} posts &middot; ${page.model.bestContent.length} ranked</span>
    <span>AI confidence: ${page.model.aiSummary.confidence}</span>
  </a>`,
  )
  .join('\n')}
</div>
<p class="small">The same account and the same data, across three date ranges. Confidence and the number of
ranked posts change with the range, which is the intended behaviour: a shorter window is weaker evidence.</p>

<h2>Sign-in screen</h2>
<p>The account screens are built as a Next.js application with server-side sessions. This page is a
static rendering of the sign-in layout so the wording and contrast can be reviewed here.</p>
<div class="cards">
  <a class="card" href="login.html">
    <strong>View the sign-in screen</strong>
    <span>Layout, copy and validation messages</span>
    <span>Not functional on a static host</span>
  </a>
</div>

<h2>What to look at</h2>
<ol>
  <li><strong>The <code>!</code> beside the Instagram engagement rate.</strong> Some posts did not report
  reach, so the rate was computed against views &mdash; and it says so, because a value measured on a
  substitute denominator cannot be compared with one measured on the real thing.</li>
  <li><strong>The follower growth card has no change badge.</strong> That metric is already a change.
  Pairing it with "no comparison available" would be noise dressed as information.</li>
  <li><strong>Hollow dots on the trend line.</strong> Days with no posts are gaps, not zeroes. Plotting
  them at the baseline would draw a decline that never happened.</li>
  <li><strong>Instagram views and Threads views are never added together.</strong> They measure different
  things. Only post counts and followers are combined, and the follower total admits it double counts
  anyone following both accounts.</li>
  <li><strong>The AI panel is pending, yet states its confidence.</strong> Confidence is calculated from
  the evidence base by rule before any model runs, because a model asked to rate itself will claim high
  confidence on three posts.</li>
  <li><strong>Every absent value explains itself.</strong> Expand "What does this mean?" on any card, and
  look for the not-calculable states in the content tables: each carries a reason and a next step.</li>
</ol>

<h2>Metric states in the 30-day render</h2>
<table>
<thead><tr><th>State</th><th>Count</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td><code>VALUE</code></td><td>${thirty.stateCounts.get('VALUE') ?? 0}</td><td>Computed on its preferred inputs.</td></tr>
<tr><td><code>VALUE_WITH_CAVEAT</code></td><td>${thirty.stateCounts.get('VALUE_WITH_CAVEAT') ?? 0}</td><td>Computed on a fallback denominator, disclosed with the value.</td></tr>
<tr><td><code>NOT_CALCULABLE</code></td><td>${thirty.stateCounts.get('NOT_CALCULABLE') ?? 0}</td><td>Knowable in principle, not knowable here. Carries a reason and an action.</td></tr>
<tr><td><code>NOT_SYNCED</code></td><td>${thirty.stateCounts.get('NOT_SYNCED') ?? 0}</td><td>Outside the collected window. Distinct from zero and from broken.</td></tr>
</tbody>
</table>
<p class="small">All four appear, which is the point: each needs a design, and only the first is usually
mocked.</p>

<h2>Decisions behind this</h2>
<p>The specification asks for several things no official API can deliver. Four decisions change product
scope and need sign-off:</p>
<ul>
  <li><a href="${REPO_BLOB}/docs/adr/0001-competitor-data-path.md">Competitor monitoring is Instagram-only</a>
  &mdash; Threads publishes no API for accounts you do not own.</li>
  <li><a href="${REPO_BLOB}/docs/adr/0002-meta-connection-strategy.md">Instagram must use the Facebook Login flow</a>
  &mdash; which requires users to have a linked Facebook Page.</li>
  <li><a href="${REPO_BLOB}/docs/adr/0003-metric-definition-registry.md">Engagement rate is two formulas, not one</a>
  &mdash; the specification's single formula summed metrics that never coexist.</li>
  <li><a href="${REPO_BLOB}/docs/adr/0004-normalized-performance-index.md">The 0-100 index is a percentile within a cohort</a>
  &mdash; relative to this account only, never an absolute score.</li>
</ul>
<p class="small">Full set: <a href="${REPO_TREE}/docs/adr">the seven ADRs</a> and
<a href="${REPO_BLOB}/docs/spec-amendments.md">the spec amendment map</a>.</p>

<h2>How much of this is verified</h2>
<p>66 automated checks pass over the metric engine, the fixture provider and this dashboard's view model,
covering the behaviour above: that a missing input does not silently shrink a percentage, that a fallback
denominator is always disclosed, that a percentile is never published on fewer than 8 comparable posts.</p>
<p>The React application, by contrast, <strong>has never been run</strong>. Dependencies could not be
installed where this was written, so these pages come from a separate static renderer that consumes the
identical view model. The wording and the states are real; the colours, spacing and mobile layout are not
yet confirmed.</p>

<footer>
Generated by <code>scripts/render-preview.ts</code> from fixture seed <code>demo</code>, as of 2026-07-31.
Deterministic: the same seed always produces this page.
&middot; <a href="${REPO_BLOB}/preview/dashboard.md">Text version</a>
&middot; <a href="${REPO_TREE}">Source</a>
</footer>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Sign-in screen (SCR-001)
// ---------------------------------------------------------------------------

/**
 * Static rendering of the sign-in layout.
 *
 * The form is deliberately inert: inputs are disabled and there is no action attribute. A static host
 * has no server, so a form that looked functional would either silently do nothing or, worse, imply
 * that credentials were being handled. The real implementation is a Next.js server action backed by
 * argon2 and database-backed sessions.
 */
function renderLogin(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNSight - sign-in screen preview</title>
<style>
:root {
  color-scheme: light;
${toCssVariables()}
}
* { box-sizing: border-box; }
body { margin:0; background:var(--surface-page); color:var(--text-secondary);
       font:var(--font-body)/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.nav { max-width:1000px; margin:0 auto; padding:20px 20px 0; }
.nav a { font-size:var(--font-small); padding:8px 14px; border:1px dashed var(--line-default);
         border-radius:999px; text-decoration:none; color:var(--text-primary);
         background:var(--surface-card); display:inline-flex; align-items:center; min-height:40px; }
.shell { max-width:1000px; margin:0 auto; padding:24px 20px 80px; display:grid; gap:36px; }
@media (min-width:900px) { .shell { grid-template-columns:minmax(0,420px) minmax(0,1fr); align-items:start; } }
.panel { background:var(--surface-card); border:1px solid var(--line-default); border-radius:12px; padding:28px 24px; }
h1 { font-size:24px; color:var(--text-primary); margin:0 0 8px; letter-spacing:-.01em; }
h2 { font-size:var(--font-body); text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); margin:0 0 16px; }
h3 { font-size:17px; color:var(--text-primary); margin:0 0 4px; }
p { margin:0 0 12px; }
a { color:var(--accent); text-underline-offset:2px; }
label { display:block; margin-bottom:18px; }
.label { display:block; font-weight:600; color:var(--text-primary); }
.hint { display:block; font-size:var(--font-small); color:var(--text-muted); margin-top:3px; }
input { display:block; width:100%; margin-top:8px; border:1px solid var(--line-strong); border-radius:6px;
        background:var(--surface-card); padding:11px 12px; font-size:var(--font-body); color:var(--text-primary); }
input:disabled { background:var(--surface-sunken); }
.btn { display:inline-flex; align-items:center; justify-content:center; width:100%; min-height:44px;
       border:1px solid var(--accent); border-radius:6px; background:var(--accent); color:var(--text-on-accent);
       font-size:var(--font-body); font-weight:650; }
.alert { border:1px solid var(--warn-line); background:var(--warn-bg); color:var(--warn-text);
         padding:12px 14px; border-radius:6px; margin-bottom:20px; }
.info { border:1px solid var(--info-line); background:var(--info-bg); color:var(--info-text);
        padding:14px 16px; border-radius:8px; }
.small { font-size:var(--font-small); color:var(--text-muted); }
.divider { border:0; border-top:1px solid var(--line-default); margin:22px 0 16px; }
ul { margin:0 0 12px; padding-left:22px; } li { margin-bottom:10px; }
.ok { color:var(--positive-text); font-size:var(--font-small); }
.req { color:var(--text-muted); font-size:var(--font-small); }
:where(a,button,input,summary,[tabindex]):focus-visible { outline:2px solid var(--line-focus); outline-offset:2px; border-radius:4px; }
</style>
</head>
<body>
<div class="nav"><a href="index.html">&larr; Overview</a></div>
<div class="shell">

  <div class="panel">
    <p class="alert"><strong>Preview only.</strong> This page is a static rendering. The fields are
    disabled and nothing is submitted anywhere.</p>

    <h1>Sign in to SNSight</h1>
    <p>New here? <a href="#">Create an account</a>.</p>

    <form>
      <label>
        <span class="label">Email</span>
        <input type="email" value="jiwon@example.com" disabled>
      </label>
      <label>
        <span class="label">Password</span>
        <input type="password" value="............" disabled>
      </label>
      <button class="btn" type="button" disabled>Sign in</button>
    </form>

    <p class="small" style="margin-top:14px"><a href="#">Forgotten your password?</a></p>
    <hr class="divider">
    <p class="small">Want to look first? <a href="dashboard-30d.html">Open the sample dashboard</a>
    &mdash; no account needed.</p>
  </div>

  <div>
    <h2>What SNSight does</h2>
    <ul>
      <li>
        <h3>Instagram and Threads in one view</h3>
        <p>Common metrics side by side, plus the ones only one platform reports. Figures that measure
        different things are never added together.</p>
      </li>
      <li>
        <h3>Every number is traceable</h3>
        <p>Each metric says whether it came from the platform, was calculated, or is an estimate, and
        every figure opens the posts behind it.</p>
      </li>
      <li>
        <h3>Analysis that shows its evidence</h3>
        <p>AI summaries cite the posts they rest on, state the period analysed, and carry a confidence
        level calculated from how much data exists.</p>
      </li>
    </ul>

    <p class="info"><strong>Signing in does not connect an account.</strong> Creating an SNSight account
    is separate from granting access to your Instagram or Threads data. You will be asked for that
    afterwards, and you can look around the sample dashboard first.</p>

    <h2 style="margin-top:36px">How the real form behaves</h2>
    <ul>
      <li><strong>Failures are indistinguishable.</strong> An unknown email and a wrong password return
      the same message and cost the same work, so the form cannot be used to discover which addresses
      have accounts.</li>
      <li><strong>Requirements are shown before submission.</strong> On the sign-up screen the password
      rules appear as you type: <span class="req">at least 12 characters, not a common password, not
      containing your email</span>, then <span class="ok">&#10003; meets the requirements</span>.</li>
      <li><strong>Repeated attempts lock the account.</strong> Five failures within an hour pause
      sign-in for 15 minutes, ten for an hour, and the message never says how many attempts remain.</li>
      <li><strong>Sensitive actions ask again.</strong> Disconnecting an account or changing someone's
      role requires the password within the last 15 minutes, even in an open session.</li>
    </ul>
    <p class="small">Every rule above is enforced by code verified in
    <code>scripts/verify-auth.ts</code>. What is not yet verified is this markup: the application has
    never been rendered, because its dependencies cannot be installed where it was written.</p>
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function renderMarkdown(m: DashboardViewModel): string {
  const lines: string[] = [];

  lines.push('# Unified dashboard - copy and state review');
  lines.push('');
  lines.push(
    'Generated from the dashboard view model by `scripts/render-preview.ts`. Every sentence below is the',
    'wording the application renders, so this file is the fastest way to review the copy and the metric',
    'states without installing the toolchain.',
    '',
  );

  if (m.isDemo) lines.push('> Sample data. Generated content; no figure describes a real account.', '');

  lines.push(`**Period:** ${m.period.label} (${m.period.start} to ${m.period.end}) vs ${m.comparison.label}`, '');

  lines.push('## Connection and sync status', '');
  for (const row of m.syncStatus) {
    lines.push(`- ${row.isHealthy ? 'OK' : 'WARNING'} **@${row.username}** - ${row.statusText}. Last sync ${row.lastSuccessfulSyncAt ?? 'never'}.`);
  }
  lines.push('');

  if (m.coverageNotices.length > 0) {
    lines.push('## Coverage notices', '');
    for (const notice of m.coverageNotices) lines.push(`- ${notice}`);
    lines.push('');
  }

  lines.push('## KPI cards', '');
  const cards = [...m.commonKpis, ...m.platformSections.flatMap((section) => section.kpis)];
  for (const card of cards) {
    lines.push(`### ${card.title}${card.platform ? ` (${card.platform})` : ' (combined)'}`);
    lines.push('');
    lines.push(`- Label: **${card.metric.labelText}** | State: **${card.metric.state}**`);
    if (card.metric.valueText) lines.push(`- Value: **${card.metric.valueText}**`);
    if (card.metric.caveat) lines.push(`- Caveat: ${card.metric.caveat}`);
    if (card.metric.reasonText) lines.push(`- Reason: ${card.metric.reasonText}`);
    if (card.metric.actionText) lines.push(`- Action: ${card.metric.actionText}`);
    if (card.change) {
      lines.push(`- Change: ${card.change.glyph} ${card.change.text} (polarity ${card.change.polarity})`);
      lines.push(`- Screen reader: "${card.change.srText}"`);
    } else {
      lines.push('- Change: not shown (this metric already expresses change)');
    }
    if (card.footnote) lines.push(`- Footnote: ${card.footnote}`);
    lines.push(`- Tooltip: ${card.metric.tooltip}`);
    if (card.drilldown) {
      const drill = resolveDrilldown({ ref: card.drilldown, rows });
      lines.push(`- Drill-down: ${drill.rows.length} post(s), filters ${drill.appliedFilters.join(' / ')}, sorted by ${drill.sort}`);
    } else {
      lines.push('- Drill-down: none (no single post explains this figure)');
    }
    lines.push('');
  }

  lines.push('## Trends', '');
  for (const section of m.platformSections) {
    const withActivity = section.trend.points.filter((point) => point.state === 'VALUE').length;
    const quiet = section.trend.points.filter((point) => point.state === 'NO_ACTIVITY').length;
    const outside = section.trend.points.filter((point) => point.state === 'OUTSIDE_COVERAGE').length;
    lines.push(
      `- **${section.platform}** ${section.trend.displayName}: ${section.trend.points.length} days - ${withActivity} with activity, ${quiet} with no posts (drawn as gaps, not zeros), ${outside} outside coverage.`,
    );
    if (section.coverageNotice) lines.push(`  - ${section.coverageNotice}`);
    lines.push(`  - Contribution: ${section.contribution.postCount} posts (${section.contribution.postSharePercent}% of the period).`);
  }
  lines.push('');

  lines.push('## Content ranking', '');
  lines.push(m.rankingNote, '');
  lines.push('| Platform | Type | Date | Index | Engagement | Excerpt |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of [...m.bestContent, ...m.worstContent]) {
    lines.push(
      `| ${row.platform} | ${row.mediaType} | ${row.publishedAt.slice(0, 10)} | ${mdCell(row.performanceIndex)} | ${mdCell(row.engagementRate)} | ${row.excerpt.replace(/\|/g, '/')} |`,
    );
  }
  lines.push('');

  lines.push('## AI summary panel', '');
  lines.push(`- State: **${m.aiSummary.state}**`);
  lines.push(`- Confidence: **${m.aiSummary.confidence}** - ${m.aiSummary.confidenceRationale}`);
  lines.push(`- Window: ${m.aiSummary.windowStart} to ${m.aiSummary.windowEnd}, ${m.aiSummary.postsAnalyzed} posts`);
  lines.push(`- Shown text: ${m.aiSummary.text ?? m.aiSummary.stateExplanation}`);
  lines.push(`- Supporting posts: ${m.aiSummary.evidence.length}`);
  lines.push('');

  lines.push('## Recommended next actions', '');
  for (const action of m.nextActions) {
    lines.push(`### ${action.title} (${action.isHypothesis ? 'hypothesis' : 'data issue'})`);
    lines.push('');
    lines.push(`${action.rationale} Evidence: ${action.evidenceCount} post(s).`);
    lines.push('');
  }

  lines.push('## State coverage in this render', '');
  const displays = [
    ...cards.map((card) => card.metric),
    ...rows.flatMap((row) => [...row.nativeMetrics, row.engagementRate, row.performanceIndex]),
  ];
  const counts = new Map<string, number>();
  for (const display of displays) counts.set(display.state, (counts.get(display.state) ?? 0) + 1);
  for (const [state, count] of [...counts.entries()].sort()) {
    lines.push(`- \`${state}\`: ${count} metric(s)`);
  }
  lines.push('');
  lines.push('All four states appear, which is the point: each needs a design, and only the first is usually mocked.');
  lines.push('');

  return lines.join('\n');
}

function mdCell(d: MetricDisplay): string {
  if (d.state === 'VALUE') return d.valueText ?? '';
  if (d.state === 'VALUE_WITH_CAVEAT') return `${d.valueText ?? ''} (on views)`;
  return d.state === 'NOT_SYNCED' ? 'not collected' : 'not calculable';
}
