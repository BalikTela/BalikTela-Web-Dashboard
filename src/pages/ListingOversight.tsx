import { ChevronRight, Pencil, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react';
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
import { availableStockKg, canModerateListing, listingDisplayStatus, listingHandlingStatus, LISTING_DISPLAY_STATUSES, LISTING_HANDLING_STATUSES } from '../../shared/workflows';

export function ListingOversight() {
  const {access}=useAuth();
  const canManage=access?.permissions.includes('listings.manage');
  const [listings,setListings]=useState<BarterListing[]>([]);
  const [query,setQuery]=useState('');
  const [filters,setFilters]=useState(emptyListingFilters);
  const [editing,setEditing]=useState<BarterListing|null>(null);
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const [columnCount,setColumnCount]=useState(listingColumnCount);
  const detailsPrefix=useId();
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{setListings((await platformApi.listings()).listings);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load listings.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>setExpandedId(null),[query,filters]);
  useEffect(()=>{
    const breakpoints=[window.matchMedia('(min-width: 640px)'),window.matchMedia('(min-width: 768px)')];
    const update=()=>setColumnCount(listingColumnCount());
    breakpoints.forEach(breakpoint=>breakpoint.addEventListener('change',update));
    return()=>breakpoints.forEach(breakpoint=>breakpoint.removeEventListener('change',update));
  },[]);
  useRecordRefresh(load,['/barter','/material-batches','/transfers']);
  const rows=useMemo(()=>filterListings(listings,query,filters),[listings,query,filters]);
  const choices = [
    { key: 'status', label: 'Listing status', all: 'All statuses', values: LISTING_DISPLAY_STATUSES.filter(status=>status!=='Unknown') },
    { key: 'handlingStatus', label: 'Listing handling', all: 'All handling states', values: LISTING_HANDLING_STATUSES },
    { key: 'region', label: 'Listing region', all: 'All regions', values: [...new Set(listings.map(item=>item.region))].sort() },
    { key: 'textileType', label: 'Listing textile', all: 'All textiles', values: [...new Set(listings.map(item=>item.textileType))].sort() },
    { key: 'circularPathway', label: 'Listing pathway', all: 'All pathways', values: [...new Set(listings.map(item=>item.circularPathway))].sort() },
    { key: 'weightStatus', label: 'Listing weight evidence', all: 'All weight statuses', values: ['Awaiting weighing','Estimated','Measured','Verified'] },
    { key: 'wasteSource', label: 'Listing waste source', all: 'All sources', values: [...new Set(listings.map(item=>item.wasteSource))].sort() },
  ] as const;
  return <div className="space-y-5">
    <p className="border-l-2 border-emerald-600 pl-3 text-xs leading-5 text-slate-600">Consumer-posted textiles are assumed recyclable. A via-Hub route assigns collection/disposal handling; direct exchanges remain participant transfers. Listing stock and historical weighing do not establish collection or recycling output.</p>
    <section className="grid overflow-hidden rounded-md border border-[#dfe5e2] bg-white sm:grid-cols-2 xl:grid-cols-4">{[['Matching listings',rows.length],['Available',rows.filter(item=>listingDisplayStatus(item)==='Available').length],['In progress',rows.filter(item=>listingDisplayStatus(item)==='In progress').length],['Completed',rows.filter(item=>listingDisplayStatus(item)==='Completed').length]].map(([label,value])=><div key={label} className="border-b border-[#e7ece9] p-5 sm:border-r xl:border-b-0"><p className="text-xs text-[#66736e]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p></div>)}</section>
    <Panel><SectionHeader title="Material Listing Oversight" eyebrow="Material availability and administrative review" actions={<div className="flex min-w-0 items-center gap-2"><label className="relative min-w-0"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input aria-label="Search listings" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search listings" className="w-full pl-9 sm:w-64"/></label><Button variant="outline" size="icon" title="Refresh listings" aria-label="Refresh listings" disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/></Button></div>}/>
      <div className="mb-5 grid grid-cols-1 items-end gap-3 border-b border-[#e7ece9] pb-4 sm:grid-cols-2 lg:grid-cols-4">{choices.map(choice=><label key={choice.key} className="min-w-0"><span className="mb-1.5 block text-xs text-[#66736e]">{choice.label.replace('Listing ', '')}</span><Select aria-label={choice.label} value={filters[choice.key]} onChange={event=>setFilters(current=>({...current,[choice.key]:event.target.value}))}><option value="">{choice.all}</option>{choice.values.map(value=><option key={value} value={value}>{value}</option>)}</Select></label>)}<Button variant="outline" onClick={()=>{setQuery('');setFilters(emptyListingFilters);}}><RotateCcw size={14}/>Reset filters</Button></div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : loading ? <div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading authorized listing records...</div> : rows.length ?
        <PaginatedRecords rows={rows} resetKey={JSON.stringify([query,filters])} label="Listings">{pageRows =>
          <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm" aria-label="Material listings">
            <thead><tr><th>Listing</th><th className="hidden sm:table-cell sm:w-[18%]">Owner</th><th className="hidden md:table-cell md:w-[14%]">Material</th><th className="hidden sm:table-cell sm:w-[16%]">Available weight</th><th className="w-24 sm:w-[16%]">Status</th><th className="w-10 text-right sm:w-20"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item => {
              const expanded=expandedId===item.id;
              const detailsId=`${detailsPrefix}-${encodeURIComponent(item.id)}`;
              const handling=listingHandlingStatus(item);
              const status=listingDisplayStatus(item);
              const stock=availableStockKg(item);
              const stockLabel=stock===null?'Awaiting weighing':`${formatMass(stock)} available`;
              return <Fragment key={item.id}>
                <tr data-listing-id={item.id} className={expanded?'bg-[#f2f7f4]':''}>
                  <td className="py-4 align-top">
                    <p className="line-clamp-2 break-words font-medium leading-5" title={item.title}>{item.title}</p>
                    <p className="mt-1 break-all text-xs leading-4 text-[#718079]">{item.id}</p>
                    <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-[#718079] sm:hidden">{item.ownerName || 'Owner not recorded'} · {item.textileType}</p>
                    <p className="mt-1 text-xs tabular-nums text-[#53615c] sm:hidden">{stockLabel}{(item.reservedKg??0)>0?` · ${formatMass(item.reservedKg)} reserved`:''}</p>
                    <p className="mt-2 hidden text-xs text-[#718079] sm:block md:hidden">{item.textileType}</p>
                  </td>
                  <td className="hidden break-words py-4 align-top sm:table-cell"><p className="line-clamp-2 leading-5" title={item.ownerName}>{item.ownerName || 'Not recorded'}</p></td>
                  <td className="hidden break-words py-4 align-top md:table-cell">{item.textileType}<p className="mt-1 text-xs text-[#718079]">{item.quality}</p></td>
                  <td className="hidden break-words py-4 align-top tabular-nums sm:table-cell"><p className="font-medium">{stockLabel}</p>{(item.reservedKg??0)>0?<p className="mt-1 text-xs text-[#718079]">{formatMass(item.reservedKg)} reserved</p>:null}</td>
                  <td data-listing-status className="py-4 align-top"><div className="flex flex-col items-start gap-1.5">{status==='Unknown'?<span aria-label="Listing status unavailable" title="Listing status unavailable" className="text-[#718079]">-</span>:<Badge variant="outline" className="max-w-full break-words px-2">{status}</Badge>}{handling!=='None'?<Badge variant="outline" className="max-w-full break-words px-2 text-amber-800">{handling}</Badge>:null}</div></td>
                  <td className="py-3 align-top"><div className="flex flex-col items-end justify-end gap-1 sm:flex-row">
                    {canManage&&canModerateListing(item)?<Button type="button" variant="ghost" size="icon" title={`Manage ${item.id}`} aria-label={`Manage ${item.id}`} onClick={()=>setEditing(item)}><Pencil size={15}/></Button>:null}
                    <Button type="button" variant="ghost" size="icon" title={expanded?'Hide listing details':'Show listing details'} aria-label={`${expanded?'Collapse':'Expand'} listing ${item.id}`} aria-expanded={expanded} aria-controls={expanded?detailsId:undefined} onClick={()=>setExpandedId(expanded?null:item.id)}><ChevronRight size={17} className={`transition-transform duration-150 motion-reduce:transition-none ${expanded?'rotate-90':''}`}/></Button>
                  </div></td>
                </tr>
                {expanded?<tr className="bg-[#f7faf8]"><td colSpan={columnCount} className="py-5"><div id={detailsId} role="region" aria-label={`Listing details for ${item.title}`} className="border-l-2 border-emerald-600 pl-4"><ListingDetails listing={item}/></div></td></tr>:null}
              </Fragment>;
            })}</tbody>
          </table></div>
        }</PaginatedRecords> : <EmptyBlock label="No material listings match these filters."/>}
    </Panel>
    {editing?<RecordEditor title="Review material listing" initial={{...editing,reason:''}} fields={[{key:'title',label:'Listing title',required:true},{key:'status',label:'Availability',type:'select',options:[...new Set([editing.status,'Open','Closed'])].map(value=>({value,label:value==='Open'?'Available':value==='Matched'?'In progress (matched)':value}))},{key:'description',label:'Description',type:'textarea'},{key:'reason',label:'Review reason',type:'textarea',required:true}]} onClose={()=>setEditing(null)} onSave={values=>platformApi.updateListing(editing.id,values)}/>:null}
  </div>;
}

function listingColumnCount() {
  return window.matchMedia('(min-width: 768px)').matches?6:window.matchMedia('(min-width: 640px)').matches?5:3;
}

function ListingDetails({listing}:{listing:BarterListing}) {
  const facts=[
    ['Listing ID',listing.id],['Batch ID',listing.batchId],['Owner',listing.ownerName||'Not recorded'],
    ['Material',listing.textileType],['Condition',listing.quality],['Waste source',listing.wasteSource],['Form',listing.wasteForm],['Pathway',listing.circularPathway],
    ['Recorded weight',formatMass(listing.quantityKg,'Not recorded')],['Weight status',listing.weightStatus??'No measurement'],
    ['Reserved weight',formatMass(listing.reservedKg??0)],['Disposed weight',formatMass(listing.disposedWeightKg??0)],
    ['Mobile status',listing.canonicalStatus??listing.status],['Handling',listingHandlingStatus(listing)],
    ...(listing.remainderPending?[['Remainder ownership','Pending']]:[]),...(listing.remainderOfId?[['Remainder of',listing.remainderOfId]]:[]),
  ];
  return <>
    <h3 className="mb-4 break-words text-sm font-semibold">{listing.title}</h3>
    <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">{facts.map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-[#718079]">{label}</dt><dd className="mt-1 break-words text-sm leading-5 text-[#34423d]">{value}</dd></div>)}<div className="min-w-0 sm:col-span-2"><dt className="text-xs text-[#718079]">Location</dt><dd className="mt-1 break-words text-sm leading-5 text-[#34423d]">{[listing.city,listing.region].filter(Boolean).join(', ')||'Not recorded'}</dd></div></dl>
    {listing.description?<div className="mt-5 border-t border-[#dfe5e2] pt-4"><p className="text-xs text-[#718079]">Description</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#34423d]">{listing.description}</p></div>:null}
  </>;
}
