import type { PageKey } from './App';
import type { AccessSummary, Permission } from './platformTypes';

const PAGE_PERMISSIONS: Record<PageKey, readonly Permission[]> = {
  overview: ['analytics.read'],
  listings: ['listings.read'],
  materials: ['batches.read'],
  operations: ['hubs.read'],
  waste: ['analytics.read'],
  transactions: ['analytics.read', 'transfers.read'],
  stakeholders: ['analytics.read'],
  facilities: ['analytics.read', 'facilities.read'],
  geographic: ['analytics.read'],
  advanced: ['analytics.read'],
  quality: ['dataQuality.read'],
  governance: ['governance.read'],
  reports: ['reports.read'],
  organizations: ['organizations.manage'],
  users: ['users.read'],
  rewards: ['rewards.read'],
  audit: ['audit.read'],
  profile: ['profile.read'],
  settings: ['configuration.manage'],
};

export function canAccessPage(access: AccessSummary | null, page: PageKey) {
  if (access?.hubOperator && !['overview', 'listings', 'materials', 'transactions', 'operations', 'facilities', 'profile'].includes(page)) return false;
  return Boolean(access && PAGE_PERMISSIONS[page].some((permission) => access.permissions.includes(permission)));
}
