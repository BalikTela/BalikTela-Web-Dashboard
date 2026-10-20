import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { Activity, CircleAlert, Clock3, Plus, Pencil, RotateCcw, Search, ShieldCheck, ChevronRight } from 'lucide-react';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { EmptyBlock } from '../components/StateBlock';
import { SummaryCard } from '../components/SummaryCard';
import { RecordEditor, type EditorField } from '../components/RecordEditor';
import type { PlatformFacility, RecoveryRecord, Transfer } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import type { Filters } from '../types';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { toQuery } from './MaterialRegistry';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { PageActivity } from '../hooks/PageActivity';
import { HubDisposalMonitoring } from '../components/HubDisposalMonitoring';
import { HubCollectionMonitoring } from '../components/HubCollectionMonitoring';
import { RecoveryRecordDetail } from '../components/RecoveryRecordDetail';
import { HubManagement } from '../components/HubManagement';

export function RecoveryOperations({filters}:{filters:Filters}) {
  const {access,user}=useAuth();
  const canReadHubs=Boolean(access?.permissions.includes('hubs.read'));
  const canReadRecovery=Boolean(!access?.hubOperator && !user?.scope.aggregateOnly && access?.permissions.includes('recovery.read'));
  const [tab,setTab]=useState<'collection'|'hubs'|'disposals'|'processing'>(canReadHubs?'collection':'processing');
  const currentTab=tab==='processing'&&!canReadRecovery?'collection':!canReadHubs?'processing':tab;
  return <div className="space-y-5">
    {canReadHubs?<div className="flex flex-wrap gap-x-5 border-b border-slate-200" role="group" aria-label="Recovery sections">
      {(['collection','hubs','disposals',...(canReadRecovery?['processing'] as const:[])] as const).map(item=><button key={item} type="button" aria-pressed={currentTab===item} onClick={()=>setTab(item)} className={`border-b-2 px-1 py-3 text-sm font-medium ${currentTab===item?'border-emerald-700 text-emerald-800':'border-transparent text-slate-500 hover:text-slate-900'}`}>{item==='collection'?'Hub Collection & Disposal':item==='hubs'?(access?.permissions.includes('hubs.manage')?'Hub Management':'Hub Directory'):item==='disposals'?'Hub Disposals':'Processing Records'}</button>)}
    </div>:null}
    {currentTab==='collection'&&canReadHubs?<HubCollectionMonitoring filters={filters}/>:currentTab==='hubs'&&canReadHubs?<HubManagement filters={filters}/>:currentTab==='disposals'&&canReadHubs?<HubDisposalMonitoring filters={filters}/>:canReadRecovery?<RecoveryStageRecords filters={filters}/>:<EmptyBlock label="Recovery monitoring is not available for this account."/>}
  </div>;
}

function RecoveryStageRecords({filters}:{filters:Filters}) {
  const {access}=useAuth();
  const canRecord=access?.permissions.includes('recovery.create');
  const canManage=access?.permissions.includes('recovery.manage');
  const canReadFacilities=Boolean(access?.permissions.includes('facilities.read'));
  const activePage=useContext(PageActivity);
  const activePageRef=useRef(activePage);
  activePageRef.current=activePage;
  const [records,setRecords]=useState<RecoveryRecord[]>([]);
  const [facilities,setFacilities]=useState<PlatformFacility[]>([]);
  const [transfers,setTransfers]=useState<Transfer[]>([]);
  const [editor,setEditor]=useState<{record?:RecoveryRecord}|null>(null);
  const [status,setStatus]=useState('Active');
  const [stage,setStage]=useState('All stages');
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [hasLoaded,setHasLoaded]=useState(false);
  const [preparingEditor,setPreparingEditor]=useState(false);
  const [error,setError]=useState('');
  const [lookupError,setLookupError]=useState('');
  const [editorError,setEditorError]=useState('');
  const requestVersion=useRef(0);
  const editorVersion=useRef(0);
  const load=useCallback(async(reset=false)=>{
    const version=++requestVersion.current;
    if(reset){setLoading(true);setHasLoaded(false);setError('');setRecords([]);setFacilities([]);setSelected(null);}
    const recovery=platformApi.recoveryRecords(toQuery(filters)).then(result=>{
      if(!Array.isArray(result.records))throw new Error('Recovery records could not be read. Please retry.');
      if(version===requestVersion.current){setRecords(result.records);setHasLoaded(true);setError('');}
    }).catch(reason=>{
      if(version===requestVersion.current)setError(reason instanceof Error?reason.message:'Unable to load recovery operations.');
    }).finally(()=>{if(version===requestVersion.current)setLoading(false);});
    const facility=(canReadFacilities?platformApi.facilities():Promise.resolve({facilities:[]})).then(result=>{
      if(!Array.isArray(result.facilities))throw new Error('Invalid facility response.');
      if(version===requestVersion.current){setFacilities(result.facilities);setLookupError('');}
    }).catch(()=>{
      if(version===requestVersion.current)setLookupError('Facility names could not be refreshed. Recorded facility IDs are shown where needed.');
    });
    await Promise.all([recovery,facility]);
  },[filters,canReadFacilities]);
  useEffect(()=>{setPreparingEditor(false);setEditorError('');void load(true);return()=>{requestVersion.current++;editorVersion.current++;};},[load]);
  useRecordRefresh(load,['/recovery-records','/facilities','/transfers','/material-batches','/barter','/users']);
  const openCreate=async()=>{
    if(!canRecord||preparingEditor)return;
    const version=++editorVersion.current;
    setPreparingEditor(true);setEditorError('');
    try{
      const [transfer,facility]=await Promise.all([platformApi.transfers(toQuery(filters)),platformApi.facilities()]);
      if(!Array.isArray(transfer.transfers)||!Array.isArray(facility.facilities))throw new Error('Operation form options could not be read. Please retry.');
      if(!transfer.transfers.length)throw new Error('No transfers are available in the selected cohort.');
      if(!facility.facilities.some(item=>item.status!=='Inactive'))throw new Error('No active facilities are available in your scope.');
      if(version!==editorVersion.current||!activePageRef.current)return;
      setTransfers(transfer.transfers);setFacilities(facility.facilities);setLookupError('');setEditor({});
    }catch(reason){if(version===editorVersion.current)setEditorError(reason instanceof Error?reason.message:'Unable to load operation form options.');}
    finally{if(version===editorVersion.current)setPreparingEditor(false);}
  };
  const facilityName=(item:RecoveryRecord)=>facilities.find(facility=>facility.id===item.facilityId)?.name??item.facilityId??'Not recorded';
  const rows=records.filter(item=>(status==='All'||(status==='Active'?item.status!=='Reversed':item.status===status))
    && (stage==='All stages'||item.stage===stage)
    && [item.id,item.batchId,item.transferId,facilityName(item),item.outcome,item.stage,item.note].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const currentSelection=records.find(item=>item.id===selected);
  const editMeasurements=(values:Record<string,unknown>)=>!values.action||['edit','correct'].includes(String(values.action));
  const fields: EditorField[]=[
    ...(editor?.record?[{key:'action',label:'Action',type:'select' as const,options:editor.record.status==='Validated'?['correct','flag','reverse']:['edit','validate','flag','reverse']}]:[
      {key:'transferId',label:'Transfer',type:'select' as const,required:true,options:transfers.map(item=>({value:item.id,label:`${item.requesterName?.trim() || item.materialCategory} · ${item.batchId} · ${item.id}`}))},
      {key:'facilityId',label:'Facility',type:'select' as const,required:true,options:facilities.filter(item=>item.status!=='Inactive').map(item=>({value:item.id,label:item.name}))},
    ]),
    {key:'stage',label:'Stage',type:'select',options:['Collection','Sorting','Processing','Recovery','Rejection'],when:editMeasurements},
    {key:'outcome',label:'Outcome',type:'select',options:['Reuse','Repair','Redistribution','Upcycling','Recycling'],when:editMeasurements},
    {key:'inputWeightKg',label:'Input weight (t)',type:'number',unit:'t',min:0.001,required:true,when:editMeasurements},
    {key:'outputWeightKg',label:'Output weight (t)',type:'number',unit:'t',min:0,required:true,when:editMeasurements},
    {key:'residualWeightKg',label:'Reject weight (t)',type:'number',unit:'t',min:0,required:true,when:editMeasurements},
    {key:'lossWeightKg',label:'Processing loss (t)',type:'number',unit:'t',min:0,required:true,when:editMeasurements},
    {key:'reason',label:editor?.record?'Change / validation reason':'Operational note',type:'textarea',required:true},
  ];
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Matching recovery record counts">
      <SummaryCard label="Matching records" value={hasLoaded?String(rows.length):'--'} detail="Stage records, not unique material batches" icon={Activity}/>
      <SummaryCard label="Awaiting validation" value={hasLoaded?String(rows.filter(item=>item.status==='Recorded').length):'--'} detail="Recorded; not confirmed outcomes" icon={Clock3}/>
      <SummaryCard label="Validated records" value={hasLoaded?String(rows.filter(item=>item.status==='Validated').length):'--'} detail="Includes intake and intermediate stages" icon={ShieldCheck}/>
      <SummaryCard label="Flagged records" value={hasLoaded?String(rows.filter(item=>item.status==='Flagged').length):'--'} detail="Withheld from confirmed output" icon={CircleAlert}/>
    </section>
    <Panel><SectionHeader title="Recovery Stage Records" eyebrow="Batch-registration cohort · latest recorded stage evidence" actions={<div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" aria-label="Refresh recovery records" title="Refresh recovery records" disabled={loading} onClick={()=>void load()}><RotateCcw size={15}/></Button>{canRecord?<Button size="sm" disabled={preparingEditor||loading||!hasLoaded} onClick={()=>void openCreate()}><Plus size={15}/>{preparingEditor?'Loading options...':'Record operation'}</Button>:null}</div>}/>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <label className="relative min-w-0 sm:col-span-2 lg:col-span-1"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><Input className="pl-9" aria-label="Search recovery records" placeholder="Search batch, transfer, facility or record" value={search} onChange={event=>setSearch(event.target.value)}/></label>
        <Select aria-label="Recovery stage" value={stage} onChange={event=>setStage(event.target.value)}>{['All stages','Collection','Sorting','Processing','Recovery','Rejection'].map(item=><option key={item}>{item}</option>)}</Select>
        <Select aria-label="Recovery record status" value={status} onChange={event=>setStatus(event.target.value)}>{['Active','Recorded','Validated','Flagged','Reversed','All'].map(item=><option key={item} value={item}>{item==='Active'?'All current records':item==='All'?'Including reversed':item}</option>)}</Select>
      </div>
      {error?<div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"><p className="min-w-0 flex-1 break-words">{error}{hasLoaded?' Showing the most recently loaded records.':''}</p><Button type="button" variant="outline" size="sm" onClick={()=>void load(!hasLoaded)}><RotateCcw size={14}/>Retry recovery records</Button></div>:null}
      {lookupError?<div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-800"><p className="min-w-0 flex-1">{lookupError}</p><Button type="button" variant="outline" size="sm" onClick={()=>void load()}><RotateCcw size={14}/>Retry facility lookup</Button></div>:null}
      {editorError?<p role="alert" className="mb-4 break-words text-sm text-red-700">{editorError}</p>:null}
      {loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]" role="status">Loading operational events...</div>:hasLoaded&&rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([status,stage,search,filters])} label="Recovery stage records">{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm" aria-label="Recovery stage records"><thead><tr><th>Operation</th><th>Batch / transfer</th><th>Facility</th><th>Input</th><th>Output</th><th>Status</th><th>Recorded</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}>
        <td className="max-w-56 py-4 pr-4"><button type="button" className="text-left font-semibold text-emerald-700 hover:underline" onClick={()=>setSelected(item.id)}>{item.stage}<span className="mt-1 block break-all text-xs font-normal">{item.id}</span></button></td>
        <td className="max-w-64 break-all py-4 pr-4">{item.batchId}<p className="mt-1 text-xs text-[#718079]">{item.transferId}</p></td>
        <td className="max-w-52 break-words pr-4">{facilityName(item)}</td><td className="whitespace-nowrap pr-4 tabular-nums">{formatMass(item.inputWeightKg)}</td><td className="whitespace-nowrap pr-4 tabular-nums">{formatMass(item.outputWeightKg,'Not recorded')}<p className="mt-1 text-xs text-[#718079]">{item.stage==='Collection'?'Intake':item.stage==='Sorting'?'Sorted material':item.stage==='Rejection'?'Rejected':item.outcome??'Not recorded'}</p></td><td className="pr-4"><Badge variant="outline">{item.status}</Badge></td><td className="whitespace-nowrap pr-4">{new Date(item.timestamp).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'})}</td>
        <td><div className="flex gap-1"><Button variant="ghost" size="icon" title={`View ${item.id}`} aria-label={`View ${item.id}`} onClick={()=>setSelected(item.id)}><ChevronRight size={15}/></Button>{canManage&&item.status!=='Reversed'?<Button variant="ghost" size="icon" title={`Manage ${item.id}`} aria-label={`Manage ${item.id}`} onClick={()=>{setEditorError('');setEditor({record:item});}}><Pencil size={15}/></Button>:null}</div></td>
      </tr>)}</tbody></table></div>}</PaginatedRecords>:hasLoaded?<EmptyBlock label="No recovery records match these filters."/>:null}
    </Panel>
    {currentSelection?<RecoveryRecordDetail record={currentSelection} facility={facilityName(currentSelection)} onClose={()=>setSelected(null)}/>:null}
    {editor?<RecordEditor title={editor.record?'Manage recovery record':'Record operational event'} initial={{transferId:transfers[0]?.id??'',facilityId:facilities.find(item=>item.status!=='Inactive')?.id??'',stage:'Processing',outcome:'Recycling',inputWeightKg:'',outputWeightKg:'',residualWeightKg:'',lossWeightKg:0,...editor.record,action:editor.record?.status==='Validated'?'correct':editor.record?'edit':'',reason:''}} fields={fields} onClose={()=>setEditor(null)} onSave={values=>editor.record?platformApi.updateRecoveryRecord(editor.record.id,values):platformApi.createRecoveryRecord({...values,note:values.reason,validate:false})}/>:null}
  </div>;
}
