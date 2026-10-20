import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Pencil, RefreshCw, Search, ShieldCheck, UsersRound, UserRoundCheck } from 'lucide-react';
import type { HubAccount, HubDirectory } from '../../shared/hubs';
import type { PlatformFacility } from '../platformTypes';
import type { Filters } from '../types';
import { platformApi } from '../services/platformApi';
import { useAuth } from '../context/AuthContext';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { PaginatedRecords } from './PaginatedRecords';
import { Panel } from './Panel';
import { SectionHeader } from './SectionHeader';
import { SummaryCard } from './SummaryCard';
import { EmptyBlock } from './StateBlock';
import { RecordEditor } from './RecordEditor';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { formatMass } from '../../shared/metrics';

export function HubManagement({ filters }: { filters: Filters }) {
  const { access } = useAuth();
  const canManage = Boolean(access?.permissions.includes('hubs.manage'));
  const [data, setData] = useState<HubDirectory | null>(null);
  const [facilities, setFacilities] = useState<PlatformFacility[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('All approvals');
  const [editing, setEditing] = useState<HubAccount | null>(null);
  const requestVersion = useRef(0);
  const { region, city, organizationId, facilityId } = filters;
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setRefreshing(true);
    try {
      const [directory, assigned] = await Promise.all([platformApi.hubs({ region, city, organizationId, facilityId }), canManage ? platformApi.facilities() : Promise.resolve({ facilities: [] })]);
      if (version !== requestVersion.current) return;
      setData(directory);
      setFacilities(assigned.facilities);
      setError('');
    } catch (reason) { if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : 'Unable to load Hub accounts.'); }
    finally { if (version === requestVersion.current) setRefreshing(false); }
  }, [canManage, region, city, organizationId, facilityId]);
  useEffect(() => { void load(); return () => { requestVersion.current++; }; }, [load]);
  useRecordRefresh(load, ['/hubs', '/users', '/facilities']);
  const rows = useMemo(() => data?.hubs.filter(item => (state === 'All approvals' || item.state === state)
    && [item.name, item.email, item.organization, item.region, item.city, item.location].join(' ').toLowerCase().includes(query.toLowerCase())) ?? [], [data, query, state]);
  if (!data && !error) return <p className="py-12 text-center text-sm text-slate-500" role="status">Loading Hub registry...</p>;
  return <div className="space-y-5">
    {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {data ? <>
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Hub accounts" value={data.summary.operators.toLocaleString()} detail="Login accounts for registered Hubs" icon={UsersRound} />
        <SummaryCard label="Approved" value={data.summary.approved.toLocaleString()} detail="Active collection and disposal approval" icon={ShieldCheck} />
        <SummaryCard label="Awaiting approval" value={data.summary.pending.toLocaleString()} detail="Administrator review required" icon={UserRoundCheck} />
        <SummaryCard label="Accounts without a Hub" value={data.summary.unassignedFacilities.toLocaleString()} detail="No account-to-Hub link recorded" icon={MapPin} />
      </section>
      <Panel>
        <SectionHeader title={canManage ? 'Hub Management' : 'Hub Directory'} eyebrow="Hub account access · current approval state" actions={<Button variant="ghost" size="icon" disabled={refreshing} title="Refresh Hub registry" aria-label="Refresh Hub registry" onClick={() => void load()}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></Button>} />
        {data.aggregateOnly ? <HubRegionTable data={data} /> : <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input aria-label="Search Hub accounts" className="pl-9" placeholder="Search accounts, organizations or locations" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <Select aria-label="Hub approval filter" className="sm:max-w-52" value={state} onChange={event => setState(event.target.value)}>{['All approvals', 'Approved', 'Pending approval', 'Suspended', 'Rejected'].map(value => <option key={value}>{value}</option>)}</Select>
          </div>
          {rows.length ? <PaginatedRecords rows={rows} resetKey={`${query}:${state}`} label="Hub accounts">{pageRows => <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm">
            <thead><tr><th>Hub account</th><th>Approval</th><th>Location / assigned Hub</th><th>Awaiting collection</th><th>Collected</th><th>Disposed</th>{canManage ? <th>Access</th> : null}</tr></thead>
            <tbody className="divide-y divide-slate-200">{pageRows.map(item => <tr key={item.id} className="data-row">
              <td className="py-4 pr-4"><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.email}</p><p className="mt-1 text-xs text-slate-500">{item.organization || 'Individual operator'} · {item.role}</p></td>
              <td className="pr-4"><Badge variant="outline" className={item.state === 'Approved' ? 'text-emerald-800' : item.state === 'Suspended' ? 'text-red-700' : 'text-amber-800'}>{item.state}</Badge><p className="mt-2 text-xs text-slate-500">{item.emailVerified ? 'Email verified' : 'Email pending'} · {item.passwordInitialized ? 'Password set' : 'Password pending'}</p></td>
              <td className="max-w-64 pr-4"><p className="break-words">{item.location || 'Location not recorded'}</p><p className="mt-1 text-xs text-slate-500">{item.facilities.map(facility => facility.name).join(', ') || 'No assigned Hub'}</p></td>
              <td className="tabular-nums">{item.awaitingCollection ?? '--'}</td><td className="whitespace-nowrap tabular-nums">{formatMass(item.collectedKg,'Pending evidence')}</td><td className="whitespace-nowrap tabular-nums">{formatMass(item.disposedKg,'Feed unavailable')}</td>
              {canManage ? <td><Button variant="ghost" size="icon" title={`Manage Hub ${item.name}`} aria-label={`Manage Hub ${item.name}`} onClick={() => setEditing(item)}><Pencil size={16} /></Button></td> : null}
            </tr>)}</tbody>
          </table></div>}</PaginatedRecords> : <EmptyBlock label="No Hub accounts match these filters." />}
        </>}
      </Panel>
    </> : <Button variant="outline" onClick={() => void load()}>Retry</Button>}
    {editing ? <RecordEditor title={`Hub access · ${editing.name}`} initial={{ action: 'assign', facilityId: editing.facilityIds[0] ?? '', reason: '' }}
      fields={[{ key: 'action', label: 'Access decision', type: 'select', options: [{ value: 'assign', label: 'Update assigned Hub' }, { value: 'approve', label: 'Approve collection and disposal access' }, { value: 'revoke', label: 'Revoke collection and disposal approval' }] },
        { key: 'facilityId', label: 'Assigned Hub', type: 'select', options: [{ value: '', label: 'No assigned Hub' }, ...facilities.filter(item => item.status !== 'Inactive' && (!editing.organizationId || item.organizationId === editing.organizationId)).map(item => ({ value: item.id, label: `${item.name} · ${item.region}` }))] },
        { key: 'reason', label: 'Administrative reason', type: 'textarea', required: true }]}
      onClose={() => setEditing(null)} onSave={async values => {
        const facilityIds = values.facilityId ? [String(values.facilityId), ...editing.facilityIds.slice(1).filter(id => id !== values.facilityId)] : [];
        await platformApi.updateHub(editing.id, { action: values.action, facilityIds, reason: values.reason });
        await load();
      }} /> : null}
  </div>;
}
function HubRegionTable({ data }: { data: HubDirectory }) {
  return data.regions.length ? <><p className="mb-4 text-xs text-slate-500">Aggregate regional access · operator identities and assignments withheld</p><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead><tr><th>Region</th><th>Operators</th><th>Approved</th><th>Pending</th></tr></thead><tbody className="divide-y divide-slate-200">{data.regions.map(item => <tr key={item.region}><td className="py-3">{item.region || 'Not recorded'}</td><td>{item.operators}</td><td>{item.approved}</td><td>{item.pending}</td></tr>)}</tbody></table></div></> : <EmptyBlock label="No Hub activity in your assigned regions." />;
}
