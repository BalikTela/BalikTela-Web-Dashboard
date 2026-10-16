import assert from 'node:assert/strict';
import test from 'node:test';
import { clientOrigin, isDefaultDemoPassword, validateProductionEnvironment } from './runtimeConfig.js';

const production = {
  NODE_ENV: 'production', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'test-server-key', SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
  JWT_SECRET: 'a-private-test-secret-with-more-than-32-characters',
  RENDER_EXTERNAL_URL: 'https://baliktela-test.onrender.com', AUTH_DEMO_DELIVERY: 'false',
};

test('production requires persistent Supabase configuration and private signing credentials', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(production));
  assert.throws(() => validateProductionEnvironment({ ...production, SUPABASE_SECRET_KEY: '' }), /SUPABASE_SECRET_KEY/);
  assert.throws(() => validateProductionEnvironment({ ...production, JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => validateProductionEnvironment({ ...production, AUTH_DEMO_DELIVERY: 'true' }), /AUTH_DEMO_DELIVERY/);
  assert.doesNotThrow(() => validateProductionEnvironment({ NODE_ENV: 'development' }));
});

test('Render origin is automatic and a custom HTTPS origin takes precedence', () => {
  assert.equal(clientOrigin(production), production.RENDER_EXTERNAL_URL);
  assert.equal(clientOrigin({ ...production, CLIENT_ORIGIN: 'https://dashboard.example.org/' }), 'https://dashboard.example.org');
  assert.throws(() => validateProductionEnvironment({ ...production, CLIENT_ORIGIN: 'http://localhost:5173' }), /HTTPS/);
  assert.throws(() => validateProductionEnvironment({ ...production, RENDER_EXTERNAL_URL: '' }), /CLIENT_ORIGIN/);
  assert.throws(() => validateProductionEnvironment({ ...production, CLIENT_ORIGIN: 'https://dashboard.example.org/login' }), /exact HTTPS origin/);
  assert.throws(() => validateProductionEnvironment({ ...production, CLIENT_ORIGIN: 'https://user:password@dashboard.example.org' }), /exact HTTPS origin/);
  assert.throws(() => validateProductionEnvironment({ ...production, SUPABASE_URL: 'http://example.supabase.co' }), /SUPABASE_URL/);
});

test('public demo password is rejected in production and all Supabase-connected environments', () => {
  assert.equal(isDefaultDemoPassword('BalikTelaDemo2026!', production), true);
  assert.equal(isDefaultDemoPassword('private-assigned-password', production), false);
  assert.equal(isDefaultDemoPassword('BalikTelaDemo2026!', { NODE_ENV: 'development' }), false);
  assert.equal(isDefaultDemoPassword('BalikTelaDemo2026!', { NODE_ENV: 'development', SUPABASE_URL: production.SUPABASE_URL }), true);
});
