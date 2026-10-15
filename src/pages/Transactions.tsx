import { CheckCircle2, Clock3, Search, Scale, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock } from '../components/StateBlock';
import { StatusBadge } from '../components/StatusBadge';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { Input } from '../components/ui/input';
import { SummaryCard } from '../components/SummaryCard';
import { BarterActivity } from '../components/BarterActivity';
import type { getDashboardData } from '../services/dashboardService';
import type { Transaction } from '../types';
import { Panel } from '../components/Panel';

type Data = Awaited<ReturnType<typeof getDashboardData>>;

export function Transactions({ data }: { data: Data }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const rows = useMemo(() => {
    const needle = query.toLowerCase();
    return data.transactions.filter((item) => [item.id, item.source, item.destination, item.location, item.status].join(' ').toLowerCase().includes(needle));
  }, [data.transactions, query]);
  const completed = data.transactions.filter((item) => item.status === 'Completed').length;
  const totalWeight = data.transactions.reduce((sum, item) => sum + item.weightKg, 0);

  return (
    <>
      <section className="stagger-grid mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Sample audit records" value={data.transactions.length.toLocaleString()} detail={data.metadata.periodLabel} icon={Waypoints} />
        <SummaryCard label="Sample material traced" value={`${totalWeight.toLocaleString()} kg`} detail="Subset of aggregate platform activity" icon={Scale} tone="blue" />
        <SummaryCard label="Audit records completed" value={`${Math.round((completed / Math.max(data.transactions.length, 1)) * 100)}%`} detail={`${completed} of ${data.transactions.length} matching sample records`} icon={CheckCircle2} tone="emerald" />
        <SummaryCard label="Open sample workflows" value={`${data.transactions.length - completed}`} detail="Sorting, transit, or validation" icon={Clock3} tone="amber" />
      </section>
      <div className="mb-5"><BarterActivity data={data.barterMetrics} periodLabel={data.metadata.periodLabel} /></div>
      <Panel>
        <SectionHeader
          title="Transactions and Traceability"
          eyebrow="Searchable demo audit subset; aggregate transaction KPIs are derived separately"
          actions={
            <label className="relative block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-textile-ink/40" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transactions" className="w-72 max-w-full pl-9" />
            </label>
          }
        />
        {rows.length ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[990px] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[8%]" /><col className="w-[7%]" /><col className="w-[14%]" /><col className="w-[15%]" /><col className="w-[8%]" />
                <col className="w-[9%]" /><col className="w-[7%]" /><col className="w-[13%]" /><col className="w-[10%]" /><col className="w-[9%]" />
              </colgroup>
              <thead className="text-xs uppercase tracking-[0.08em] text-textile-ink/45">
                <tr><th className="py-2">ID</th><th>Date</th><th>Source</th><th>Destination</th><th>Type</th><th>Category</th><th>Weight</th><th>Location</th><th>Status</th><th>Evidence</th></tr>
              </thead>
              <tbody className="divide-y divide-textile-thread">
                {rows.map((item) => (
                <tr key={item.id} className="data-row cursor-pointer transition-colors hover:bg-slate-50" onClick={() => setSelected(item)}>
                    <td className="break-words py-3 pr-3 font-medium text-emerald-700">{item.id}</td>
                    <td className="pr-3">{item.date}</td>
                    <td className="pr-3">{item.source}</td>
                    <td className="pr-3">{item.destination}</td>
                    <td className="pr-3">{item.type}</td>
                    <td className="pr-3">{item.textileCategory}</td>
                    <td className="pr-3">{item.weightKg.toLocaleString()} kg</td>
                    <td className="pr-3">{item.location}</td>
                    <td className="pr-3"><StatusBadge status={item.status} /></td>
                    <td className="text-textile-ink/65">{item.status === 'Completed' ? 'Lifecycle recorded' : 'Outcome pending'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyBlock />}
      </Panel>
      <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />
    </>
  );
}
