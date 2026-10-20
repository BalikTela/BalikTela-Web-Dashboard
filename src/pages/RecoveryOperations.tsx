import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { EmptyBlock } from '../components/StateBlock';
import { HubDisposalMonitoring } from '../components/HubDisposalMonitoring';
import { HubCollectionMonitoring } from '../components/HubCollectionMonitoring';
import { HubManagement } from '../components/HubManagement';
import type { Filters } from '../types';

export function RecoveryOperations({ filters }: { filters: Filters }) {
  const { access } = useAuth();
  const [tab, setTab] = useState<'collection' | 'hubs' | 'disposals'>('collection');
  if (!access?.permissions.includes('hubs.read')) return <EmptyBlock label="Recovery monitoring is not available for this account." />;

  return <div className="space-y-5">
    <div className="flex flex-wrap gap-x-5 border-b border-slate-200" role="group" aria-label="Recovery sections">
      {(['collection', 'hubs', 'disposals'] as const).map(item => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)} className={`border-b-2 px-1 py-3 text-sm font-medium ${tab === item ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
        {item === 'collection' ? 'Hub Collection & Disposal' : item === 'hubs' ? (access.permissions.includes('hubs.manage') ? 'Hub Management' : 'Hub Directory') : 'Hub Disposals'}
      </button>)}
    </div>
    {tab === 'collection' ? <HubCollectionMonitoring filters={filters} /> : tab === 'hubs' ? <HubManagement filters={filters} /> : <HubDisposalMonitoring filters={filters} />}
  </div>;
}
