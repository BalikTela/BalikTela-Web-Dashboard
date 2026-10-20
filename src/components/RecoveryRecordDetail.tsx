import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { formatMass } from '../../shared/metrics';
import { recoveryMassBalance } from '../../shared/recovery';
import type { RecoveryRecord } from '../platformTypes';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

export function RecoveryRecordDetail({ record, facility, onClose }: {
  record: RecoveryRecord; facility: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return createPortal(<dialog ref={dialog} aria-labelledby="recovery-detail-title" onCancel={event => { event.preventDefault(); onClose(); }}
    className="record-editor m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-md border border-[#dfe5e2] bg-white p-4 text-[#17201d] shadow-xl backdrop:bg-slate-950/35 sm:p-6">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="recovery-detail-title" className="text-lg font-semibold">{record.stage} record</h2><p className="mt-1 break-all text-xs text-slate-500">{record.id}</p></div>
      <Button variant="ghost" size="icon" aria-label="Close recovery detail" onClick={onClose}><X size={18} /></Button>
    </header>
    <div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline">{record.status}</Badge><Badge variant="outline">{recoveryMassBalance(record)}</Badge></div>
    <dl className="mt-5 grid gap-4 border-y border-slate-200 py-4 sm:grid-cols-2">
      {([['Batch', record.batchId], ['Transfer', record.transferId], ['Facility', facility], [record.stage === 'Collection' || record.stage === 'Sorting' ? 'Intended pathway' : 'Outcome', record.stage === 'Rejection' ? 'Rejected' : record.outcome ?? 'Not recorded']] as const).map(([label, value]) =>
        <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}
    </dl>
    <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{([
      ['Input', record.inputWeightKg], ['Output', record.outputWeightKg], ['Rejects', record.residualWeightKg], ['Processing loss', record.lossWeightKg ?? 0],
    ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{formatMass(value, 'Not recorded')}</dd></div>)}</dl>
    <p className="mt-4 border-l-2 border-emerald-600 pl-3 text-xs leading-5 text-slate-600">Input = output + rejects + processing loss. Stage weights are not additional collected material. Only eligible validated final outcomes on completed transfers contribute to confirmed reuse and recycling; Hub disposal is separate.</p>
    <dl className="mt-5 grid gap-4 sm:grid-cols-2">{([
      ['Recorded by', record.recordedBy], ['Validated by', record.validatedBy ?? 'Not validated'],
      ['Recorded at', new Date(record.timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })],
      ['Source', record.isDemo ? 'Synthetic scenario record' : 'Shared platform record'],
    ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>
    <h3 className="mt-5 text-sm font-semibold">Notes and corrections</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{record.note || 'No notes recorded.'}</p>
  </dialog>, document.body);
}
