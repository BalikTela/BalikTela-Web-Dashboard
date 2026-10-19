import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, PackageCheck, RotateCcw, ShieldCheck } from 'lucide-react';
import { formatMass } from '../../shared/metrics';
import type { HubDisposalMonitoring as DisposalData } from '../../shared/hubs';
import type { Filters } from '../types';
import { platformApi } from '../services/platformApi';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { Panel } from './Panel';
import { SectionHeader } from './SectionHeader';
import { SummaryCard } from './SummaryCard';
import { PaginatedRecords } from './PaginatedRecords';
import { Button } from './ui/button';
import { EmptyBlock } from './StateBlock';

export function HubDisposalMonitoring({ filters }: { filters: Filters }) {
  const [data, setData] = useState<DisposalData | null>(null);
  const [error, setError] = useState('');
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    try { const result = await platformApi.hubDisposals({ ...filters }); if (current === version.current) { setData(result); setError(''); } }
    catch (reason) { if (current === version.current) setError(reason instanceof Error ? reason.message : 'Unable to load Hub disposals.'); }
  }, [filters]);
  useEffect(() => { setData(null); void load(); return () => { version.current++; }; }, [load]);
  useRecordRefresh(load, ['/hubs', '/hub-disposals', '/barter', '/material-batches']);
  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-3">
      <SummaryCard label="Hub disposal records" value={data?.available ? String(data.summary.records) : '--'} detail="Recorded by Hub operators" icon={Archive} />
      <SummaryCard label="Recorded disposal mass" value={data?.available ? formatMass(data.summary.disposedKg) : 'Not available'} detail="Disposal ledger; not recovered material" icon={PackageCheck} />
      <SummaryCard label="Diverted from landfill" value="Not established" detail="Final destination evidence required" icon={ShieldCheck} />
    </section>
    <Panel><SectionHeader title="Hub Disposal Monitoring" eyebrow="Shared mobile disposal ledger" />
      {error ? <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-red-700"><p className="min-w-0 flex-1">{error}</p><Button variant="outline" size="sm" onClick={() => void load()}><RotateCcw size={14} />Retry disposals</Button></div> : null}
      {!data && !error ? <p role="status" className="py-8 text-sm text-slate-500">Loading Hub disposal records...</p> : null}
      {data && !data.available ? <p className="py-4 text-sm text-amber-800">The Hub disposal ledger is not available in this environment.</p> : null}
      {data?.available && data.aggregateOnly ? <p className="py-4 text-sm text-slate-600">Operator and listing details are restricted for this account.</p> : data?.available && data.records.length ? <PaginatedRecords rows={data.records} resetKey={JSON.stringify(filters)} label="Hub disposals">{rows => <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr><th>Disposal / listing</th><th>Batch</th><th>Operator</th><th>Mass</th><th>Reason</th><th>Recorded</th></tr></thead><tbody className="divide-y divide-slate-200">{rows.map(row => <tr key={row.id}><td className="py-3"><p className="font-medium">{row.listingTitle}</p><p className="text-xs text-slate-500">{row.id} · {row.listingId}</p></td><td>{row.batchId}</td><td>{row.operator}</td><td className="whitespace-nowrap tabular-nums">{formatMass(row.weightKg)}</td><td className="max-w-xs break-words">{row.reason}</td><td>{new Date(row.disposedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td></tr>)}</tbody></table></div>}</PaginatedRecords> : data?.available ? <EmptyBlock label="No Hub disposal records match this cohort." /> : null}
      {data && data.summary.missingLinks + data.summary.invalidRecords > 0 ? <p role="status" className="mt-3 text-xs text-amber-800">{data.summary.missingLinks} disposal records have missing listing links; {data.summary.invalidRecords} have incomplete weight or operator evidence. These are excluded from disposal mass.</p> : null}
    </Panel>
  </div>;
}
