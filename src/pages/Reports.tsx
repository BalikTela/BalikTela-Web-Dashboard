import { Download, LoaderCircle, LockKeyhole, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReportDocument } from '../../shared/reporting';
import type { ReportDefinition } from '../platformTypes';
import type { Filters } from '../types';
import { platformApi } from '../services/platformApi';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { renderPrintableReport } from '../lib/printReport';
import { useRecordRefresh } from '../hooks/useRecordRefresh';

export function Reports({ filters, active = true }: { filters: Filters; active?: boolean }) {
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [id, setId] = useState('material-flow');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; report?: ReportDocument; error?: string }>({ key: '' });
  const [busy, setBusy] = useState('');
  const [exportError, setExportError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const key = JSON.stringify([id, filters, revision]);
  const current = state.key === key ? state : undefined;
  const report = current?.report;
  useEffect(() => { let active = true; void platformApi.reports().then(result => { if (active) { setReports(result.reports); setCatalogError(''); } }).catch(error => { if (active) setCatalogError(error.message ?? 'Unable to load report types.'); }); return () => { active = false; }; }, [revision]);
  useRecordRefresh(() => setRevision(value => value + 1), ['/material-batches', '/transfers', '/recovery-records', '/organizations', '/configuration']);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); setExportError('');
    const timer = setTimeout(() => {
      void platformApi.reportPreview(id, { ...filters }, controller.signal).then(result => { if (!controller.signal.aborted) setState({ key, report: result }); }).catch(error => { if (!controller.signal.aborted) setState({ key, error: error.message ?? 'Unable to generate this report.' }); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, filters, key, active]);
  const exportCsv = async () => {
    if (!report) return;
    setBusy('csv'); setExportError('');
    try { await platformApi.exportReport(id, { ...filters }, `baliktela-${id}-${report.period.startDate}-${report.period.endDate}.csv`); }
    catch (error) { setExportError(error instanceof Error ? error.message : 'Unable to export CSV.'); }
    finally { setBusy(''); }
  };
  const print = async () => {
    const popup = window.open('about:blank', '_blank');
    if (!popup) { setExportError('Allow pop-ups for this site to open the printable report.'); return; }
    popup.opener = null; popup.document.title = 'Preparing BalikTelaPH report'; popup.document.body.textContent = 'Preparing report...';
    setBusy('print'); setExportError('');
    try { const document = await platformApi.printableReport(id, { ...filters }); renderPrintableReport(popup, document); popup.focus(); }
    catch (error) { popup.close(); setExportError(error instanceof Error ? error.message : 'Unable to prepare the printable report.'); }
    finally { setBusy(''); }
  };
  return <Panel>
    {catalogError ? <p role="alert" className="mb-4 text-sm text-red-700">{catalogError} <button type="button" className="underline" onClick={() => setRevision(value => value + 1)}>Retry report list</button></p> : null}
    <SectionHeader title="Reports" eyebrow="Filtered operational summaries" actions={<label className="grid min-w-0 gap-1.5 text-xs text-[#66736e]">Report type<Select aria-label="Report type" value={id} onChange={event => setId(event.target.value)} className="w-full sm:max-w-80">{(reports.length ? reports : [{ id: 'material-flow', name: 'Material Flow Summary' }]).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>} />
    {current?.error ? <div role="alert" className="py-12 text-sm text-red-700"><p>{current.error}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)} className="mt-4">Retry report</Button></div> : !report ? <div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-[#66736e]"><LoaderCircle size={18} className="animate-spin" />Preparing filtered report...</div> : <>
      <header className="flex flex-col justify-between gap-5 border-y border-[#dfe5e2] py-5 lg:flex-row lg:items-start"><div className="min-w-0"><h3 className="text-lg font-semibold">{report.title}</h3><p className="mt-2 text-sm text-[#66736e]">{report.period.label} / {report.period.timeZone}</p><p className="mt-1 text-xs leading-5 text-[#718079]">{report.scope.role} / {report.scope.description}</p><p className="mt-1 text-xs text-[#718079]">Generated {new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })} PHT</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" aria-label="Refresh report" title="Refresh report" disabled={Boolean(busy)} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /></Button><Button variant="outline" disabled={!report.scope.canExport || Boolean(busy)} onClick={exportCsv}><Download size={15} />{busy === 'csv' ? 'Preparing...' : 'Export CSV'}</Button><Button variant="outline" disabled={!report.scope.canExport || Boolean(busy)} onClick={print}><Printer size={15} />Print / PDF</Button></div></header>
      {!report.scope.canExport ? <p className="mt-4 flex items-center gap-2 text-xs text-[#66736e]"><LockKeyhole size={14} />Export permission is not assigned to this account.</p> : null}
      {exportError ? <p role="alert" className="mt-4 text-sm text-red-700">{exportError}</p> : null}
      <dl className="grid grid-cols-2 gap-5 border-b border-[#dfe5e2] py-6 xl:grid-cols-3">{report.summary.map(item => <div key={item.label} className="min-w-0"><dt className="text-xs text-[#66736e]">{item.label}</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums text-[#22634e]">{item.value}</dd>{item.description ? <p className="mt-2 text-xs leading-5 text-[#718079]">{item.description}</p> : null}</div>)}</dl>
      {report.interpretation?.length ? <section className="border-b border-[#dfe5e2] py-5" aria-label="Report interpretation"><h4 className="text-sm font-semibold text-[#20332a]">Report Interpretation</h4><div className="mt-4 grid gap-x-8 gap-y-4 lg:grid-cols-2">{report.interpretation.map(item => <div key={item.label} className="min-w-0"><p className="text-xs font-medium text-[#34423d]">{item.label}</p><p className="mt-1 break-words text-xs leading-5 text-[#66736e]">{item.text}</p></div>)}</div></section> : null}
      <div className="mt-5"><PaginatedRecords rows={report.rows} resetKey={key} label="Report rows">{rows => <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs tabular-nums" aria-label={`${report.title} preview`}><thead><tr>{report.columns.map(column => <th key={column} className="border-b border-[#dfe5e2] bg-[#f7f9f8] px-3 py-3 font-medium text-[#66736e]">{column}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index} className={row[0] === 'TOTAL' ? 'bg-[#f7f9f8] font-semibold' : ''}>{row.map((cell, column) => <td key={column} className="border-b border-[#edf0ee] px-3 py-3">{cell}</td>)}</tr>) : <tr><td colSpan={report.columns.length} className="px-3 py-8 text-center text-[#718079]">No records match this report scope and period.</td></tr>}</tbody></table></div>}</PaginatedRecords></div>
      <details className="mt-6 border-t border-[#dfe5e2] pt-4 text-xs text-[#66736e]"><summary className="cursor-pointer font-medium">Definitions, filters & limitations</summary><div className="mt-3 space-y-3 leading-6">{report.definitions?.map(item => <p key={item.label}><strong className="font-medium">{item.label}: </strong>{item.text}</p>)}<p>{report.filters.map(item => `${item.label}: ${item.value}`).join(' / ') || 'Default reporting filters'}</p>{report.notes.map(note => <p key={note}>{note}</p>)}</div></details>
    </>}
  </Panel>;
}
