import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { isTerminalTransfer, matchesTransferStatus } from '../../shared/workflows';
import { ChevronRight, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const requestVersion = useRef(0);
  const activeView = canManage ? view : 'transfers';
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
  return <><Panel><SectionHeader title="Transactions and Traceability" eyebrow="Custody, measurement, discrepancy, and reward evidence" actions={<div className="flex flex-wrap gap-2">{canManage?<div className="flex rounded-md bg-slate-100 p-1">{(['transfers','offers'] as const).map(item=><button key={item} type="button" aria-pressed={view===item} className={`rounded px-3 py-1 text-sm ${view===item?'bg-white':'text-slate-500'}`} onClick={()=>setView(item)}>{item==='transfers'?'Transfers':'Offers'}</button>)}</div>:null}<label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label="Search transfers" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or ID" className="w-full pl-9 sm:w-56"/></label></div>}/>
    {error?<div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"><p>{error}</p><Button variant="outline" disabled={loading} onClick={()=>void load()}><RotateCcw size={15}/>Retry traceability records</Button></div>:null}
    {loading && !(activeView==='offers'?offers.length:transfers.length)?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading traceability records...</div>:activeView==='offers' && offers.length?<PaginatedRecords rows={offers.filter(item=>`${item.id} ${item.listingTitle} ${item.recipientName}`.toLowerCase().includes(query.trim().toLowerCase()))} resetKey={JSON.stringify([query, view, filters])}>{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr><th>Offer</th><th>Listing</th><th>Requester</th><th>Requested</th><th>Terms</th><th>Status</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}><td className="py-3">{item.id}</td><td>{item.listingTitle}</td><td>{item.recipientName}</td><td>{formatMass(item.quantityKg)}</td><td>{item.terms}</td><td><Badge variant="outline">{item.status}</Badge></td><td>{['Pending','Revised'].includes(item.status)?<Button variant="ghost" size="icon" title={`Review ${item.id}`} aria-label={`Review ${item.id}`} onClick={()=>setOffer(item)}><Pencil size={15}/></Button>:null}</td></tr>)}</tbody></table></div>}</PaginatedRecords>:activeView==='transfers' && rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([query, view, filters])}>{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead><tr><th>Requester</th><th>Transfer</th><th>Batch</th><th>Material</th><th>Agreed</th><th>Reported handover</th><th>Reported receipt</th><th>Verified</th><th>Status</th><th>Outcome</th><th>Reward</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}><td className="min-w-40 max-w-56 py-3 pr-4 font-medium"><span className="break-words">{item.requesterName?.trim() || 'Name unavailable'}</span></td><td className="py-3"><button className="text-left font-semibold text-emerald-700" onClick={()=>setSelected(item)}>{item.id}</button><p className="text-xs text-[#718079]">{item.events.length} events</p></td><td>{item.batchId}</td><td>{item.materialCategory}</td><td>{formatMass(item.agreedWeightKg)}</td><td>{formatMass(item.handoverWeightKg)}</td><td>{formatMass(item.receiptWeightKg)}</td><td>{formatMass(item.verifiedWeightKg)}</td><td><Badge variant="outline">{item.status}</Badge></td><td>{item.circularOutcome??'Pending'}</td><td>{item.rewardIssuedAt?'Issued':'See reward ledger'}</td><td><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`View ${item.id}`} title={`View ${item.id}`} onClick={()=>setSelected(item)}><ChevronRight size={15}/></Button>{canManage && !isTerminalTransfer(item.status) && ['Reserved','Handed over','Received','Validated','Disputed'].includes(item.status)?<Button variant="ghost" size="icon" aria-label={`Manage ${item.id}`} title={`Manage ${item.id}`} onClick={()=>setEditing(item)}><Pencil size={15}/></Button>:null}</div></td></tr>)}</tbody></table></div>}</PaginatedRecords>:!error?<EmptyBlock label={activeView==='offers'?'No offers match these filters.':'No transfers match these filters.'}/>:null}
  </Panel>
  {currentSelection?<div className="overlay-enter fixed inset-0 z-50 bg-slate-950/35" role="dialog" aria-modal="true" onClick={()=>setSelected(null)}><aside className="drawer-enter absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6" onClick={e=>e.stopPropagation()}><header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-all text-lg font-semibold">{currentSelection.id}</h2><p className="mt-1 text-sm text-[#66736e]">Batch {currentSelection.batchId} · {currentSelection.materialCategory}</p></div><Button variant="ghost" size="icon" aria-label="Close transfer detail" onClick={()=>setSelected(null)}><X size={18}/></Button></header><div className="mt-5 grid grid-cols-2 gap-4 border-y border-[#dfe5e2] py-4 sm:grid-cols-4">{[['Agreed',currentSelection.agreedWeightKg],['Handover',currentSelection.handoverWeightKg],['Receipt',currentSelection.receiptWeightKg],['Verified',currentSelection.verifiedWeightKg]].map(([label,value])=><div key={label}><p className="text-xs text-[#718079]">{label}</p><p className="mt-1 text-lg font-semibold">{value===null?'Pending':`${formatMass(Number(value))}`}</p></div>)}</div>{currentSelection.discrepancyKg?<p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">{formatMass(currentSelection.discrepancyKg)} discrepancy · {currentSelection.discrepancyReason}</p>:null}<ol className="mt-5 divide-y divide-[#dfe5e2]">{currentSelection.events.map(event=><li key={event.id} className="py-4"><p className="text-sm font-medium">{event.type} · {event.status}</p><p className="mt-1 text-xs text-[#718079]">{event.actorName} · {event.location} · {new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(event.timestamp))}</p><p className="mt-2 text-sm">{event.note}</p>{event.weightKg!=null?<p className="mt-2 text-sm tabular-nums">{formatMass(event.weightKg)} · {event.weightStatus ?? 'Evidence status not recorded'}</p>:null}</li>)}</ol></aside></div>:null}
  {editing?<TransferAdmin transfer={editing} onClose={()=>setEditing(null)}/>:null}{offer?<OfferAdmin offer={offer} onClose={()=>setOffer(null)}/>:null}
  </>;
}
