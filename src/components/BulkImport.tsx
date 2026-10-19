import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, LoaderCircle, X } from 'lucide-react';
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, type ImportPreview, type ImportResult, type ImportOptions } from '../../shared/imports';
import { formatMass } from '../../shared/metrics';
import { manilaDate } from '../../shared/reporting';
import { platformApi } from '../services/platformApi';
import { PaginatedRecords } from './PaginatedRecords';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function BulkImport({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options,setOptions]=useState<ImportOptions|null>(null);
  const [chunks,setChunks]=useState<string[]>([]);
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [result,setResult]=useState<ImportResult|null>(null);
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  useEffect(()=>{
    const element=dialog.current!, previous=document.activeElement as HTMLElement|null;
    element.showModal();
    let active=true;
    platformApi.importOptions().then(data=>{if(active)setOptions(data);}).catch(reason=>{if(active)setError(reason.message);});
    return()=>{active=false;element.close();previous?.focus();};
  },[]);
  const choose=async(file?:File)=>{
    setPreview(null);setResult(null);setConfirmed(false);setError('');setChunks([]);
    if(!file)return;
    if(!file.name.toLowerCase().endsWith('.csv')||file.size>IMPORT_MAX_BYTES){setError(`Select a CSV up to ${IMPORT_MAX_BYTES/1000} KB.`);return;}
    const csv=await file.text(), next:string[]=[];
    for(let offset=0;offset<csv.length;offset+=8000)next.push(csv.slice(offset,offset+8000));
    setChunks(next);
  };
  const template=()=>{
    if(!options)return;
    const producer=options.producers[0],recipient=options.recipients.find(user=>options.facilities.some(facility=>facility.organizationId===user.organizationId));
    const facility=options.facilities.find(item=>item.organizationId===recipient?.organizationId);
    const today=manilaDate(), year=Number(today.slice(0,4)), month=Number(today.slice(5,7))-1;
    const rows=[...Array(3)].map((_,index)=>{
      const date=new Date(Date.UTC(year,month-2+index,1)).toISOString().slice(0,10);
      return [`demo-${date}-example`,`${date}T00:00:00+08:00`,producer?.id??'',recipient?.id??'',facility?.id??'','Cotton',100+index*20,90+index*18,80+index*16,'Recycling',70+index*14];
    });
    const csv=[IMPORT_COLUMNS,...rows].map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='baliktela-demo-lifecycle-template.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const validate=async()=>{setBusy(true);setError('');setResult(null);setConfirmed(false);try{setPreview(await platformApi.previewImport(chunks));}catch(reason){setError(reason instanceof Error?reason.message:'Unable to preview file.');}finally{setBusy(false);}};
  const save=async()=>{if(!preview?.valid)return;setBusy(true);setError('');try{setResult(await platformApi.commitImport(chunks,preview.previewHash,reason));setPreview(null);setConfirmed(false);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to import file.');}finally{setBusy(false);}};
  return <dialog ref={dialog} aria-labelledby="bulk-import-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}} className="m-auto max-h-[90dvh] w-[calc(100%_-_24px)] max-w-4xl overflow-y-auto rounded-md border border-slate-200 bg-white p-4 text-slate-900 shadow-xl backdrop:bg-slate-950/40 sm:p-6">
    <header className="mb-5 flex items-start justify-between gap-3"><div><h2 id="bulk-import-title" className="text-lg font-semibold">Import demo lifecycle data</h2><p className="mt-1 text-xs leading-5 text-slate-500">Synthetic records only · kilograms in CSV · up to {IMPORT_MAX_ROWS} rows · no account, reward or existing-record changes</p></div><Button disabled={busy} variant="ghost" size="icon" aria-label="Close bulk import" onClick={onClose}><X size={18}/></Button></header>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><Button variant="outline" disabled={!options||busy} onClick={template}><Download size={15}/>CSV template</Button><label className="min-w-0 flex-1"><span className="mb-1.5 block text-xs font-medium">Dataset CSV</span><Input type="file" accept=".csv,text/csv" aria-label="Dataset CSV" disabled={busy} onChange={event=>void choose(event.target.files?.[0])}/></label><Button disabled={!chunks.length||busy} onClick={()=>void validate()}>{busy?<LoaderCircle size={15} className="animate-spin"/>:<FileUp size={15}/>}Preview file</Button></div>
    {error?<p role="alert" className="mt-4 break-words text-sm text-red-700">{error}</p>:null}
    {result?<p role="status" className={`mt-4 rounded-md border p-3 text-sm leading-6 ${result.complete?'border-emerald-200 bg-emerald-50 text-emerald-900':'border-amber-200 bg-amber-50 text-amber-900'}`}>{result.importedRows} imported · {result.skippedRows} already present. {result.message}</p>:null}
    {preview?<section className="mt-5 space-y-4"><p className="text-sm font-semibold">{preview.totalRows} rows · {preview.newRows} new · {preview.skippedRows} already imported · {preview.rows.filter(row=>row.status==='Invalid').length} invalid</p><dl className="grid grid-cols-2 gap-3 border-y border-slate-200 py-3 sm:grid-cols-4">{Object.entries(preview.totals).map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label.replace('Kg','').replace(/^./,letter=>letter.toUpperCase())}</dt><dd className="mt-1 font-semibold tabular-nums">{formatMass(value)}</dd></div>)}</dl>
      <PaginatedRecords rows={preview.rows} resetKey={preview.previewHash} label="Import rows">{rows=><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr><th>CSV row</th><th>External ID</th><th>Status</th><th>Validation</th></tr></thead><tbody className="divide-y divide-slate-200">{rows.map(row=><tr key={row.row}><td className="py-3">{row.row}</td><td className="max-w-48 break-all">{row.externalId}</td><td className={row.status==='Invalid'?'text-red-700':'text-emerald-800'}>{row.status}</td><td className="max-w-sm break-words">{row.message}</td></tr>)}</tbody></table></div>}</PaginatedRecords>
      <label className="block"><span className="mb-1.5 block text-xs font-medium">Import reason</span><Input value={reason} maxLength={4000} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)} className="mt-1"/><span>I confirm this file contains synthetic demo data, not independently verified operational evidence.</span></label>
      <Button disabled={!preview.valid||!preview.newRows||!reason.trim()||!confirmed||busy} onClick={()=>void save()}><FileUp size={15}/>Import {preview.newRows} demo rows</Button>
    </section>:null}
  </dialog>;
}
