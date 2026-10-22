import type { PageKey } from './App';
import type { AccessSummary, Permission } from './platformTypes';
import { isWebDashboardRole } from '../shared/webAccess';

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
  return Boolean(access && isWebDashboardRole(access.role) && PAGE_PERMISSIONS[page].every((permission) => access.permissions.includes(permission)));
}
