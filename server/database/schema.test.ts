import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_COLLECTION_NAMES, DATABASE_COLLECTIONS, DATABASE_SCHEMA_VERSION, LEGACY_COLLECTION_DECISIONS, WEB_PERSISTENCE_COLLECTION_MAP } from './schema.js';

test('database schema has a semantic version and unique collection names', () => {
  assert.match(DATABASE_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(new Set(CORE_COLLECTION_NAMES).size, CORE_COLLECTION_NAMES.length);
});

test('every collection has a strict object validator and uniquely named indexes', () => {
  for (const definition of DATABASE_COLLECTIONS) {
    const jsonSchema = definition.validator.$jsonSchema;
    assert.equal(jsonSchema.bsonType, 'object', definition.name);
    assert.equal(jsonSchema.additionalProperties, false, definition.name);
    assert.ok(jsonSchema.required.includes('_id'), definition.name);
    const names = definition.indexes.map((index) => index.name);
    assert.ok(names.every(Boolean), `${definition.name} has an unnamed index`);
    assert.equal(new Set(names).size, names.length, `${definition.name} has duplicate index names`);
  }
});

test('material-first shared collections and web mappings are present', () => {
  for (const name of ['material_batches', 'measurements', 'listings', 'match_requests', 'transfers', 'flow_events', 'collection_receipts', 'recovery_records', 'activity_logs']) {
    assert.ok(CORE_COLLECTION_NAMES.includes(name), name);
  }
  for (const target of Object.values(WEB_PERSISTENCE_COLLECTION_MAP)) assert.ok(CORE_COLLECTION_NAMES.includes(target), target);
});

test('authentication lifecycle collections are part of the canonical contract', () => {
  for (const name of ['auth_account_security', 'sessions', 'auth_challenges', 'auth_rate_limits']) assert.ok(CORE_COLLECTION_NAMES.includes(name), name);
});

test('legacy retail and duplicate audit collections are not core collections', () => {
  for (const name of Object.keys(LEGACY_COLLECTION_DECISIONS)) assert.ok(!CORE_COLLECTION_NAMES.includes(name), name);
});
