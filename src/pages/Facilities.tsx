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
  const storage = data.hubStorage;
  const rows = storage?.rows ?? [];
  const capacity = rows.reduce((sum, item) => sum + item.capacityKg, 0);
  const complete = rows.length > 0 && rows.every(item => item.storedKg !== null && item.utilization !== null);
  const held = complete ? rows.reduce((sum, item) => sum + item.storedKg!, 0) : null;
  const utilization = held !== null && capacity > 0 ? percentage(held, capacity) : null;
  const available = rows.length > 0 && rows.every(item => item.availableToReceiveKg !== null)
    ? rows.reduce((sum, item) => sum + (item.status === 'Available' || storage?.aggregateOnly ? item.availableToReceiveKg! : 0), 0) : null;
  return <div className="space-y-5">
    <p className="border-l-2 border-amber-500 pl-3 text-xs leading-5 text-amber-900">{storage?.illustrativeCapacity?'Some Hubs use labeled illustrative storage limits, not surveyed capacities. ':''}Current stock and incoming reservations include all recorded history and textile types, independent of the selected reporting dates. Mobile selection enforcement is not yet connected.</p>
    <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label={storage?.aggregateOnly ? 'Regional Hub groups' : 'Registered Hubs'} value={String(rows.length)} detail="Matching Hub location and textile filters" icon={Factory} />
      <SummaryCard label="Storage capacity" value={capacity > 0 ? formatMass(capacity) : 'Not configured'} detail={storage?.illustrativeCapacity?'Configured and labeled illustrative limits':'Configured physical storage limits'} icon={Gauge} tone="blue" />
      <SummaryCard label="Storage utilization" value={utilization === null ? 'Not available' : `${utilization}%`} detail="Current stock held / storage capacity" icon={Activity} tone={utilization !== null && utilization >= 90 ? 'amber' : 'emerald'} />
      <SummaryCard label="Storage headroom" value={formatMass(available, 'Not established')} detail="Below 90%; includes labeled simulations" icon={PackageCheck} tone="emerald" />
    </section>
    {storage?.summary.unattributedBatches ? <p role="status" className="border-l-2 border-amber-500 pl-3 text-xs text-amber-900">{storage.summary.unattributedBatches} batches have ambiguous Hub assignments. Affected Hubs remain unavailable until the records are reconciled.</p> : null}
    <Panel>
      <SectionHeader title="Hub Facilities" eyebrow="Storage, incoming reservations, and availability" />
      {rows.length ? <PaginatedRecords rows={rows} resetKey={JSON.stringify(rows.map(item => item.id))} label="Hub facilities">{pageRows => <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[1200px] text-left text-sm" aria-label="Hub facility analytics">
          <thead><tr><th>Hub</th><th>Location</th><th>Accepted textiles</th><th>Storage capacity</th><th>Stock held</th><th>Incoming reservations</th><th>Utilization</th><th>Recorded disposal</th><th className="sticky right-0 z-10 min-w-40 border-l border-slate-200 bg-white pl-3">Status</th></tr></thead>
          <tbody className="divide-y divide-textile-thread">{pageRows.map(item => <tr key={item.id} className="data-row">
            <td className="min-w-40 py-4 pr-4 font-semibold"><span>{item.name}</span>{item.containsSimulation ? <p className="mt-1 text-xs font-normal text-amber-800">Includes synthetic simulation</p> : null}</td>
            <td className="pr-4">{item.location}</td><td className="max-w-44 pr-4">{item.acceptedTypes.join(', ') || 'Not configured'}</td>
            <td className="whitespace-nowrap pr-4 tabular-nums">{item.capacityKg>0?formatMass(item.capacityKg):'Not configured'}{item.capacityKg>0?<p className="mt-1 text-xs text-slate-500">{formatMass(item.capacityKg * (storage?.thresholdPercent ?? 90) / 100)} intake cutoff</p>:null}{item.capacitySource==='Illustrative'?<p className="mt-1 text-xs text-amber-800">Illustrative limit</p>:null}</td>
            <td className="pr-4 tabular-nums">{formatMass(item.storedKg, 'Not established')}{item.estimatedStock ? <p className="mt-1 text-xs text-slate-500">Estimated</p> : null}{item.storedKg !== null && item.capacityKg>0 && item.storedKg > item.capacityKg ? <p className="mt-1 text-xs text-red-700">Exceeds storage limit</p> : null}</td>
            <td className="pr-4 tabular-nums">{formatMass(item.reservedKg, 'Not established')}<p className="mt-1 text-xs text-slate-500">{formatMass(item.availableToReceiveKg, 'Unknown')} headroom</p></td>
            <td className="pr-4">{item.utilization !== null ? <div className="flex items-center gap-2"><Progress value={Math.min(100, item.utilization)} className="w-24" indicatorClassName={item.status === 'Intake paused' ? 'bg-amber-500' : undefined} /><span className="tabular-nums">{item.utilization}%</span></div> : 'Not available'}{item.allocatedPercent !== null ? <p className="mt-1 text-xs text-slate-500">{item.allocatedPercent}% with reservations</p> : null}</td>
            <td className="whitespace-nowrap pr-4 tabular-nums">{formatMass(item.disposedKg, 'Not available')}</td>
            <td className="sticky right-0 border-l border-slate-200 bg-white pl-3"><StatusBadge status={item.status} />{item.simulationOnly ? <p className="mt-1 text-xs text-amber-800">Simulation only</p> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>}</PaginatedRecords> : <EmptyBlock label="Storage analytics are unavailable or no Hubs match these filters." />}
      <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">Stock held = recorded physical intake minus unique disposal records and evidenced outbound movements. Pending consumer submissions reserve declared weight once per batch. Intake pauses when stock plus reservations reaches 90% of storage capacity; a new submission must fit within that limit. Supported mobile disposal records, monitored in Recovery Monitoring, release space on refresh. Missing or conflicting balances cannot establish availability; maintenance, inactive and unapproved Hubs remain unavailable.</p>
    </Panel>
  </div>;
}
