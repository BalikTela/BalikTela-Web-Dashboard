import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesRegistryWeightStatus, registryBatchPayload, registryWeightFilter, registryWeightStatus, REGISTRY_WEIGHT_STATUSES } from '../shared/registryWeights.js';

test('registry exposes two weight labels without claiming missing or unknown evidence is measured', () => {
  assert.deepEqual(REGISTRY_WEIGHT_STATUSES, ['Estimated', 'Measured']);
  assert.equal(registryWeightStatus('Estimated'), 'Estimated');
  for (const status of ['Measured', 'Verified']) assert.equal(registryWeightStatus(status), 'Measured');
  for (const status of [null, undefined, '', 'Unknown', 'Awaiting weighing']) assert.equal(registryWeightStatus(status), null);
});

test('registry measured filter includes historical verification but excludes estimates and missing statuses', () => {
  const statuses = ['Estimated', 'Measured', 'Verified', null];
  assert.deepEqual(statuses.filter(status => matchesRegistryWeightStatus(status, 'Measured')), ['Measured', 'Verified']);
  assert.deepEqual(statuses.filter(status => matchesRegistryWeightStatus(status, 'Estimated')), ['Estimated']);
  assert.equal(registryWeightFilter('Verified'), 'Measured');
  assert.equal(registryWeightFilter('Awaiting weighing'), 'All weight statuses');
  assert.deepEqual(statuses.filter(status => matchesRegistryWeightStatus(status, 'All weight statuses')), statuses);
});

test('two-label registry edits preserve existing verification only when the recorded weight is unchanged', () => {
  const previous = { weightStatus: 'Verified', declaredWeightKg: 100 };
  const values = { declaredWeightKg: 100, weightStatus: 'Measured', city: 'Updated city', reason: 'Metadata correction' };
  const payload = registryBatchPayload(values, previous);
  assert.equal(Object.hasOwn(payload, 'weightStatus'), false);
  assert.equal(values.weightStatus, 'Measured');
  assert.equal(previous.weightStatus, 'Verified');
  assert.equal(registryBatchPayload({ ...values, declaredWeightKg: 110 }, previous).weightStatus, 'Measured');
  assert.equal(registryBatchPayload({ ...values, weightStatus: 'Estimated' }, previous).weightStatus, 'Estimated');
  assert.equal(registryBatchPayload(values).weightStatus, 'Measured');
  assert.equal(registryBatchPayload(values, { ...previous, weightStatus: 'Measured' }).weightStatus, 'Measured');
});
