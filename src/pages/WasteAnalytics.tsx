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
  const lowest = [...data.categoryShares].sort((a, b) => a.recoveryRate - b.recoveryRate)[0];
  return (
    <div className="space-y-5">
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Generated waste" value={formatKilograms(flow.generatedKg)} detail={data.metadata.periodLabel} icon={Scale} />
        <SummaryCard label="Collected" value={formatKilograms(flow.collectedKg)} detail={`${ratio(flow.collectedKg, flow.generatedKg)}% collection coverage`} icon={PackageCheck} tone="blue" />
        <SummaryCard label="Recovered" value={formatKilograms(flow.recycledKg + flow.reusedKg)} detail={`${data.impactMetrics.diversionRate}% of generated waste`} icon={Recycle} tone="emerald" />
        <SummaryCard label="Lowest recovery" value={`${lowest?.recoveryRate ?? 0}%`} detail={lowest?.category ?? 'No matching category'} icon={CircleGauge} tone="amber" />
      </section>
      <ImpactSummary data={data.impactMetrics} periodLabel={data.metadata.periodLabel} />
      <div className="grid gap-5 xl:grid-cols-2">
      <Panel>
        <SectionHeader title="Waste Stream Performance" eyebrow="Generated / collected / recycled / reused" />
        <div className="h-96"><WasteTrendChart data={data.wasteTrend} /></div>
      </Panel>
      <Panel>
        <SectionHeader title="Regional Collection and Recycling" eyebrow="Coverage comparison" />
        <div className="h-96"><RegionalBarChart data={data.regionalActivity} /></div>
      </Panel>
      <Panel>
        <SectionHeader title="Category Recovery Rates" eyebrow="Low recovery categories need attention" />
        <div className="space-y-4">
          {data.categoryShares.map((item) => (
            <div key={item.category}>
              <div className="mb-1 flex justify-between text-sm font-semibold"><span>{item.category}</span><span>{item.recoveryRate}%</span></div>
              <Progress value={item.recoveryRate} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SectionHeader title="Textile Category Mix" eyebrow="Current sample composition" actions={<BarChart3 size={20} className="text-textile-ocean" />} />
        <div className="h-80"><CategoryDoughnut data={data.categoryShares} /></div>
      </Panel>
      </div>
    </div>
  );
}

function formatKilograms(kilograms: number) { return `${Math.round(kilograms).toLocaleString()} kg`; }
function ratio(value: number, total: number) { return total ? Math.round((value / total) * 100) : 0; }
