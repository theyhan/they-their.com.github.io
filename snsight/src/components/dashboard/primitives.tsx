/**
 * Presentation primitives for the dashboard.
 *
 * These components render decisions already made in the view model. They must not compute a metric,
 * choose an empty-state sentence, or decide whether a change is good: doing any of that here would
 * put a mandatory UX rule outside the layer that verifies it.
 */

import type { ChangeIndicator, MetricDisplay } from '@/lib/dashboard/types';

/** Spec 3.3. A visible badge, not a tooltip-only detail. */
export function MetricLabelBadge({ display }: { display: MetricDisplay }) {
  const tone =
    display.label === 'RAW_API_METRIC'
      ? 'bg-slate-100 text-slate-700 border-slate-300'
      : display.label === 'CALCULATED'
        ? 'bg-sky-50 text-sky-800 border-sky-300'
        : display.label === 'ESTIMATE'
          ? 'bg-amber-50 text-amber-900 border-amber-300'
          : 'bg-violet-50 text-violet-900 border-violet-300';

  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {display.labelText}
    </span>
  );
}

/**
 * The mandatory definition tooltip. Uses a native `title` plus visible affordance; a hover-only
 * tooltip would be unreachable on the touch devices the spec requires core dashboards to support,
 * so the full definition is also rendered in the details element below the value.
 */
export function MetricTooltip({ display }: { display: MetricDisplay }) {
  return (
    <details className="group mt-2">
      <summary
        className="cursor-pointer list-none text-xs text-slate-500 underline decoration-dotted hover:text-slate-800"
        title={display.tooltip}
      >
        What does this mean?
      </summary>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{display.tooltip}</p>
    </details>
  );
}

/**
 * Renders all four value states. Colour is never the only carrier of meaning: an absent value is
 * announced by its heading text and its sentence, not by being grey.
 */
export function MetricValueBlock({ display }: { display: MetricDisplay }) {
  if (display.state === 'VALUE' || display.state === 'VALUE_WITH_CAVEAT') {
    return (
      <div>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">{display.valueText}</p>
        {display.state === 'VALUE_WITH_CAVEAT' && display.caveat ? (
          <p className="mt-1 flex gap-1 text-xs text-amber-900">
            <span aria-hidden="true">!</span>
            <span>{display.caveat}</span>
          </p>
        ) : null}
      </div>
    );
  }

  const heading = display.state === 'NOT_SYNCED' ? 'Not collected yet' : 'Not calculable';
  return (
    <div>
      <p className="text-base font-semibold text-slate-700">{heading}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{display.reasonText}</p>
      <p className="mt-1 text-xs font-medium text-slate-800">{display.actionText}</p>
    </div>
  );
}

/**
 * "Do not communicate positive or negative change through color alone." The glyph and the sentence
 * carry the meaning; colour is added on top for users who can perceive it.
 */
export function ChangeBadge({ change }: { change: ChangeIndicator }) {
  const tone =
    change.polarity === 'POSITIVE'
      ? 'text-emerald-800'
      : change.polarity === 'NEGATIVE'
        ? 'text-rose-800'
        : 'text-slate-600';

  return (
    <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${tone}`}>
      <span aria-hidden="true">{change.glyph}</span>
      <span>{change.text}</span>
      <span className="sr-only">{change.srText}</span>
    </p>
  );
}

export function EmptyState({ reason, action }: { reason: string; action: string }) {
  return (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-4">
      <p className="text-sm text-slate-700">{reason}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{action}</p>
    </div>
  );
}
