import assert from 'node:assert/strict';
import test from 'node:test';
import { planImportRemoval, removalAuditActor, ImportRemovalSafetyError, type ImportRow } from '../scripts/lib/import-removal.js';
import type { CanonicalMutation } from './database/mutations.js';

const prefix = `IMP-DEMO-${'a'.repeat(24)}`;
const mutation = (table: string, suffix: string, values: Record<string, unknown>): CanonicalMutation => ({ table, id: `${prefix}-${suffix}`, mode: 'insert', values, expected: {} });
const expected = [mutation('material_batches', 'BAT', { is_demo: true, created_at: '2026-08-01T04:00:00Z' }),
  mutation('listings', 'LST', { is_demo: true, description: 'original fingerprint' }), mutation('measurements', 'DECL', { batch_id: `${prefix}-BAT`, weight_kg: 100 })];
const fixture = (): Record<string, ImportRow[]> => ({ material_batches: [{ id: `${prefix}-BAT`, is_demo: true, created_at: '2026-08-01T04:00:00+00:00' }],
  listings: [{ id: `${prefix}-LST`, is_demo: true, description: 'original fingerprint', disposed_at: null, disposed_weight_kg: 0, auth_user_id: 'SUPABASE_AUTH_ID', delivery_route: 'via_hub', weighing_hub_id: null }],
  measurements: [{ id: `${prefix}-DECL`, batch_id: `${prefix}-BAT`, weight_kg: 100 }] });

test('bulk-test removal accepts exact unchanged lifecycle rows and is idempotent for absent datasets', () => {
  const current = fixture(), before = structuredClone(current);
  assert.equal(planImportRemoval(expected, current).measurements.length, 1);
  assert.deepEqual(current, before); assert.deepEqual(planImportRemoval(expected, {}), {});
});
test('bulk-test removal refuses non-demo, edited, unrecognized or orphaned records', () => {
  for (const change of [
    (rows: ReturnType<typeof fixture>) => { rows.material_batches[0].is_demo = false; },
    (rows: ReturnType<typeof fixture>) => { rows.listings[0].description = 'changed'; },
    (rows: ReturnType<typeof fixture>) => { rows.measurements[0].weight_kg = 101; },
    (rows: ReturnType<typeof fixture>) => { rows.listings[0].disposed_weight_kg = 3; },
    (rows: ReturnType<typeof fixture>) => { rows.listings[0].auth_user_id = 'real-auth-identity'; },
    (rows: ReturnType<typeof fixture>) => { rows.listings[0].weighing_hub_id = 'REAL-HUB'; },
    (rows: ReturnType<typeof fixture>) => { rows.measurements[0].id = 'REAL-MOBILE-RECORD'; },
    (rows: ReturnType<typeof fixture>) => { rows.material_batches = []; },
  ]) {
    const current = fixture(); change(current);
    assert.throws(() => planImportRemoval(expected, current), ImportRemovalSafetyError);
  }
  assert.throws(() => planImportRemoval([mutation('users', 'USER', {})], {}), ImportRemovalSafetyError);
});

test('cleanup audit requires the unique active administrator from original import evidence', () => {
  const log = { actor_id: 'ADMIN', details: { summary: JSON.stringify({ batchIds: [`${prefix}-BAT`] }) } };
  const ids = new Set([`${prefix}-BAT`]), users = [{ id: 'ADMIN', role: 'Administrator', accountStatus: 'Active' }];
  assert.equal(removalAuditActor([log], ids, users), 'ADMIN');
  assert.throws(() => removalAuditActor([], ids, users), ImportRemovalSafetyError);
  assert.throws(() => removalAuditActor([log, { ...log, actor_id: 'OTHER' }], ids, users), ImportRemovalSafetyError);
  assert.throws(() => removalAuditActor([log], ids, [{ ...users[0], role: 'Consumer' }]), ImportRemovalSafetyError);
});
