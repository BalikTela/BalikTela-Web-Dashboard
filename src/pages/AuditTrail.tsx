import { PaginatedRecords } from '../components/PaginatedRecords';
import { History, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Input } from '../components/ui/input';
import type { AuditRecord } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock } from '../components/StateBlock';
import { useRecordRefresh } from '../hooks/useRecordRefresh';

export function AuditTrail() {
  const [records,setRecords]=useState<AuditRecord[]>([]);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{setRecords((await platformApi.auditRecords({q:query})).records);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load audit history.');}},[query]);
  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},150);return ()=>window.clearTimeout(timer);},[load]);
  useRecordRefresh(load,['/users','/organizations','/facilities','/material-batches','/transfers','/barter','/recovery-records','/configuration']);
  return <Panel><SectionHeader title="Audit Trail" eyebrow="Administrative changes, verification, lifecycle events, and configuration" actions={<label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search audit records" className="w-full pl-9 sm:w-64"/></label>}/>
    {error?<p className="text-sm text-red-700" role="alert">{error}</p>:records.length?<PaginatedRecords rows={records} resetKey={query} label="Audit records">{pageRows=><div className="border-l border-[#cfd8d4] pl-6">{pageRows.map(record=>{
      let reason=record.details;let changes:unknown;
      try{const parsed=JSON.parse(record.details);if(parsed.reason){reason=String(parsed.reason);changes=parsed.changes;}}catch{/* Legacy audit summaries remain plain text. */}
      return <article key={record.id} className="relative border-b border-[#edf0ee] py-4 last:border-0"><span className="absolute -left-[31px] top-5 grid h-4 w-4 place-items-center rounded-full bg-white ring-1 ring-[#cfd8d4]"><History size={9}/></span><div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium">{record.action}</p><p className="mt-1 break-all text-xs text-[#718079]">{record.entityType} · {record.entityId} · {record.actorId}</p><p className="mt-2 break-words text-sm text-[#53615c]">{reason}</p></div><p className="shrink-0 text-xs text-[#8b9893]">{new Date(record.timestamp).toLocaleString('en-PH')}</p></div>{changes?<details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-emerald-800">Changed records</summary><pre className="mt-2 max-h-80 overflow-auto rounded border border-[#dfe5e2] bg-[#f7f9f8] p-3 text-xs">{JSON.stringify(changes,null,2)}</pre></details>:null}</article>;
    })}</div>}</PaginatedRecords>:<EmptyBlock label="No audit records match the search."/>}
  </Panel>;
}
