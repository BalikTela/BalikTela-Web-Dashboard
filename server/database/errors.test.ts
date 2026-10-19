import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseOperationError } from './errors.js';

test('database errors retain diagnostic codes without storing provider messages or SQL details', () => {
  for (const code of ['42703', 'PGRST202', 'XX000']) {
    const error = new DatabaseOperationError('read recovery_records', { code, message: 'private-password postgres://secret-host', details: 'private SQL values' });
    assert.equal(error.code, code);
    assert.equal(error.operation, 'read recovery_records');
    assert.doesNotMatch(JSON.stringify(error) + error.message, /private-password|secret-host|private SQL/);
  }
});

test('database network failures and deadlines have safe, useful categories', () => {
  assert.equal(new DatabaseOperationError('load dashboard source snapshot', { message: 'TypeError: fetch failed' }).code, 'database_network_error');
  assert.equal(new DatabaseOperationError('read users', { message: 'The query timed out' }).code, 'database_timeout');
  assert.equal(new DatabaseOperationError('read users', { code: 'sb_secret_not_a_code', message: 'private provider reason' }).code, 'database_error');
  assert.equal(new DatabaseOperationError('read https://private-host?token=secret', { message: 'unavailable' }).operation, 'database operation');
});
