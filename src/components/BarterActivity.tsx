import { ArrowRight, Gift, ListPlus, ShieldCheck, Users } from 'lucide-react';
import type { BarterMetrics } from '../types';
import { SectionHeader } from './SectionHeader';

export function BarterActivity({ data, periodLabel }: { data: BarterMetrics; periodLabel: string }) {
  const stages = [
    { label: 'Listings', value: data.listings, icon: ListPlus },
    { label: 'Matches', value: data.matches, icon: Users },
    { label: 'Validated', value: data.validated, icon: ShieldCheck },
    { label: 'Completed', value: data.completed, icon: Gift },
  ];
  return (
    <section className="dashboard-panel rounded-md border border-slate-200 bg-white p-5">
      <SectionHeader title="Barter Activity" eyebrow={`${periodLabel} · shared platform activity`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="stagger-grid grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <div key={stage.label} className="relative border-b border-slate-200 p-4 sm:border-b-0">
                <div className="flex items-center justify-between gap-2"><p className="text-xs text-slate-500">{stage.label}</p><Icon size={14} className="text-slate-400" /></div>
                <p className="mt-2 text-xl font-semibold text-slate-950">{stage.value.toLocaleString()}</p>
                {index < stages.length - 1 ? <ArrowRight size={14} className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 bg-white text-slate-300 sm:block" /> : null}
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-200 pt-3 lg:w-44 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <p className="text-xs text-slate-500">Net reward credits</p>
          <p className="mt-1 text-xl font-semibold text-slate-950">{data.rewardCredits.toLocaleString()}</p>
          <p className="mt-1 text-xs text-slate-500">Issued ledger credits including reversals and adjustments</p>
        </div>
      </div>
    </section>
  );
}
