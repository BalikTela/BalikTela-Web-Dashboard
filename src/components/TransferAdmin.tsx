import type { BarterOffer, Transfer } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { RecordEditor, type EditorField } from './RecordEditor';

export function TransferAdmin({transfer,onClose}:{transfer:Transfer;onClose:()=>void}) {
  const next=transfer.status==='Reserved'?'handover':transfer.status==='Handed over'?'receipt':transfer.status==='Received'?'validate':transfer.status==='Validated'?'complete':transfer.status==='Disputed'?'resolve':'';
  const fields: EditorField[]=[
    {key:'action',label:'Lifecycle action',type:'select',options:[next,'cancel','reject',...(transfer.status==='Disputed'?[]:['dispute'])].filter(Boolean)},
    {key:'weightKg',label:'Measured weight (kg)',type:'number',min:0.001,required:true,when:values=>['handover','receipt','validate'].includes(String(values.action))},
    {key:'method',label:'Measurement method',required:true,when:values=>['handover','receipt','validate'].includes(String(values.action))},
    {key:'circularOutcome',label:'Confirmed outcome',type:'select',options:['Reuse','Repair','Redistribution','Upcycling','Recycling'],when:values=>values.action==='complete'},
    {key:'discrepancyReason',label:'Receipt discrepancy reason',type:'textarea',when:values=>values.action==='receipt'},
    {key:'location',label:'Event location',required:true},{key:'note',label:'Reason / event note',type:'textarea',required:true},
  ];
  return <RecordEditor title={`Manage transfer ${transfer.id}`} initial={{action:next,weightKg:transfer.verifiedWeightKg??transfer.receiptWeightKg??transfer.handoverWeightKg??transfer.agreedWeightKg,method:'',location:'',circularOutcome:'Recycling',discrepancyReason:'',note:''}} fields={fields} onClose={onClose} onSave={values=>platformApi.advanceTransfer(transfer.id,values)}/>;
}
export function OfferAdmin({offer,onClose}:{offer:BarterOffer;onClose:()=>void}) {
  const fields: EditorField[]=[{key:'action',label:'Action',type:'select',options:['edit','accept','decline']},
    {key:'quantityKg',label:'Requested weight (kg)',type:'number',min:0.001,required:true,when:values=>values.action==='edit'},
    {key:'terms',label:'Terms',type:'textarea',required:true,when:values=>values.action==='edit'},
    {key:'offeredCredits',label:'Proposed credits',type:'number',min:0,required:true,when:values=>values.action==='edit'},
    {key:'reason',label:'Administrative reason',type:'textarea',required:true}];
  return <RecordEditor title={`Review offer ${offer.id}`} initial={{...offer,action:'edit',reason:''}} fields={fields} onClose={onClose} onSave={values=>platformApi.manageOffer(offer.id,{...values,status:values.action==='accept'?'Accepted':values.action==='decline'?'Declined':undefined})}/>;
}
