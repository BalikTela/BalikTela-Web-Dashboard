import { PaginatedRecords } from '../components/PaginatedRecords';
import { formatMass } from '../../shared/metrics';
import { Building2, Factory, Plus, Pencil, Archive, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SummaryCard } from '../components/SummaryCard';
import { RecordEditor, type EditorField } from '../components/RecordEditor';
import type { Organization, PlatformFacility } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { ORGANIZATION_STATUSES, ORGANIZATION_TYPES, REGISTRY_VERIFICATIONS, organizationStatus, organizationType, registryVerification } from '../../shared/registry';
import { hubStorageCapacity } from '../../shared/hubStorage';

const organizationFields: EditorField[]=[
  {key:'name',label:'Organization name',required:true},
  {key:'type',label:'Organization type',type:'select',options:[...ORGANIZATION_TYPES],required:true},
  {key:'city',label:'City',required:true},{key:'region',label:'Region',required:true},{key:'contactEmail',label:'Contact email',type:'email'},
  {key:'serviceAreas',label:'Service areas',type:'list'},{key:'acceptedMaterials',label:'Accepted materials',type:'list'},
  {key:'status',label:'Organization status',type:'select',options:[...ORGANIZATION_STATUSES]},
  {key:'verification',label:'Verification',type:'select',options:[...REGISTRY_VERIFICATIONS]},
  {key:'reason',label:'Change reason',type:'textarea',required:true},
];
export function OrganizationAdmin() {
  const [organizations,setOrganizations]=useState<Organization[]>([]);
  const [facilities,setFacilities]=useState<PlatformFacility[]>([]);
  const [editor,setEditor]=useState<{kind:'organization'|'facility';record?:Organization|PlatformFacility;action?:'deactivate'|'restore'}|null>(null);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{const [orgs,facs]=await Promise.all([platformApi.organizations(),platformApi.facilities()]);setOrganizations(orgs.organizations);setFacilities(facs.facilities);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load registry.');}},[]);
  useEffect(()=>{void load();},[load]);
  useRecordRefresh(load,['/organizations','/facilities']);
  const hubOrganizations=organizations.filter(item=>item.status!=='Inactive' && item.recordLabel==='Operational' || editor?.kind==='facility' && editor.record && 'organizationId' in editor.record && editor.record.organizationId===item.id);
  const facilityFields: EditorField[]=[
    {key:'name',label:'Hub name',required:true},{key:'organizationId',label:'Organization',type:'select',options:[{value:'',label:'Select organization'},...hubOrganizations.map(item=>({value:item.id,label:item.name}))],required:true},
    {key:'city',label:'City',required:true},{key:'region',label:'Region',required:true},
    {key:'storageCapacityKg',label:'Storage capacity (t)',type:'number',unit:'t',min:0.001,required:true},
    {key:'serviceAreas',label:'Service areas',type:'list'},{key:'acceptedMaterials',label:'Accepted materials',type:'list'},
    {key:'status',label:'Availability',type:'select',options:[{value:'Pilot onboarding',label:'Onboarding'},'Available','Near capacity','Maintenance','Inactive']},
    {key:'verification',label:'Verification',type:'select',options:[...REGISTRY_VERIFICATIONS]},
    {key:'reason',label:'Change reason',type:'textarea',required:true},
  ];
  const match=(item:Organization|PlatformFacility)=>`${item.name} ${item.id} ${item.city} ${item.region}`.toLowerCase().includes(query.toLowerCase());
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Organizations" value={organizations.filter(item=>item.status!=='Inactive').length.toString()} detail="Active and prospective registry records" icon={Building2}/>
      <SummaryCard label="Inactive organizations" value={organizations.filter(item=>item.status==='Inactive').length.toString()} detail="Retained for traceability" icon={Archive}/>
      <SummaryCard label="Registered Hubs" value={facilities.filter(item=>item.status!=='Inactive').length.toString()} detail="Existing Hub registry; excludes inactive records" icon={Factory}/>
      <SummaryCard label="Storage capacity" value={formatMass(facilities.filter(item=>item.status!=='Inactive').reduce((sum,item)=>sum+hubStorageCapacity(item).capacityKg,0))} detail="Active Hubs; includes labeled illustrative limits" icon={Factory}/>
    </section>
    {error?<p className="text-sm text-red-700" role="alert">{error}</p>:null}
    <Panel><SectionHeader title="Organizations and Hubs" eyebrow="Institutional registry" actions={<div className="flex flex-wrap gap-2"><Input aria-label="Search registry" placeholder="Search registry" value={query} onChange={e=>setQuery(e.target.value)} className="w-full sm:w-56"/><Button size="sm" variant="outline" onClick={()=>setEditor({kind:'facility'})}><Plus size={14}/>Hub</Button><Button size="sm" onClick={()=>setEditor({kind:'organization'})}><Plus size={14}/>Organization</Button></div>}/>
      <PaginatedRecords rows={organizations.filter(match)} resetKey={JSON.stringify([query])}>{pageRows =><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr><th>Organization</th><th>Type</th><th>Status</th><th>Verification</th><th>Location</th><th>Materials</th><th>Actions</th></tr></thead><tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(item=><tr key={item.id}>
        <td className="py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-[#718079]">{item.id}{item.recordLabel!=='Operational'?` · ${item.recordLabel}`:''}</p></td><td>{organizationType(item.type)??item.type}</td><td><Badge variant="outline">{organizationStatus(item.status)}</Badge></td><td>{registryVerification(item.verification)}</td><td>{item.city}, {item.region}</td><td>{item.acceptedMaterials.join(', ') || 'Not configured'}</td>
        <td><div className="flex gap-1"><Action label={`Edit ${item.name}`} onClick={()=>setEditor({kind:'organization',record:item})}><Pencil size={15}/></Action><Action label={`${item.status==='Inactive'?'Restore':'Deactivate'} ${item.name}`} onClick={()=>setEditor({kind:'organization',record:item,action:item.status==='Inactive'?'restore':'deactivate'})}>{item.status==='Inactive'?<RotateCcw size={15}/>:<Archive size={15}/>}</Action></div></td>
      </tr>)}</tbody></table></div>}</PaginatedRecords>
    </Panel>
    <Panel><SectionHeader title="Hub Registry" eyebrow="Storage capacity and service areas"/>
      <PaginatedRecords rows={facilities.filter(match)} resetKey={query} label="Hub registry">{pageRows=><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{pageRows.map(item=><article key={item.id} className="rounded-md border border-[#dfe5e2] p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{item.name}</p><p className="mt-1 text-xs text-[#718079]">Hub · {item.city}</p></div><Badge variant="outline">{['Available','Near capacity'].includes(item.status)?'Active':item.status}</Badge></div>
        <p className="mt-4 text-sm tabular-nums">Storage capacity: {hubStorageCapacity(item).capacityKg>0?formatMass(hubStorageCapacity(item).capacityKg):'Not configured'}</p>{hubStorageCapacity(item).capacitySource==='Illustrative'?<p className="mt-1 text-xs text-amber-800">Illustrative limit</p>:null}<p className="mt-2 text-xs text-[#66736e]">{item.acceptedMaterials.join(', ')}</p>
        <div className="mt-4 flex justify-end gap-1"><Action label={`Edit ${item.name}`} onClick={()=>setEditor({kind:'facility',record:item})}><Pencil size={15}/></Action><Action label={`${item.status==='Inactive'?'Restore':'Deactivate'} ${item.name}`} onClick={()=>setEditor({kind:'facility',record:item,action:item.status==='Inactive'?'restore':'deactivate'})}>{item.status==='Inactive'?<RotateCcw size={15}/>:<Archive size={15}/>}</Action></div>
      </article>)}</div>}</PaginatedRecords>
    </Panel>
    {editor?<RecordEditor title={`${editor.action==='deactivate'?'Deactivate':editor.action==='restore'?'Restore':editor.record?'Edit':'Register'} ${editor.kind==='facility'?'Hub':editor.kind}`} initial={{name:'',city:'',region:'Metro Manila',organizationId:'',storageCapacityKg:null,serviceAreas:[],acceptedMaterials:[],...editor.record,type:editor.kind==='organization'?organizationType(editor.record?.type)??editor.record?.type??'Producer/Retailer':editor.record?.type??'Collection point',verification:registryVerification(editor.record?.verification??'Pending review'),status:editor.kind==='organization'?organizationStatus((editor.record as Organization|undefined)?.status??'Pending review'):editor.record?.status??'Pilot onboarding',reason:''}}
      fields={editor.action?[{key:'reason',label:'Reason',type:'textarea',required:true}]:editor.kind==='organization'?organizationFields:facilityFields} onClose={()=>setEditor(null)} onSave={async values=>{
        const status=editor.action==='deactivate'?'Inactive':editor.kind==='organization'?'Pending review':'Pilot onboarding';
        const body=editor.action?{status,reason:values.reason}:values;
        if(editor.kind==='organization') return editor.record?platformApi.updateOrganization(editor.record.id,body):platformApi.createOrganization(body);
        return editor.record?platformApi.updateFacility(editor.record.id,body):platformApi.createFacility(body);
      }}/>:null}
  </div>;
}
function Action({label,onClick,children}:{label:string;onClick:()=>void;children:React.ReactNode}) {return <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} onClick={onClick}>{children}</Button>;}
