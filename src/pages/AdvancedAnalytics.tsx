import { formatMass, percentage } from '../../shared/metrics';
import { useState } from 'react';
import { isCompletedTransfer } from '../../shared/workflows';
import { PaginatedRecords } from '../components/PaginatedRecords';
import { SectionHeader } from '../components/SectionHeader';
import type { getDashboardData } from '../services/dashboardService';
import { Panel } from '../components/Panel';
import { cn } from '../lib/utils';
import { PredictiveAnalytics } from '../components/PredictiveAnalytics';

type Data = Awaited<ReturnType<typeof getDashboardData>>;
type Tab = 'Diagnostic' | 'Predictive';

export function AdvancedAnalytics({ data, onModeChange }: { data: Data; onModeChange?: (mode: Tab) => void }) {
  const [tab, setTab] = useState<Tab>('Diagnostic');
  return (
    <Panel>
      <SectionHeader
        title="Advanced Analytics"
        eyebrow="Diagnostic and predictive views"
        actions={
          <div className="flex flex-wrap rounded-md bg-slate-100 p-1">
            {(['Diagnostic', 'Predictive'] as Tab[]).map((item) => (
              <button key={item} type="button" aria-pressed={tab === item} onClick={() => { setTab(item); onModeChange?.(item); }} className={cn('h-8 rounded px-3 text-sm font-medium transition-colors', tab === item ? 'bg-white text-slate-950 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900')}>{item}</button>
            ))}
          </div>
        }
      />
      {tab === 'Diagnostic' ? <Diagnostic data={data} /> : null}
      {tab === 'Predictive' ? <PredictiveAnalytics /> : null}
    </Panel>
  );
}

function Diagnostic({ data }: { data: Data }) {
  const completed = data.sharedActivity?.completedTransfers ?? data.transactions.filter((item) => isCompletedTransfer(item.status)).length;
  const transferCount = data.sharedActivity?.transferCount ?? data.transactions.length;
  const lowRecovery = data.categoryShares.filter(item => item.recoveryRateAvailable !== false).sort((a, b) => a.recoveryRate - b.recoveryRate)[0];
  const highUtilization = [...data.facilities].sort((a, b) => b.utilization - a.utilization)[0];
  return (
    <div className="section-enter space-y-6">
      <div className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DiagnosticMetric label="Intake evidence pending" value={String(data.materialEvidence?.missingCollectionBatches ?? 0)} detail="Batches without supported physical receipt evidence" warning />
        <DiagnosticMetric label="Transactions completed" value={transferCount ? `${percentage(completed, transferCount)}%` : 'Not available'} detail={`${completed} of ${transferCount} scoped transfers, including closed states`} />
        <DiagnosticMetric label="Highest utilization" value={highUtilization?.capacityKg ? `${highUtilization.utilization}%` : 'Not available'} detail={highUtilization?.name ?? 'No matching facility'} warning />
        <DiagnosticMetric label="Lowest confirmed share" value={lowRecovery ? `${lowRecovery.recoveryRate}%` : 'Not available'} detail={lowRecovery?.category ?? 'No supported category rate'} warning />
      </div>
      <section className="border-t border-slate-200 pt-4"><h3 className="mb-3 text-sm font-semibold">Recovery evidence by material</h3>
        <PaginatedRecords rows={data.categoryShares} resetKey={data.metadata.periodLabel}>{rows => <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead><tr><th>Material</th><th>Physically received</th><th>Confirmed recovery share</th><th>Evidence</th></tr></thead><tbody className="divide-y divide-slate-200">{rows.map(item => <tr key={item.category}><td className="py-3 font-medium">{item.category}</td><td>{formatMass(item.kilograms)}</td><td>{item.recoveryRateAvailable === false ? 'Not available' : `${item.recoveryRate}%`}</td><td>{item.recoveryRateAvailable === false ? 'Matching physical receipt and final outcome required' : 'Matched final output / physically received weight'}</td></tr>)}</tbody></table></div>}</PaginatedRecords>
      </section>
      <section className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2"><DiagnosticMetric label="Received textiles without confirmed recovery" value={formatMass(data.materialEvidence?.unresolvedCollectedKg ?? data.circularFlow.residualKg)} detail="May include stock, rejects, losses or missing outcome evidence; not measured landfill disposal" /><DiagnosticMetric label="Confirmed recovery share" value={data.impactMetrics.diversionRate === null ? 'Not available' : `${data.impactMetrics.diversionRate}%`} detail="Matched final outputs / physically received weight; unlinked outputs are excluded" /></section>
    </div>
  );
}

function DiagnosticMetric({ label, value, detail, warning = false }: { label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="min-w-0 rounded-md bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className={cn('mt-1 break-words text-2xl font-semibold', warning ? 'text-amber-700' : 'text-slate-950')}>{value}</p><p className="mt-1 break-words text-xs leading-5 text-slate-500">{detail}</p></div>;
}
