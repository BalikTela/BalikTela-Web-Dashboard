import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { isTerminalTransfer, matchesTransferStatus } from '../../shared/workflows';
import { ChevronRight, Pencil, RotateCcw, Search, Waypoints, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { EmptyBlock } from '../components/StateBlock';
import { OfferAdmin, TransferAdmin } from '../components/TransferAdmin';
import type { BarterOffer, Transfer } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import type { Filters } from '../types';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { useAuth } from '../context/AuthContext';
import { useRecordRefresh } from '../hooks/useRecordRefresh';

export function OperationalTraceability({filters}:{filters:Filters}) {
  const {user,access}=useAuth();
  const canManage=user?.role==='Administrator' && access?.permissions.includes('transfers.manage');
  const [transfers,setTransfers]=useState<Transfer[]>([]);
  const [offers,setOffers]=useState<BarterOffer[]>([]);
  const [query,setQuery]=useState('');
  const [view,setView]=useState<'transfers'|'offers'>('transfers');
  const [selected,setSelected]=useState<Transfer|null>(null);
  const [editing,setEditing]=useState<Transfer|null>(null);
  const [offer,setOffer]=useState<BarterOffer|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const [columnCount,setColumnCount]=useState(()=>traceabilityColumnCount('transfers'));
  const detailsPrefix=useId();
  const requestVersion = useRef(0);
  const activeView = canManage ? view : 'transfers';
  useEffect(()=>setExpandedId(null),[query,activeView,filters]);
  useEffect(()=>{
    const breakpoints=[window.matchMedia('(min-width: 640px)'),window.matchMedia('(min-width: 768px)')];
    const update=()=>setColumnCount(traceabilityColumnCount(activeView));
    update();
    breakpoints.forEach(breakpoint=>breakpoint.addEventListener('change',update));
    return()=>breakpoints.forEach(breakpoint=>breakpoint.removeEventListener('change',update));
  },[activeView]);
  const loadedScope = useRef('');
  const load=useCallback(async()=>{
    const version=++requestVersion.current;
    const scope=JSON.stringify([activeView,filters]);
    if(loadedScope.current!==scope){setTransfers([]);setOffers([]);setError('');loadedScope.current=scope;}
    setLoading(true);
    try {
      if(activeView==='offers') {
        const result=await platformApi.offers({...filters});
        if(!Array.isArray(result.offers))throw new Error('Offers could not be read. Please retry.');
        if(version!==requestVersion.current)return;
        setOffers(result.offers);
      } else {
        const result=await platformApi.transfers({...filters});
        if(!Array.isArray(result.transfers))throw new Error('Transfers could not be read. Please retry.');
        if(version!==requestVersion.current)return;
        setTransfers(result.transfers);
      }
      setError('');
    }catch(reason){if(version===requestVersion.current)setError(reason instanceof Error?reason.message:'Unable to load traceability records.');}
    finally{if(version===requestVersion.current)setLoading(false);}
  },[activeView,filters]);
  useEffect(()=>{void load();return()=>{requestVersion.current++;};},[load]);
  useRecordRefresh(load,['/transfers','/barter','/material-batches','/users']);
  const currentSelection = selected ? transfers.find(item => item.id === selected.id) ?? null : null;
  const rows=useMemo(()=>transfers.filter(item=>matchesTransferStatus(item.status,filters.transactionStatus)).filter(item=>[item.requesterName,item.recipientId,item.providerId,item.id,item.batchId,item.listingId,item.offerId,item.materialCategory,item.status,item.circularOutcome].join(' ').toLowerCase().includes(query.trim().toLowerCase())),[filters.transactionStatus,query,transfers]);
  const offerRows=useMemo(()=>offers.filter(item=>[item.id,item.listingTitle,item.listingId,item.recipientName,item.recipientId,item.providerId,item.terms,item.status].join(' ').toLowerCase().includes(query.trim().toLowerCase())),[offers,query]);
  return <><Panel><SectionHeader title="Transactions and Traceability" eyebrow="Custody, measurement, discrepancy, and reward evidence" actions={<div className="flex flex-wrap gap-2">{canManage?<div className="flex rounded-md bg-slate-100 p-1">{(['transfers','offers'] as const).map(item=><button key={item} type="button" aria-pressed={view===item} className={`rounded px-3 py-1 text-sm ${view===item?'bg-white':'text-slate-500'}`} onClick={()=>setView(item)}>{item==='transfers'?'Transfers':'Offers'}</button>)}</div>:null}<label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label="Search transfers" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or ID" className="w-full pl-9 sm:w-56"/></label></div>}/>
    {error?<div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"><p>{error}</p><Button variant="outline" disabled={loading} onClick={()=>void load()}><RotateCcw size={15}/>Retry traceability records</Button></div>:null}
    {loading && !(activeView==='offers'?offers.length:transfers.length)?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading traceability records...</div>
      :activeView==='offers' && offerRows.length?<PaginatedRecords rows={offerRows} resetKey={JSON.stringify([query,view,filters])}>{pageRows=><div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm" aria-label="Transaction offers">
        <thead><tr><th>Listing</th><th className="hidden sm:table-cell sm:w-[22%]">Requester</th><th className="hidden sm:table-cell sm:w-[16%]">Requested weight</th><th className="w-24 sm:w-[16%]">Status</th><th className="w-10 text-right sm:w-20"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=>{
          const expanded=expandedId===item.id,detailsId=`${detailsPrefix}-offer-${encodeURIComponent(item.id)}`;
          return <Fragment key={item.id}>
            <tr className={expanded?'bg-[#f2f7f4]':''} data-offer-id={item.id}>
              <td className="py-4 align-top"><p className="line-clamp-2 break-words font-medium leading-5" title={item.listingTitle}>{item.listingTitle}</p><p className="mt-1 break-all text-xs leading-4 text-[#718079]">{item.id}</p><p className="mt-2 break-words text-xs text-[#718079] sm:hidden">{item.recipientName||'Name unavailable'}</p><p className="mt-1 text-xs tabular-nums sm:hidden">{formatMass(item.quantityKg)} requested</p></td>
              <td className="hidden break-words py-4 align-top sm:table-cell"><p className="line-clamp-2 leading-5" title={item.recipientName}>{item.recipientName||'Name unavailable'}</p></td>
              <td className="hidden break-words py-4 align-top tabular-nums sm:table-cell">{formatMass(item.quantityKg)}</td>
              <td className="py-4 align-top"><Badge variant="outline" className="max-w-full break-words px-2">{item.status}</Badge></td>
              <td className="py-3 align-top"><div className="flex flex-col items-end justify-end gap-1 sm:flex-row">{['Pending','Revised'].includes(item.status)?<Button variant="ghost" size="icon" title={`Review ${item.id}`} aria-label={`Review ${item.id}`} onClick={()=>setOffer(item)}><Pencil size={15}/></Button>:null}<ExpandTransaction expanded={expanded} detailsId={detailsId} label={`offer ${item.id}`} onClick={()=>setExpandedId(expanded?null:item.id)}/></div></td>
            </tr>
            {expanded?<tr className="bg-[#f7faf8]"><td colSpan={columnCount} className="py-5"><div id={detailsId} role="region" aria-label={`Offer details for ${item.id}`} className="border-l-2 border-emerald-600 pl-4"><TraceabilityFacts facts={[
              ['Offer ID',item.id],['Listing ID',item.listingId],['Requester ID',item.recipientId],['Provider ID',item.providerId],
              ['Offered credits',item.offeredCredits.toLocaleString()],['Created',transactionDate(item.createdAt)],['Last updated',transactionDate(item.updatedAt)],
            ]}/><DetailText label="Terms" value={item.terms}/></div></td></tr>:null}
          </Fragment>;
        })}</tbody></table></div>}</PaginatedRecords>
      :activeView==='transfers' && rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([query,view,filters])}>{pageRows=><div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm" aria-label="Textile transactions">
        <thead><tr><th>Transaction ID</th><th className="hidden sm:table-cell sm:w-[22%]">Requester</th><th className="hidden md:table-cell md:w-[14%]">Material</th><th className="hidden sm:table-cell sm:w-[15%]">Agreed weight</th><th className="w-24 sm:w-[16%]">Status</th><th className="w-10 text-right sm:w-20"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=>{
          const expanded=expandedId===item.id,detailsId=`${detailsPrefix}-transfer-${encodeURIComponent(item.id)}`;
          return <Fragment key={item.id}>
            <tr className={expanded?'bg-[#f2f7f4]':''} data-transfer-id={item.id}>
              <td className="py-4 align-top"><button type="button" className="max-w-full break-all text-left font-semibold leading-5 text-emerald-700 hover:underline" title="View transaction timeline" onClick={()=>setSelected(item)}>{item.id}</button><p className="mt-1 text-xs text-[#718079]">{item.events.length} events</p><p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-[#718079] sm:hidden">{item.requesterName?.trim()||'Name unavailable'} · {item.materialCategory}</p><p className="mt-1 text-xs tabular-nums sm:hidden">{formatMass(item.agreedWeightKg)} agreed</p><p className="mt-2 hidden break-words text-xs text-[#718079] sm:block md:hidden">{item.materialCategory}</p></td>
              <td className="hidden break-words py-4 align-top sm:table-cell"><p className="line-clamp-2 leading-5" title={item.requesterName??undefined}>{item.requesterName?.trim()||'Name unavailable'}</p></td>
              <td className="hidden break-words py-4 align-top md:table-cell">{item.materialCategory}</td>
              <td className="hidden break-words py-4 align-top tabular-nums sm:table-cell">{formatMass(item.agreedWeightKg)}</td>
              <td className="py-4 align-top"><Badge variant="outline" className="max-w-full break-words px-2">{item.status}</Badge></td>
              <td className="py-3 align-top"><div className="flex flex-col items-end justify-end gap-1 sm:flex-row">{canManage && !isTerminalTransfer(item.status) && ['Reserved','Handed over','Received','Validated','Disputed'].includes(item.status)?<Button variant="ghost" size="icon" aria-label={`Manage ${item.id}`} title={`Manage ${item.id}`} onClick={()=>setEditing(item)}><Pencil size={15}/></Button>:null}<ExpandTransaction expanded={expanded} detailsId={detailsId} label={`transaction ${item.id}`} onClick={()=>setExpandedId(expanded?null:item.id)}/></div></td>
            </tr>
            {expanded?<tr className="bg-[#f7faf8]"><td colSpan={columnCount} className="py-5"><div id={detailsId} role="region" aria-label={`Transaction details for ${item.id}`} className="border-l-2 border-emerald-600 pl-4">
              <TraceabilityFacts facts={[
                ['Batch ID',item.batchId],['Listing ID',item.listingId],['Request ID',item.offerId],['Requester',item.requesterName?.trim()||'Name unavailable'],
                ['Provider ID',item.providerId],['Recipient ID',item.recipientId],['Material',item.materialCategory],['Agreed weight',formatMass(item.agreedWeightKg)],
                ['Reported handover',formatMass(item.handoverWeightKg,'Pending')],['Reported receipt',formatMass(item.receiptWeightKg,'Pending')],['Verified weight',formatMass(item.verifiedWeightKg,'Pending')],
                ['Outcome',item.circularOutcome??'Pending'],['Reward',item.rewardIssuedAt?'Issued':'See reward ledger'],['Created',transactionDate(item.createdAt)],['Last updated',transactionDate(item.updatedAt)],
              ]}/>
              {item.discrepancyKg!==null?<DetailText label="Discrepancy" value={`${formatMass(item.discrepancyKg)}${item.discrepancyReason?` · ${item.discrepancyReason}`:''}`}/>:null}
              {item.agreedTerms?<DetailText label="Agreed terms" value={item.agreedTerms}/>:null}
              <div className="mt-5"><Button type="button" variant="outline" onClick={()=>setSelected(item)}><Waypoints size={15}/>View timeline</Button></div>
            </div></td></tr>:null}
          </Fragment>;
        })}</tbody></table></div>}</PaginatedRecords>
      :!error?<EmptyBlock label={activeView==='offers'?'No offers match these filters.':'No transfers match these filters.'}/>:null}
  </Panel>
  {currentSelection?<div className="overlay-enter fixed inset-0 z-50 bg-slate-950/35" role="dialog" aria-modal="true" onClick={()=>setSelected(null)}><aside className="drawer-enter absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6" onClick={e=>e.stopPropagation()}><header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-all text-lg font-semibold">{currentSelection.id}</h2><p className="mt-1 text-sm text-[#66736e]">Batch {currentSelection.batchId} · {currentSelection.materialCategory}</p></div><Button variant="ghost" size="icon" aria-label="Close transfer detail" onClick={()=>setSelected(null)}><X size={18}/></Button></header><div className="mt-5 grid grid-cols-2 gap-4 border-y border-[#dfe5e2] py-4 sm:grid-cols-4">{[['Agreed',currentSelection.agreedWeightKg],['Handover',currentSelection.handoverWeightKg],['Receipt',currentSelection.receiptWeightKg],['Verified',currentSelection.verifiedWeightKg]].map(([label,value])=><div key={label}><p className="text-xs text-[#718079]">{label}</p><p className="mt-1 text-lg font-semibold">{value===null?'Pending':`${formatMass(Number(value))}`}</p></div>)}</div>{currentSelection.discrepancyKg?<p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">{formatMass(currentSelection.discrepancyKg)} discrepancy · {currentSelection.discrepancyReason}</p>:null}<ol className="mt-5 divide-y divide-[#dfe5e2]">{currentSelection.events.map(event=><li key={event.id} className="py-4"><p className="text-sm font-medium">{event.type} · {event.status}</p><p className="mt-1 text-xs text-[#718079]">{event.actorName} · {event.location} · {new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(event.timestamp))}</p><p className="mt-2 text-sm">{event.note}</p>{event.weightKg!=null?<p className="mt-2 text-sm tabular-nums">{formatMass(event.weightKg)} · {event.weightStatus ?? 'Evidence status not recorded'}</p>:null}</li>)}</ol></aside></div>:null}
  {editing?<TransferAdmin transfer={editing} onClose={()=>setEditing(null)}/>:null}{offer?<OfferAdmin offer={offer} onClose={()=>setOffer(null)}/>:null}
  </>;
}

function traceabilityColumnCount(view:'transfers'|'offers') {
  if (!window.matchMedia('(min-width: 640px)').matches) return 3;
  return view==='transfers' && window.matchMedia('(min-width: 768px)').matches?6:5;
}

function ExpandTransaction({expanded,detailsId,label,onClick}:{expanded:boolean;detailsId:string;label:string;onClick:()=>void}) {
  return <Button type="button" variant="ghost" size="icon" title={expanded?'Hide details':'Show details'} aria-label={`${expanded?'Collapse':'Expand'} ${label}`} aria-expanded={expanded} aria-controls={expanded?detailsId:undefined} onClick={onClick}><ChevronRight size={17} className={`transition-transform duration-150 motion-reduce:transition-none ${expanded?'rotate-90':''}`}/></Button>;
}

function TraceabilityFacts({facts}:{facts:Array<[string,string]>}) {
  return <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">{facts.map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-[#718079]">{label}</dt><dd className="mt-1 break-words text-sm leading-5 text-[#34423d] [overflow-wrap:anywhere]">{value||'Not recorded'}</dd></div>)}</dl>;
}

function DetailText({label,value}:{label:string;value:string}) {
  return <div className="mt-5 border-t border-[#dfe5e2] pt-4"><p className="text-xs text-[#718079]">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#34423d] [overflow-wrap:anywhere]">{value||'Not recorded'}</p></div>;
}

function transactionDate(value:string) {
  const date=new Date(value);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(date):'Not recorded';
}
