import { useEffect, useState } from 'react';
import type { MaterialBatch, PlatformUser } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { RecordEditor, type EditorField } from './RecordEditor';
import { CIRCULAR_PATHWAYS, MATERIAL_CONDITIONS } from '../../shared/workflows';
import { REGISTRY_WEIGHT_STATUSES, registryBatchPayload, registryWeightStatus } from '../../shared/registryWeights';

export function MaterialBatchEditor({ batch, action='edit', onClose }: { batch?:MaterialBatch;action?:'edit'|'archive'|'restore';onClose:()=>void }) {
  const [users,setUsers]=useState<PlatformUser[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{if(!batch)platformApi.users().then(result=>setUsers(result.users.filter(item=>item.accountStatus==='Active'))).catch(reason=>setError(reason.message));},[batch]);
  const fields: EditorField[]=[
    ...(!batch?[{key:'sourceUserId',label:'Source user',type:'select' as const,required:true,options:users.map(item=>({value:item.id,label:`${item.fullName} · ${item.organization}`}))}]:[]),
    {key:'materialCategory',label:'Material category',required:true},
    {key:'wasteSource',label:'Waste source',type:'select',options:['Pre-consumer','Post-consumer','Obsolete inventory','Household','Institutional','Unknown']},
    {key:'wasteForm',label:'Waste form',type:'select',options:['Garments','Offcuts','Fabric rolls','Fiber','Mixed textiles','Other']},
    {key:'condition',label:'Condition',type:'select',options:[...MATERIAL_CONDITIONS]},
    {key:'circularPathway',label:'Pathway',type:'select',options:[...CIRCULAR_PATHWAYS]},
    {key:'declaredWeightKg',label:'Declared weight (t)',type:'number',unit:'t',min:0.001,required:true},
    {key:'weightStatus',label:'Weight Status',type:'select',required:true,options:[{value:'',label:'Select weight status'},...REGISTRY_WEIGHT_STATUSES]},
    {key:'city',label:'City',required:true},{key:'region',label:'Region',required:true},
    {key:'method',label:'Measurement method',required:true},
    ...(!batch?[{key:'isDemo',label:'Synthetic/demo record',type:'checkbox' as const}]:[]),
    {key:'reason',label:'Registration / correction reason',type:'textarea',required:true},
  ];
  if(error)return <div role="alert" className="text-sm text-red-700">{error}</div>;
  if(!batch && !users.length)return <p role="status" className="text-sm text-[#718079]">Loading source users...</p>;
  return <RecordEditor title={batch?`${action==='edit'?'Edit':action==='archive'?'Archive':'Restore'} material batch`:'Register material batch'} initial={{sourceUserId:users[0]?.id??'',materialCategory:'Cotton',wasteSource:'Pre-consumer',wasteForm:'Offcuts',condition:'Recyclable',circularPathway:'Recycling',declaredWeightKg:'',city:'',region:'Metro Manila',isDemo:false,method:'',...batch,weightStatus:batch ? registryWeightStatus(batch.weightStatus) ?? '' : 'Measured',reason:''}}
    fields={action==='edit'?fields:[{key:'reason',label:'Reason',type:'textarea',required:true}]} onClose={onClose}
    onSave={values=>batch?platformApi.updateMaterialBatch(batch.id,{...registryBatchPayload(values,batch),action}):platformApi.createMaterialBatch(values)}/>;
}
