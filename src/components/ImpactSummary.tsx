import type { ImpactMetrics } from '../types';
import { SectionHeader } from './SectionHeader';

export function ImpactSummary({ data, periodLabel }: { data: ImpactMetrics; periodLabel: string }) {
  const metrics = [
    ['Confirmed recovery share', data.diversionRate !== null ? `${data.diversionRate}%` : 'Not available', 'Linked final output / physically received weight'],
    ['Recovery yield from sorted textiles', data.sortingYield !== null ? `${data.sortingYield}%` : 'Not available', 'Final output / sorted mass on matching evidenced batches'],
  ];
  return (
    <section className="border-y border-slate-200 py-5">
      <SectionHeader title="Circular Economy Performance" eyebrow={periodLabel} />
      <div className="stagger-grid grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {metrics.map(([label, value, detail]) => (
          <article key={label} className="min-w-0 border-t border-slate-300 pt-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
            <p className="mt-1 text-xs leading-4 text-slate-500">{detail}</p>
          </article>
        ))}
      </div>
      {(data.sortingYield ?? 0) > 100 || (data.diversionRate ?? 0) > 100 ? <p className="mt-2 text-xs text-red-700" role="alert">A rate exceeds 100%. Review outcome weights and denominator evidence; values have not been silently capped.</p> : null}
    </section>
  );
}
