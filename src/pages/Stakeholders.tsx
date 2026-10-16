import { formatMass } from '../../shared/metrics';
import { percentage } from '../../shared/metrics';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { Activity, Recycle, UsersRound, Waypoints } from 'lucide-react';
import { useState } from 'react';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock } from '../components/StateBlock';
import { SummaryCard } from '../components/SummaryCard';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import type { getDashboardData } from '../services/dashboardService';
import { Panel } from '../components/Panel';
import { StakeholderDrawer } from '../components/StakeholderDrawer';
import type { Stakeholder } from '../types';

type Data = Awaited<ReturnType<typeof getDashboardData>>;
type Group = 'Producer' | 'Recycler' | 'Consumer' | 'NGO';

const groups: Group[] = ['Producer', 'Recycler', 'Consumer', 'NGO'];

export function Stakeholders({ data }: { data: Data }) {
  const [activeGroup, setActiveGroup] = useState<Group>('Producer');
  const [selected, setSelected] = useState<Stakeholder | null>(null);
  const rows = data.stakeholders.filter((item) => item.type === activeGroup);
  const recovered = data.circularFlow.recycledKg + data.circularFlow.reusedKg;
  const transactions = data.stakeholders.reduce((sum, item) => sum + item.transactions, 0);
  const participation = percentage(data.transactions.filter(item=>item.status==='Completed').length, data.transactions.length);

  return (
    <div className="space-y-5">
      {data.metadata.aggregateOnly && <p className="text-sm text-slate-600">Your assigned access is aggregate-only. Individual stakeholder profiles and transaction histories are restricted.</p>}
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active stakeholders" value={data.metadata.aggregateOnly ? 'Restricted' : data.stakeholders.length.toString()} detail="Matching current filters" icon={UsersRound} />
        <SummaryCard label="System recovered volume" value={`${formatMass(recovered)}`} detail="Unique filtered material flow" icon={Recycle} tone="emerald" />
        <SummaryCard label="Transfer completion" value={data.transactions.length ? `${participation}%` : 'Not available'} detail="Completed / all scoped transfers" icon={Activity} tone="blue" />
        <SummaryCard label="Profile activity" value={data.metadata.aggregateOnly ? 'Restricted' : transactions.toLocaleString()} detail="Role involvements; not unique transactions" icon={Waypoints} tone="amber" />
      </section>

      <Panel>
        <SectionHeader
          title="Stakeholder Directory"
          eyebrow="Participation and operational metrics by stakeholder type"
          actions={
            <div className="flex max-w-full overflow-x-auto rounded-md bg-slate-100 p-1">
              {groups.map((group) => (
                <button key={group} type="button" aria-pressed={activeGroup === group} onClick={() => setActiveGroup(group)} className={cn('h-8 whitespace-nowrap rounded px-3 text-sm font-medium transition-colors', activeGroup === group ? 'bg-white text-slate-950 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900')}>
                  {group === 'NGO' ? 'NGOs' : `${group}s`}
                </button>
              ))}
            </div>
          }
        />
        {rows.length ? (
          <PaginatedRecords rows={rows} resetKey={JSON.stringify([activeGroup, data.metadata.periodLabel])} label="Stakeholders">{pageRows=><div key={activeGroup} className="stagger-grid grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pageRows.map((item) => (
              <button type="button" key={item.id} onClick={() => setSelected(item)} className="rounded-lg bg-slate-50 p-4 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="font-semibold text-slate-950">{item.name}</p><p className="mt-1 text-sm text-slate-500">{item.city}, {item.region}</p></div>
                  <Badge variant="outline" className="shrink-0 bg-white text-slate-600">{item.transactions} txns</Badge>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 text-sm">
                  <Metric label="Recovered" value={`${formatMass(item.recoveredKg)}`} />
                  <Metric label="Generated" value={item.generatedKg ? `${formatMass(item.generatedKg)}` : 'Not reported'} />
                  <Metric label="Completion rate" value={item.transactions ? `${item.participation}%` : 'Not available'} />
                  <Metric label="Utilization" value={item.utilization != null ? `${item.utilization}%` : 'Not applicable'} />
                </div>
                <p className="mt-4 text-xs font-medium text-emerald-700">View stakeholder detail</p>
              </button>
            ))}
          </div>}</PaginatedRecords>
        ) : <EmptyBlock label={data.metadata.aggregateOnly ? 'Individual profiles are restricted by your aggregate-only access.' : `No ${activeGroup === 'NGO' ? 'NGO' : activeGroup.toLowerCase()} records match the current filters.`} />}
      </Panel>
      <StakeholderDrawer stakeholder={selected} transactions={data.transactions} onClose={() => setSelected(null)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{value}</p></div>;
}
