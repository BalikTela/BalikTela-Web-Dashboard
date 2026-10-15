import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Save, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';

export interface EditorField {
  key: string; label: string; type?: 'text' | 'number' | 'email' | 'textarea' | 'list' | 'select' | 'checkbox';
  options?: Array<string | {value:string;label:string}>; required?: boolean; min?: number; disabled?: boolean;
  when?: (values: Record<string, unknown>) => boolean;
}

export function RecordEditor({ title, initial, fields, onSave, onClose }: {
  title: string; initial: Record<string, unknown>; fields: EditorField[];
  onSave: (values: Record<string, unknown>) => Promise<unknown>; onClose: () => void;
}) {
  const [values,setValues]=useState<Record<string,unknown>>(()=>Object.fromEntries(Object.entries(initial).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value ?? ''])));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const previous=document.activeElement as HTMLElement | null; dialog.current?.showModal(); return ()=>previous?.focus(); },[]);
  return createPortal(<dialog ref={dialog} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-md border border-[#dfe5e2] bg-white p-0 text-[#17201d] shadow-xl backdrop:bg-slate-950/35">
    <form className="p-4 sm:p-6" onSubmit={async event=>{
      event.preventDefault(); event.stopPropagation(); setBusy(true); setError('');
      const payload={...values};
      for(const field of fields) {
        if(field.when && !field.when(values)) {delete payload[field.key];continue;}
        if(field.type==='list') payload[field.key]=String(values[field.key] ?? '').split(',').map(item=>item.trim()).filter(Boolean);
        if(field.type==='number') payload[field.key]=values[field.key]===''?undefined:Number(values[field.key]);
      }
      try {await onSave(payload);onClose();} catch(reason) {setError(reason instanceof Error?reason.message:'Unable to save this record.');} finally {setBusy(false);}
    }}>
      <header className="mb-5 flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2><Button type="button" variant="ghost" size="icon" aria-label="Close editor" disabled={busy} onClick={onClose}><X size={17}/></Button></header>
      <div className="grid gap-4 sm:grid-cols-2">{fields.filter(field=>!field.when || field.when(values)).map(field=><label key={field.key} className={field.type==='textarea'?'sm:col-span-2':''}>
        <span className="mb-1.5 block text-xs font-medium text-[#66736e]">{field.label}</span>
        {field.type==='select'?<Select aria-label={field.label} disabled={busy || field.disabled} required={field.required} value={String(values[field.key] ?? '')} onChange={e=>setValues({...values,[field.key]:e.target.value})}>{field.options?.map(option=>{const value=typeof option==='string'?option:option.value;return <option key={value} value={value}>{typeof option==='string'?option:option.label}</option>;})}</Select>:
        field.type==='checkbox'?<input aria-label={field.label} type="checkbox" disabled={busy || field.disabled} checked={Boolean(values[field.key])} onChange={e=>setValues({...values,[field.key]:e.target.checked})}/>:
        field.type==='textarea'?<textarea aria-label={field.label} className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" required={field.required} disabled={busy || field.disabled} value={String(values[field.key] ?? '')} onChange={e=>setValues({...values,[field.key]:e.target.value})}/>:
        <Input aria-label={field.label} type={field.type==='number'?'number':field.type==='email'?'email':'text'} step={field.type==='number'?'0.001':undefined} min={field.min} required={field.required} disabled={busy || field.disabled} value={String(values[field.key] ?? '')} onChange={e=>setValues({...values,[field.key]:e.target.value})}/>}
      </label>)}</div>
      {error?<p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>:null}
      <footer className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}><Save size={15}/>{busy?'Saving...':'Save changes'}</Button></footer>
    </form>
  </dialog>,document.body);
}
