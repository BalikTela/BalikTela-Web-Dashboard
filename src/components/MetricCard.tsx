import type { Kpi } from '../types';
import { cn } from '../lib/utils';

export function MetricCard({ metric, featured = false, sparkline, sparklineStart = 'Start', sparklineEnd = 'Current' }: { metric: Kpi; featured?: boolean; sparkline?: number[]; sparklineStart?: string; sparklineEnd?: string }) {
  const positive = metric.delta.startsWith('+') || metric.delta.includes('% of');

  return (
    <article className={cn('min-w-0 overflow-hidden rounded-md border', featured ? 'flex min-h-52 flex-col border-[#193c31] bg-[#193c31] p-5 text-white sm:col-span-2 sm:min-h-64 xl:row-span-2' : 'surface-panel surface-panel-interactive flex min-h-[132px] flex-col p-4')}>
      <p className={cn('break-words text-xs font-medium leading-5', featured ? 'text-white/65' : 'text-[#66736e]')}>{metric.label}</p>
      <p className={cn('break-words font-semibold leading-none tabular-nums', featured ? 'mt-4 text-4xl text-white' : 'mt-3 text-2xl text-[#174b3a]')}>{metric.value}</p>
      <p className={cn('text-xs leading-5', featured ? 'mt-2 text-white/60' : 'mt-auto pt-3', !featured && (positive ? 'text-emerald-700' : 'text-[#718079]'))}>{metric.delta}</p>
      {featured && sparkline ? (
        <div className="mt-auto pt-5">
          <Sparkline values={sparkline} label={`${metric.label} trend from ${sparklineStart} to ${sparklineEnd}`} featured />
          <div className="mt-2 flex justify-between text-[11px] text-white/45"><span>{sparklineStart}</span><span>{sparklineEnd}</span></div>
        </div>
      ) : null}
    </article>
  );
}

function Sparkline({ values, label, featured = false }: { values: number[]; label: string; featured?: boolean }) {
  const width = 320;
  const height = 54;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const calculatedPoints = values.map((value, index) => ({ x: values.length === 1 ? width : (index / (values.length - 1)) * width, y: height - ((value - min) / range) * (height - 6) - 3 }));
  const pointList = calculatedPoints.length === 1 ? [{ x: 0, y: calculatedPoints[0].y }, calculatedPoints[0]] : calculatedPoints;
  const points = pointList.map((point) => `${point.x},${point.y}`).join(' ');
  const lastPoint = pointList[pointList.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={label}>
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke={featured ? 'rgba(255,255,255,.15)' : '#e2e8f0'} />
      <polyline pathLength="1" className="sparkline-line" points={points} fill="none" stroke={featured ? '#77d6b2' : '#047857'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="section-enter" cx={lastPoint.x} cy={lastPoint.y} r="3.5" fill={featured ? '#77d6b2' : '#047857'} />
    </svg>
  );
}
