import type { Kpi } from '../types';
import { cn } from '../lib/utils';
import { useContentTransition } from '../lib/motion';

export function MetricCard({ metric, featured = false, sparkline, sparklineStart = 'Start', sparklineEnd = 'Current' }: { metric: Kpi; featured?: boolean; sparkline?: Array<number | null>; sparklineStart?: string; sparklineEnd?: string }) {
  const positive = metric.delta.startsWith('+') || metric.delta.includes('% of');
  const reading = useContentTransition<HTMLParagraphElement>(metric.value);

  return (
    <article className={cn('min-w-0 overflow-hidden rounded-md border', featured ? 'flex min-h-52 flex-col border-[#193c31] bg-[#193c31] p-5 text-white sm:col-span-2 sm:min-h-64 xl:row-span-2' : 'surface-panel surface-panel-interactive flex min-h-[132px] flex-col p-4')}>
      <p className={cn('break-words text-xs font-medium leading-5', featured ? 'text-white/65' : 'text-[#66736e]')}>{metric.label}</p>
      <p ref={reading} className={cn('break-words font-semibold leading-tight tabular-nums', featured ? 'mt-4 text-4xl text-white' : 'mt-3 text-2xl text-[#174b3a]')}>{metric.value}</p>
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

function Sparkline({ values, label, featured = false }: { values: Array<number | null>; label: string; featured?: boolean }) {
  const width = 320;
  const height = 54;
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!known.length) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const range = Math.max(max - min, 1);
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { if (segment.length) segments.push(segment); segment = []; return; }
    segment.push({ x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * (width - 8) + 4, y: height - ((value - min) / range) * (height - 6) - 3 });
  });
  if (segment.length) segments.push(segment);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={label}>
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke={featured ? 'rgba(255,255,255,.15)' : '#e2e8f0'} />
      {segments.map((points, index) => <g key={index}>
        <polyline pathLength="1" className="sparkline-line" points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={featured ? '#77d6b2' : '#047857'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="section-enter" cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={featured ? '#77d6b2' : '#047857'} />
      </g>)}
    </svg>
  );
}
