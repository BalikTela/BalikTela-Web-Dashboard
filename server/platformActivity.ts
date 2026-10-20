import type { PlatformActivityMetrics } from '../shared/platformActivity.js';
import { inReportingWindow, type ReportingPeriod } from '../shared/reporting.js';
import { isCompletedTransfer } from '../shared/workflows.js';
import { isHubProfile } from '../shared/hubs.js';
import type { DashboardSourceSnapshot, Store } from './store.js';
import type { AuditRecord, ListingRecord, OfferRecord, TransferRecord, UserRecord } from './types.js';

const unique = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map(row => [row.id, row])).values()];
const authIdentity = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function registeredAccountCount(source: DashboardSourceSnapshot, actor: UserRecord, query: Record<string, unknown>, now: Date) {
  const orgs = new Set([actor.organizationId, ...actor.scope.organizationIds].filter(Boolean));
  const profiles = source.users.filter(user => {
    if (!user.authUserId || !authIdentity.test(user.authUserId) || user.id.startsWith('SYN-') || Date.parse(user.joinedAt) > now.getTime() || !Number.isFinite(Date.parse(user.joinedAt))) return false;
    if (isHubProfile(actor) && user.id !== actor.id) return false;
    if (actor.role !== 'Administrator' && (['Government', 'Researcher'].includes(actor.role)
      ? actor.scope.regions.length > 0 && !actor.scope.regions.includes(user.region)
      : user.id !== actor.id && (!user.organizationId || !orgs.has(user.organizationId)))) return false;
    return (!query.region || query.region === 'All regions' || user.region === query.region)
      && (!query.city || user.city.toLowerCase().includes(String(query.city).trim().toLowerCase()))
      && (!query.organizationId || query.organizationId === 'All organizations' || user.organizationId === query.organizationId)
      && (!query.stakeholderType || query.stakeholderType === 'All stakeholders' || user.role === query.stakeholderType);
  });
  return new Set(profiles.map(user => user.authUserId!.toLowerCase())).size;
}

export async function buildPlatformActivity(store: Store, source: DashboardSourceSnapshot, actor: UserRecord, query: Record<string, unknown>,
  period: ReportingPeriod, listings: ListingRecord[], requests: OfferRecord[], transfers: TransferRecord[], now: Date): Promise<PlatformActivityMetrics> {
  let exports: AuditRecord[] | null;
  try { exports = store.loadReportExportEvents ? await store.loadReportExportEvents(period.start, period.endExclusive) : await store.all('auditRecords'); }
  catch { exports = null; }
  const occurred = (at: string) => Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime();
  const exportCount = exports === null ? null : unique(exports).filter(item => item.action === 'report.exported' && item.entityType === 'Report'
    && item.actorId && item.entityId && inReportingWindow(item.timestamp, period) && occurred(item.timestamp)
    && (actor.role === 'Administrator' || item.actorId === actor.id)).length;
  return {
    registeredAccounts: registeredAccountCount(source, actor, query, now),
    listings: unique(listings).filter(item => occurred(item.createdAt)).length,
    requests: unique(requests).filter(item => occurred(item.createdAt)).length,
    completedTransfers: unique(transfers).filter(item => isCompletedTransfer(item.status) && occurred(item.updatedAt)).length,
    reportExports: exportCount, exportScope: actor.role === 'Administrator' ? 'Platform' : 'Own', accountAsOf: now.toISOString(),
    monthlyActiveUsers: null, monthlyActiveUsersAvailable: false, sessions: null, averageSessionMinutes: null,
  };
}
