import type { EngagementMetrics } from '../types';
import { SectionHeader } from './SectionHeader';

export function PlatformEngagement({ data, periodLabel }: { data: EngagementMetrics; periodLabel: string }) {
  const metrics = [
    ['Monthly active users', data.monthlyActiveUsers.toLocaleString(), 'Latest month in selected period'],
    ['Sessions', data.sessions.toLocaleString(), `${data.averageSessionMinutes} min average duration`],
    ['Waste submissions', data.wasteSubmissions.toLocaleString(), 'System-recorded submission actions'],
    ['Barter actions', data.barterActions.toLocaleString(), 'Listings, matches, and offer actions'],
    ['Report exports', data.reportExports.toLocaleString(), 'Dashboard export events'],
  ];
  return (
    <section className="dashboard-panel rounded-md border border-slate-200 bg-white p-5">
      <SectionHeader title="Platform Engagement" eyebrow={`${periodLabel} · demo system interaction logs`} />
      <div className="stagger-grid grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value, detail]) => (
          <article key={label} className="border-t border-slate-300 pt-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs leading-4 text-slate-500">{detail}</p></article>
        ))}
      </div>
    </section>
  );
}
