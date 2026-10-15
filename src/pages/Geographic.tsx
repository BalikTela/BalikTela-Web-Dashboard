import { Factory, MapPin, Recycle, TriangleAlert } from 'lucide-react';
import { RegionalBarChart } from '../components/Charts';
import { PhilippinesMapMock } from '../components/PhilippinesMapMock';
import { SectionHeader } from '../components/SectionHeader';
import type { getDashboardData } from '../services/dashboardService';
import { Panel } from '../components/Panel';
import { SummaryCard } from '../components/SummaryCard';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function Geographic({ data }: { data: Data }) {
  const highGap = [...data.regionalActivity].sort((a, b) => b.wasteGapKg - a.wasteGapKg);
  const collectionPoints = data.regionalActivity.reduce((sum, item) => sum + item.collectionPoints, 0);
  const recyclers = data.regionalActivity.reduce((sum, item) => sum + item.recyclers, 0);
  const recycled = data.regionalActivity.reduce((sum, item) => sum + item.recyclingKg, 0);
  return (
    <div className="space-y-5">
      <section className="stagger-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Regions covered" value={data.regionalActivity.length.toString()} detail="Current pilot footprint" icon={MapPin} />
        <SummaryCard label="Collection points" value={collectionPoints.toString()} detail="Across participating cities" icon={Factory} tone="blue" />
        <SummaryCard label="Recycler network" value={recyclers.toString()} detail="Mapped processing partners" icon={Recycle} tone="emerald" />
        <SummaryCard label="Largest coverage gap" value={`${Math.round(highGap[0]?.wasteGapKg ?? 0).toLocaleString()} kg`} detail={highGap[0]?.region ?? 'No matching region'} icon={TriangleAlert} tone="amber" />
      </section>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <SectionHeader title="Philippines Textile Activity" eyebrow="Producers, collection points, recyclers, and textile activity" />
          <PhilippinesMapMock regions={data.regionalActivity} />
        </Panel>
        <div className="space-y-5">
          <Panel>
            <SectionHeader title="Regional Performance" eyebrow={`${Math.round(recycled).toLocaleString()} kg total recycled in the sample period`} />
            <div className="h-72"><RegionalBarChart data={data.regionalActivity} /></div>
          </Panel>
          <Panel>
            <SectionHeader title="High Waste / Low Coverage" eyebrow="Sample targeting list" />
            <div className="space-y-3">
              {highGap.map((item) => (
                <article key={item.region} className="rounded-lg bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3"><p className="font-semibold text-textile-ink">{item.region}</p><p className="text-sm font-semibold text-amber-700">{item.wasteGapKg.toLocaleString()} kg gap</p></div>
                  <p className="mt-1 text-sm text-textile-ink/58">{item.producers} producers · {item.collectionPoints} collection points · {item.recyclers} recyclers</p>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
