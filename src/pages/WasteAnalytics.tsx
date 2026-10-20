import { formatMass, MATERIAL_METRIC_LABELS } from '../../shared/metrics';
import { BarChart3, CircleGauge, PackageCheck, Recycle, Scale } from 'lucide-react';
import { CategoryDoughnut, RegionalBarChart, WasteTrendChart } from '../components/Charts';
import { SectionHeader } from '../components/SectionHeader';
import type { getDashboardData } from '../services/dashboardService';
import { Panel } from '../components/Panel';
import { Progress } from '../components/ui/progress';
import { SummaryCard } from '../components/SummaryCard';
import { ImpactSummary } from '../components/ImpactSummary';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function WasteAnalytics({ data }: { data: Data }) {
  const flow = data.circularFlow;
  const lowest = data.categoryShares.filter(item => item.recoveryRateAvailable !== false).sort((a, b) => a.recoveryRate - b.recoveryRate)[0];
  return (
    <div className="space-y-5">
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={MATERIAL_METRIC_LABELS.declared} value={formatMass(flow.generatedKg)} detail="Reported batch weights in the selected scope" icon={Scale} />
        <SummaryCard label={MATERIAL_METRIC_LABELS.received} value={flow.collectedAvailable === false ? 'Pending evidence' : formatMass(flow.collectedKg)} detail="Supported physical intake, not declared weight" icon={PackageCheck} tone="blue" />
        <SummaryCard label="Confirmed outcomes" value={flow.recycledAvailable === false && flow.reusedAvailable === false ? 'Pending evidence' : formatMass(flow.recycledKg + flow.reusedKg)} detail={data.impactMetrics.diversionRate !== null ? `${data.impactMetrics.diversionRate}% of physically received textiles (linked outcomes)` : 'Recovery share unavailable'} icon={Recycle} tone="emerald" />
        <SummaryCard label="Lowest confirmed share" value={lowest ? `${lowest.recoveryRate}%` : 'Not available'} detail={lowest?.category ?? 'No supported category rate'} icon={CircleGauge} tone="amber" />
      </section>
      <ImpactSummary data={data.impactMetrics} periodLabel={data.metadata.periodLabel} />
      <div className="grid gap-5 xl:grid-cols-2">
      <Panel>
        <SectionHeader title="Textile Evidence Trend" eyebrow="Batch-registration cohorts · missing evidence is not zero" />
        <div className="h-96"><WasteTrendChart data={data.wasteTrend} /></div>
      </Panel>
      <Panel>
        <SectionHeader title="Regional Receipts and Recycling" eyebrow="Supported physical intake and final output" />
        <div className="h-96"><RegionalBarChart data={data.regionalActivity} /></div>
      </Panel>
      <Panel>
        <SectionHeader title="Category Recovery Rates" eyebrow="Low recovery categories need attention" />
        <div className="space-y-4">
          {data.categoryShares.map((item) => (
            <div key={item.category}>
              <div className="mb-1 flex justify-between gap-3 text-sm font-semibold"><span>{item.category}</span><span>{item.recoveryRateAvailable === false ? 'Not available' : `${item.recoveryRate}%`}</span></div>
              {item.recoveryRateAvailable !== false ? <Progress value={item.recoveryRate} /> : <p className="text-xs text-slate-500">Supported physical receipt and linked final outcomes required.</p>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SectionHeader title="Textile Category Mix" eyebrow="Physically received material composition" actions={<BarChart3 size={20} className="text-textile-ocean" />} />
        <div className="h-80"><CategoryDoughnut data={data.categoryShares} /></div>
      </Panel>
      </div>
    </div>
  );
}
