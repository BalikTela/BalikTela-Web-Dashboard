import { AlertTriangle, CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { Badge } from '../components/ui/badge';
import { EmptyBlock } from '../components/StateBlock';
import { SummaryCard } from '../components/SummaryCard';
import type { DataQualityResult } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import type { Filters } from '../types';
import { toQuery } from './MaterialRegistry';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';

export function DataQuality({ filters }: { filters: Filters }) {
  const [data, setData] = useState<DataQualityResult | null>(null);
  const [error, setError] = useState('');
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    try { const result = await platformApi.dataQuality(toQuery(filters)); if (current === version.current) { setData(result); setError(''); } }
    catch (reason) { if (current === version.current) setError(reason instanceof Error ? reason.message : 'Unable to load data-quality checks.'); }
  }, [filters]);
  useEffect(() => { setData(null); void load(); return () => { version.current++; }; }, [load]);
  useRecordRefresh(load, ['/material-batches', '/transfers', '/configuration', '/recovery-records', '/imports']);
  if (error) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!data) return <div className="grid min-h-80 place-items-center text-sm text-[#718079]">Running quality checks...</div>;
  return <div className="space-y-5">
    <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Quality findings" value={String(data.summary.totalIssues)} detail="Open and documented findings in scope" icon={CircleAlert} />
      <SummaryCard label="Critical findings" value={String(data.summary.critical)} detail="Requires investigation or evidence" icon={AlertTriangle} tone="amber" />
      <SummaryCard label="Warnings" value={String(data.summary.warnings)} detail="Incomplete or estimated records" icon={CircleAlert} />
      <SummaryCard label="Weight verification coverage" value={data.checkedBatches === 0 ? 'Not available' : `${data.summary.validationCoveragePercent}%`} detail="Verified batch weights / batches in scope; not final recovery" icon={ShieldCheck} tone="emerald" />
    </section>
    <Panel><SectionHeader title="Data Quality Center" eyebrow={`Automated integrity checks · discrepancy threshold ${data.thresholdPercent}%`} />
      {data.issues.length ? <PaginatedRecords rows={data.issues} resetKey={JSON.stringify(filters)}>{rows => <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead><tr><th>Severity</th><th>Category</th><th>Record</th><th>Description</th><th>Status</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{rows.map(item => <tr key={item.id}><td className="py-3"><Badge variant="outline" className={item.severity === 'Critical' ? 'border-red-200 text-red-700' : 'border-amber-200 text-amber-700'}>{item.severity}</Badge></td><td className="font-medium">{item.category}</td><td>{item.entityType}<p className="text-xs text-[#718079]">{item.entityId}</p></td><td className="max-w-xl leading-5">{item.description}</td><td><span className={item.status === 'Documented' ? 'flex items-center gap-1.5 text-emerald-700' : 'text-amber-700'}>{item.status === 'Documented' ? <CheckCircle2 size={14} /> : null}{item.status}</span></td></tr>)}</tbody></table></div>}</PaginatedRecords> : <EmptyBlock label="No quality findings match the current scope and filters." />}
    </Panel>
    {data.checks ? <section className="border-y border-[#dfe5e2] py-5"><SectionHeader title="Checks and Source Records" />
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{data.checks.map(rule => <div key={rule.label} className="min-w-0"><dt className="text-sm font-semibold">{rule.label}</dt><dd className="mt-1 break-words text-xs leading-5 text-slate-600">{rule.meaning}<span className="mt-1 block text-slate-500">Source: {rule.source}</span></dd></div>)}</dl>
    </section> : null}
  </div>;
}
