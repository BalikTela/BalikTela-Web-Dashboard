import { useState } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { formatMass, percentage } from '../../shared/metrics';
import { GeographicMap } from '../components/GeographicMap';
import { RegionalBarChart } from '../components/Charts';
import { EmptyBlock } from '../components/StateBlock';
import { geographicMetrics, geographicValue, rankedRegions, type GeographicMetric } from '../lib/geography';
import type { getDashboardData } from '../services/dashboardService';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function Geographic({ data }: { data: Data }) {
  const [metric, setMetric] = useState<GeographicMetric>('collectionKg');
  const [selection, setSelection] = useState<string | null>(null);
  const regions = data.regionalActivity;
  const selected = regions.some(region => region.region === selection) ? selection : null;
  const ordered = rankedRegions(regions, metric);
  const metricLabel = geographicMetrics.find(item => item.key === metric)!.label;
  const total = regions.reduce((sum, region) => sum + geographicValue(region, metric), 0);
  const collected = regions.reduce((sum, region) => sum + region.collectionKg, 0);
  const recycled = regions.reduce((sum, region) => sum + region.recyclingKg, 0);
  const recoveryGap = regions.reduce((sum, region) => sum + region.wasteGapKg, 0);
  const collectionPoints = regions.reduce((sum, region) => sum + region.collectionPoints, 0);
  const recyclers = regions.reduce((sum, region) => sum + region.recyclers, 0);
  const highestGap = rankedRegions(regions, 'wasteGapKg')[0];

  return <div className="geo-page">
    <section aria-label="Geographic activity map" className="min-w-0">
      <header className="geo-section-header">
        <div><h2>Regional material flows</h2><p>Collection, recycling, and recovery coverage</p></div>
        <div className="geo-period"><span>{data.metadata.periodLabel}</span></div>
      </header>
      <GeographicMap regions={regions} metric={metric} onMetricChange={setMetric} selectedRegion={selected} onSelectRegion={setSelection} />
    </section>

    <section className="geo-summary" aria-label="Geographic summary">
      <article className="geo-summary-primary"><p>Collected material</p><strong>{data.circularFlow.collectedAvailable === false ? 'Pending evidence' : formatMass(collected)}</strong><span>Across {regions.length} represented regions</span></article>
      <article><p>Confirmed recycling</p><strong>{data.circularFlow.recycledAvailable === false ? 'Pending evidence' : formatMass(recycled)}</strong><span>Validated final output only</span></article>
      <article><p>Declared outcome gap</p><strong>{formatMass(recoveryGap)}</strong><span>Not measured disposal or landfill waste</span></article>
      <article><p>Regional network</p><strong>{collectionPoints.toLocaleString()}<span> registered Hubs</span></strong><span>{recyclers} recycler involvements across regions</span></article>
    </section>

    <div className="geo-analysis-grid">
      <section className="geo-analysis-section" aria-label="Regional breakdown">
        <header className="geo-section-header"><div><h2>Regional breakdown</h2><p>Ranked by {metricLabel.toLowerCase()} mass</p></div><span className="geo-count">{regions.length} regions</span></header>
        {ordered.length ? <div className="overflow-x-auto"><table className="geo-region-table">
          <thead><tr><th>Region</th><th>Collected</th><th>Recycled</th><th>Recovery gap</th><th>Share of {metricLabel.toLowerCase()}</th></tr></thead>
          <tbody>{ordered.map(region => <tr key={region.region} data-selected={selected === region.region}>
            <td><button type="button" className="geo-region-button" aria-pressed={selected === region.region} aria-label={`Locate ${region.region}`} onClick={() => setSelection(selected === region.region ? null : region.region)}><MapPin size={14} aria-hidden="true" /><span>{region.region}</span><ArrowUpRight size={13} aria-hidden="true" /></button><p>{region.collectionPoints} registered Hubs · {region.recyclers} recyclers</p></td>
            <td>{region.collectionAvailable === false ? 'Pending evidence' : formatMass(region.collectionKg)}</td><td>{region.recyclingAvailable === false ? 'Pending evidence' : formatMass(region.recyclingKg)}</td><td>{formatMass(region.wasteGapKg)}</td>
            <td><div className="geo-share"><span className={metric === 'wasteGapKg' ? 'geo-share-track geo-share-gap' : 'geo-share-track'}><span style={{ width: `${percentage(geographicValue(region, metric), total)}%` }} /></span><span>{total > 0 ? `${percentage(geographicValue(region, metric), total)}%` : 'Not available'}</span></div></td>
          </tr>)}</tbody>
        </table></div> : <EmptyBlock label="No regions match the current filters." />}
        <p className="geo-method-note">Share = regional {metricLabel.toLowerCase()} mass / total {metricLabel.toLowerCase()} mass in the current filter scope. Locations indicate regions, not participant addresses.</p>
      </section>

      <section className="geo-analysis-section" aria-label="Regional comparison">
        <header className="geo-section-header"><div><h2>Collection and recycling</h2><p>Matching regions · metric tons (t)</p></div></header>
        {regions.length ? <div className="geo-comparison-chart"><RegionalBarChart data={regions} /></div> : <EmptyBlock label="No regional activity to compare." />}
        {highestGap ? <div className="geo-priority"><span className="geo-priority-indicator" /><div><p>Largest recovery gap</p><strong>{highestGap.region}</strong></div><span className="tabular-nums">{formatMass(highestGap.wasteGapKg)}</span></div> : null}
      </section>
    </div>
  </div>;
}
