import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { HubOperationsMonitoring } from '../../shared/hubs';
import { formatMass } from '../../shared/metrics';
import type { Filters } from '../types';
import { platformApi } from '../services/platformApi';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { SectionHeader } from './SectionHeader';
import { HubHandlingSummary } from './HubHandlingSummary';
import { PaginatedRecords } from './PaginatedRecords';
import { EmptyBlock } from './StateBlock';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';

export function HubCollectionMonitoring({ filters }: { filters: Filters }) {
  const [data, setData] = useState<HubOperationsMonitoring | null>(null), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [state, setState] = useState('All states'), [busy, setBusy] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const request = ++version.current; setBusy(true);
    try { const result = await platformApi.hubOperations({ ...filters }); if (request === version.current) { setData(result); setError(''); } }
    catch (reason) { if (request === version.current) setError(reason instanceof Error ? reason.message : 'Unable to load Hub collection and disposal.'); }
    finally { if (request === version.current) setBusy(false); }
  }, [filters]);
  useEffect(() => { setData(null); setError(''); void load(); return () => { version.current++; }; }, [load]);
  useRecordRefresh(load, ['/hubs', '/hub-disposals', '/material-batches', '/barter', '/transfers', '/recovery-records', '/facilities', '/users']);
  const rows = data?.records.filter(row => (state === 'All states' || row.state === state) && [row.title, row.owner, row.hub, row.batchId, row.listingId, row.material, row.region].join(' ').toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <section className="space-y-5" aria-label="Hub collection and disposal">
    <SectionHeader title="Hub Collection & Disposal" eyebrow={data?.periodLabel ?? 'Assigned materials and recorded physical handling'} actions={<Button type="button" variant="outline" size="icon" disabled={busy} title="Refresh Hub operations" aria-label="Refresh Hub operations" onClick={() => void load()}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /></Button>} />
    {error ? <p role="alert" className="border-l-2 border-red-400 pl-3 text-sm text-red-700">{error}{data ? ' Showing the previous result for these filters.' : ''}</p> : null}
    {!data && !error ? <p role="status" className="py-10 text-sm text-slate-500">Loading Hub operations...</p> : null}
    {data ? <>
      <HubHandlingSummary summary={data.summary}/>
      <p className="text-xs leading-5 text-slate-500">{data.summary.assigned} linked listings · {data.summary.awaitingCollection} awaiting collection · {data.summary.missingIntakeBatches} batches without intake records</p>
      <p className="border-l-2 border-emerald-600 pl-3 text-xs leading-5 text-slate-600">Awaiting disposal = received weight minus recorded disposal and evidenced transfers out, counted once per batch. Missing intake or conflicting movements leave the balance unavailable. Listing weights are not intake receipts; disposal is not recycling output.</p>
      {data.aggregateOnly ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm" aria-label="Regional Hub operations"><thead><tr><th>Region</th><th>Assigned</th><th>Received batches</th><th>Textiles received</th><th>Recorded disposal</th><th>Awaiting disposal</th></tr></thead><tbody>{data.regions.map(row => <tr key={row.region} className="border-b border-slate-200"><th scope="row" className="py-3 font-medium">{row.region}</th><td>{row.assigned}</td><td>{row.collectedBatches}</td><td>{row.collectedBatches ? formatMass(row.collectedKg) : 'Intake not recorded'}</td><td>{data.disposalFeedAvailable ? formatMass(row.disposedKg) : 'Feed unavailable'}</td><td>{formatMass(row.awaitingDisposalKg,'Balance unavailable')}</td></tr>)}</tbody></table></div> : <>
        <div className="flex flex-col gap-3 sm:flex-row"><label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><Input className="pl-9" aria-label="Search Hub materials" placeholder="Search textile, owner, Hub or batch" value={search} onChange={event => setSearch(event.target.value)} /></label><Select aria-label="Hub handling status" className="sm:max-w-52" value={state} onChange={event => setState(event.target.value)}>{['All states', 'Awaiting collection', 'Collected', 'Partially disposed', 'Disposed', 'Transfer active', 'Closed'].map(value => <option key={value}>{value}</option>)}</Select></div>
        {rows.length ? <PaginatedRecords rows={rows} resetKey={JSON.stringify([filters, search, state])} label="Hub materials">{pageRows => <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs" aria-label="Hub material handling">
            <thead><tr>{['Textile / batch', 'Owner', 'Handling Hub', 'Handling state', 'Intake receipt', 'Disposed', 'Awaiting disposal', 'Last activity'].map(label => <th key={label} className="py-3 pr-4 text-slate-500">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-200">{pageRows.map(row => <tr key={row.listingId}>
              <th scope="row" className="max-w-64 py-4 pr-4 text-left font-medium"><p>{row.title}</p><p className="mt-1 break-all text-[11px] font-normal text-slate-500">{row.batchId}</p><p className="mt-1 text-slate-500">{row.material} · {row.region}</p></th>
              <td className="pr-4">{row.owner}</td><td className="pr-4">{row.hub}</td>
              <td className="pr-4"><Badge variant="outline">{row.state}</Badge></td>
              <td className="max-w-52 pr-4"><p>{formatMass(row.collectionKg, row.balanceStatus==='Shown once per batch'?'Shown once per batch':'Intake not recorded')}</p><p className="mt-1 text-slate-500">{row.collectionEvidence}</p></td>
              <td className="pr-4">{data.disposalFeedAvailable ? formatMass(row.disposedKg) : 'Feed unavailable'}</td>
              <td className="max-w-52 pr-4"><p>{formatMass(row.awaitingDisposalKg,row.balanceStatus)}</p>{row.balanceStatus==='Reconciled'&&row.transferredOutKg!==null?<p className="mt-1 text-slate-500">{formatMass(row.transferredOutKg)} transferred out</p>:null}</td>
              <td>{new Date(row.lastActivityAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td>
            </tr>)}</tbody>
          </table>
        </div>}</PaginatedRecords> : <EmptyBlock label="No assigned or handled Hub materials match these filters." />}
      </>}
    </> : null}
  </section>;
}
