import { ArrowUpRight, Building2, ClipboardCheck, Landmark, LockKeyhole, MapPinned, PackageCheck, RefreshCw, Search, ShieldCheck, Scale } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { formatMass } from '../../shared/metrics';
import type { GovernanceData } from '../platformTypes';
import type { Filters } from '../types';
import type { PageKey } from '../DashboardApp';
import { useAuth } from '../context/AuthContext';
import { canAccessPage } from '../access';
import { PageActivity } from '../hooks/PageActivity';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { platformApi } from '../services/platformApi';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { EmptyBlock, LoadingBlock } from '../components/StateBlock';
import { SectionHeader } from '../components/SectionHeader';
import { SummaryCard } from '../components/SummaryCard';
import { cn } from '../lib/utils';

const tabs = [
  { id: 'summary', label: 'Policy Summary', icon: Landmark },
  { id: 'regions', label: 'Regional Performance', icon: MapPinned },
  { id: 'producers', label: 'Producer Evidence', icon: Building2 },
  { id: 'accountability', label: 'Accountability & Methodology', icon: ShieldCheck },
] as const;
type Tab = typeof tabs[number]['id'];
const mass = (value: number | null) => formatMass(value, 'Pending evidence');
const rate = (value: number | null) => value === null ? 'Not available' : `${value}%`;
const cell = 'border-b border-[#e5ebe7] px-3 py-3 align-top';
const table = 'w-full min-w-[900px] text-left text-xs tabular-nums';

export function Governance({ filters, onNavigate }: { filters: Filters; onNavigate: (page: PageKey) => void }) {
  const { user, access } = useAuth();
  const active = useContext(PageActivity);
  const [tab, setTab] = useState<Tab>('summary');
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ key: string; data?: GovernanceData; error?: string }>({ key: '' });
  const key = JSON.stringify([filters, user?.id, user?.role, user?.scope]);
  const current = state.key === key ? state : undefined;
  const data = current?.data;
  useRecordRefresh(() => setRevision(value => value + 1), ['/configuration', '/hubs', '/users', '/material-batches', '/transfers', '/recovery-records', '/barter', '/imports/commit', '/facilities', '/organizations']);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(() => {
      void platformApi.governance({ ...filters }, controller.signal).then(result => {
        if (!controller.signal.aborted) setState({ key, data: result });
      }).catch(error => {
        if (!controller.signal.aborted) setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, error: error.message ?? 'Unable to load policy evidence.' }));
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, key, filters, revision]);
  const link = (page: PageKey, label: string) => canAccessPage(access, page)
    && !(data?.privacy.aggregateOnly && ['materials', 'operations', 'listings', 'transactions'].includes(page))
    && (page !== 'transactions' || access?.permissions.includes('transfers.read'))
    ? <Button type="button" variant="outline" size="sm" onClick={() => onNavigate(page)}>{label}<ArrowUpRight size={14} aria-hidden="true" /></Button> : null;
  if (!data) return current?.error ? <div role="alert" className="border-l-2 border-red-400 p-4 text-sm text-red-700"><p>{current.error}</p><Button className="mt-3" variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />Retry policy evidence</Button></div> : <LoadingBlock label="Loading policy evidence..." />;
  const m = data.monitoring;
  const rows = m.producers.filter(item => `${item.name} ${item.region}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><p className="text-xs font-medium text-emerald-700">GOVERNANCE & POLICY</p><h2 className="mt-1 text-xl font-semibold">Policy monitoring</h2><p className="mt-2 text-xs text-[#66736e]">{m.periodLabel} · Asia/Manila</p><p className="mt-1 text-xs text-[#718079]">{m.summary.batches.toLocaleString()} registered batches · {data.privacy.policy}</p></div>
      <div className="flex shrink-0 items-center gap-2">{link('reports', data.privacy.exportAllowed ? 'Reports & exports' : 'View reports')}<Button type="button" variant="outline" size="icon" title="Refresh policy evidence" aria-label="Refresh policy evidence" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /></Button></div>
    </header>
    {current?.error ? <p role="alert" className="border-l-2 border-amber-500 pl-3 text-xs text-amber-800">Refresh failed: {current.error} Showing the previous result for these filters.</p> : busy ? <p role="status" className="text-xs text-[#66736e]">Refreshing policy evidence...</p> : null}
    <div role="tablist" aria-label="Governance sections" className="flex max-w-full gap-5 overflow-x-auto border-b border-[#dfe5e2]">
      {tabs.map(({ id, label, icon: Icon }, index) => <button key={id} id={`policy-tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`policy-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); setTab(tabs[next].id); document.getElementById(`policy-tab-${tabs[next].id}`)?.focus();
      }} className={cn('flex h-11 shrink-0 items-center gap-2 border-b-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600', tab === id ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-[#66736e] hover:text-[#17201d]')}><Icon size={15} aria-hidden="true" />{label}</button>)}
    </div>
    <section key={tab} id={`policy-panel-${tab}`} role="tabpanel" aria-labelledby={`policy-tab-${tab}`} tabIndex={0} className="section-enter min-w-0 space-y-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
      {tab === 'summary' ? <>
        <div className="stagger-grid grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Validated collection" value={mass(m.summary.collectedKg)} detail="Unique batch intake" icon={PackageCheck} tone="emerald" />
          <SummaryCard label="Recyclable textiles collected" value={mass(m.summary.recyclableCollectedKg)} detail="Recorded classification or consumer-listing assumption; intake required" icon={Scale} />
          <SummaryCard label="Confirmed recovery share" value={rate(m.summary.recoveryShare)} detail="Matched final outcomes / validated collection" icon={ClipboardCheck} />
          <SummaryCard label="Intake evidence coverage" value={rate(m.summary.intakeCoverage)} detail={`${m.summary.batches - m.summary.missingIntake} of ${m.summary.batches} batches`} icon={ShieldCheck} />
        </div>
        <section className="border-y border-[#dfe5e2] py-5"><SectionHeader title="Period comparison" eyebrow={m.comparisonLabel ? `Previous cohort: ${m.comparisonLabel}` : 'No prior comparison window'} actions={link('waste', 'Waste analytics')} />
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm tabular-nums" aria-label="Policy period comparison"><thead><tr className="text-xs text-[#66736e]"><th className={cell}>Indicator</th><th className={cell}>Selected cohort</th><th className={cell}>Previous cohort</th></tr></thead><tbody>{[
            ['Validated collection', mass(m.summary.collectedKg), mass(m.previous.collectedKg)],
            ['Confirmed reuse', mass(m.summary.reusedKg), mass(m.previous.reusedKg)],
            ['Confirmed recycling output', mass(m.summary.recycledKg), mass(m.previous.recycledKg)],
            ['Confirmed recovery share', rate(m.summary.recoveryShare), rate(m.previous.recoveryShare)],
            ['Completed transfers', String(m.summary.completedTransfers), String(m.previous.completedTransfers)],
          ].map(([label, currentValue, prior]) => <tr key={label}><th scope="row" className={`${cell} font-medium`}>{label}</th><td className={cell}>{currentValue}</td><td className={cell}>{m.comparisonLabel ? prior : 'Not available'}</td></tr>)}</tbody></table></div>
          <p className="mt-3 text-xs leading-5 text-[#66736e]">Registration cohorts, with outcomes recorded through {new Date(m.asOf).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT. A current partial month is not a full-month throughput comparison.</p>
        </section>
        <section><SectionHeader title="Evidence requiring attention" actions={link('quality', 'Data quality')} /><dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{[
          ['Missing validated intake', `${m.summary.missingIntake} batches`], ['Conflicting allocations', `${m.summary.conflicts} findings`],
          ['Recovery unconfirmed', m.summary.collectedKg === null ? 'Pending evidence' : mass(m.summary.unconfirmedCollectedKg)], ['Participating source organizations', String(m.participatingOrganizations)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-[#66736e]">{label}</dt><dd className="mt-2 text-lg font-semibold">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-5 text-[#66736e]">Unconfirmed recovery may include stock, rejects, losses or missing records. It is not measured landfill waste.</p></section>
        <section className="border-t border-[#dfe5e2] pt-5"><SectionHeader title="Hub disposal oversight" actions={link('operations', 'Recovery Monitoring')} /><dl className="grid gap-5 sm:grid-cols-3"><Fact label="Recorded disposal" value={m.hubDisposals.available ? mass(m.hubDisposals.disposedKg) : 'Feed unavailable'} /><Fact label="Disposal records" value={m.hubDisposals.available ? String(m.hubDisposals.records) : 'Not available'} /><Fact label="Landfill diversion" value="Not established" /></dl><p className="mt-4 text-xs leading-5 text-[#66736e]">Includes archived disposal history. Disposal does not establish reuse, recycling or landfill avoidance.{m.hubDisposals.invalidRecords ? ` ${m.hubDisposals.invalidRecords} invalid disposal records are excluded.` : ''}</p></section>
      </> : null}
      {tab === 'regions' ? <>
        <SectionHeader title="Regional performance" eyebrow="Registered batch origins; not national waste estimates" actions={link('geographic', 'Geographic insights')} />
        {m.regions.length ? <PaginatedRecords rows={m.regions} resetKey={key} label="Policy regions">{pageRows => <div className="overflow-x-auto"><table className={table} aria-label="Regional policy performance"><thead><tr className="bg-[#f3f7f5] text-[#66736e]">{['Region', 'Collected (t)', 'Previous (t)', 'Change', 'Reuse (t)', 'Recycling output (t)', 'Recovery share', 'Missing intake', 'Sources'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead><tbody>{pageRows.map(row => <tr key={row.region}><th scope="row" className={`${cell} min-w-40 font-medium`}>{row.region}</th><td className={cell}>{mass(row.collectedKg)}</td><td className={cell}>{mass(row.previousCollectedKg)}</td><td className={cell}>{row.collectionChangePercent === null ? 'No comparable baseline' : `${row.collectionChangePercent > 0 ? '+' : ''}${row.collectionChangePercent}%`}</td><td className={cell}>{mass(row.reusedKg)}</td><td className={cell}>{mass(row.recycledKg)}</td><td className={cell}>{rate(row.recoveryShare)}</td><td className={cell}>{row.missingIntake}</td><td className={cell}>{row.participatingSources}</td></tr>)}</tbody></table></div>}</PaginatedRecords> : <EmptyBlock label="No regional activity matches the selected cohort." />}
        <section className="border-t border-[#dfe5e2] pt-5"><SectionHeader title="Hub participation and coverage" /><div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-xs tabular-nums" aria-label="Regional Hub coverage"><thead><tr className="text-[#66736e]">{['Region', 'Participating approved Hubs', 'Historical listing-weighed batches', 'Registered Hubs'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead><tbody>{m.regions.map(row => <tr key={row.region}><th className={`${cell} font-medium`} scope="row">{row.region}</th><td className={cell}>{row.approvedHubs}</td><td className={cell}>{row.hubWeighedBatches}</td><td className={cell}>{row.facilities}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs leading-5 text-[#66736e]">Hubs collect and dispose textiles. Historical listing weighing does not establish physical collection. Only regions with selected batch activity appear; participation and registered Hubs do not prove regional service coverage.</p></section>
      </> : null}
      {tab === 'producers' ? <>
        <SectionHeader title="Producer reporting evidence" eyebrow="Preparation only; no statutory compliance certification" actions={link('reports', 'Review supporting reports')} />
        <p className="text-sm leading-6 text-[#66736e]">{m.producerNamesRestricted ? 'Producer identities are withheld. Values are grouped by source region.' : 'Source organizations are grouped by region. Downstream outcomes remain linked to their original batches.'} These records may inform producer-responsibility discussions; they are not official EPR compliance evidence without formal authorization.</p>
        <label className="relative block max-w-sm"><span className="sr-only">Search producer evidence</span><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-400" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={m.producerNamesRestricted ? 'Search region' : 'Search organization or region'} className="pl-9" /></label>
        {rows.length ? <PaginatedRecords rows={rows} resetKey={`${key}:${search}`} label="Producer evidence">{pageRows => <div className="overflow-x-auto"><table className={table} aria-label="Producer policy evidence"><thead><tr className="bg-[#f3f7f5] text-[#66736e]">{['Source group', 'Region', 'Batches', 'Declared (t)', 'Collected (t)', 'Reuse (t)', 'Recycling output (t)', 'Missing intake', 'Conflicts'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead><tbody>{pageRows.map(row => <tr key={row.key}><th scope="row" className={`${cell} min-w-52 font-medium`}>{row.name}<span className="mt-1 block text-[11px] font-normal text-[#718079]">{row.sources} source {row.sources === 1 ? 'account' : 'accounts'}</span></th><td className={cell}>{row.region}</td><td className={cell}>{row.batches}</td><td className={cell}>{mass(row.declaredKg)}</td><td className={cell}>{mass(row.collectedKg)}</td><td className={cell}>{mass(row.reusedKg)}</td><td className={cell}>{mass(row.recycledKg)}</td><td className={cell}>{row.missingIntake}</td><td className={cell}>{row.conflicts}</td></tr>)}</tbody></table></div>}</PaginatedRecords> : <EmptyBlock label="No producer source groups match these filters and search." />}
        <p className="border-l-2 border-amber-400 pl-3 text-xs leading-5 text-[#66736e]">Collection, transfer completion and final recovery are separate evidence stages. Source declarations and recyclable classifications do not establish recycling output. Producer totals need not equal platform totals because other participant roles can originate batches.</p>
      </> : null}
      {tab === 'accountability' ? <>
        <SectionHeader title="Accountability & methodology" eyebrow="Evidence sources, access boundaries, and reporting limitations" />
        <section className="border-y border-[#dfe5e2] py-5"><h3 className="text-sm font-semibold">Supporting records</h3><div className="mt-4 flex flex-wrap gap-2">{link('materials', 'Material registry')}{link('transactions', 'Traceability')}{link('operations', 'Recovery monitoring')}{link('quality', 'Data quality')}{link('audit', 'Audit trail')}{link('reports', 'Reports')}</div><p className="mt-3 text-xs leading-5 text-[#66736e]">{m.quality.totalIssues} quality findings · {m.quality.critical} critical · {m.quality.warnings} warnings. Findings can overlap on the same batch. Configured discrepancy threshold: {m.quality.thresholdPercent}%.</p><p className="mt-2 text-xs leading-5 text-[#66736e]">{m.evidence.reportedReceiptTransfers} completed transfers use reported receipt weights; {m.evidence.missingTransferWeights} have no final weight. {mass(m.evidence.unlinkedOutcomeKg)} of final outcomes lacks matched intake and is excluded from the recovery-share numerator. {m.evidence.missingGeography} batches lack complete structured locations.</p></section>
        <section className="border-b border-[#dfe5e2] pb-5"><div className="flex items-center gap-2"><LockKeyhole size={17} className="text-emerald-700" /><h3 className="text-sm font-semibold">Privacy and scope</h3></div><dl className="mt-4 grid gap-4 sm:grid-cols-3"><Fact label="Current role" value={data.privacy.role} /><Fact label="Access boundary" value={data.privacy.aggregateOnly ? 'Aggregate / de-identified' : 'Authorized operational scope'} /><Fact label="Report export" value={data.privacy.exportAllowed ? 'Permitted' : 'Not assigned'} /></dl><p className="mt-3 text-xs leading-5 text-[#66736e]">Government and aggregate-only views withhold producer identities. Report generation and export permissions are checked separately; operational weights cannot be edited from this page.</p></section>
        <section><h3 className="text-sm font-semibold">Calculation methodology</h3><Badge variant="outline" className="mt-3 max-w-full whitespace-normal break-words text-amber-800">{data.methodology.version}</Badge><dl className="mt-4 space-y-4">{[['Mass accounting', data.methodology.massAccounting], ['Environmental impact', data.methodology.environmentalImpact], ['Predictive analytics', data.methodology.predictiveAnalytics]].map(([label, text]) => <div key={label}><dt className="text-xs font-semibold">{label}</dt><dd className="mt-1 text-xs leading-5 text-[#66736e]">{text}</dd></div>)}</dl></section>
        <section className="border-t border-[#dfe5e2] pt-5"><SectionHeader title="Policy Indicator Readiness" eyebrow="Reporting boundaries, not certification scores" /><div className="divide-y divide-[#dfe5e2]">{data.policyIndicators.map(item => <article key={item.label} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]"><div><h4 className="text-sm font-medium">{item.label}</h4><p className="mt-1 max-w-3xl text-xs leading-5 text-[#66736e]">{item.caveat}</p></div><Badge variant="outline" className="h-fit w-fit">{item.status}</Badge></article>)}</div></section>
        <section className="border-t border-[#dfe5e2] pt-5"><h3 className="text-sm font-semibold">Reporting notes</h3><ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-5 text-[#66736e]">{m.notes.map(note => <li key={note}>{note}</li>)}</ul></section>
      </> : null}
    </section>
    <footer className="flex flex-col gap-2 border-t border-[#dfe5e2] pt-4 text-[11px] leading-5 text-[#718079] sm:flex-row sm:justify-between"><span>PoC reporting combines scenario and operational records; source provenance is retained.</span><span>No compliance certification issued</span></footer>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-[#66736e]">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>;
}
