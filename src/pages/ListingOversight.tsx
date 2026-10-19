import { Pencil, RotateCcw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyBlock } from '../components/StateBlock';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { RecordEditor } from '../components/RecordEditor';
import type { BarterListing } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { Panel } from '../components/Panel';
import { useAuth } from '../context/AuthContext';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { emptyListingFilters, filterListings } from '../lib/listingFilters';
import { formatMass } from '../../shared/metrics';
import { availableStockKg, canModerateListing, listingDisplayStatus, LISTING_STATUSES } from '../../shared/workflows';

export function ListingOversight() {
  const {access}=useAuth();
  const canManage=access?.permissions.includes('listings.manage');
  const [listings,setListings]=useState<BarterListing[]>([]);
  const [query,setQuery]=useState('');
  const [filters,setFilters]=useState(emptyListingFilters);
  const [editing,setEditing]=useState<BarterListing|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{setListings((await platformApi.listings()).listings);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load listings.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  useRecordRefresh(load,['/barter','/material-batches','/transfers']);
  const rows=useMemo(()=>filterListings(listings,query,filters),[listings,query,filters]);
  const choices = [
    { key: 'status', label: 'Listing status', all: 'All statuses', values: [...Object.values(LISTING_STATUSES), 'Disposed', 'Partially disposed', 'Remainder pending', 'Unknown'] },
    { key: 'region', label: 'Listing region', all: 'All regions', values: [...new Set(listings.map(item=>item.region))].sort() },
    { key: 'textileType', label: 'Listing textile', all: 'All textiles', values: [...new Set(listings.map(item=>item.textileType))].sort() },
    { key: 'circularPathway', label: 'Listing pathway', all: 'All pathways', values: [...new Set(listings.map(item=>item.circularPathway))].sort() },
    { key: 'weightStatus', label: 'Listing weight evidence', all: 'All weight statuses', values: ['Awaiting weighing','Estimated','Measured','Verified'] },
    { key: 'wasteSource', label: 'Listing waste source', all: 'All sources', values: [...new Set(listings.map(item=>item.wasteSource))].sort() },
    { key: 'recordType', label: 'Listing record type', all: 'All records', values: ['Demo','Operational'] },
  ] as const;
  return <div className="space-y-5">
    <section className="grid overflow-hidden rounded-md border border-[#dfe5e2] bg-white sm:grid-cols-2 xl:grid-cols-4">{[['Matching listings',rows.length],['Open',rows.filter(item=>listingDisplayStatus(item)==='Open').length],['Matched or reserved',rows.filter(item=>['Matched','Reserved'].includes(listingDisplayStatus(item))).length],['Completed',rows.filter(item=>listingDisplayStatus(item)==='Completed').length]].map(([label,value])=><div key={label} className="border-b border-[#e7ece9] p-5 sm:border-r xl:border-b-0"><p className="text-xs text-[#66736e]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p></div>)}</section>
    <Panel><SectionHeader title="Material Listing Oversight" eyebrow="Mobile-originated material availability and administrative review" actions={<label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label="Search listings" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search listings" className="w-full pl-9 sm:w-64"/></label>}/>
      <div className="mb-5 grid grid-cols-1 items-end gap-3 border-b border-[#e7ece9] pb-4 sm:grid-cols-2 lg:grid-cols-4">{choices.map(choice=><label key={choice.key} className="min-w-0"><span className="mb-1.5 block text-xs text-[#66736e]">{choice.label.replace('Listing ', '')}</span><Select aria-label={choice.label} value={filters[choice.key]} onChange={event=>setFilters(current=>({...current,[choice.key]:event.target.value}))}><option value="">{choice.all}</option>{choice.values.map(value=><option key={value} value={value}>{value}</option>)}</Select></label>)}<Button variant="outline" onClick={()=>{setQuery('');setFilters(emptyListingFilters);}}><RotateCcw size={14}/>Reset filters</Button></div>
      {error?<p role="alert" className="text-sm text-red-700">{error}</p>:loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading authorized listing records...</div>:rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([query,filters])} label="Listings">{pageRows=><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr><th>Listing</th><th>Material batch</th><th>Owner</th><th>Material</th><th>Source / form</th><th>Stock / reservations</th><th>Pathway</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}><td className="py-3"><p className="font-medium">{item.title}</p><p className="mt-0.5 text-xs text-[#718079]">{item.id} · {item.isDemo?'Demo':'Operational'}</p></td><td>{item.batchId}</td><td>{item.ownerName}</td><td>{item.textileType}<p className="text-xs text-[#718079]">{item.quality}</p></td><td>{item.wasteSource}<p className="text-xs text-[#718079]">{item.wasteForm}</p></td><td className="whitespace-nowrap tabular-nums">{formatMass(availableStockKg(item), 'Awaiting weighing')} available<p className="text-xs text-[#718079]">{formatMass(item.reservedKg ?? 0)} reserved</p><p className="text-xs text-[#718079]">{formatMass(item.quantityKg, 'Not recorded')} recorded · {item.weightStatus ?? 'No measurement'}</p>{item.disposedWeightKg ? <p className="text-xs text-amber-800">{formatMass(item.disposedWeightKg)} disposed</p> : null}{item.remainderPending ? <p className="text-xs text-amber-800">Remainder ownership pending</p> : null}{item.remainderOfId ? <p className="max-w-48 break-all text-xs text-[#718079]">Remainder of {item.remainderOfId}</p> : null}</td><td>{item.circularPathway}</td><td>{item.city || 'Not recorded'}<p className="text-xs text-[#718079]">{item.region || 'Not recorded'}</p></td><td><Badge variant="outline">{listingDisplayStatus(item)}</Badge>{item.canonicalStatus?<p className="text-xs text-[#718079]">Mobile: {item.canonicalStatus}</p>:null}</td><td>{canManage && canModerateListing(item)?<Button variant="ghost" size="icon" title={`Manage ${item.id}`} aria-label={`Manage ${item.id}`} onClick={()=>setEditing(item)}><Pencil size={15}/></Button>:null}</td></tr>)}</tbody></table></div>}</PaginatedRecords>:<EmptyBlock label="No material listings match these filters."/>}
    </Panel>
    {editing?<RecordEditor title="Review material listing" initial={{...editing,reason:''}} fields={[{key:'title',label:'Listing title',required:true},{key:'status',label:'Availability',type:'select',options:[...new Set([editing.status,'Open','Closed'])]},{key:'description',label:'Description',type:'textarea'},{key:'reason',label:'Review reason',type:'textarea',required:true}]} onClose={()=>setEditing(null)} onSave={values=>platformApi.updateListing(editing.id,values)}/>:null}
  </div>;
}
