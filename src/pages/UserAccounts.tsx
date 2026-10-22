import { PaginatedRecords } from '../components/PaginatedRecords';
import { Plus, Search, ShieldCheck, Smartphone, UsersRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Organization, PlatformUser } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { SummaryCard } from '../components/SummaryCard';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyBlock } from '../components/StateBlock';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { ACCOUNT_GROUPS, ACCOUNT_ROLES, WEB_DASHBOARD_ROLES, accountGroup, accountRoleLabel, isWebDashboardRole } from '../../shared/webAccess';

function webReady(user: PlatformUser) {
  return isWebDashboardRole(user.role) && user.accountStatus === 'Active' && Boolean(user.emailVerifiedAt && user.passwordChangedAt);
}

export function UserAccounts() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All account groups');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [userResult, orgResult] = await Promise.all([platformApi.users(), platformApi.organizations()]);
      setUsers(userResult.users); setOrganizations(orgResult.organizations);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load user accounts.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRecordRefresh(load, ['/organizations', '/hubs']);
  const rows = useMemo(() => users.filter(user => group === 'All account groups' || accountGroup(user.role) === group)
    .filter(user => [user.fullName, user.email, user.organization, user.city, user.region, user.role].join(' ').toLowerCase().includes(query.toLowerCase())), [query, group, users]);
  return <>
    <div className="space-y-5">
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Registered accounts" value={String(users.length)} detail="All platform account types" icon={UsersRound} />
        <SummaryCard label="Web dashboard access" value={String(users.filter(webReady).length)} detail="Active Admin, Government, and Researcher accounts" icon={ShieldCheck} />
        <SummaryCard label="Mobile-only accounts" value={String(users.filter(user => !isWebDashboardRole(user.role)).length)} detail="Participant and Hub account types" icon={Smartphone} />
        <SummaryCard label="Restricted or pending" value={String(users.filter(user => user.accountStatus !== 'Active').length)} detail="Awaiting approval, suspended, or deactivated" icon={ShieldCheck} tone="amber" />
      </section>
      <Panel>
        <SectionHeader title="User Accounts" eyebrow="Account types, approvals, and access" actions={<div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <label className="relative w-full sm:w-60"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input aria-label="Search users" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search users" className="w-full pl-9" /></label>
          <Select aria-label="Account group" value={group} onChange={event => setGroup(event.target.value)} className="w-full sm:w-52"><option>All account groups</option>{ACCOUNT_GROUPS.map(item => <option key={item.label}>{item.label}</option>)}</Select>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => setCreating(true)}><Plus size={14} />Dashboard account</Button>
        </div>} />
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : loading ? <div className="grid min-h-64 place-items-center text-sm text-[#718079]">Loading registered accounts...</div> : rows.length ? <PaginatedRecords rows={rows} resetKey={JSON.stringify([query, group])}>{pageRows => <div className="overflow-x-auto">
          <table aria-label="User accounts" className="w-full min-w-[1050px] text-left text-sm">
            <thead><tr><th>User</th><th>Account type</th><th>Platform access</th><th>Organization</th><th>Account status</th><th>Security</th><th>Actions</th></tr></thead>
            <tbody className="divide-y divide-[#dfe5e2]">{pageRows.map(user => <tr key={user.id}>
              <td className="max-w-64 break-words py-3"><p className="font-medium">{user.fullName}</p><p className="text-xs text-[#718079]">{user.email}</p><p className="break-all text-xs text-[#718079]">{user.id}</p></td>
              <td><Badge variant="outline">{accountRoleLabel(user.role)}</Badge><p className="mt-1 text-xs text-[#718079]">{accountGroup(user.role)}</p></td>
              <td>{isWebDashboardRole(user.role) ? <><p>{webReady(user) ? 'Web dashboard' : 'Web access pending / restricted'}</p><p className="mt-1 text-xs text-[#718079]">{user.role === 'Administrator' ? 'Full administration' : user.role === 'Government' || user.scope.aggregateOnly ? 'Read-only summaries' : 'Read-only, de-identified records'}</p></> : <p>Mobile only</p>}</td>
              <td className="max-w-52 break-words">{user.organization || 'Individual participant'}</td>
              <td><Badge variant="outline" className={user.accountStatus === 'Active' ? 'text-emerald-700' : user.accountStatus === 'Suspended' ? 'text-red-700' : 'text-amber-700'}>{user.accountStatus}</Badge></td>
              <td><p className={user.emailVerifiedAt ? 'text-emerald-700' : 'text-amber-700'}>{user.emailVerifiedAt ? 'Email verified' : 'Email pending'}</p><p className="text-xs text-[#718079]">{user.passwordChangedAt ? 'Password initialized' : 'Invitation pending'}</p></td>
              <td><Button size="sm" variant="outline" onClick={() => setEditing(user)}>Manage access</Button></td>
            </tr>)}</tbody>
          </table>
        </div>}</PaginatedRecords> : <EmptyBlock label="No user accounts match these filters." />}
      </Panel>
    </div>
    {creating ? <CreateUser organizations={organizations} onClose={() => setCreating(false)} onCreated={load} /> : null}
    {editing ? <EditAccess user={editing} organizations={organizations} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} /> : null}
  </>;
}

function CreateUser({ organizations, onClose, onCreated }: { organizations: Organization[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ fullName: '', email: '', role: 'Researcher', organizationId: organizations[0]?.id ?? '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [invitationLink, setInvitationLink] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="Invite dashboard user" onClose={onClose}><form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await platformApi.createUser(form); setMessage(result.message); setInvitationLink(result.demoInvitationLink ?? ''); await onCreated(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to send the invitation.'); }
    finally { setBusy(false); }
  }}>
    <Field label="Full name"><Input required disabled={Boolean(message)} value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /></Field>
    <Field label="Email"><Input required disabled={Boolean(message)} type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></Field>
    <Field label="Dashboard role"><Select aria-label="Dashboard role" disabled={Boolean(message)} value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}>{WEB_DASHBOARD_ROLES.map(role => <option key={role} value={role}>{accountRoleLabel(role)}</option>)}</Select></Field>
    <Field label="Organization"><Select aria-label="Organization" disabled={Boolean(message)} value={form.organizationId} onChange={event => setForm({ ...form, organizationId: event.target.value })}>{organizations.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</Select></Field>
    {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
    {invitationLink ? <a className="block text-sm font-medium text-emerald-800 underline" href={invitationLink} target="_blank" rel="noreferrer">Open development invitation link</a> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{message ? 'Close' : 'Cancel'}</Button>{!message ? <Button disabled={busy}>{busy ? 'Sending...' : 'Send invitation'}</Button> : null}</div>
  </form></Dialog>;
}

function EditAccess({ user, organizations, onClose, onSaved }: { user: PlatformUser; organizations: Organization[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ fullName: user.fullName, city: user.city, region: user.region, role: user.role, organizationId: user.organizationId ?? '', accountStatus: user.accountStatus, aggregateOnly: user.role === 'Government' || user.scope.aggregateOnly, canExport: user.scope.canExport, regions: user.scope.regions.join(', '), facilityIds: user.scope.facilityIds.join(', '), reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title={`Manage account: ${user.fullName}`} onClose={onClose}><form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await platformApi.updateUserAccess(user.id, { ...form, aggregateOnly: form.role === 'Government' || form.aggregateOnly, regions: form.regions.split(',').map(item => item.trim()).filter(Boolean), facilityIds: form.facilityIds.split(',').map(item => item.trim()).filter(Boolean), approve: form.accountStatus === 'Active' }); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update account.'); }
    finally { setBusy(false); }
  }}>
    <Field label="Full name"><Input required value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="City"><Input value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} /></Field><Field label="Region"><Input value={form.region} onChange={event => setForm({ ...form, region: event.target.value })} /></Field></div>
    <Field label="Role"><Select aria-label="Role" value={form.role} onChange={event => { const role = event.target.value as PlatformUser['role']; setForm({ ...form, role, aggregateOnly: role === 'Government' || role === form.role && form.aggregateOnly }); }}>
      {ACCOUNT_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.roles.filter(role => (ACCOUNT_ROLES as readonly string[]).includes(role) || role === user.role).map(role => <option key={role} value={role}>{accountRoleLabel(role)}</option>)}</optgroup>)}
    </Select></Field>
    <Field label="Platform access"><Input readOnly value={isWebDashboardRole(form.role) ? form.role === 'Administrator' ? 'Web dashboard - Admin' : form.role === 'Government' ? 'Web dashboard - Read-only summaries' : 'Web dashboard - Read-only research' : 'Mobile only'} /></Field>
    <Field label="Organization"><Select aria-label="Organization" value={form.organizationId} onChange={event => setForm({ ...form, organizationId: event.target.value })}><option value="">No organization</option>{organizations.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</Select></Field>
    <Field label="Account status"><Select value={form.accountStatus} onChange={event => setForm({ ...form, accountStatus: event.target.value as PlatformUser['accountStatus'] })}>{['Active', 'Pending verification', 'Suspended', 'Deactivated'].map(item => <option key={item}>{item}</option>)}</Select></Field>
    <Field label="Assigned regions"><Input value={form.regions} onChange={event => setForm({ ...form, regions: event.target.value })} /></Field>
    {!isWebDashboardRole(form.role) ? <Field label="Assigned facility IDs"><Input value={form.facilityIds} onChange={event => setForm({ ...form, facilityIds: event.target.value })} /></Field> : null}
    {form.role === 'Researcher' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.aggregateOnly} onChange={event => setForm({ ...form, aggregateOnly: event.target.checked })} />Summary-only research access</label> : null}
    {form.role === 'Government' || form.role === 'Researcher' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.canExport} onChange={event => setForm({ ...form, canExport: event.target.checked })} />Allow scoped report downloads</label> : null}
    <Field label="Administrative reason"><Input required value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></Field>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving...' : 'Save account'}</Button></div>
  </form></Dialog>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div role="dialog" aria-modal="true" aria-label={title} className="overlay-enter fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" onClick={onClose}><section className="drawer-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}><header className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><Button type="button" variant="ghost" size="icon" aria-label="Close account editor" onClick={onClose}><X size={18} /></Button></header>{children}</section></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#53615c]">{label}</span>{children}</label>;
}
