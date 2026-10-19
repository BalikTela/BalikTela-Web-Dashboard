import { formatMass } from '../../shared/metrics';
import { FacilityUtilizationChart, CategoryDoughnut, WasteTrendChart } from '../components/Charts';
import { CircularFlow } from '../components/CircularFlow';
import { EmptyBlock } from '../components/StateBlock';
import { MetricCard } from '../components/MetricCard';
import { PhilippinesMapMock } from '../components/PhilippinesMapMock';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { PlatformEngagement } from '../components/PlatformEngagement';
import { Panel } from '../components/Panel';
import type { getDashboardData } from '../services/dashboardService';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function Overview({ data }: { data: Data }) {
  const highestGap = [...data.regionalActivity].sort((a, b) => b.wasteGapKg - a.wasteGapKg)[0];
  const lowestRecovery = data.categoryShares.filter(item => item.recoveryRateAvailable !== false).sort((a, b) => a.recoveryRate - b.recoveryRate)[0];
  const spareFacility = [...data.facilities].sort((a, b) => a.utilization - b.utilization)[0];
  const insights = [
    highestGap ? [`${highestGap.region}: outcome evidence review`, `${formatMass(highestGap.wasteGapKg)} of declared mass has no confirmed reuse or recycling outcome. This is an evidence gap, not measured landfill waste.`] : null,
    lowestRecovery ? [`${lowestRecovery.category}: confirmed recovery share`, `${lowestRecovery.recoveryRate}% of validated collection has a confirmed final outcome in this registration cohort.`] : null,
    spareFacility ? [`${spareFacility.name}: capacity review`, spareFacility.utilization > 100 ? `${spareFacility.utilization}% utilization exceeds prorated period capacity; review intake and capacity records.` : `${Number((100 - spareFacility.utilization).toFixed(1))}% of prorated period capacity remains available for compatible intake.`] : null,
  ].filter((item): item is [string, string] => item !== null);
  if (!['Administrator', 'Government', 'Researcher'].includes(data.operations.scope.role)) return <div className="space-y-6"><OperationalSnapshot data={data} /><OperationalRoleDetail data={data} /></div>;
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0"><p className="text-sm font-semibold text-[#17201d]">Program Analytics</p><p className="mt-1 text-xs leading-5 text-[#718079]">Shared material flow, recovery evidence, and participation</p></div>
          <p className="shrink-0 rounded-md border border-[#dfe5e2] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#53615c]">{data.metadata.periodLabel}</p>
        </div>
        <div className="stagger-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:auto-rows-[minmax(132px,auto)] xl:grid-cols-4 2xl:grid-cols-6">
          {data.kpis.map((metric, index) => <MetricCard key={metric.label} metric={metric} featured={index === 0} sparkline={index === 0 && data.circularFlow.collectedAvailable !== false ? data.wasteTrend.map((point) => point.hasCollectionEvidence === false ? null : point.collected) : undefined} sparklineStart={data.wasteTrend[0]?.month ?? 'Start'} sparklineEnd={data.wasteTrend[data.wasteTrend.length - 1]?.month ?? 'Current'} />)}
        </div>
        {data.materialEvidence ? <div className="mt-4 border-l-2 border-slate-300 pl-4 text-xs leading-5 text-slate-600">
          <p className="font-semibold text-slate-800">Evidence coverage</p>
          {data.sharedActivity?.demoBatches ? <p>Includes {data.sharedActivity.demoBatches} synthetic demo batches and {data.sharedActivity.operationalBatches} operational batches. Demo figures are illustrative, not measured national totals.</p> : null}
          <p>{data.materialEvidence.missingCollectionBatches} batches await validated intake evidence. {data.materialEvidence.completedReportedWeight} completed transfers use reported receipt weights; {data.materialEvidence.completedMissingWeight} have no final weight and are excluded from transfer mass.</p>
          <p>Hub intake establishes collection, not diversion. Only validated final outcomes establish reuse or recycling; landfill avoidance remains uncalculated.</p>
          {data.materialEvidence.collectionConflicts + data.materialEvidence.outcomeConflicts > 0 ? <p className="mt-1 text-amber-800">{data.materialEvidence.collectionConflicts} collection and {data.materialEvidence.outcomeConflicts} outcome batch allocations need review. Ambiguous mass is withheld, not capped.</p> : null}
          {data.materialEvidence.unlinkedOutcomeKg > 0 ? <p>{formatMass(data.materialEvidence.unlinkedOutcomeKg)} of confirmed outcomes has no matching validated intake and is excluded from the recovery-share numerator.</p> : null}
          <p className="mt-1">Dates select batch registration; charts group that cohort by registration month, with outcomes known as of {new Date(data.metadata.period.asOf).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}.</p>
        </div> : null}
      </section>

      <OperationalSnapshot data={data} supporting />

      {data.sharedActivity ? <section className="border-y border-slate-200 py-5" aria-label="Shared platform activity">
        <SectionHeader title="Shared Platform Activity" eyebrow={`${data.sharedActivity.operationalBatches} operational batches · ${data.sharedActivity.demoBatches} demo batches in the selected cohort`} />
        <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">{[
          ['Material listings', data.sharedActivity.listings], ['Pending / revised requests', data.sharedActivity.pendingRequests],
          ['Hub-weighed batches', data.sharedActivity.hubWeighedBatches], ['Completed transfers', data.sharedActivity.completedTransfers],
        ].map(([label, count]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{Number(count).toLocaleString()}</dd></div>)}</dl>
        <p className="mt-4 text-xs leading-5 text-slate-500">{data.sharedActivity.completionAwaitingVerification} completed transfers have no independent validation weight. Transfer completion alone does not prove reuse, recycling or diversion. {data.sharedActivity.missingGeography ? `${data.sharedActivity.missingGeography} batches have incomplete structured location data.` : ''}</p>
      </section> : null}

      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel>
          <SectionHeader title="Textile Evidence Trend" eyebrow="Registration-month cohorts · gaps indicate missing evidence" />
          <div className="h-64 sm:h-72"><WasteTrendChart data={data.wasteTrend} /></div>
        </Panel>
        <Panel>
          <SectionHeader title="Collected Textile Categories" eyebrow="Validated intake only" />
          <div className="h-64 sm:h-72"><CategoryDoughnut data={data.categoryShares} /></div>
        </Panel>
      </section>

      <section className="border-y border-slate-200 py-5">
        <SectionHeader title="Material Evidence Summary" eyebrow="Stage totals overlap; they are not additive flows" />
        <CircularFlow data={data.circularFlow} />
        <p className="mt-3 text-xs leading-5 text-slate-500">Unconfirmed collected mass may include stock, losses, rejects or missing outcome records; it is not automatically landfill disposal. {data.metadata.denominatorNote}</p>
      </section>

      <PlatformEngagement data={data.engagementMetrics} periodLabel={data.metadata.periodLabel} />

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <SectionHeader title="Philippine Regional Activity" eyebrow="Recorded regional activity" />
          <PhilippinesMapMock regions={data.regionalActivity} />
        </Panel>
        <Panel>
          <SectionHeader title="Recycler Capacity and Utilization" eyebrow="Operational signal" />
          <div className="h-80 sm:h-96"><FacilityUtilizationChart data={data.facilities} /></div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel>
          <SectionHeader title="Recent Transactions" eyebrow="Latest recorded lifecycle states" />
          {data.transactions.length ? (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.12em] text-textile-ink/45">
                  <tr><th className="py-2">ID</th><th>Source</th><th>Type</th><th>Weight</th><th>Status</th><th>Evidence</th></tr>
                </thead>
                <tbody className="divide-y divide-textile-thread">
                  {data.transactions.slice(0, 5).map((item) => (
                    <tr key={item.id} className="data-row">
                      <td className="py-3 font-semibold text-textile-ink">{item.id}</td>
                      <td>{item.source}</td>
                      <td>{item.type}</td>
                      <td>{formatMass(item.weightKg)}<p className="text-xs text-slate-500">{item.weightEvidence}</p></td>
                      <td><StatusBadge status={item.status} /></td>
                      <td className="text-textile-ink/65">{item.status === 'Completed' ? 'Lifecycle recorded' : 'Outcome pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyBlock />}
        </Panel>
        <Panel>
          <SectionHeader title="Monitoring Notes" eyebrow="Evidence and capacity review" />
          <div className="space-y-3">
            {insights.map(([title, body]) => (
              <article key={title} className="border-l-2 border-emerald-600 py-1 pl-4">
                <p className="font-semibold text-textile-ink">{title}</p>
                <p className="mt-1 text-sm leading-6 text-textile-ink/62">{body}</p>
              </article>
            ))}
            {!insights.length ? <EmptyBlock label="No recommendation cues match the current filters." /> : null}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function OperationalRoleDetail({ data }: { data: Data }) {
  const { massBalance, quality, environmentalImpact } = data.operations;
  const stages = [['Declared', massBalance.declaredKg], ['Handed over', massBalance.handedOverKg], ['Received', massBalance.receivedKg], ['Verified completion', massBalance.verifiedKg]] as const;
  return <><section className="surface-panel rounded-md p-5"><SectionHeader title="Organization Material Evidence" eyebrow="Role-scoped operational records from the shared backend" /><div className="grid gap-px overflow-hidden rounded-md border border-[#dfe5e2] bg-[#dfe5e2] sm:grid-cols-2 xl:grid-cols-4">{stages.map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-xs text-[#66736e]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{formatMass(value)}</p></div>)}</div><p className="mt-4 text-xs text-[#718079]">Recorded discrepancy balance: {massBalance.discrepancyKg > 0 ? '+' : ''}{formatMass(massBalance.discrepancyKg)}. Variances remain documented rather than silently removed.</p></section><section className="grid gap-5 lg:grid-cols-2"><div className="border-y border-[#dfe5e2] py-5"><h3 className="text-sm font-semibold">Measurement quality</h3><div className="mt-4 grid grid-cols-3 gap-3"><Quality label="Estimated" value={quality.estimatedBatches} /><Quality label="Measured" value={quality.measuredBatches} /><Quality label="Verified" value={quality.verifiedBatches} /></div></div><div className="border-y border-[#dfe5e2] py-5"><h3 className="text-sm font-semibold">Environmental methodology</h3><p className="mt-3 text-sm text-amber-800">{environmentalImpact.status}. This organization view reports material mass and lifecycle evidence only.</p></div></section></>;
}
function Quality({ label, value }: { label: string; value: number }) { return <div><p className="text-[10px] uppercase text-[#8b9893]">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>; }

function OperationalSnapshot({ data, supporting = false }: { data: Data; supporting?: boolean }) {
  const operations = data.operations;
  const role = operations.scope.role;
  const copy: Record<string, [string, string]> = {
    Administrator: ['System oversight', 'National demo operations, data integrity, institutional access, and governance.'],
    Government: ['Policy monitoring', 'Aggregate, de-identified indicators for program monitoring and policy preparation.'],
    Researcher: ['Research and M&E', 'Aggregate evidence, validation coverage, and documented methodology constraints.'],
    Producer: ['Producer workspace', 'Organization-scoped material declarations, outgoing transfers, and verified outcomes.'],
    Recycler: ['Recycler workspace', 'Organization-scoped receipts, validation, facility intake, and recovery outcomes.'],
    'LGU/Collection Point': ['Collection workspace', 'Authorized collection events, custody transitions, and regional service coverage.'],
    Upcycler: ['Upcycler workspace', 'Authorized material intake, transformation records, and validated circular outcomes.'],
  };
  const [title, description] = copy[role] ?? ['Authorized workspace', 'Role-scoped BalikTela operational indicators.'];
  const metrics = [
    ['Declared material', `${formatMass(operations.metrics.declaredKg)}`, `${operations.metrics.batchCount} unique material batches`],
    ['Verified completion', `${formatMass(operations.metrics.verifiedKg)}`, `${operations.metrics.completedTransfers} completed transfers`],
    ['Active transfers', operations.metrics.activeTransfers.toLocaleString(), 'Reserved through validation'],
    ['Data quality flags', operations.quality.discrepancyFlags.toLocaleString(), `${operations.quality.estimatedBatches} estimated batches`],
  ];
  return <section className={supporting ? 'border-y border-[#dfe5e2] py-5' : 'overflow-hidden rounded-md border border-[#cfdad5] bg-white'}>
    <header className={supporting ? 'flex flex-col gap-3 pb-4 sm:flex-row sm:items-end sm:justify-between' : 'flex flex-col gap-3 border-b border-[#dfe5e2] p-5 sm:flex-row sm:items-end sm:justify-between'}>
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">{role.toUpperCase()} VIEW</p><h2 className="mt-1 text-base font-semibold text-[#17201d]">{title}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[#718079]">{description}</p></div>
      <p className="shrink-0 text-xs text-[#66736e]">{operations.period.label}</p>
    </header>
    <div className={supporting ? 'grid overflow-hidden rounded-md border border-[#dfe5e2] bg-[#dfe5e2] sm:grid-cols-2 xl:grid-cols-4' : 'grid sm:grid-cols-2 xl:grid-cols-4'}>{metrics.map(([label, value, detail], index) => <div key={label} className={supporting ? 'bg-white p-4' : 'border-b border-r-0 border-[#e7ece9] p-5 sm:border-r xl:border-b-0 xl:last:border-r-0'}><p className="text-xs text-[#66736e]">{label}</p><p className={index === 0 && !supporting ? 'mt-2 text-3xl font-semibold tabular-nums text-[#17201d]' : 'mt-2 text-2xl font-semibold tabular-nums text-[#17201d]'}>{value}</p><p className="mt-1 text-xs text-[#718079]">{detail}</p></div>)}</div>
    <footer className={supporting ? 'pt-3 text-xs text-[#66736e]' : 'border-t border-[#e7ece9] bg-[#f8faf9] px-5 py-3 text-xs text-[#66736e]'}>{operations.metrics.denominator}. Environmental equivalents remain disabled pending an approved methodology.</footer>
  </section>;
}
