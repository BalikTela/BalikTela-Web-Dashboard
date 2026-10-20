import type { EngagementMetrics } from '../types';
import { SectionHeader } from './SectionHeader';

export function PlatformEngagement({ data, periodLabel }: { data: EngagementMetrics; periodLabel: string }) {
  const metrics = [
    ['Registered accounts', data.registeredAccounts.toLocaleString(), 'Auth-linked profiles; includes test registrations'],
    ['Material listings', data.listings.toLocaleString(), 'Listing records in the selected batch cohort'],
    ['Match requests', data.requests.toLocaleString(), 'Request records across all workflow states'],
    ['Completed transfers', data.completedTransfers.toLocaleString(), 'Completed and processed transfer records'],
    ['Report exports', data.reportExports === null ? 'Not available' : data.reportExports.toLocaleString(), data.exportScope === 'Platform' ? 'Audited platform exports in the selected dates' : 'Your audited exports in the selected dates'],
  ];
  return (
    <section className="dashboard-panel rounded-md border border-slate-200 bg-white p-5">
      <SectionHeader title="Platform Engagement" eyebrow={`${periodLabel} · record-based activity`} />
      <div className="stagger-grid grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value, detail]) => (
          <article key={label} className="border-t border-slate-300 pt-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs leading-4 text-slate-500">{detail}</p></article>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">Accounts are counted as of {new Date(data.accountAsOf).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })} by profile geography, organization and role, not textile category. Listings, requests and transfers follow the selected batch cohort. Exports follow audit-event dates, not material filters. Combined material activity retains the PoC reporting scope.</p>
      <dl className="mt-4 grid gap-3 border-t border-slate-200 pt-4 text-xs sm:grid-cols-3">{['Active users', 'Sessions', 'Average session duration'].map(label => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-700">Not available</dd></div>)}</dl>
    </section>
  );
}
