import type { KpiCard } from '@/lib/dashboard/types';
import { ChangeBadge, MetricLabelBadge, MetricTooltip, MetricValueBlock } from './primitives';

/**
 * A KPI card (SCR-002 row 1). Every card is a drill-down affordance when content can explain it
 * (FR-009); cards whose figure no single post explains, such as a follower total, render as static
 * so the product does not imply a causal link the data cannot support.
 */
export function KpiCardView({ card, onDrilldown }: { card: KpiCard; onDrilldown?: (card: KpiCard) => void }) {
  const interactive = card.drilldown !== null && onDrilldown !== undefined;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">
          {card.title}
          {card.platform ? (
            <span className="ml-1 text-xs font-normal text-slate-500">
              {card.platform === 'INSTAGRAM' ? 'Instagram' : 'Threads'}
            </span>
          ) : null}
        </h3>
        <MetricLabelBadge display={card.metric} />
      </div>

      <div className="mt-3">
        <MetricValueBlock display={card.metric} />
        {card.change ? <ChangeBadge change={card.change} /> : null}
      </div>

      {card.footnote ? <p className="mt-2 text-xs leading-relaxed text-slate-500">{card.footnote}</p> : null}
      <MetricTooltip display={card.metric} />
      {interactive ? (
        <p className="mt-2 text-xs font-medium text-sky-800">View the {card.metric.displayName.toLowerCase()} behind this &rarr;</p>
      ) : null}
    </>
  );

  if (!interactive) {
    return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onDrilldown?.(card)}
      className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      {body}
    </button>
  );
}
