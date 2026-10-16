import { percentage } from '../../shared/metrics';
import { useState } from 'react';
import { FacilityUtilizationChart, RegionalBarChart, WasteTrendChart } from '../components/Charts';
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
  const completed = data.transactions.filter((item) => item.status === 'Completed').length;
  const lowRecovery = [...data.categoryShares].sort((a, b) => a.recoveryRate - b.recoveryRate)[0];
  const highUtilization = [...data.facilities].sort((a, b) => b.utilization - a.utilization)[0];
  return (
    <div className="section-enter space-y-6">
      <div className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DiagnosticMetric label="Waste recovered" value={`${data.impactMetrics.diversionRate}%`} detail="Reused + recycled / generated in selected period" />
        <DiagnosticMetric label="Transactions completed" value={data.transactions.length ? `${percentage(completed, data.transactions.length)}%` : 'Not available'} detail={`${completed} of ${data.transactions.length} sample records`} />
        <DiagnosticMetric label="Highest utilization" value={`${highUtilization?.utilization ?? 0}%`} detail={highUtilization?.name ?? 'No matching facility'} warning />
        <DiagnosticMetric label="Lowest recovery" value={`${lowRecovery?.recoveryRate ?? 0}%`} detail={lowRecovery?.category ?? 'No matching category'} warning />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartSection title="Waste and recovery trend"><div className="h-72"><WasteTrendChart data={data.wasteTrend} /></div></ChartSection>
        <ChartSection title="Recycling by region"><div className="h-72"><RegionalBarChart data={data.regionalActivity} /></div></ChartSection>
        <ChartSection title="Recycler utilization" className="xl:col-span-2"><div className="h-72"><FacilityUtilizationChart data={data.facilities} /></div></ChartSection>
      </div>
    </div>
  );
}

function DiagnosticMetric({ label, value, detail, warning = false }: { label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className={cn('mt-1 text-2xl font-semibold', warning ? 'text-amber-700' : 'text-slate-950')}>{value}</p><p className="mt-1 truncate text-xs text-slate-500">{detail}</p></div>;
}

function ChartSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={cn('min-w-0 border-t border-slate-200 pt-4', className)}><h3 className="mb-3 text-sm font-medium text-slate-700">{title}</h3>{children}</section>;
}
