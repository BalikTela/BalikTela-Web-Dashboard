import { formatMass } from '../../shared/metrics';
import type { CircularFlowMetrics } from '../types';

export function CircularFlow({ data }: { data: CircularFlowMetrics }) {
  const stages = [
    { label: 'Declared material', value: formatMass(data.generatedKg), color: 'bg-slate-400' },
    { label: 'Validated collection', value: data.collectedAvailable === false ? 'Pending evidence' : formatMass(data.collectedKg), color: 'bg-emerald-700' },
    { label: 'Sorted output', value: data.sortedAvailable === false ? 'Pending evidence' : formatMass(data.sortedKg), color: 'bg-emerald-700' },
    { label: 'Confirmed reuse', value: data.reusedAvailable === false ? 'Pending evidence' : formatMass(data.reusedKg), color: 'bg-emerald-700' },
    { label: 'Confirmed recycling', value: data.recycledAvailable === false ? 'Pending evidence' : formatMass(data.recycledKg), color: 'bg-emerald-700' },
    { label: 'Collected · recovery unconfirmed', value: data.collectedAvailable === false ? 'Pending evidence' : formatMass(data.residualKg), color: 'bg-slate-400' },
  ];
  return (
    <div className="circular-flow grid overflow-hidden rounded-md border border-b-0 border-r-0 border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {stages.map((stage) => (
        <div key={stage.label} className="circular-flow-step relative min-w-0 border-b border-r border-slate-200 p-4">
          <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${stage.color}`} /><p className="text-xs font-medium text-slate-500">{stage.label}</p></div>
          <p className="mt-2 text-lg font-semibold text-slate-950">{stage.value}</p>
        </div>
      ))}
    </div>
  );
}
