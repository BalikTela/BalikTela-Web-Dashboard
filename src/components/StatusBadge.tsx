import type { Facility, TransactionStatus } from '../types';
import { Badge } from './ui/badge';
import type { HubFacilityMetric } from '../../shared/hubFacilities';

type Status = TransactionStatus | Facility['status'] | HubFacilityMetric['status'];
const toneByStatus: Partial<Record<Status, string>> = {
  Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'In sorting': 'border-lime-200 bg-lime-50 text-lime-800',
  'In transit': 'border-cyan-200 bg-cyan-50 text-cyan-700',
  'Pending validation': 'border-amber-200 bg-amber-50 text-amber-700',
  Flagged: 'border-red-200 bg-red-50 text-red-700',
  Available: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Near capacity': 'border-orange-200 bg-orange-50 text-orange-700',
  'At capacity': 'border-amber-200 bg-amber-50 text-amber-800',
  'Over capacity': 'border-red-200 bg-red-50 text-red-700',
  'Capacity not configured': 'border-slate-200 bg-slate-100 text-slate-700',
  'No operator assigned': 'border-slate-200 bg-slate-100 text-slate-700',
  'Intake incomplete': 'border-amber-200 bg-amber-50 text-amber-800',
  Maintenance: 'border-slate-200 bg-slate-100 text-slate-700',
  'Pilot onboarding': 'border-blue-200 bg-blue-50 text-blue-700',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={`whitespace-nowrap font-medium ${toneByStatus[status] ?? 'border-slate-200 bg-white text-slate-700'}`}>{status}</Badge>
  );
}
