import type { ReactNode } from 'react';

export function SectionHeader({ title, eyebrow, actions }: { title: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-[#17201d]">{title}</h2>
        {eyebrow ? <p className="mt-1 text-xs leading-5 text-[#718079]">{eyebrow}</p> : null}
      </div>
      {actions ? <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:shrink-0">{actions}</div> : null}
    </div>
  );
}
