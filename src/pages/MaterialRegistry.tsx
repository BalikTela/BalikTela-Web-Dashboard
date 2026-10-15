import { ChevronRight, Database, Search, ShieldCheck, Weight, X, Pencil, Archive, RotateCcw, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { EmptyBlock } from '../components/StateBlock';
import { SummaryCard } from '../components/SummaryCard';
import { MaterialBatchEditor } from '../components/MaterialBatchEditor';
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
  const [query,setQuery]=useState('');
  const [visibility,setVisibility]=useState('Active');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{const result=await platformApi.materialBatches(toQuery(filters));setBatches(result.batches);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load batches.');}finally{setLoading(false);}},[filters]);
  useEffect(()=>{void load();},[load]);
  useRecordRefresh(load,['/material-batches','/transfers','/barter']);
  const active=batches.filter(item=>item.currentStatus!=='Archived');
  const rows=useMemo(()=>batches.filter(item=>visibility==='All'||(visibility==='Archived'?item.currentStatus==='Archived':item.currentStatus!=='Archived')).filter(item=>[item.id,item.materialCategory,item.wasteSource,item.wasteForm,item.city,item.region,item.currentStatus].join(' ').toLowerCase().includes(query.toLowerCase())),[batches,query,visibility]);
  return <>
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Material batches" value={active.length.toString()} detail="Active unique records in scope" icon={Database}/><SummaryCard label="Declared mass" value={`${active.reduce((sum,item)=>sum+item.declaredWeightKg,0).toLocaleString()} kg`} detail="Unique active batch mass" icon={Weight}/><SummaryCard label="Verified mass" value={`${active.filter(item=>item.weightStatus==='Verified').reduce((sum,item)=>sum+item.currentWeightKg,0).toLocaleString()} kg`} detail="Current verified weights" icon={ShieldCheck}/><SummaryCard label="Archived batches" value={batches.filter(item=>item.currentStatus==='Archived').length.toString()} detail="Retained with measurement history" icon={Archive}/></section>
    <Panel><SectionHeader title="Material Batch Registry" eyebrow="Provenance, custody, measurements, and circular pathway" actions={<div className="flex flex-wrap gap-2"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label="Search batch records" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search batches" className="w-full pl-9 sm:w-56"/></label><Select aria-label="Batch visibility" value={visibility} onChange={e=>setVisibility(e.target.value)}><option>Active</option><option>Archived</option><option>All</option></Select>{canManage?<Button size="sm" onClick={()=>setEditor({action:'edit'})}><Plus size={14}/>Register batch</Button>:null}</div>}/>
      {error?<p role="alert" className="text-sm text-red-700">{error}</p>:loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading authorized material records...</div>:rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr><th>Batch</th><th>Material</th><th>Source / form</th><th>Pathway</th><th>Declared</th><th>Current</th><th>Evidence</th><th>Custody status</th><th>Location</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{rows.map(batch=><tr key={batch.id}>
        <td className="py-3"><button className="text-left font-semibold text-emerald-700" onClick={()=>setSelected(batch)}>{batch.id}</button><p className="text-[10px] text-[#718079]">{batch.isDemo?'Demo record':'Operational record'}</p></td><td>{batch.materialCategory}<p className="text-xs text-[#718079]">{batch.condition}</p></td><td>{batch.wasteSource}<p className="text-xs text-[#718079]">{batch.wasteForm}</p></td><td>{batch.circularPathway}</td><td>{batch.declaredWeightKg.toLocaleString()} kg</td><td>{batch.currentWeightKg.toLocaleString()} kg</td><td><Badge variant="outline">{batch.weightStatus}</Badge></td><td>{batch.currentStatus}</td><td>{batch.city}, {batch.region}</td><td><div className="flex gap-1"><Action label={`View ${batch.id}`} onClick={()=>setSelected(batch)}><ChevronRight size={15}/></Action>{canManage?<><Action label={`Edit ${batch.id}`} onClick={()=>setEditor({batch,action:'edit'})}><Pencil size={15}/></Action><Action label={`${batch.currentStatus==='Archived'?'Restore':'Archive'} ${batch.id}`} onClick={()=>setEditor({batch,action:batch.currentStatus==='Archived'?'restore':'archive'})}>{batch.currentStatus==='Archived'?<RotateCcw size={15}/>:<Archive size={15}/>}</Action></>:null}</div></td>
      </tr>)}</tbody></table></div>:<EmptyBlock label="No material batches match the current scope and filters."/>}
    </Panel>
    <BatchDrawer batch={selected} onClose={()=>setSelected(null)}/>
    {editor?<MaterialBatchEditor key={editor.batch?.id ?? (editor.action==='edit'?'new':'action')} batch={editor.batch} action={editor.action} onClose={()=>setEditor(null)}/>:null}
  </>;
}
function Action({label,onClick,children}:{label:string;onClick:()=>void;children:React.ReactNode}) {return <Button type="button" variant="ghost" size="icon" title={label} aria-label={label} onClick={onClick}>{children}</Button>;}
function BatchDrawer({batch,onClose}:{batch:MaterialBatch|null;onClose:()=>void}) {
  if(!batch)return null;
  return <div className="overlay-enter fixed inset-0 z-50 bg-slate-950/35" role="dialog" aria-modal="true" onClick={onClose}><aside className="drawer-enter absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6" onClick={e=>e.stopPropagation()}><header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-all text-lg font-semibold">{batch.id}</h2><p className="mt-1 text-sm text-[#66736e]">{batch.materialCategory} · {batch.condition} · {batch.currentStatus}</p></div><Button variant="ghost" size="icon" aria-label="Close batch detail" onClick={onClose}><X size={18}/></Button></header><div className="mt-6 grid gap-3 border-y border-[#dfe5e2] py-4 sm:grid-cols-2"><Detail label="Waste source" value={batch.wasteSource}/><Detail label="Waste form" value={batch.wasteForm}/><Detail label="Pathway" value={batch.circularPathway}/><Detail label="Location" value={`${batch.city}, ${batch.region}`}/><Detail label="Source organization" value={batch.sourceOrganizationId??'Individual participant'}/><Detail label="Current custodian" value={batch.currentCustodianId}/></div><section className="mt-6"><h3 className="text-sm font-semibold">Measurement history</h3><div className="mt-3 divide-y divide-[#dfe5e2] border-y border-[#dfe5e2]">{batch.measurements.map(item=><article key={item.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]"><div><p className="text-sm font-medium">{item.stage} · {item.status}</p><p className="mt-1 text-xs text-[#718079]">{item.method} · {new Date(item.timestamp).toLocaleString('en-PH')}</p><p className="mt-1 text-xs text-[#66736e]">{item.note}</p></div><p className="text-xl font-semibold tabular-nums">{item.weightKg} kg</p></article>)}</div></section></aside></div>;
}
function Detail({label,value}:{label:string;value:string}) {return <div><p className="text-xs text-[#718079]">{label}</p><p className="mt-1 break-all text-sm font-medium">{value}</p></div>;}
export function toQuery(filters:Filters) {return {region:filters.region,materialCategory:filters.textileType,wasteSource:filters.wasteSource,circularPathway:filters.circularPathway,weightStatus:filters.weightStatus,facilityId:filters.facilityId,organizationId:filters.organizationId,transactionStatus:filters.transactionStatus};}
