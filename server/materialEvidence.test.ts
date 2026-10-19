import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateMaterialEvidence as aggregate } from './materialEvidence.js';
import { createSeedData } from './seed.js';
import type { RecoveryRecord } from './types.js';

const seed = await createSeedData();
const batch = { ...seed.materialBatches[3], id: 'B1', declaredWeightKg: 100 };
const transfer = { ...seed.transfers[0], id: 'T1', batchId: batch.id, listingId: 'L1', verifiedWeightKg: 80, receiptWeightKg: 80, circularOutcome: 'Recycling' as const };
const record = (patch: Partial<RecoveryRecord> = {}): RecoveryRecord => ({
  ...seed.recoveryRecords[0], id: 'COL', batchId: batch.id, transferId: transfer.id, stage: 'Collection',
  inputWeightKg: 100, outputWeightKg: 100, residualWeightKg: 0, lossWeightKg: 0,
  status: 'Validated', validatedBy: 'Verifier', outcome: null, ...patch,
});
const final = record({ id: 'FINAL', stage: 'Recovery', inputWeightKg: 80, outputWeightKg: 72, residualWeightKg: 8, outcome: 'Recycling' });
const validation = { ...seed.measurements[0], id: 'VALIDATION', batchId: batch.id, transferId: transfer.id, stage: 'Validation' as const, weightKg: 80, status: 'Verified' as const, verifiedBy: 'Verifier' };

test('collection, completed activity and final recycling output are separate non-additive quantities', () => {
  const value = aggregate([batch, batch], [transfer, transfer], [record(), final, final], { measurements: [validation] });
  assert.equal(value.generatedKg, 100);
  assert.equal(value.collectedKg, 100);
  assert.equal(value.completedKg, 80);
  assert.equal(value.recycledKg, 72);
  assert.equal(value.diversionRate, 72);
  assert.equal(value.unresolvedCollectedKg, 28);
  assert.equal(value.transactionCount, 1);
  assert.equal(value.completedReportedWeight, 0);
});

test('intended recycling, sorting and completed status do not establish a final outcome', () => {
  const value = aggregate([batch], [transfer], [record(), record({ id: 'SORT', stage: 'Sorting', outputWeightKg: 90, residualWeightKg: 10, outcome: 'Recycling' })]);
  assert.equal(value.recycledKg, 0);
  assert.equal(value.recyclingRecords, 0);
  assert.equal(value.diversionRate, null);
  assert.equal(value.unresolvedCollectedKg, 100);
});

test('pending, flagged, reversed and unapproved records are not official outcomes', () => {
  for (const change of [{ status: 'Recorded' as const }, { status: 'Flagged' as const }, { status: 'Reversed' as const }, { validatedBy: null }]) {
    const value = aggregate([batch], [transfer], [record(), { ...final, ...change }]);
    assert.equal(value.recyclingRecords, 0);
    assert.equal(value.diversionRate, null);
  }
});

test('final Recovery supersedes Processing for the same portion; duplicate finals require review', () => {
  const processing = { ...final, id: 'PROCESSING', stage: 'Processing' as const, outputWeightKg: 75, residualWeightKg: 5 };
  assert.equal(aggregate([batch], [transfer], [record(), processing, final]).recycledKg, 72);
  const conflict = aggregate([batch], [transfer], [record(), final, { ...final, id: 'DUPLICATE' }]);
  assert.equal(conflict.recycledKg, 0);
  assert.equal(conflict.outcomeConflicts, 1);
  assert.equal(conflict.diversionRate, null);
  assert.equal(aggregate([batch], [transfer], [record(), final, { ...final, id: 'OLD', status: 'Reversed' }]).recycledKg, 72);
});

test('invalid balances and over-allocation are withheld rather than capped to 100 percent', () => {
  for (const bad of [
    { ...final, outputWeightKg: 90 }, { ...final, inputWeightKg: 120, outputWeightKg: 112 },
    { ...final, outputWeightKg: NaN }, { ...final, inputWeightKg: -1 },
  ]) {
    const result = aggregate([batch], [transfer], [record(), bad]);
    assert.equal(result.recycledKg, 0);
    assert.equal(result.diversionRate, null);
  }
  const collectionConflict = aggregate([batch], [transfer], [record(), record({ id: 'DUPLICATE-COLLECTION' }), final]);
  assert.equal(collectionConflict.collectedKg, 0);
  assert.equal(collectionConflict.collectionConflicts, 1);
  assert.equal(collectionConflict.diversionRate, null);
});

test('multi-transfer final portions require an allocation contract even when their sum fits intake', () => {
  const second = { ...transfer, id: 'T2', listingId: 'L2' };
  const result = aggregate([batch], [transfer, second], [record(),
    { ...final, inputWeightKg: 40, outputWeightKg: 36, residualWeightKg: 4 },
    { ...final, id: 'FINAL2', transferId: second.id, inputWeightKg: 40, outputWeightKg: 36, residualWeightKg: 4 },
  ]);
  assert.equal(result.recycledKg, 0);
  assert.equal(result.outcomeConflicts, 1);
  assert.equal(result.transactionCount, 2);
});

test('verified receipt can establish intake; listing weighing and cancelled receipts cannot', () => {
  const receipt = { ...validation, stage: 'Receipt' as const };
  assert.equal(aggregate([batch], [transfer], [], { measurements: [receipt] }).collectedKg, 80);
  assert.equal(aggregate([batch], [transfer], [], { measurements: [{ ...receipt, status: 'Measured' }] }).collectedBatches, 0);
  assert.equal(aggregate([batch], [transfer], [], { measurements: [{ ...receipt, stage: 'Declaration', canonicalStage: 'listing' }] }).collectedBatches, 0);
  assert.equal(aggregate([batch], [{ ...transfer, status: 'Cancelled' }], [], { measurements: [receipt] }).collectedBatches, 0);
  const corrected = { ...receipt, id: 'NEW', weightKg: 75, supersedesMeasurementId: receipt.id };
  assert.equal(aggregate([batch], [transfer], [], { measurements: [receipt, corrected] }).collectedKg, 75);
  assert.equal(aggregate([batch], [transfer], [record()], { measurements: [receipt] }).collectedKg, 100, 'Collection and receipt must not be added.');
});

test('completed mass uses approved validation or reported receipt, never agreed quantity', () => {
  const unverified = { ...validation, status: 'Measured' as const, weightKg: 999 };
  assert.equal(aggregate([batch], [transfer], [], { measurements: [unverified] }).completedKg, 80);
  assert.equal(aggregate([batch], [transfer], [], { measurements: [unverified] }).completedReportedWeight, 1);
  const missing = aggregate([batch], [{ ...transfer, receiptWeightKg: null }], []);
  assert.equal(missing.completedMissingWeight, 1);
  assert.equal(missing.completedKg, 0);
});

test('missing intake is not a zero denominator or a 0 percent outcome; pending collected stock remains in denominator', () => {
  const other = { ...batch, id: 'B2' };
  const stock = record({ id: 'STOCK', batchId: other.id, inputWeightKg: 100, outputWeightKg: 100 });
  const matched = aggregate([batch, other], [transfer], [record(), final, stock]);
  assert.equal(matched.diversionRate, 36);
  assert.equal(matched.unresolvedCollectedKg, 128);
  const unlinked = aggregate([batch, other], [transfer], [final, stock]);
  assert.equal(unlinked.diversionRate, null);
  assert.equal(unlinked.unlinkedOutcomeKg, 72);
  const confirmedZero = aggregate([batch], [transfer], [record(), { ...final, outputWeightKg: 0, residualWeightKg: 80 }]);
  assert.equal(confirmedZero.diversionRate, 0);
  assert.equal(confirmedZero.recyclingRecords, 1);
});

test('remainder batches are not treated as additional independent collected material', () => {
  const listing = { ...seed.listings[0], batchId: batch.id, remainderOfId: 'PARENT-LISTING' };
  const result = aggregate([batch], [transfer], [record(), final], { listings: [listing] });
  assert.equal(result.collectedKg, 0);
  assert.equal(result.recycledKg, 0);
  assert.equal(result.diversionRate, null);
});
