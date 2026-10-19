import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass, percentage } from '../../shared/metrics';
import { Activity, Factory, Gauge, PackageCheck } from 'lucide-react';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock } from '../components/StateBlock';
import { StatusBadge } from '../components/StatusBadge';
import type { getDashboardData } from '../services/dashboardService';
import { Panel } from '../components/Panel';
import { Progress } from '../components/ui/progress';
import { SummaryCard } from '../components/SummaryCard';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { HubManagement } from '../components/HubManagement';
import { HubDisposalMonitoring } from '../components/HubDisposalMonitoring';
import type { Filters } from '../types';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function Facilities({ data, filters }: { data: Data; filters: Filters }) {
  const { access } = useAuth();
  const canReadHubs = Boolean(access?.permissions.includes('hubs.read'));
  const [tab, setTab] = useState<'performance' | 'hubs' | 'disposals'>('performance');
  return <div className="space-y-5">
    {canReadHubs ? <div className="flex flex-wrap gap-x-5 border-b border-slate-200" role="group" aria-label="Facility sections">{(['performance', 'hubs', 'disposals'] as const).map(item => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)} className={`border-b-2 px-1 py-3 text-sm font-medium ${tab === item ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>{item === 'performance' ? 'Facility Performance' : item === 'disposals' ? 'Hub Disposals' : access?.permissions.includes('hubs.manage') ? 'Hub Management' : 'Hub Directory'}</button>)}</div> : null}
    {tab === 'hubs' && canReadHubs ? <HubManagement filters={filters} /> : tab === 'disposals' && canReadHubs ? <HubDisposalMonitoring filters={filters} /> : <FacilityPerformance data={data} />}
  </div>;
}

function FacilityPerformance({ data }: { data: Data }) {
  const capacity = data.facilities.reduce((sum, item) => sum + item.capacityKg, 0);
  const processed = data.facilities.reduce((sum, item) => sum + item.processedKg, 0);
  const averageUtilization = percentage(data.facilities.reduce((sum, item) => sum + item.intakeKg, 0), capacity);
  return (
    <div className="space-y-5">
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={data.metadata.aggregateOnly ? 'Regional facility groups' : 'Registered facilities'} value={data.facilities.length.toString()} detail="Matching regional and textile filters" icon={Factory} />
        <SummaryCard label="Period capacity" value={`${formatMass(capacity)}`} detail={data.metadata.periodLabel} icon={Gauge} tone="blue" />
        <SummaryCard label="Network utilization" value={capacity ? `${averageUtilization}%` : 'Not available'} detail="Total intake / prorated period capacity" icon={Activity} tone={averageUtilization >= 85 ? 'amber' : 'emerald'} />
        <SummaryCard label="Confirmed outcome output" value={data.facilities.some(item => item.processedAvailable !== false) ? formatMass(processed) : 'Pending evidence'} detail="Validated final reuse and recycling output" icon={PackageCheck} tone="emerald" />
      </section>
      <Panel>
      <SectionHeader title="Recovery Facilities and Hubs" eyebrow="Registered period capacity, allocated intake, and confirmed final output" />
      {data.facilities.length ? (
        <PaginatedRecords rows={data.facilities} resetKey={JSON.stringify([data.metadata.periodLabel])}>{pageRows =><div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-textile-ink/45">
              <tr><th className="py-2">Facility</th><th>Location</th><th>Accepted types</th><th>Capacity</th><th>Utilization</th><th>Intake</th><th>Confirmed output</th><th>Processing time</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-textile-thread">
              {pageRows.map((item) => (
                <tr key={item.id} className="data-row">
                  <td className="py-3 font-semibold text-textile-ink">{item.name}</td>
                  <td>{item.location}</td>
                  <td className="max-w-xs">{item.acceptedTypes.join(', ')}</td>
                  <td>{formatMass(item.capacityKg)}</td>
                  <td><div className="flex items-center gap-2"><Progress value={item.utilization} className="w-24" indicatorClassName={item.utilization >= 85 ? 'bg-amber-500' : undefined} />{item.capacityKg > 0 ? `${item.utilization}%` : 'Not available'}</div></td>
                  <td>{formatMass(item.intakeKg)}</td>
                  <td>{item.processedAvailable === false ? 'Pending evidence' : formatMass(item.processedKg)}</td>
                  <td>{item.processingTimeDays > 0 && !data.metadata.aggregateOnly ? `${item.processingTimeDays} days` : 'Not reported'}</td>
                  <td><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}</PaginatedRecords>
      ) : <EmptyBlock />}
      </Panel>
    </div>
  );
}
