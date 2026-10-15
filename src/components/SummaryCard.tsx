import type { ComponentType } from 'react';
import { cn } from '../lib/utils';

export function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: string;
  detail: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  tone?: 'emerald' | 'blue' | 'amber' | 'slate';
}) {
  return (
    <article className="min-w-0 border-t border-slate-300 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <Icon size={15} className="shrink-0 text-slate-400" />
      </div>
      <p className={cn('mt-2 break-words text-2xl font-semibold leading-tight text-slate-950', tone === 'amber' && 'text-amber-700')}>{value}</p>
      <p className="mt-1 text-xs leading-4 text-slate-500">{detail}</p>
    </article>
  );
}
