import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { installSecurity, securityErrorHandler } from './security.js';
import { ManagementError } from './management.js';
import { ReportingInputError } from '../shared/reporting.js';

async function fixture(run: (base: string) => Promise<void>, limits?: { api: number; auth: number }) {
  const app = express();
  installSecurity(app, { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://dashboard.example.test' }, limits);
  app.get('/', (_req, res) => res.send('<html>Public page</html>'));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/private', (_req, res) => res.status(401).json({ message: 'Authentication required.' }));
  app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
  app.post('/api/mutation', (_req, res) => res.json({ ok: true }));
  app.delete('/api/mutation', (_req, res) => res.status(204).end());
  app.get('/api/domain-error', () => { throw new ManagementError('A valid material category is required.'); });
  app.get('/api/report-error', () => { throw new ReportingInputError('Choose a supported date range.'); });
  app.get('/api/provider-error', () => { const error = new Error('postgres://private-password@secret-host'); error.name = 'SupabaseAuthError'; throw error; });
  app.get('/api/unavailable', () => { throw Object.assign(new Error('private SQL connection detail'), { status: 503 }); });
  app.use(securityErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address.');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('production headers constrain scripts, framing, referrers and capabilities; protected responses never cache', async () => fixture(async base => {
  for (const path of ['/', '/api/private']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('strict-transport-security')!, /max-age=31536000/);
    assert.doesNotMatch(response.headers.get('strict-transport-security')!, /includeSubDomains/);
    assert.match(response.headers.get('content-security-policy')!, /script-src 'self';/);
    assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.match(response.headers.get('permissions-policy')!, /camera=\(\)/);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.ok(response.headers.get('x-request-id'));
    if (path.startsWith('/api')) assert.equal(response.headers.get('cache-control'), 'no-store');
  }
}));

test('foreign origins cannot mutate; exact allowed origin and originless API clients remain compatible', async () => fixture(async base => {
  const call = (headers: Record<string,string>) => fetch(`${base}/api/mutation`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await call({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call({ Origin: 'https://dashboard.example.test.attacker.test' })).status, 403);
  assert.equal((await call({ Origin: 'null' })).status, 403);
  assert.equal((await call({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await call({})).status, 200);
  const allowed = await call({ Origin: 'https://dashboard.example.test' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://dashboard.example.test');
  const preflight = await fetch(`${base}/api/mutation`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
}));

test('input validation blocks form CSRF, malformed JSON, prototype keys, excessive structures and password truncation', async () => fixture(async base => {
  const call = (body: string, type = 'application/json', query = '') => fetch(`${base}/api/mutation${query}`, { method: 'POST', headers: { 'Content-Type': type }, body });
  assert.equal((await call('value=1', 'application/x-www-form-urlencoded')).status, 415);
  assert.equal((await call('[]')).status, 400);
  assert.equal((await call('null')).status, 400);
  assert.equal((await call('{')).status, 400);
  assert.equal((await call('{"__proto__":{"admin":true}}')).status, 400);
  assert.equal((await call('{"weight":1e999}')).status, 400);
  assert.equal((await call(JSON.stringify({ rows: Array(201).fill(1) }))).status, 400);
  assert.equal((await call(JSON.stringify({ password: 'A'.repeat(73) }))).status, 400);
  assert.equal((await call(JSON.stringify({ password: 'é'.repeat(37) }))).status, 400);
  assert.equal((await call(JSON.stringify({ password: { toString: 'secret' } }))).status, 400);
  assert.equal((await call('{}', 'application/json', '?region=A&region=B')).status, 400);
  const large = await call(JSON.stringify({ payload: 'a'.repeat(1_100_000) }));
  assert.equal(large.status, 413);
  assert.doesNotMatch(await large.text(), /payload|a{40}/);
  assert.equal((await call('{"reason":"Valid update"}')).status, 200);
  assert.equal((await fetch(`${base}/api/mutation`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })).status, 204);
  assert.equal((await fetch(`${base}/api/mutation`, { method: 'DELETE' })).status, 204);
}));

test('IP limits stop username spraying, bound API traffic and leave health checks available', async () => fixture(async base => {
  const call = () => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  const blocked = await call();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  await fetch(`${base}/api/private`);
  assert.equal((await fetch(`${base}/api/private`)).status, 429);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
}, { api: 4, auth: 2 }));

test('provider and parser errors do not disclose secrets; validated domain errors stay useful', async () => fixture(async base => {
  const provider = await fetch(`${base}/api/provider-error`);
  assert.equal(provider.status, 400);
  assert.doesNotMatch(await provider.text(), /private-password|postgres:|secret-host/);
  const unavailable = await fetch(`${base}/api/unavailable`);
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private SQL/);
  assert.match(await fetch(`${base}/api/domain-error`).then(response => response.text()), /material category/);
  assert.match(await fetch(`${base}/api/report-error`).then(response => response.text()), /supported date range/);
}));
