import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPermission, isWithinOperationalScope, permissionsFor, scopeBatches } from './access-control.js';
import type { MaterialBatchRecord, UserRecord, UserRole } from './types.js';

function user(role: UserRole, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: `USR-${role}`, authUserId: null, email: `${role.toLowerCase()}@demo.test`, passwordHash: 'x'.repeat(20), fullName: role, role,
    organizationId: role === 'Consumer' ? null : 'ORG-1', organization: 'Demo', city: 'Quezon City', region: 'NCR',
    joinedAt: '2026-01-01T00:00:00.000Z', consentAt: '2026-01-01T00:00:00.000Z', emailVerifiedAt: '2026-01-01T00:00:00.000Z', passwordChangedAt: '2026-01-01T00:00:00.000Z', verification: 'Demo verified', accountStatus: 'Active',
    scope: { organizationIds: role === 'Consumer' ? [] : ['ORG-1'], facilityIds: ['FAC-1'], regions: ['NCR'], canExport: false, aggregateOnly: role === 'Government' || role === 'Researcher' },
    trustPlaceholder: 50, profile: { ageGroup: '', organizationSize: '', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: [], sustainabilityInterests: [] },
    ...overrides,
  };
}

test('administrator receives the complete permission registry', () => {
  const permissions = permissionsFor(user('Administrator'));
  assert.ok(permissions.includes('users.manage'));
  assert.ok(permissions.includes('configuration.manage'));
  assert.ok(permissions.includes('reports.export'));
});

test('government is aggregate-only and cannot access operational exchange functions', () => {
  const government = user('Government');
  assert.equal(hasPermission(government, 'analytics.read'), true);
  assert.equal(hasPermission(government, 'listings.read'), false);
  assert.equal(isWithinOperationalScope(government, { organizationIds: ['ORG-1'] }), false);
});

test('export permission remains separate from authorized government audit access', () => {
  const government = user('Government');
  assert.equal(hasPermission(government, 'reports.export'), false);
  assert.equal(hasPermission(government, 'audit.read'), true);
  const authorized = user('Government', { scope: { ...government.scope, canExport: true } });
  assert.equal(hasPermission(authorized, 'reports.export'), true);
  assert.equal(hasPermission(authorized, 'audit.read'), true);
});

test('pending institutional accounts are restricted to their own profile', () => {
  const producer = user('Producer', { accountStatus: 'Pending verification' });
  assert.equal(hasPermission(producer, 'profile.read'), true);
  assert.equal(hasPermission(producer, 'analytics.read'), false);
  assert.equal(hasPermission(producer, 'listings.create'), false);
});

test('unverified email or temporary password restricts account permissions', () => {
  assert.equal(hasPermission(user('Producer', { emailVerifiedAt: null }), 'listings.read'), false);
  assert.equal(hasPermission(user('Producer', { passwordChangedAt: null }), 'analytics.read'), false);
  assert.equal(hasPermission(user('Producer', { emailVerifiedAt: null }), 'profile.update'), true);
});

test('organization scope prevents cross-organization batch access', () => {
  const producer = user('Producer');
  const records = [
    { id: 'MB-1', sourceUserId: 'OTHER', sourceOrganizationId: 'ORG-1', currentCustodianId: 'OTHER' },
    { id: 'MB-2', sourceUserId: 'OTHER', sourceOrganizationId: 'ORG-2', currentCustodianId: 'OTHER' },
  ] as MaterialBatchRecord[];
  assert.deepEqual(scopeBatches(producer, records).map((record) => record.id), ['MB-1']);
  assert.equal(isWithinOperationalScope(producer, { organizationIds: ['ORG-2'] }), false);
});

test('recovery creation is limited to approved operational roles', () => {
  assert.equal(hasPermission(user('Recycler'), 'recovery.create'), true);
  assert.equal(hasPermission(user('Upcycler'), 'recovery.create'), true);
  assert.equal(hasPermission(user('LGU/Collection Point'), 'recovery.create'), true);
  assert.equal(hasPermission(user('Producer'), 'recovery.create'), false);
  assert.equal(hasPermission(user('Consumer'), 'recovery.create'), false);
});
