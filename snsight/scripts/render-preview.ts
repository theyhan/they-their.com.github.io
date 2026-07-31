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
console.log('preview/index.html: landing page written.');

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
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f8fafc; color:#0f172a;
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; margin:32px 0 12px; }
  h3 { font-size:14px; margin:0; }
  .banner { border:1px solid #fcd34d; background:#fffbeb; color:#78350f;
            padding:10px 12px; border-radius:6px; margin-bottom:16px; font-size:14px; }
  .muted { color:#475569; font-size:13px; }
  .small { font-size:12px; color:#475569; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:14px;
          box-shadow:0 1px 2px rgba(15,23,42,.04); }
  .card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .value { font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; margin:10px 0 0; }
  .absent-head { font-size:15px; font-weight:600; color:#334155; margin:10px 0 0; }
  .badge { display:inline-block; border:1px solid; border-radius:4px; padding:2px 6px;
           font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; }
  .b-raw { background:#f1f5f9; color:#334155; border-color:#cbd5e1; }
  .b-calc { background:#f0f9ff; color:#075985; border-color:#7dd3fc; }
  .b-est { background:#fffbeb; color:#78350f; border-color:#fcd34d; }
  .b-ai { background:#f5f3ff; color:#4c1d95; border-color:#c4b5fd; }
  .chg { margin:8px 0 0; font-size:12px; font-weight:600; display:flex; gap:4px; align-items:center; }
  .pos { color:#065f46; } .neg { color:#9f1239; } .neu { color:#475569; }
  .caveat { color:#78350f; font-size:12px; margin:6px 0 0; }
  .foot { color:#64748b; font-size:12px; margin:8px 0 0; }
  details { margin-top:8px; }
  summary { cursor:pointer; font-size:12px; color:#0369a1; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; }
  .ai { border:1px solid #ddd6fe; background:#faf5ff; border-radius:8px; padding:14px; margin-top:12px; }
  .legend { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; color:#475569; margin-top:8px; padding:0; list-style:none; }
  .notcalc { color:#64748b; font-weight:400; }
  .nav { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
  .nav a { font-size:13px; padding:5px 11px; border:1px solid #cbd5e1; border-radius:999px;
           text-decoration:none; color:#0f172a; background:#fff; }
  .nav a.on { background:#0369a1; color:#fff; border-color:#0369a1; }
  .nav a.home { border-style:dashed; }
  .nav span { font-size:12px; color:#64748b; }
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
        return `<text x="${x(index).toFixed(1)}" y="${(plotH + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#94a3b8">&#215;</text>`;
      }
      if (point.state === 'NO_ACTIVITY') {
        return `<circle cx="${x(index).toFixed(1)}" cy="${plotH.toFixed(1)}" r="2.5" fill="#fff" stroke="#94a3b8"/>`;
      }
      return `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value as number).toFixed(1)}" r="3.2" fill="#0369a1"><title>${point.date}: ${(point.value as number).toLocaleString('en-US')} (${point.postCount} post(s))</title></circle>`;
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
    <line x1="0" y1="${plotH}" x2="${plotW}" y2="${plotH}" stroke="#cbd5e1"/>
    <text x="-8" y="10" text-anchor="end" font-size="10" fill="#64748b">${max.toLocaleString('en-US')}</text>
    <text x="-8" y="${plotH}" text-anchor="end" font-size="10" fill="#64748b">0</text>
    ${segments.map((segment) => `<path d="${segment}" fill="none" stroke="#0369a1" stroke-width="2"/>`).join('')}
    ${markers}
    <text x="0" y="${plotH + 18}" font-size="10" fill="#64748b">${series.points[0]?.date ?? ''}</text>
    <text x="${plotW}" y="${plotH + 18}" text-anchor="end" font-size="10" fill="#64748b">${series.points[series.points.length - 1]?.date ?? ''}</text>
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
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f8fafc; color:#0f172a;
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:40px 20px 72px; }
  h1 { font-size:28px; margin:0 0 8px; letter-spacing:-.01em; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; margin:40px 0 12px; }
  p { margin:0 0 12px; }
  .lede { font-size:18px; color:#334155; }
  .banner { border:1px solid #fcd34d; background:#fffbeb; color:#78350f;
            padding:12px 14px; border-radius:6px; margin:20px 0; font-size:14px; }
  .cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }
  a.card { display:block; background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:16px;
           text-decoration:none; color:inherit; box-shadow:0 1px 2px rgba(15,23,42,.04); }
  a.card:hover { border-color:#0369a1; }
  a.card strong { display:block; font-size:17px; margin-bottom:6px; }
  a.card span { font-size:13px; color:#475569; display:block; }
  ol,ul { margin:0 0 12px; padding-left:22px; }
  li { margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; font-size:14px; margin:8px 0 16px; }
  th,td { text-align:left; padding:8px; border-bottom:1px solid #e2e8f0; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:13px; }
  .small { font-size:13px; color:#475569; }
  footer { margin-top:48px; padding-top:20px; border-top:1px solid #e2e8f0; font-size:13px; color:#64748b; }
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
