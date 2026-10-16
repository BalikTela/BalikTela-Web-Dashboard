import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { paginationWindow } from '../../shared/pagination';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { useContentTransition } from '../lib/motion';

export function PaginatedRecords<T>({ rows, children, resetKey = '', label = 'Records' }: {
  rows: T[]; children: (pageRows: T[]) => ReactNode; resetKey?: string; label?: string;
}) {
  const [state, setState] = useState({ page: 1, size: 10, key: resetKey });
  const window = paginationWindow(rows.length, state.key === resetKey ? state.page : 1, state.size);
  const content = useContentTransition(`${resetKey}:${window.page}:${state.size}:${rows.length}`);
  const navigate = (page: number) => setState({ ...state, page, key: resetKey });
  return <>
    <div ref={content} className="min-w-0">{children(rows.slice(window.start, window.end))}</div>
    <nav aria-label={`${label} pagination`} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe5e2] pt-4 text-xs text-[#66736e]">
      <p role="status" className="tabular-nums">{window.total ? window.start + 1 : 0}–{window.end} of {window.total.toLocaleString()} records</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">Rows per page<Select aria-label={`${label} rows per page`} className="w-20" value={state.size} onChange={event => setState({ page: 1, size: Number(event.target.value), key: resetKey })}>{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</Select></label>
        <span className="tabular-nums">Page {window.page} of {window.pages}</span>
        <div className="flex gap-1">{[
          { name: 'First page', page: 1, icon: ChevronFirst, disabled: window.page === 1 },
          { name: 'Previous page', page: window.page - 1, icon: ChevronLeft, disabled: window.page === 1 },
          { name: 'Next page', page: window.page + 1, icon: ChevronRight, disabled: window.page === window.pages },
          { name: 'Last page', page: window.pages, icon: ChevronLast, disabled: window.page === window.pages },
        ].map(action => <Button key={action.name} type="button" variant="outline" size="icon" title={action.name} aria-label={action.name} disabled={action.disabled} onClick={() => navigate(action.page)}><action.icon size={15} /></Button>)}</div>
      </div>
    </nav>
  </>;
}
