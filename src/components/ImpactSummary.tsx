import type { ImpactMetrics } from '../types';
import { SectionHeader } from './SectionHeader';

export function ImpactSummary({ data, periodLabel, generatedKg, sortedKg }: { data: ImpactMetrics; periodLabel: string; generatedKg: number; sortedKg: number }) {
  const metrics = [
    ['Environmental diversion claim', 'Disabled', 'Pending an approved impact methodology'],
    ['Circularity rate', generatedKg > 0 ? `${data.diversionRate}%` : 'Not available', 'Reused + recycled / generated'],
    ['Sorting yield', sortedKg > 0 ? `${data.sortingYield}%` : 'Not available', 'Reused + recycled / sorted material'],
    ['Emissions avoided', 'Disabled', 'No approved CO2e conversion factor'],
    ['Water avoided', 'Disabled', 'No approved water conversion factor'],
  ];
  return (
    <section className="border-y border-slate-200 py-5">
      <SectionHeader title="Circular Economy and Environmental Impact" eyebrow={`${periodLabel} · environmental claims disabled`} />
      <div className="stagger-grid grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value, detail], index) => (
          <article key={label} className="border-t border-slate-300 pt-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
            <p className="mt-1 text-xs leading-4 text-slate-500">{detail}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs text-amber-700">Environmental equivalents remain unavailable until evidence requirements, factors, denominators, and approval ownership are documented.</p>
      {data.sortingYield > 100 || data.diversionRate > 100 ? <p className="mt-2 text-xs text-red-700" role="alert">A rate exceeds 100%. Review outcome weights and denominator evidence; values have not been silently capped.</p> : null}
    </section>
  );
}
