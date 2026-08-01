# Unified dashboard - copy and state review

Generated from the dashboard view model by `scripts/render-preview.ts`. Every sentence below is the
wording the application renders, so this file is the fastest way to review the copy and the metric
states without installing the toolchain.

> Sample data. Generated content; no figure describes a real account.

**Period:** Last 30 days (2026-07-02 to 2026-07-31) vs previous 30 days

## Connection and sync status

- OK **@demo.studio** - Connected. Last sync 2026-07-30T23:18:00.000Z.
- WARNING **@demo.studio.threads** - Connection expires soon - reconnect to avoid a gap. Last sync 2026-07-30T23:18:00.000Z.

## Coverage notices

- This workspace uses generated sample data. No figure here describes a real account.

## KPI cards

### Followers (combined)

- Label: **From platform** | State: **VALUE**
- Value: **25,895**
- Change: ▲ +4.2% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 4.2 percent compared with previous 30 days."
- Footnote: Combined across platforms. The same person may follow both accounts, so this is not a unique-audience figure.
- Tooltip: Followers at the end of the selected period. Instagram and Threads followers are added together.
- Drill-down: none (no single post explains this figure)

### Follower growth (combined)

- Label: **Calculated** | State: **VALUE**
- Value: **4.2%**
- Change: not shown (this metric already expresses change)
- Footnote: Growth across the selected period, not against the comparison period.
- Tooltip: How much the follower count grew or shrank across the selected period. Formula: (ending followers - starting followers) / starting followers x 100.
- Drill-down: none (no single post explains this figure)

### Posts published (combined)

- Label: **Calculated** | State: **VALUE**
- Value: **35**
- Change: ▲ +25.0% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 25.0 percent compared with previous 30 days."
- Footnote: A post is a post on both platforms, so this total is combined. Views and interactions are not.
- Tooltip: Posts published inside the selected period. Counted from collected media, so it can differ from the platform profile total when the period predates collection. Formula: count of posts published within the period.
- Drill-down: 35 post(s), filters All platforms / 2026-07-02 to 2026-07-31, sorted by NEWEST

### Views (INSTAGRAM)

- Label: **From platform** | State: **VALUE**
- Value: **664,304**
- Change: ▲ +27.7% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 27.7 percent compared with previous 30 days."
- Tooltip: Plays or views of the post. Recent Instagram API versions consolidated older impression-style metrics into views, which is why this definition carries an availability window.
- Drill-down: 19 post(s), filters Instagram / 2026-07-02 to 2026-07-31, sorted by VIEWS

### Interactions (INSTAGRAM)

- Label: **Calculated** | State: **VALUE**
- Value: **26,980**
- Change: ▲ +39.7% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 39.7 percent compared with previous 30 days."
- Tooltip: Sum of Instagram interactions on the post. Saves and shares are owner-only, so this is unavailable for competitors. Formula: likes + comments + saves + shares.
- Drill-down: 19 post(s), filters Instagram / 2026-07-02 to 2026-07-31, sorted by INTERACTIONS

### Engagement rate (INSTAGRAM)

- Label: **Calculated** | State: **VALUE_WITH_CAVEAT**
- Value: **4.1%**
- Caveat: Calculated on views because the preferred denominator was unavailable. Not directly comparable with values based on reach.
- Change: ▲ +9.5% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 9.5 percent compared with previous 30 days."
- Footnote: Some posts did not report reach, so this period is measured against views.
- Tooltip: The share of accounts that saw the post and then interacted with it. Instagram and Threads engagement rates are calculated differently and are not directly comparable. Formula: (likes + comments + saves + shares) / reach x 100.
- Drill-down: 19 post(s), filters Instagram / 2026-07-02 to 2026-07-31, sorted by ENGAGEMENT_RATE

### Views (THREADS)

- Label: **From platform** | State: **VALUE**
- Value: **475,837**
- Change: ▲ +36.9% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 36.9 percent compared with previous 30 days."
- Footnote: Threads views are not equivalent to Instagram reach and are never added to it.
- Tooltip: How many times the thread was viewed. Threads reports views rather than reach, so this figure is never added to an Instagram reach total. Platform data available from 2024-04-13.
- Drill-down: 16 post(s), filters Threads / 2026-07-02 to 2026-07-31, sorted by VIEWS

### Interactions (THREADS)

- Label: **Calculated** | State: **VALUE**
- Value: **13,466**
- Change: ▲ +62.8% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 62.8 percent compared with previous 30 days."
- Tooltip: Sum of Threads interactions on the post. Formula: likes + replies + reposts + quotes. Platform data available from 2024-04-13.
- Drill-down: 16 post(s), filters Threads / 2026-07-02 to 2026-07-31, sorted by INTERACTIONS

### Engagement rate (THREADS)

- Label: **Calculated** | State: **VALUE**
- Value: **2.8%**
- Change: ▲ +18.9% vs previous 30 days (polarity POSITIVE)
- Screen reader: "Increased 18.9 percent compared with previous 30 days."
- Tooltip: The share of views that produced any interaction: a like, reply, repost or quote. Formula: (likes + replies + reposts + quotes) / views x 100. Platform data available from 2024-04-13.
- Drill-down: 16 post(s), filters Threads / 2026-07-02 to 2026-07-31, sorted by ENGAGEMENT_RATE

## Trends

- **INSTAGRAM** Views: 30 days - 11 with activity, 19 with no posts (drawn as gaps, not zeros), 0 outside coverage.
  - Contribution: 19 posts (54.3% of the period).
- **THREADS** Views: 30 days - 12 with activity, 18 with no posts (drawn as gaps, not zeros), 0 outside coverage.
  - Contribution: 16 posts (45.7% of the period).

## Content ranking

Ranked by performance index, which compares each post with others of the same type on the same account. Native metrics are shown alongside, since a high index can accompany modest absolute numbers. 2 of 35 posts are unranked: their cohort has fewer than 8 comparable posts, or their engagement rate could not be calculated.

| Platform | Type | Date | Index | Engagement | Excerpt |
| --- | --- | --- | --- | --- | --- |
| THREADS | TH_VIDEO | 2026-07-18 | 100 / 100 | 7.7% | question: ask me anything #6 |
| THREADS | TH_VIDEO | 2026-07-23 | 94 / 100 | 6.9% | personal experience: product tips #11 |
| THREADS | TH_IMAGE | 2026-07-31 | 90 / 100 | 6.1% | personal experience: ask me anything #15 |
| THREADS | TH_VIDEO | 2026-07-17 | 0 / 100 | 0.9% | plain information: behind the scenes #4 |
| INSTAGRAM | IG_REEL | 2026-07-16 | 14 / 100 | 2.8% | conclusion first: ask me anything #5 |
| THREADS | TH_VIDEO | 2026-07-09 | 17 / 100 | 1.6% | question: routine #1 |

## AI summary panel

- State: **PENDING**
- Confidence: **HIGH** - 35 posts across 30 days, with 97% of required metrics available.
- Window: 2026-07-02 to 2026-07-31, 35 posts
- Shown text: Written analysis is generated in the background and appears here when it is ready. Confidence is calculated from the evidence base before analysis runs, so it is shown now.
- Supporting posts: 0

## Recommended next actions

### Reconnect Instagram to restore reach-based rates (data issue)

3 post(s) were measured against views because reach was unavailable, which is not comparable with reach-based rates elsewhere on this dashboard. Evidence: 3 post(s).

## State coverage in this render

- `NOT_CALCULABLE`: 3 metric(s)
- `NOT_SYNCED`: 3 metric(s)
- `VALUE`: 244 metric(s)
- `VALUE_WITH_CAVEAT`: 4 metric(s)

All four states appear, which is the point: each needs a design, and only the first is usually mocked.
