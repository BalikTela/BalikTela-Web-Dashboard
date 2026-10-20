import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { WeighingMonitoring } from '../components/WeighingMonitoring';
import { OperationalTraceability } from './OperationalTraceability';
import { Transactions } from './Transactions';
import type { DashboardAnalytics } from '../platformTypes';
import type { Filters } from '../types';

export function TraceabilityWorkspace({ data, filters }: { data: DashboardAnalytics; filters: Filters }) {
  const { user, access } = useAuth();
  const canMonitor = Boolean(access?.permissions.includes('weighing.read'));
  const [tab, setTab] = useState<'transfers' | 'weighing'>('transfers');
  return <div className="space-y-5">
    {canMonitor ? <div className="flex flex-wrap gap-5 border-b border-slate-200" role="group" aria-label="Traceability sections">{(['transfers', 'weighing'] as const).map(item => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)} className={`border-b-2 px-1 py-3 text-sm font-medium ${tab === item ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>{item === 'transfers' ? 'Transfers' : 'Historical Listing Weights'}</button>)}</div> : null}
    {tab === 'weighing' && canMonitor ? <WeighingMonitoring filters={filters} /> : user?.scope.aggregateOnly ? <Transactions data={data} /> : <OperationalTraceability filters={filters} />}
  </div>;
}
