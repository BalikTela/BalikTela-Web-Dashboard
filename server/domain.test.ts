import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOperationalMass, canIssueReward, nextLifecycleStatus, uniqueBatches } from './domain.js';
import type { MaterialBatchRecord, TransferRecord } from './types.js';

const batch = (id: string, kg: number) => ({ id, declaredWeightKg: kg } as MaterialBatchRecord);
const transfer = (overrides: Partial<TransferRecord> = {}) => ({ status: 'Completed', handoverWeightKg: 95, receiptWeightKg: 92, verifiedWeightKg: 90, discrepancyKg: -3, ...overrides } as TransferRecord);

test('unique batch denominator prevents duplicate declared mass', () => {
  assert.equal(uniqueBatches([batch('A', 100), batch('A', 100), batch('B', 50)]).length, 2);
  assert.equal(calculateOperationalMass([batch('A', 100), batch('A', 100), batch('B', 50)], [transfer()]).declaredKg, 150);
});

test('only completed verified transfers contribute to operational completion', () => {
  const result = calculateOperationalMass([batch('A', 200)], [transfer(), transfer({ status: 'Validated', verifiedWeightKg: 80 })]);
  assert.equal(result.verifiedKg, 90);
  assert.equal(result.diversionRate, 45);
});

test('reward is gated to first validated-to-completed transition', () => {
  assert.equal(canIssueReward('Validated', 'Completed', null), true);
  assert.equal(canIssueReward('Received', 'Completed', null), false);
  assert.equal(canIssueReward('Validated', 'Completed', '2026-09-01T00:00:00Z'), false);
});

test('lifecycle transition map rejects skipped stages', () => {
  assert.equal(nextLifecycleStatus('Reserved', 'validate'), null);
  assert.equal(nextLifecycleStatus('Reserved', 'handover'), 'Handed over');
  assert.equal(nextLifecycleStatus('Received', 'validate'), 'Validated');
  assert.equal(nextLifecycleStatus('Validated', 'complete'), 'Completed');
});
