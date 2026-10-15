import { Save, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { RecordEditor } from '../components/RecordEditor';
import type { PlatformConfiguration } from '../platformTypes';
import { platformApi } from '../services/platformApi';

const taxonomies=[['materialCategories','Material categories'],['wasteSources','Waste sources'],['wasteForms','Waste forms'],['circularPathways','Circular pathways'],['facilityTypes','Facility types'],['weightStatuses','Weight evidence states']] as const;
export function Settings() {
  const [config,setConfig]=useState<PlatformConfiguration|null>(null);
  const [references,setReferences]=useState<Record<string,string>>({});
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [reason,setReason]=useState('');
  const [reset,setReset]=useState(false);
  const load=useCallback(async()=>{try{const result=await platformApi.configuration();setConfig(result.configuration);setReferences(Object.fromEntries(taxonomies.map(([key])=>[key,result.configuration[key].join(', ')])));}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load configuration.');}},[]);
  useEffect(()=>{void load();},[load]);
  if(!config)return <div className="grid min-h-64 place-items-center text-sm text-[#718079]">{error||'Loading platform configuration...'}</div>;
  return <form className="space-y-5" onSubmit={async event=>{event.preventDefault();setSaving(true);setError('');setMessage('');try{
    const arrays=Object.fromEntries(taxonomies.map(([key])=>[key,references[key].split(',').map(item=>item.trim()).filter(Boolean)]));
    const result=await platformApi.updateConfiguration({...config,...arrays,reason} as Partial<PlatformConfiguration>);
    setConfig(result.configuration);setReason('');setMessage('Configuration saved.');
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to save configuration.');}finally{setSaving(false);}}}>
    <Panel><SectionHeader title="Platform Taxonomies" eyebrow="Shared reference classifications"/>
      <div className="grid gap-4 lg:grid-cols-2">{taxonomies.map(([key,label])=><label key={key}><span className="mb-1.5 block text-xs font-medium text-[#66736e]">{label}</span><Input required disabled={saving} value={references[key]} onChange={e=>setReferences({...references,[key]:e.target.value})}/></label>)}</div>
    </Panel>
    <Panel><SectionHeader title="Validation and Reward Rules" actions={<Button type="button" variant="ghost" size="icon" title="Reset rules" aria-label="Reset rules" onClick={()=>setReset(true)}><RotateCcw size={16}/></Button>}/><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-medium text-[#66736e]">Discrepancy threshold (%)</span><Input required type="number" min="0" max="100" step="0.1" value={config.discrepancyThresholdPercent} onChange={e=>setConfig({...config,discrepancyThresholdPercent:Number(e.target.value)})}/></label><label><span className="mb-1.5 block text-xs font-medium text-[#66736e]">Reward credits per verified kg</span><Input required type="number" min="0" step="0.1" value={config.rewardCreditsPerVerifiedKg} onChange={e=>setConfig({...config,rewardCreditsPerVerifiedKg:Number(e.target.value)})}/></label></div></Panel>
    <Panel><SectionHeader title="Matching Rule Weights"/><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(config.matchingWeights).map(([key,value])=><label key={key}><span className="mb-1.5 block text-xs font-medium capitalize text-[#66736e]">{key}</span><Input type="number" required min="0" value={value} onChange={e=>setConfig({...config,matchingWeights:{...config.matchingWeights,[key]:Number(e.target.value)}})}/></label>)}</div></Panel>
    <section className="border-y border-[#dfe5e2] py-4"><p className="text-sm font-medium">Environmental methodology</p><p className="mt-1 text-xs text-[#718079]">{config.methodologyVersion}</p></section>
    <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#66736e]">Change reason</span><Input required value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}{message?<p role="status" className="text-sm text-emerald-700">{message}</p>:null}
    <div className="flex justify-end"><Button disabled={saving}><Save size={15}/>{saving?'Saving...':'Save configuration'}</Button></div>
    {reset?<RecordEditor title="Reset validation and matching rules" initial={{reason:''}} fields={[{key:'reason',label:'Reset reason',type:'textarea',required:true}]} onClose={()=>setReset(false)} onSave={async values=>{const result=await platformApi.updateConfiguration({discrepancyThresholdPercent:5,rewardCreditsPerVerifiedKg:2,matchingWeights:{category:30,pathway:15,region:15,condition:10,quantity:10},reason:values.reason} as Partial<PlatformConfiguration>);setConfig(result.configuration);setMessage('Rules reset.');}}/>:null}
  </form>;
}
