import { Activity, Factory, Gauge, PackageCheck } from 'lucide-react';
import { formatMass, percentage } from '../../shared/metrics';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock } from '../components/StateBlock';
import { StatusBadge } from '../components/StatusBadge';
import { Panel } from '../components/Panel';
import { Progress } from '../components/ui/progress';
import { SummaryCard } from '../components/SummaryCard';
import type { DashboardAnalytics } from '../platformTypes';

export function Facilities({ data }: { data: DashboardAnalytics }) {
  const rows = data.facilities;
  const capacity = rows.reduce((sum, item) => sum + item.capacityKg, 0);
  const intake = rows.reduce((sum, item) => sum + item.intakeKg, 0);
  const output = rows.reduce((sum, item) => sum + item.processedKg, 0);
  const capacityConfigured = rows.length > 0 && rows.every(item => Number.isFinite(item.capacityKg) && item.capacityKg > 0);
  const utilization = capacityConfigured ? percentage(intake, capacity) : null;
  return <div className="space-y-5">
    <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label={data.metadata.aggregateOnly ? 'Regional Hub groups' : 'Registered Hubs'} value={String(rows.length)} detail="Matching regional and textile filters" icon={Factory} />
      <SummaryCard label="Period capacity" value={capacity > 0 ? formatMass(capacity) : 'Not configured'} detail={data.metadata.periodLabel} icon={Gauge} tone="blue" />
      <SummaryCard label="Network utilization" value={utilization === null ? 'Not available' : `${utilization}%`} detail="Recorded intake / prorated period capacity" icon={Activity} tone={utilization !== null && utilization >= 85 ? 'amber' : 'emerald'} />
      <SummaryCard label="Confirmed outcome output" value={rows.some(item => item.processedAvailable !== false) ? formatMass(output) : 'Pending evidence'} detail="Historical validated reuse and recycling output" icon={PackageCheck} tone="emerald" />
    </section>
    <Panel>
      <SectionHeader title="Hub Facilities" eyebrow="Capacity, utilization, and recorded performance" />
      {rows.length ? <PaginatedRecords rows={rows} resetKey={data.metadata.periodLabel} label="Hub facilities">{pageRows => <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[1050px] text-left text-sm" aria-label="Hub facility analytics">
          <thead><tr><th>Hub</th><th>Location</th><th>Accepted textiles</th><th>Period capacity</th><th>Utilization</th><th>Recorded intake</th><th>Confirmed output</th><th>Processing time</th><th>Status</th></tr></thead>
          <tbody className="divide-y divide-textile-thread">{pageRows.map(item => <tr key={item.id} className="data-row">
            <td className="min-w-40 py-4 pr-4 font-semibold"><span>{item.name}</span></td>
            <td className="pr-4">{item.location}</td><td className="max-w-44 pr-4">{item.acceptedTypes.join(', ') || 'Not configured'}</td>
            <td className="whitespace-nowrap pr-4 tabular-nums">{item.capacityKg > 0 ? formatMass(item.capacityKg) : 'Not configured'}
              {item.capacityKg > 0 ? <p className={`mt-1 text-xs ${item.intakeKg > item.capacityKg ? 'text-red-700' : 'text-slate-500'}`}>{formatMass(Math.abs(item.capacityKg - item.intakeKg))} {item.intakeKg > item.capacityKg ? 'over capacity' : 'remaining'}</p> : null}</td>
            <td className="pr-4">{item.capacityKg > 0 ? <div className="flex items-center gap-2"><Progress value={Math.min(100, item.utilization)} className="w-24" indicatorClassName={item.utilization > 100 ? 'bg-red-600' : item.utilization >= 85 ? 'bg-amber-500' : undefined} /><span className="tabular-nums">{item.utilization}%</span></div> : 'Not available'}</td>
            <td className="whitespace-nowrap pr-4 tabular-nums">{formatMass(item.intakeKg)}</td>
            <td className="whitespace-nowrap pr-4 tabular-nums">{item.processedAvailable === false ? 'Pending evidence' : formatMass(item.processedKg)}</td>
            <td className="whitespace-nowrap pr-4">{item.processingTimeDays > 0 && !data.metadata.aggregateOnly ? `${item.processingTimeDays} days` : 'Not reported'}</td>
            <td><StatusBadge status={item.status} /></td>
          </tr>)}</tbody>
        </table>
      </div>}</PaginatedRecords> : <EmptyBlock label="No Hubs match these filters." />}
      <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">Utilization = recorded intake / period capacity. Available: below 85%; near capacity: 85% to below 100%; at capacity: 100%; over capacity: above 100%. Maintenance and onboarding remain operating conditions. Intake counts each batch once per Hub from a collection receipt or its earliest validated operation; later stages are not added again. This is handling volume, not storage occupancy or proof of disposal. Confirmed output is historical recovery evidence, not Hub disposal.</p>
    </Panel>
  </div>;
}
