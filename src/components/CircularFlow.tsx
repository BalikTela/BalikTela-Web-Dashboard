import { ChevronRight } from 'lucide-react';
import type { CircularFlowMetrics } from '../types';

export function CircularFlow({ data }: { data: CircularFlowMetrics }) {
  const stages = [
    { label: 'Generated', value: formatKilograms(data.generatedKg), color: 'bg-slate-400' },
    { label: 'Collected', value: formatKilograms(data.collectedKg), color: 'bg-emerald-700' },
    { label: 'Sorted', value: formatKilograms(data.sortedKg), color: 'bg-emerald-700' },
    { label: 'Reused / Bartered', value: formatKilograms(data.reusedKg), color: 'bg-emerald-700' },
    { label: 'Recycled', value: formatKilograms(data.recycledKg), color: 'bg-emerald-700' },
    { label: 'Residual / uncollected', value: formatKilograms(data.residualKg), color: 'bg-amber-500' },
  ];
  return (
    <div className="stagger-grid grid overflow-hidden rounded-md border border-b-0 border-r-0 border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {stages.map((stage, index) => (
        <div key={stage.label} className="relative min-w-0 border-b border-r border-slate-200 p-4">
          <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${stage.color}`} /><p className="text-xs font-medium text-slate-500">{stage.label}</p></div>
          <p className="mt-2 text-lg font-semibold text-slate-950">{stage.value}</p>
          {index < stages.length - 1 ? <ChevronRight size={15} className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 bg-white text-slate-300 2xl:block" /> : null}
        </div>
      ))}
    </div>
  );
}

function formatKilograms(kilograms: number) { return `${Math.round(kilograms).toLocaleString()} kg`; }
