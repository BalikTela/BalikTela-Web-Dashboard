import { Activity, Factory, Gauge, PackageCheck } from 'lucide-react';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock } from '../components/StateBlock';
import { StatusBadge } from '../components/StatusBadge';
import type { getDashboardData } from '../services/dashboardService';
import { Panel } from '../components/Panel';
import { Progress } from '../components/ui/progress';
import { SummaryCard } from '../components/SummaryCard';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function Facilities({ data }: { data: Data }) {
  const capacity = data.facilities.reduce((sum, item) => sum + item.capacityKg, 0);
  const processed = data.facilities.reduce((sum, item) => sum + item.processedKg, 0);
  const averageUtilization = Math.round(data.facilities.reduce((sum, item) => sum + item.utilization, 0) / Math.max(data.facilities.length, 1));
  return (
    <div className="space-y-5">
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Active facilities" value={data.facilities.length.toString()} detail="Matching regional and textile filters" icon={Factory} />
        <SummaryCard label="Period capacity" value={`${Math.round(capacity).toLocaleString()} kg`} detail={data.metadata.periodLabel} icon={Gauge} tone="blue" />
        <SummaryCard label="Average utilization" value={`${averageUtilization}%`} detail="Network-wide operating level" icon={Activity} tone={averageUtilization >= 85 ? 'amber' : 'emerald'} />
        <SummaryCard label="Processed volume" value={`${Math.round(processed).toLocaleString()} kg`} detail="Derived from filtered recycling flow" icon={PackageCheck} tone="emerald" />
      </section>
      <Panel>
      <SectionHeader title="Recycling Facilities" eyebrow="Period capacity, allocated intake, filtered recycling output, and processing status" />
      {data.facilities.length ? (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-textile-ink/45">
              <tr><th className="py-2">Facility</th><th>Location</th><th>Accepted types</th><th>Capacity</th><th>Utilization</th><th>Intake</th><th>Processed</th><th>Processing time</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-textile-thread">
              {data.facilities.map((item) => (
                <tr key={item.id} className="data-row">
                  <td className="py-3 font-semibold text-textile-ink">{item.name}</td>
                  <td>{item.location}</td>
                  <td className="max-w-xs">{item.acceptedTypes.join(', ')}</td>
                  <td>{item.capacityKg.toLocaleString()} kg</td>
                  <td><div className="flex items-center gap-2"><Progress value={item.utilization} className="w-24" indicatorClassName={item.utilization >= 85 ? 'bg-amber-500' : undefined} />{item.utilization}%</div></td>
                  <td>{item.intakeKg.toLocaleString()} kg</td>
                  <td>{item.processedKg.toLocaleString()} kg</td>
                  <td>{item.processingTimeDays} days</td>
                  <td><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyBlock />}
      </Panel>
    </div>
  );
}
