import type { TrendPoint, TrendSeries } from '@/lib/dashboard/types';
import { MetricLabelBadge } from './primitives';

/**
 * Inline SVG trend chart. No charting dependency, because the one behaviour that matters here is
 * specific: gaps must stay gaps.
 *
 * A day with no posts and a day outside the collection window are drawn differently from each other
 * and from a real zero. Most chart libraries default to connecting across nulls or plotting them at
 * the baseline, which invents a decline (spec 6.1, and the FR-003 requirement to show real coverage).
 *
 * Every plotted point is a button, satisfying "clicking a chart data point must reveal the
 * corresponding content".
 */
export function TrendChart({
  series,
  onSelectDate,
}: {
  series: TrendSeries;
  onSelectDate?: (date: string) => void;
}) {
  const width = 720;
  const height = 180;
  const padding = { top: 12, right: 12, bottom: 28, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = series.points.filter((p) => p.value !== null).map((p) => p.value as number);
  const max = values.length > 0 ? Math.max(...values) : 0;
  const scaleY = (value: number): number => (max === 0 ? plotHeight : plotHeight - (value / max) * plotHeight);
  const scaleX = (index: number): number =>
    series.points.length <= 1 ? 0 : (index / (series.points.length - 1)) * plotWidth;

  // Segments break wherever a value is absent, so the line is never drawn across a gap.
  const segments: string[] = [];
  let current: string[] = [];
  series.points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${scaleX(index).toFixed(1)},${scaleY(point.value).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  return (
    <figure className="mt-4">
      <figcaption className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">
          {series.displayName} by day &middot; {series.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads'}
        </span>
        <MetricLabelBadge
          display={{
            metricKey: series.metricKey,
            displayName: series.displayName,
            state: 'VALUE',
            label: series.label,
            labelText: series.label === 'RAW_API_METRIC' ? 'From platform' : 'Calculated',
            tooltip: series.tooltip,
          }}
        />
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${series.displayName} per day. ${values.length} days with activity out of ${series.points.length}.`}
      >
        <g transform={`translate(${padding.left},${padding.top})`}>
          <line x1={0} y1={plotHeight} x2={plotWidth} y2={plotHeight} stroke="#cbd5e1" strokeWidth={1} />
          <text x={-8} y={10} textAnchor="end" className="fill-slate-500 text-[10px]">
            {max.toLocaleString('en-US')}
          </text>
          <text x={-8} y={plotHeight} textAnchor="end" className="fill-slate-500 text-[10px]">
            0
          </text>

          {segments.map((segment, index) => (
            <path key={index} d={segment} fill="none" stroke="#0369a1" strokeWidth={2} />
          ))}

          {series.points.map((point, index) => (
            <PointMarker
              key={point.date}
              point={point}
              x={scaleX(index)}
              y={point.value === null ? plotHeight : scaleY(point.value)}
              onSelectDate={onSelectDate}
            />
          ))}

          <text x={0} y={plotHeight + 18} className="fill-slate-500 text-[10px]">
            {series.points[0]?.date}
          </text>
          <text x={plotWidth} y={plotHeight + 18} textAnchor="end" className="fill-slate-500 text-[10px]">
            {series.points[series.points.length - 1]?.date}
          </text>
        </g>
      </svg>

      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-sky-700" /> Published activity
        </li>
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-slate-400 bg-white" /> No
          posts that day
        </li>
        <li className="flex items-center gap-1">
          <span aria-hidden="true">&#215;</span> Outside collected data
        </li>
      </ul>

      {series.uncoveredDates.length > 0 ? (
        <p className="mt-2 text-xs text-slate-600">
          {series.uncoveredDates.length} day(s) in this range precede the start of collection for this account and are
          shown as outside coverage rather than as zero.
        </p>
      ) : null}
    </figure>
  );
}

function PointMarker({
  point,
  x,
  y,
  onSelectDate,
}: {
  point: TrendPoint;
  x: number;
  y: number;
  onSelectDate?: (date: string) => void;
}) {
  if (point.state === 'OUTSIDE_COVERAGE') {
    return (
      <text x={x} y={y + 4} textAnchor="middle" className="fill-slate-400 text-[10px]" aria-hidden="true">
        &#215;
      </text>
    );
  }

  if (point.state === 'NO_ACTIVITY') {
    return <circle cx={x} cy={y} r={2.5} fill="#ffffff" stroke="#94a3b8" strokeWidth={1} />;
  }

  const label = `${point.date}: ${point.value?.toLocaleString('en-US')} (${point.postCount} post${point.postCount === 1 ? '' : 's'})`;

  if (!onSelectDate) {
    return <circle cx={x} cy={y} r={3} fill="#0369a1" aria-label={label} />;
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${label}. Select to see the posts.`}
      className="cursor-pointer"
      onClick={() => onSelectDate(point.date)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelectDate(point.date);
      }}
    >
      {/* Generous transparent hit area: a 3px dot is not a usable touch target. */}
      <circle cx={x} cy={y} r={12} fill="transparent" />
      <circle cx={x} cy={y} r={3.5} fill="#0369a1" />
    </g>
  );
}
