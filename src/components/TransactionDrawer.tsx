import { AlertTriangle, Check, Clock3, MapPin, X } from 'lucide-react';
import type { LifecycleEvent, Transaction } from '../types';
import { StatusBadge } from './StatusBadge';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

export function TransactionDrawer({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  if (!transaction) return null;

  return (
    <div className="overlay-enter fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="drawer-enter absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-slate-500">Lifecycle traceability</p><Badge variant="outline">Demo record</Badge></div>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{transaction.id}</h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close transaction detail"><X size={18} /></Button>
        </div>

        <div className="mt-6 grid gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-4 text-sm sm:grid-cols-2">
          <Detail label="Source" value={transaction.source} />
          <Detail label="Destination" value={transaction.destination} />
          <Detail label="Location" value={transaction.location} />
          <Detail label="Weight" value={`${transaction.weightKg.toLocaleString()} kg`} />
          <div className="flex items-center justify-between gap-3 sm:col-span-2"><span className="text-slate-500">Status</span><StatusBadge status={transaction.status} /></div>
          <div className="border-t border-slate-200 pt-3 sm:col-span-2"><Detail label="Environmental impact" value="Disabled pending approved methodology" /></div>
        </div>

        <div className="mt-7 flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-slate-900">Audit lifecycle</h3>
          <p className="text-xs text-slate-500">Philippine Standard Time</p>
        </div>
        <ol className="mt-4 space-y-0">
          {transaction.lifecycle.map((event, index) => (
            <li key={event.id} className="data-row relative flex gap-4 pb-5">
              {index < transaction.lifecycle.length - 1 ? <span className="absolute bottom-0 left-[15px] top-8 w-px bg-slate-200" /> : null}
              <EventMarker status={event.status} />
              <div className="min-w-0 flex-1 border-b border-slate-100 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-950">{event.stage}</p>
                  <EventStatus status={event.status} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{event.actor}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>{event.timestamp ? formatTimestamp(event.timestamp) : 'Awaiting event'}</span>
                  <span className="flex items-center gap-1"><MapPin size={12} />{event.location}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{event.note}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function EventMarker({ status }: { status: LifecycleEvent['status'] }) {
  const styles = status === 'Completed' ? 'bg-emerald-700 text-white' : status === 'Exception' ? 'bg-red-600 text-white' : status === 'Current' ? 'border-2 border-emerald-700 bg-white text-emerald-700' : 'border border-slate-300 bg-white text-slate-400';
  return <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ${styles}`}>{status === 'Completed' ? <Check size={15} /> : status === 'Exception' ? <AlertTriangle size={14} /> : <Clock3 size={14} />}</span>;
}

function EventStatus({ status }: { status: LifecycleEvent['status'] }) {
  const styles = status === 'Completed' ? 'text-emerald-700' : status === 'Exception' ? 'text-red-700' : status === 'Current' ? 'text-amber-700' : 'text-slate-400';
  return <span className={`text-xs font-medium ${styles}`}>{status}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-slate-900">{value}</span></div>;
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(timestamp));
}
