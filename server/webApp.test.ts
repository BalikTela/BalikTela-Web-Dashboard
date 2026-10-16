import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { serveWebApp } from './webApp.js';

test('production serves the dashboard and immutable assets without masking API errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baliktela-web-test-'));
  const app = express();
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<html><body>Dashboard fixture</body></html>');
  await writeFile(join(directory, 'assets', 'app-hash.js'), 'console.log("fixture");');
  await writeFile(join(directory, '.env'), 'PRIVATE_FIXTURE');
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  serveWebApp(app, directory);
  app.use((_req, res) => res.status(404).json({ message: 'API route not found.' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port.');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ['/', '/login', '/dashboard', '/auth/callback', '/stakeholders/detail']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.match(await response.text(), /Dashboard fixture/);
    }
    const asset = await fetch(`${base}/assets/app-hash.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control')!, /immutable/);
    assert.equal((await fetch(`${base}/api/health`).then(response => response.json())).status, 'ok');
    for (const path of ['/api/missing', '/assets/missing.js', '/.env', '/missing.png']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /Dashboard fixture|PRIVATE_FIXTURE/);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('production refuses to start with a missing dashboard build', () => {
  assert.throws(() => serveWebApp(express(), join(tmpdir(), 'baliktela-missing-build')), /build is missing/);
});
