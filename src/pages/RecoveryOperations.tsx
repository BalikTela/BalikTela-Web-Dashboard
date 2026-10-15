import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { Activity, Factory, Plus, Pencil, Scale, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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

export function RecoveryOperations({filters}:{filters:Filters}) {
  const {access}=useAuth();
  const canRecord=access?.permissions.includes('recovery.create');
  const canManage=access?.permissions.includes('recovery.manage');
  const [records,setRecords]=useState<RecoveryRecord[]>([]);
  const [facilities,setFacilities]=useState<PlatformFacility[]>([]);
  const [transfers,setTransfers]=useState<Transfer[]>([]);
  const [editor,setEditor]=useState<{record?:RecoveryRecord}|null>(null);
  const [status,setStatus]=useState('Active');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{const [recovery,facility,transfer]=await Promise.all([platformApi.recoveryRecords(toQuery(filters)),platformApi.facilities(toQuery(filters)),platformApi.transfers()]);setRecords(recovery.records);setFacilities(facility.facilities);setTransfers(transfer.transfers);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load recovery operations.');}finally{setLoading(false);}},[filters]);
  useEffect(()=>{void load();},[load]);
  useRecordRefresh(load,['/recovery-records','/facilities','/transfers']);
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
    {key:'residualWeightKg',label:'Residual weight (t)',type:'number',unit:'t',min:0,required:true,when:editMeasurements},
    {key:'reason',label:editor?.record?'Change / validation reason':'Operational note',type:'textarea',required:true},
  ];
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Operational records" value={active.length.toString()} detail="Active stage records" icon={Activity}/><SummaryCard label="Recorded input" value={`${formatMass(active.reduce((sum,item)=>sum+item.inputWeightKg,0))}`} detail="Stage inputs; not unique material mass" icon={Scale}/><SummaryCard label="Recorded output" value={`${formatMass(active.reduce((sum,item)=>sum+(item.outputWeightKg??0),0))}`} detail="Stage outputs; excludes reversed records" icon={ShieldCheck}/><SummaryCard label="Residual recorded" value={`${formatMass(active.reduce((sum,item)=>sum+(item.residualWeightKg??0),0))}`} detail="Recorded loss across stages" icon={Factory}/></section>
    <Panel><SectionHeader title="Collection and Recovery Operations" eyebrow="Measured stage inputs, outputs, and validation" actions={<div className="flex flex-wrap gap-2"><Select aria-label="Recovery record status" value={status} onChange={e=>setStatus(e.target.value)}>{['Active','Recorded','Validated','Flagged','Reversed','All'].map(item=><option key={item}>{item}</option>)}</Select>{canRecord?<Button size="sm" onClick={()=>setEditor({})}><Plus size={15}/>Record operation</Button>:null}</div>}/>
      {error?<p role="alert" className="text-sm text-red-700">{error}</p>:loading?<div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading operational events...</div>:rows.length?<PaginatedRecords rows={rows} resetKey={JSON.stringify([status, filters])}>{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr><th>Record</th><th>Stage</th><th>Batch / transfer</th><th>Facility</th><th>Input</th><th>Output</th><th>Residual</th><th>Outcome</th><th>Validation</th><th>Recorded</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}><td className="py-3 font-semibold text-emerald-700">{item.id}</td><td>{item.stage}</td><td>{item.batchId}<p className="text-xs text-[#718079]">{item.transferId}</p></td><td>{facilities.find(facility=>facility.id===item.facilityId)?.name??item.facilityId}</td><td>{formatMass(item.inputWeightKg)}</td><td>{formatMass(item.outputWeightKg)}</td><td>{formatMass(item.residualWeightKg)}</td><td>{item.outcome??'Pending'}</td><td><Badge variant="outline">{item.status}</Badge></td><td>{new Date(item.timestamp).toLocaleDateString('en-PH')}</td><td>{canManage && item.status!=='Reversed'?<Button variant="ghost" size="icon" title={`Manage ${item.id}`} aria-label={`Manage ${item.id}`} onClick={()=>setEditor({record:item})}><Pencil size={15}/></Button>:null}</td></tr>)}</tbody></table></div>}</PaginatedRecords>:<EmptyBlock label="No recovery records match these filters."/>}
    </Panel>
    {editor?<RecordEditor title={editor.record?'Manage recovery record':'Record operational event'} initial={{transferId:transfers[0]?.id??'',facilityId:facilities[0]?.id??'',stage:'Collection',outcome:'Recycling',inputWeightKg:'',outputWeightKg:'',residualWeightKg:'',...editor.record,action:editor.record?.status==='Validated'?'correct':editor.record?'edit':'',reason:''}} fields={fields} onClose={()=>setEditor(null)} onSave={values=>editor.record?platformApi.updateRecoveryRecord(editor.record.id,values):platformApi.createRecoveryRecord({...values,note:values.reason,validate:false})}/>:null}
  </div>;
}
