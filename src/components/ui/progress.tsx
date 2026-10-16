import { cn } from '../../lib/utils';

export function Progress({ value, className, indicatorClassName, label = 'Percentage' }: { value: number; className?: string; indicatorClassName?: string; label?: string }) {
  const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div className={cn('progress-fill h-full origin-left bg-primary', indicatorClassName)} style={{ width: `${percent}%` }} />
    </div>
  );
}
