import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { Activity, Factory, Plus, Pencil, RotateCcw, Scale, ShieldCheck } from 'lucide-react';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
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

export function RecoveryOperations({filters}:{filters:Filters}) {
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
    if(reset){setLoading(true);setHasLoaded(false);setError('');}
    const recovery=platformApi.recoveryRecords(toQuery(filters)).then(result=>{
      if(!Array.isArray(result.records))throw new Error('Recovery records could not be read. Please retry.');
      if(version===requestVersion.current){setRecords(result.records);setHasLoaded(true);setError('');}
    }).catch(reason=>{
      if(version===requestVersion.current)setError(reason instanceof Error?reason.message:'Unable to load recovery operations.');
    }).finally(()=>{if(version===requestVersion.current)setLoading(false);});
    const facility=(canReadFacilities?platformApi.facilities(toQuery(filters)):Promise.resolve({facilities:[]})).then(result=>{
      if(!Array.isArray(result.facilities))throw new Error('Invalid facility response.');
      if(version===requestVersion.current){setFacilities(result.facilities);setLookupError('');}
    }).catch(()=>{
      if(version===requestVersion.current)setLookupError('Facility names could not be refreshed. Recorded facility IDs are shown where needed.');
    });
    await Promise.all([recovery,facility]);
  },[filters,canReadFacilities]);
  useEffect(()=>{setPreparingEditor(false);setEditorError('');void load(true);return()=>{requestVersion.current++;editorVersion.current++;};},[load]);
  useRecordRefresh(load,['/recovery-records','/facilities','/transfers']);
  const openCreate=async()=>{
    if(!canRecord||preparingEditor)return;
    const version=++editorVersion.current;
    setPreparingEditor(true);setEditorError('');
    try{
      const [transfer,facility]=await Promise.all([platformApi.transfers(),platformApi.facilities(toQuery(filters))]);
      if(!Array.isArray(transfer.transfers)||!Array.isArray(facility.facilities))throw new Error('Operation form options could not be read. Please retry.');
      if(version!==editorVersion.current||!activePageRef.current)return;
      setTransfers(transfer.transfers);setFacilities(facility.facilities);setLookupError('');setEditor({});
    }catch(reason){if(version===editorVersion.current)setEditorError(reason instanceof Error?reason.message:'Unable to load operation form options.');}
    finally{if(version===editorVersion.current)setPreparingEditor(false);}
  };
  const active=records.filter(item=>item.status!=='Reversed');
  const rows=records.filter(item=>status==='All'||(status==='Active'?item.status!=='Reversed':item.status===status));
  const editMeasurements=(values:Record<string,unknown>)=>!values.action||['edit','correct'].includes(String(values.action));
  const fields: EditorField[]=[
    ...(editor?.record?[{key:'action',label:'Action',type:'select' as const,options:editor.record.status==='Validated'?['correct','flag','reverse']:['edit','validate','flag','reverse']}]:[
      {key:'transferId',label:'Transfer',type:'select' as const,required:true,options:transfers.map(item=>({value:item.id,label:`${item.id} · ${item.materialCategory}`}))},
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
    {access?.permissions.includes('hubs.read') ? <HubDisposalMonitoring filters={filters} /> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Operational records" value={hasLoaded?active.length.toString():'--'} detail="Active stage records" icon={Activity}/><SummaryCard label="Recorded input" value={hasLoaded?formatMass(active.reduce((sum,item)=>sum+item.inputWeightKg,0)):'--'} detail="Stage inputs; not unique material mass" icon={Scale}/><SummaryCard label="Recorded output" value={hasLoaded?formatMass(active.reduce((sum,item)=>sum+(item.outputWeightKg??0),0)):'--'} detail="Stage outputs; excludes reversed records" icon={ShieldCheck}/><SummaryCard label="Rejects and loss" value={hasLoaded?formatMass(active.reduce((sum,item)=>sum+(item.residualWeightKg??0)+(item.lossWeightKg??0),0)):'--'} detail="Reject mass plus separate processing loss" icon={Factory}/></section>
    <Panel><SectionHeader title="Collection and Recovery Operations" eyebrow="Measured stage inputs, outputs, and validation" actions={<div className="flex flex-wrap gap-2"><Select aria-label="Recovery record status" value={status} onChange={e=>setStatus(e.target.value)}>{['Active','Recorded','Validated','Flagged','Reversed','All'].map(item=><option key={item}>{item}</option>)}</Select>{canRecord?<Button size="sm" disabled={preparingEditor||loading} onClick={()=>void openCreate()}><Plus size={15}/>{preparingEditor?'Loading options...':'Record operation'}</Button>:null}</div>}/>
      {error?<div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"><p className="min-w-0 flex-1 break-words">{error}{hasLoaded?' Showing the most recently loaded records.':''}</p><Button type="button" variant="outline" size="sm" onClick={()=>void load(!hasLoaded)}><RotateCcw size={14}/>Retry recovery records</Button></div>:null}
      {lookupError?<div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-800"><p className="min-w-0 flex-1">{lookupError}</p><Button type="button" variant="outline" size="sm" onClick={()=>void load()}><RotateCcw size={14}/>Retry facility lookup</Button></div>:null}
      {editorError?<p role="alert" className="mb-4 break-words text-sm text-red-700">{editorError}</p>:null}
      {loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]" role="status">Loading operational events...</div>:hasLoaded&&rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([status, filters])}>{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr><th>Record</th><th>Stage</th><th>Batch / transfer</th><th>Facility</th><th>Input</th><th>Output</th><th>Rejects</th><th>Loss</th><th>Outcome</th><th>Validation</th><th>Recorded</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}><td className="py-3 font-semibold text-emerald-700">{item.id}</td><td>{item.stage}</td><td>{item.batchId}<p className="text-xs text-[#718079]">{item.transferId}</p></td><td>{facilities.find(facility=>facility.id===item.facilityId)?.name??item.facilityId??'Not recorded'}</td><td>{formatMass(item.inputWeightKg)}</td><td>{formatMass(item.outputWeightKg)}</td><td>{formatMass(item.residualWeightKg)}</td><td>{formatMass(item.lossWeightKg ?? 0)}</td><td>{item.outcome??'Pending'}</td><td><Badge variant="outline">{item.status}</Badge></td><td>{new Date(item.timestamp).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'})}</td><td>{canManage && item.status!=='Reversed'?<Button variant="ghost" size="icon" title={`Manage ${item.id}`} aria-label={`Manage ${item.id}`} onClick={()=>{setEditorError('');setEditor({record:item});}}><Pencil size={15}/></Button>:null}</td></tr>)}</tbody></table></div>}</PaginatedRecords>:hasLoaded?<EmptyBlock label="No recovery records match these filters."/>:null}
    </Panel>
    {editor?<RecordEditor title={editor.record?'Manage recovery record':'Record operational event'} initial={{transferId:transfers[0]?.id??'',facilityId:facilities[0]?.id??'',stage:'Collection',outcome:'Recycling',inputWeightKg:'',outputWeightKg:'',residualWeightKg:'',lossWeightKg:0,...editor.record,action:editor.record?.status==='Validated'?'correct':editor.record?'edit':'',reason:''}} fields={fields} onClose={()=>setEditor(null)} onSave={values=>editor.record?platformApi.updateRecoveryRecord(editor.record.id,values):platformApi.createRecoveryRecord({...values,note:values.reason,validate:false})}/>:null}
  </div>;
}
