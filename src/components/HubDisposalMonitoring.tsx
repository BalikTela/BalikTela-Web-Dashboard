import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { formatMass } from '../../shared/metrics';
import type { HubDisposalMonitoring as DisposalData } from '../../shared/hubs';
import type { Filters } from '../types';
import { platformApi } from '../services/platformApi';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { Panel } from './Panel';
import { SectionHeader } from './SectionHeader';
import { HubHandlingSummary } from './HubHandlingSummary';
import { PaginatedRecords } from './PaginatedRecords';
import { Button } from './ui/button';
import { EmptyBlock } from './StateBlock';
import { Input } from './ui/input';

export function HubDisposalMonitoring({ filters }: { filters: Filters }) {
  const [data, setData] = useState<DisposalData | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    setBusy(true);
    try { const result = await platformApi.hubDisposals({ ...filters }); if (current === version.current) { setData(result); setError(''); } }
    catch (reason) { if (current === version.current) setError(reason instanceof Error ? reason.message : 'Unable to load Hub disposals.'); }
    finally { if (current === version.current) setBusy(false); }
  }, [filters]);
  useEffect(() => { setData(null); setError(''); void load(); return () => { version.current++; }; }, [load]);
  useRecordRefresh(load, ['/hubs', '/hub-disposals', '/barter', '/material-batches', '/recovery-records', '/transfers', '/facilities']);
  const records = data?.records.filter(row => [row.id, row.listingTitle, row.listingId, row.batchId, row.operator, row.reason].join(' ').toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <div className="space-y-4">
    <HubHandlingSummary summary={data?.handling}/>
    <Panel><SectionHeader title="Hub Disposal Monitoring" eyebrow="Shared mobile disposal ledger · selected batch cohort" actions={<Button variant="outline" size="icon" disabled={busy} aria-label="Refresh disposals" title="Refresh disposals" onClick={() => void load()}><RotateCcw size={15} className={busy?'animate-spin':''}/></Button>}/>
      {data?.available && !data.aggregateOnly ? <label className="relative mb-4 block max-w-md"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><Input className="pl-9" aria-label="Search disposal records" placeholder="Search textile, batch, operator or reason" value={search} onChange={event=>setSearch(event.target.value)}/></label> : null}
      {error ? <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-red-700"><p className="min-w-0 flex-1">{error}{data?' Showing the most recently loaded ledger.':''}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}><RotateCcw size={14} />Retry disposals</Button></div> : null}
      {!data && !error ? <p role="status" className="py-8 text-sm text-slate-500">Loading Hub disposal records...</p> : null}
      {data && !data.available ? <p className="py-4 text-sm text-amber-800">The Hub disposal ledger is not available in this environment.</p> : null}
      {data?.available && data.aggregateOnly ? <p className="py-4 text-sm text-slate-600">Operator and listing details are restricted for this account.</p> : data?.available && records.length ? <PaginatedRecords rows={records} resetKey={JSON.stringify([filters,search])} label="Hub disposals">{rows => <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm" aria-label="Hub disposal ledger"><thead><tr><th>Disposal / listing</th><th>Batch</th><th>Operator</th><th>Mass</th><th>Reason</th><th>Recorded</th></tr></thead><tbody className="divide-y divide-slate-200">{rows.map(row => <tr key={row.id}><td className="max-w-72 py-4 pr-4"><p className="font-medium">{row.listingTitle}</p><p className="mt-1 break-all text-xs text-slate-500">{row.id} · {row.listingId}</p></td><td className="max-w-56 break-all pr-4">{row.batchId}</td><td className="pr-4">{row.operator}</td><td className="whitespace-nowrap pr-4 tabular-nums">{formatMass(row.weightKg)}</td><td className="max-w-xs break-words pr-4">{row.reason}</td><td>{new Date(row.disposedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td></tr>)}</tbody></table></div>}</PaginatedRecords> : data?.available ? <EmptyBlock label={search.trim()?'No disposal records match this search.':'No Hub disposal records match this cohort.'} /> : null}
      {data && data.summary.missingLinks + data.summary.invalidRecords > 0 ? <p role="status" className="mt-3 text-xs text-amber-800">{data.summary.missingLinks} disposal records have missing listing links; {data.summary.invalidRecords} have incomplete weight or operator evidence. These are excluded from disposal mass.</p> : null}
    </Panel>
  </div>;
}
