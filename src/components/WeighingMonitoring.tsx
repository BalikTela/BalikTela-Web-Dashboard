import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Clock3, RefreshCw, Scale, Search, ShieldCheck } from 'lucide-react';
import { formatMass } from '../../shared/metrics';
import type { WeighingMonitoring as WeighingData } from '../../shared/hubs';
import { platformApi } from '../services/platformApi';
import type { Filters } from '../types';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { PaginatedRecords } from './PaginatedRecords';
import { Panel } from './Panel';
import { SectionHeader } from './SectionHeader';
import { SummaryCard } from './SummaryCard';
import { EmptyBlock } from './StateBlock';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';

export function WeighingMonitoring({ filters }: { filters: Filters }) {
  const [data, setData] = useState<WeighingData | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'queue' | 'history'>('queue');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Awaiting weighing');
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setRefreshing(true);
    try { const result = await platformApi.weighing({ ...filters }); if (version === requestVersion.current) { setData(result); setError(''); } }
    catch (reason) { if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : 'Unable to load weighing evidence.'); }
    finally { if (version === requestVersion.current) setRefreshing(false); }
  }, [filters]);
  useEffect(() => { void load(); return () => { requestVersion.current++; }; }, [load]);
  useRecordRefresh(load, ['/hubs', '/users', '/barter', '/material-batches', '/transfers']);
  const tasks = useMemo(() => data?.tasks.filter(item => (status === 'All states' || item.state === status)
    && [item.id, item.title, item.batchId, item.owner, item.hub, item.region].join(' ').toLowerCase().includes(query.toLowerCase())) ?? [], [data, status, query]);
  const history = useMemo(() => data?.history.filter(item => [item.id, item.title, item.batchId, item.owner, item.operator, item.facility].join(' ').toLowerCase().includes(query.toLowerCase())) ?? [], [data, query]);
  if (!data && !error) return <p className="py-12 text-center text-sm text-slate-500" role="status">Loading weighing evidence...</p>;
  return <div className="space-y-5">
    {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {data ? <>
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Awaiting weighing" value={data.summary.awaiting.toLocaleString()} detail={`${data.summary.unweighedBatches} batches without declared mass`} icon={Clock3} />
        <SummaryCard label="Weighing records" value={data.summary.measurements.toLocaleString()} detail="Hub scale and declaration evidence" icon={ClipboardList} />
        <SummaryCard label="Latest weighed mass" value={formatMass(data.summary.latestWeighedKg)} detail="Latest active measurement per batch" icon={Scale} />
        <SummaryCard label="Verified at Hub" value={data.summary.verifiedBatches.toLocaleString()} detail="Weighing evidence, not completed recovery" icon={ShieldCheck} />
      </section>
      <Panel><SectionHeader title="Weighing Monitoring" eyebrow="Selected registration cohort · Philippine time" actions={<Button variant="ghost" size="icon" disabled={refreshing} title="Refresh weighing evidence" aria-label="Refresh weighing evidence" onClick={() => void load()}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></Button>} />
        {data.aggregateOnly ? <><p className="mb-4 text-xs text-slate-500">Aggregate access · material and operator identities withheld</p><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr><th>Region</th><th>Awaiting weighing</th><th>Records</th><th>Latest weighed mass</th></tr></thead><tbody className="divide-y divide-slate-200">{data.regions.map(item => <tr key={item.region}><td className="py-3">{item.region}</td><td>{item.awaiting}</td><td>{item.measurements}</td><td>{formatMass(item.latestWeighedKg)}</td></tr>)}</tbody></table></div>{!data.regions.length ? <EmptyBlock label="No weighing activity matches your scope and filters." /> : null}</> : <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div role="group" aria-label="Weighing view" className="flex w-fit rounded-md bg-slate-100 p-1">{(['queue', 'history'] as const).map(item => <Button key={item} size="sm" variant={view === item ? 'secondary' : 'ghost'} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'queue' ? 'Weighing queue' : 'Measurement history'}</Button>)}</div>
            <label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input aria-label="Search weighing records" className="pl-9" placeholder="Search textiles, operators or batch IDs" value={query} onChange={event => setQuery(event.target.value)} /></label>
            {view === 'queue' ? <Select aria-label="Weighing queue status" className="lg:max-w-48" value={status} onChange={event => setStatus(event.target.value)}>{['Awaiting weighing', 'Weighed', 'Locked', 'All states'].map(value => <option key={value}>{value}</option>)}</Select> : null}
          </div>
          {view === 'queue' ? tasks.length ? <PaginatedRecords rows={tasks} resetKey={JSON.stringify([query, status, filters])} label="Weighing tasks">{pageRows => <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr><th>Textile / batch</th><th>Original owner</th><th>Assigned Hub operator</th><th>Location</th><th>Recorded weight</th><th>State</th></tr></thead><tbody className="divide-y divide-slate-200">{pageRows.map(item => <tr key={item.id} className="data-row"><td className="max-w-64 py-4 pr-4"><p className="font-medium">{item.title}</p><p className="mt-1 break-all text-xs text-slate-500">{item.batchId}</p></td><td className="pr-4">{item.owner}</td><td className="pr-4">{item.hub}</td><td className="pr-4">{item.city}<p className="text-xs text-slate-500">{item.region}</p></td><td>{formatMass(item.quantityKg, 'Awaiting weighing')}<p className="text-xs text-slate-500">{item.weightStatus ?? 'No measurement'}</p></td><td><Badge variant="outline">{item.state}</Badge></td></tr>)}</tbody></table></div>}</PaginatedRecords> : <EmptyBlock label="No textiles match this weighing queue." /> : history.length ? <PaginatedRecords rows={history} resetKey={JSON.stringify([query, filters])} label="Weighing history">{pageRows => <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead><tr><th>Textile / batch</th><th>Weight / evidence</th><th>Operator / facility</th><th>Measured at</th><th>Original owner</th><th>Completed recipients</th><th>Record</th></tr></thead><tbody className="divide-y divide-slate-200">{pageRows.map(item => <tr key={item.id} className="data-row"><td className="max-w-64 py-4 pr-4"><p className="font-medium">{item.title}</p><p className="mt-1 break-all text-xs text-slate-500">{item.batchId}</p><p className="mt-1 break-all text-xs text-slate-400">{item.id}</p></td><td className="pr-4"><p className="font-medium tabular-nums">{formatMass(item.weightKg)}</p><p className="mt-1 text-xs text-slate-500">{item.weightStatus} · Hub weighing</p><p className="mt-1 max-w-52 break-words text-xs text-slate-500">{item.note}</p></td><td className="pr-4">{item.operator}<p className="mt-1 text-xs text-slate-500">{item.facility}</p></td><td className="whitespace-nowrap pr-4 text-xs">{new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.measuredAt))}</td><td className="pr-4">{item.owner}</td><td className="max-w-56 pr-4">{item.recipients.length ? item.recipients.map(recipient => <p key={recipient.id} className="mb-1 text-xs">{recipient.name} · {formatMass(recipient.weightKg)} agreed</p>) : <span className="text-xs text-slate-500">No completed transfer</span>}</td><td><Badge variant="outline">{item.current ? 'Latest' : 'Historical'}</Badge><p className="mt-1 text-xs text-slate-500">{item.listingStatus}</p></td></tr>)}</tbody></table></div>}</PaginatedRecords> : <EmptyBlock label="No Hub weighing measurements match these filters." />}
        </>}
        <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">Weighing records establish material mass only. Collection, receipt, transfer validation and recovery outcomes remain separate evidence.</p>
      </Panel>
    </> : <Button variant="outline" onClick={() => void load()}>Retry</Button>}
  </div>;
}
