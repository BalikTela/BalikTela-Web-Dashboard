import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from '../seed.js';
import { decodeRecord, encodeFlowEvent, encodeRecord } from './codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from './schema.js';
import type { DatabaseShape } from '../types.js';

test('canonical adapter round-trips every seeded web record', async () => {
  const seed = await createSeedData();

  for (const name of Object.keys(seed) as (keyof DatabaseShape)[]) {
    assert.ok(WEB_PERSISTENCE_COLLECTION_MAP[name], `${name} has no canonical collection mapping`);

    for (const record of seed[name]) {
      const document = encodeRecord(name, record as never);
      const decoded = decodeRecord(name, document);
      assert.equal(decoded.id, record.id, `${name}:${record.id}`);
      if ('isDemo' in record) {
        assert.equal('isDemo' in decoded ? decoded.isDemo : undefined, record.isDemo, `${name}:${record.id}:isDemo`);
      }
    }
  }
});

test('transfer lifecycle events become ordered canonical flow events', async () => {
  const seed = await createSeedData();
  const transfer = seed.transfers[0];
  assert.ok(transfer);

  const documents = transfer.events.map((event, index) =>
    encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1),
  );

  assert.deepEqual(documents.map((document) => document.sequence), [1, 2, 3, 4, 5]);
  assert.ok(documents.every((document) => document.transfer_id === transfer.id));
  assert.ok(documents.every((document) => document.batch_id === transfer.batchId));
});

test('users without usernames omit the optional field for unique-index compatibility', async () => {
  const seed = await createSeedData();
  const document = encodeRecord('users', seed.users[0]);
  assert.equal(Object.hasOwn(document, 'username'), false);
});

test('compact dashboard transfer rows preserve measured lifecycle weights', async () => {
  const seed = await createSeedData();
  const transfer = seed.transfers[0];
  const document = {
    ...encodeRecord('transfers', transfer),
    _handover_weight_kg: transfer.handoverWeightKg,
    _receipt_weight_kg: transfer.receiptWeightKg,
    _validation_weight_kg: transfer.verifiedWeightKg,
    _flow_events: transfer.events.map((event, index) => encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1)),
  };

  const decoded = decodeRecord('transfers', document);
  assert.equal(decoded.handoverWeightKg, transfer.handoverWeightKg);
  assert.equal(decoded.receiptWeightKg, transfer.receiptWeightKg);
  assert.equal(decoded.verifiedWeightKg, transfer.verifiedWeightKg);
  assert.equal(decoded.events.length, transfer.events.length);
});
