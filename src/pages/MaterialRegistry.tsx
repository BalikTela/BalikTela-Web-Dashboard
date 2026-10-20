import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { measurementStageLabel } from '../../shared/hubs';
import { matchesRegistryWeightStatus, registryWeightStatus } from '../../shared/registryWeights';
import { ChevronRight, Database, Search, Scale, Weight, X, Pencil, Archive, RotateCcw, Plus, FileUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { EmptyBlock } from '../components/StateBlock';
import { SummaryCard } from '../components/SummaryCard';
import { MaterialBatchEditor } from '../components/MaterialBatchEditor';
import { BulkImport } from '../components/BulkImport';
import type { MaterialBatch } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import type { Filters } from '../types';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { useAuth } from '../context/AuthContext';
import { useRecordRefresh } from '../hooks/useRecordRefresh';

export function MaterialRegistry({ filters }: {filters:Filters}) {
  const {access}=useAuth();
  const canManage=access?.permissions.includes('batches.manage');
  const [batches,setBatches]=useState<MaterialBatch[]>([]);
  const [selected,setSelected]=useState<MaterialBatch|null>(null);
  const [editor,setEditor]=useState<{batch?:MaterialBatch;action:'edit'|'archive'|'restore'}|null>(null);
  const [importing,setImporting]=useState(false);
  const [query,setQuery]=useState('');
  const [visibility,setVisibility]=useState('Active');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const requestVersion=useRef(0);
  const load=useCallback(async()=>{const version=++requestVersion.current;try{const result=await platformApi.materialBatches({...toQuery(filters),weightStatus:'All weight statuses'});if(version===requestVersion.current){setBatches(result.batches.filter(batch=>matchesRegistryWeightStatus(batch.weightStatus,filters.weightStatus)));setError('');}}catch(reason){if(version===requestVersion.current)setError(reason instanceof Error?reason.message:'Unable to load batches.');}finally{if(version===requestVersion.current)setLoading(false);}},[filters]);
  useEffect(()=>{void load();return()=>{requestVersion.current++;};},[load]);
  useRecordRefresh(load,['/material-batches','/transfers','/barter','/imports/commit']);
  const active=batches.filter(item=>item.currentStatus!=='Archived');
  const rows=useMemo(()=>batches.filter(item=>visibility==='All'||(visibility==='Archived'?item.currentStatus==='Archived':item.currentStatus!=='Archived')).filter(item=>[item.id,item.materialCategory,item.wasteSource,item.wasteForm,item.city,item.region,item.currentStatus].join(' ').toLowerCase().includes(query.toLowerCase())),[batches,query,visibility]);
  return <>
    <p className="mb-4 border-l-2 border-emerald-600 pl-3 text-xs leading-5 text-slate-600">Posted consumer textiles are assumed recyclable. Original condition and intended pathway are preserved; neither a listing nor an estimated weight establishes physical collection or final recycling.</p>
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Material batches" value={active.length.toString()} detail="Active unique records in scope" icon={Database}/><SummaryCard label="Declared mass" value={`${formatMass(active.reduce((sum,item)=>sum+(item.declaredWeightKg ?? 0),0))}`} detail={`${active.filter(item=>item.declaredWeightKg === null).length} batches awaiting weighing`} icon={Weight}/><SummaryCard label="Measured mass" value={`${formatMass(active.filter(item=>registryWeightStatus(item.weightStatus)==='Measured').reduce((sum,item)=>sum+(item.currentWeightKg ?? 0),0))}`} detail="Current measured weights" icon={Scale}/><SummaryCard label="Archived batches" value={batches.filter(item=>item.currentStatus==='Archived').length.toString()} detail="Retained with measurement history" icon={Archive}/></section>
    <Panel><SectionHeader title="Material Batch Registry" eyebrow="Provenance, custody, measurements, and circular pathway" actions={<div className="flex flex-wrap gap-2"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label="Search batch records" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search batches" className="w-full pl-9 sm:w-56"/></label><Select aria-label="Batch visibility" value={visibility} onChange={e=>setVisibility(e.target.value)}><option>Active</option><option>Archived</option><option>All</option></Select>{canManage?<><Button size="sm" variant="outline" onClick={()=>setImporting(true)}><FileUp size={14}/>Import CSV</Button><Button size="sm" onClick={()=>setEditor({action:'edit'})}><Plus size={14}/>Register batch</Button></>:null}</div>}/>
      {error?<p role="alert" className="text-sm text-red-700">{error}</p>:loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading authorized material records...</div>:rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([query, visibility, filters])}>{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr><th>Batch</th><th>Material</th><th>Source / form</th><th>Pathway</th><th>Declared</th><th>Current</th><th>Weight Status</th><th>Custody status</th><th>Location</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(batch=><tr key={batch.id}>
        <td className="py-3"><button className="text-left font-semibold text-emerald-700" onClick={()=>setSelected(batch)}>{batch.id}</button></td><td>{batch.materialCategory}<p className="text-xs text-[#718079]">{batch.condition}</p></td><td>{batch.wasteSource}<p className="text-xs text-[#718079]">{batch.wasteForm}</p></td><td>{batch.circularPathway}</td><td>{formatMass(batch.declaredWeightKg, 'Awaiting weighing')}</td><td>{formatMass(batch.currentWeightKg, 'Awaiting weighing')}</td><td>{registryWeightStatus(batch.weightStatus)?<Badge variant="outline">{registryWeightStatus(batch.weightStatus)}</Badge>:<span title="Weight status not recorded" aria-label="Weight status not recorded">-</span>}</td><td>{batch.currentStatus}</td><td>{batch.city}, {batch.region}</td><td><div className="flex gap-1"><Action label={`View ${batch.id}`} onClick={()=>setSelected(batch)}><ChevronRight size={15}/></Action>{canManage?<><Action label={`Edit ${batch.id}`} onClick={()=>setEditor({batch,action:'edit'})}><Pencil size={15}/></Action><Action label={`${batch.currentStatus==='Archived'?'Restore':'Archive'} ${batch.id}`} onClick={()=>setEditor({batch,action:batch.currentStatus==='Archived'?'restore':'archive'})}>{batch.currentStatus==='Archived'?<RotateCcw size={15}/>:<Archive size={15}/>}</Action></>:null}</div></td>
      </tr>)}</tbody></table></div>}</PaginatedRecords>:<EmptyBlock label="No material batches match the current scope and filters."/>}
    </Panel>
    <BatchDrawer batch={selected ? batches.find(item=>item.id===selected.id) ?? null : null} onClose={()=>setSelected(null)}/>
    {importing ? <BulkImport onClose={()=>setImporting(false)}/> : null}
    {editor?<MaterialBatchEditor key={editor.batch?.id ?? (editor.action==='edit'?'new':'action')} batch={editor.batch} action={editor.action} onClose={()=>setEditor(null)}/>:null}
  </>;
}
function Action({label,onClick,children}:{label:string;onClick:()=>void;children:React.ReactNode}) {return <Button type="button" variant="ghost" size="icon" title={label} aria-label={label} onClick={onClick}>{children}</Button>;}
function BatchDrawer({batch,onClose}:{batch:MaterialBatch|null;onClose:()=>void}) {
  if(!batch)return null;
  return <div className="overlay-enter fixed inset-0 z-50 bg-slate-950/35" role="dialog" aria-modal="true" aria-label={`Material batch ${batch.id}`} onClick={onClose}>
    <aside className="drawer-enter absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6" onClick={e=>e.stopPropagation()}>
      <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-all text-lg font-semibold">{batch.id}</h2><p className="mt-1 text-sm text-[#66736e]">{batch.materialCategory} · {batch.condition} · {batch.currentStatus}</p></div><Button variant="ghost" size="icon" aria-label="Close batch detail" onClick={onClose}><X size={18}/></Button></header>
      <div className="mt-6 grid gap-3 border-y border-[#dfe5e2] py-4 sm:grid-cols-2">
        <Detail label="Waste source" value={batch.wasteSource}/><Detail label="Waste form" value={batch.wasteForm}/><Detail label="Pathway" value={batch.circularPathway}/><Detail label="Location" value={[batch.city,batch.region].filter(Boolean).join(', ') || 'Not recorded'}/>
        <Detail label="Source user ID" value={batch.sourceUserId}/><Detail label="Source organization" value={batch.sourceOrganizationId??'Individual participant'}/><Detail label="Current custodian ID" value={batch.currentCustodianId}/><Detail label="Mobile batch state" value={batch.canonicalStatus ?? batch.currentStatus}/>
        <Detail label="Recyclability basis" value={batch.recyclability?.basis ?? 'Not assessed in this response'}/>
      </div>
      <section className="mt-6"><h3 className="text-sm font-semibold">Measurement history</h3><div className="mt-3 divide-y divide-[#dfe5e2] border-y border-[#dfe5e2]">{[...batch.measurements].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).map(item=><article key={item.id} className="grid min-w-0 gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0 break-words"><p className="text-sm font-medium">{measurementStageLabel(item.canonicalStage ?? item.stage)} · {registryWeightStatus(item.status) ?? 'Not recorded'}</p><p className="mt-1 text-xs text-[#718079]">{item.method} · {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.timestamp))}</p><p className="mt-1 break-all text-xs text-[#718079]">Measurement {item.id} · operator {item.recordedBy} · verifier {item.verifiedBy ?? 'Not recorded'}</p><p className="mt-1 break-all text-xs text-[#718079]">Transfer {item.transferId ?? 'Not linked'} · facility {item.facilityId ?? 'Not recorded'}{item.supersedesMeasurementId ? ` · replaces ${item.supersedesMeasurementId}` : ''}</p><p className="mt-1 text-xs text-[#66736e]">{item.note}</p></div><p className="text-xl font-semibold tabular-nums">{formatMass(item.weightKg)}</p></article>)}</div></section>
    </aside>
  </div>;
}
function Detail({label,value}:{label:string;value:string}) {return <div><p className="text-xs text-[#718079]">{label}</p><p className="mt-1 break-all text-sm font-medium">{value}</p></div>;}
export function toQuery(filters:Filters) {return { ...filters, materialCategory: filters.textileType };}
