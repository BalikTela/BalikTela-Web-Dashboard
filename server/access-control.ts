import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import type { Store } from './store.js';
import type { FacilityRecord, MaterialBatchRecord, OrganizationRecord, RecoveryRecord, TransferRecord, UserRecord, UserRole } from './types.js';

export const PERMISSIONS = [
  'profile.read', 'profile.update',
  'users.read', 'users.manage',
  'organizations.read', 'organizations.manage',
  'listings.read', 'listings.create', 'listings.match', 'listings.manage',
  'offers.read', 'offers.create', 'offers.manage',
  'batches.read', 'batches.manage',
  'facilities.read', 'facilities.manage',
  'transfers.read', 'transfers.manage',
  'recovery.read', 'recovery.create', 'recovery.manage',
  'analytics.read', 'dataQuality.read', 'audit.read',
  'configuration.read', 'configuration.manage',
  'governance.read', 'reports.read', 'reports.export',
  'messages.read', 'messages.create', 'wallet.read',
] as const;

export type Permission = typeof PERMISSIONS[number];

const profile: Permission[] = ['profile.read', 'profile.update'];
const discovery: Permission[] = ['listings.read', 'listings.create', 'listings.match', 'offers.read', 'offers.create', 'offers.manage', 'batches.read', 'facilities.read', 'transfers.read', 'transfers.manage', 'configuration.read', 'messages.read', 'messages.create', 'wallet.read'];
const organizationMonitoring: Permission[] = ['organizations.read', 'analytics.read', 'reports.read', 'reports.export', 'governance.read'];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  Administrator: PERMISSIONS,
  Government: [...profile, 'organizations.read', 'facilities.read', 'analytics.read', 'audit.read', 'configuration.read', 'governance.read', 'reports.read', 'reports.export'],
  Researcher: [...profile, 'organizations.read', 'listings.read', 'batches.read', 'facilities.read', 'transfers.read', 'recovery.read', 'analytics.read', 'dataQuality.read', 'configuration.read', 'governance.read', 'reports.read', 'reports.export'],
  Producer: [...profile, ...discovery, ...organizationMonitoring, 'recovery.read'],
  Recycler: [...profile, ...discovery, ...organizationMonitoring, 'facilities.manage', 'recovery.read', 'recovery.create'],
  Upcycler: [...profile, ...discovery, ...organizationMonitoring, 'facilities.manage', 'recovery.read', 'recovery.create'],
  'LGU/Collection Point': [...profile, ...discovery, 'organizations.read', 'facilities.manage', 'analytics.read', 'reports.read', 'recovery.read', 'recovery.create'],
  NGO: [...profile, ...discovery, 'organizations.read', 'analytics.read', 'reports.read', 'recovery.read'],
  Consumer: [...profile, ...discovery],
};

const pendingAccountPermissions = new Set<Permission>(profile);

export function hasPermission(user: UserRecord, permission: Permission) {
  if (['Suspended', 'Deactivated'].includes(user.accountStatus)) return false;
  if ((!user.emailVerifiedAt || !user.passwordChangedAt) && !pendingAccountPermissions.has(permission)) return false;
  if (user.accountStatus === 'Pending verification' && !pendingAccountPermissions.has(permission)) return false;
  if (!ROLE_PERMISSIONS[user.role].includes(permission)) return false;
  if (permission === 'reports.export') return user.role === 'Administrator' || user.scope.canExport;
  return true;
}

export function permissionsFor(user: UserRecord) {
  return PERMISSIONS.filter((permission) => hasPermission(user, permission));
}

export function authorize(store: Store, permission: Permission) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ message: 'Authentication required.' });
    const [session, actor] = await Promise.all([
      store.findSession(req.auth.sessionId),
      store.findById('users', req.auth.userId),
    ]);
    if (!session || session.userId !== req.auth.userId || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      return res.status(401).json({ message: 'Your database session is invalid, revoked, or expired.' });
    }
    if (!actor) return res.status(401).json({ message: 'The account linked to this session no longer exists.' });
    if (['Suspended', 'Deactivated'].includes(actor.accountStatus)) return res.status(403).json({ message: 'This account is suspended or deactivated. Contact a BalikTela administrator.' });
    if (!hasPermission(actor, permission)) {
      const message = actor.accountStatus === 'Pending verification'
        ? 'This account must be verified before using this function.'
        : 'Your role or assigned scope does not permit this function.';
      return res.status(403).json({ message, permission });
    }
    req.actor = actor;
    next();
  };
}

export interface ResourceScope {
  userIds?: Array<string | null | undefined>;
  organizationIds?: Array<string | null | undefined>;
  facilityIds?: Array<string | null | undefined>;
}

export function isWithinOperationalScope(user: UserRecord, resource: ResourceScope) {
  if (user.role === 'Administrator') return true;
  if (user.scope.aggregateOnly) return false;
  if (resource.userIds?.some((id) => id === user.id)) return true;
  const organizations = new Set([user.organizationId, ...user.scope.organizationIds].filter(Boolean));
  if (resource.organizationIds?.some((id) => id && organizations.has(id))) return true;
  const facilities = new Set(user.scope.facilityIds);
  return Boolean(resource.facilityIds?.some((id) => id && facilities.has(id)));
}

export function scopeOrganizations(user: UserRecord, organizations: OrganizationRecord[]) {
  if (['Administrator', 'Government', 'Researcher'].includes(user.role)) return organizations;
  const allowed = new Set([user.organizationId, ...user.scope.organizationIds].filter(Boolean));
  return organizations.filter((organization) => allowed.has(organization.id));
}

export function scopeFacilities(user: UserRecord, facilities: FacilityRecord[]) {
  if (['Administrator', 'Consumer', 'Government', 'Researcher'].includes(user.role)) {
    return user.scope.regions.length && ['Government', 'Researcher'].includes(user.role)
      ? facilities.filter((facility) => user.scope.regions.includes(facility.region))
      : facilities;
  }
  const organizationIds = new Set([user.organizationId, ...user.scope.organizationIds].filter(Boolean));
  const facilityIds = new Set(user.scope.facilityIds);
  return facilities.filter((facility) => organizationIds.has(facility.organizationId) || facilityIds.has(facility.id));
}

export function scopeBatches(user: UserRecord, batches: MaterialBatchRecord[]) {
  if (user.role === 'Administrator') return batches;
  if (user.scope.aggregateOnly) return [];
  const organizationIds = new Set([user.organizationId, ...user.scope.organizationIds].filter(Boolean));
  return batches.filter((batch) => batch.sourceUserId === user.id || batch.currentCustodianId === user.id || Boolean(batch.sourceOrganizationId && organizationIds.has(batch.sourceOrganizationId)));
}

export function scopeAnalyticalBatches(user: UserRecord, batches: MaterialBatchRecord[]) {
  batches=batches.filter(batch=>batch.currentStatus!=='Archived');
  if (['Administrator', 'Government', 'Researcher'].includes(user.role)) {
    return user.scope.regions.length && user.role !== 'Administrator'
      ? batches.filter((batch) => user.scope.regions.includes(batch.region))
      : batches;
  }
  return scopeBatches(user, batches);
}

export function scopeTransfers(user: UserRecord, transfers: TransferRecord[]) {
  if (user.role === 'Administrator') return transfers;
  if (user.scope.aggregateOnly) return [];
  return transfers.filter((transfer) => transfer.providerId === user.id || transfer.recipientId === user.id);
}

export function scopeRecoveryRecords(user: UserRecord, records: RecoveryRecord[]) {
  if (user.role === 'Administrator') return records;
  if (user.scope.aggregateOnly) return [];
  const organizationIds = new Set([user.organizationId, ...user.scope.organizationIds].filter(Boolean));
  const facilityIds = new Set(user.scope.facilityIds);
  return records.filter((record) => organizationIds.has(record.organizationId) || facilityIds.has(record.facilityId) || record.recordedBy === user.id);
}

export function accessSummary(user: UserRecord) {
  return {
    role: user.role,
    permissions: permissionsFor(user),
    scope: user.scope,
  };
}
