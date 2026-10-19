import { formatMass } from '../../shared/metrics';
import { CheckCircle2, ChevronRight, Leaf, ShieldCheck, X } from 'lucide-react';
import type { Stakeholder, Transaction } from '../types';
import { StatusBadge } from './StatusBadge';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

export function StakeholderDrawer({ stakeholder, transactions, onClose }: { stakeholder: Stakeholder | null; transactions: Transaction[]; onClose: () => void }) {
  if (!stakeholder) return null;
  const history = transactions.filter((item) => item.sourceStakeholderId === stakeholder.id || item.destinationStakeholderId === stakeholder.id);
  const tracedMaterialKg = history.reduce((sum, item) => sum + (item.weightKg ?? 0), 0);
  return (
    <div className="overlay-enter fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="drawer-enter absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-2xl sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><div className="flex flex-wrap gap-2"><Badge variant="outline">Demo stakeholder record</Badge><Badge variant="outline" className="text-emerald-700"><ShieldCheck size={12} className="mr-1" />{stakeholder.verification}</Badge></div><h2 className="mt-3 text-xl font-semibold text-slate-950">{stakeholder.name}</h2><p className="mt-1 text-sm text-slate-500">{stakeholder.type} · {stakeholder.city}, {stakeholder.region}</p></div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close stakeholder detail"><X size={18} /></Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Metric label="Completion rate" value={stakeholder.transactions ? `${stakeholder.participation}%` : 'Not available'} detail="Completed linked transfers / all linked transfers" />
          <Metric label="Confirmed outcome output" value={stakeholder.recoveredAvailable === false ? 'Pending evidence' : formatMass(stakeholder.recoveredKg)} detail="Validated final output linked to received transfers" />
          <Metric label="Transactions" value={stakeholder.transactions.toLocaleString()} detail="Derived demo activity count" />
          <Metric label="Traceable material" value={`${formatMass(tracedMaterialKg)}`} detail="Material mass in matching sample audit records" />
        </div>

        <section className="mt-7 border-y border-slate-200 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5"><div><p className="text-sm font-semibold text-slate-900">Placeholder reliability indicator</p><p className="mt-1 text-xs leading-5 text-slate-500">Demo UI placeholder only. The formula, inputs, thresholds, and governance process are not defined or validated.</p></div><p className="shrink-0 text-2xl font-semibold text-slate-950">{stakeholder.reliabilityPlaceholder}/100</p></div>
          <Progress value={stakeholder.reliabilityPlaceholder} className="mt-4" />
        </section>

        <section className="mt-6"><h3 className="text-sm font-semibold text-slate-900">Sustainability activity</h3><div className="mt-3 space-y-2">{stakeholder.sustainabilityActivities.map((activity) => <div key={activity} className="flex items-center gap-2 text-sm text-slate-600"><Leaf size={15} className="text-emerald-700" />{activity}</div>)}</div></section>

        <section className="mt-7"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">Sample transaction history</h3><p className="text-xs text-slate-500">{history.length} audit records</p></div>
          {history.length ? <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">{history.map((item) => <article key={item.id} className="data-row flex items-start gap-3 py-3 sm:items-center"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-slate-400 sm:mt-0" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-slate-900">{item.id} · {item.type}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{item.date} · {formatMass(item.weightKg)} · {item.textileCategory}</p></div><StatusBadge status={item.status} /><ChevronRight size={15} className="hidden shrink-0 text-slate-300 sm:block" /></article>)}</div> : <p className="mt-3 rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-500">No sample audit records match the selected filters.</p>}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="border-t border-slate-300 pt-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs leading-4 text-slate-500">{detail}</p></div>; }
