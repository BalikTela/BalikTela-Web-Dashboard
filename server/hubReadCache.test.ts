import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { setTimeout as wait } from 'node:timers/promises';
import { AsyncTtlCache } from './asyncCache.js';
import { issueToken } from './auth.js';
import { registerHubRoutes } from './hubs.js';
import { loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { installRuntimeMonitoring } from './runtimeMonitoring.js';

test('Hub reads share one in-flight snapshot, cache by scope, invalidate on writes and leave health available', async () => {
  const data = await createSeedData(), actor = data.users[0], store = new MemoryStore(data);
  const source = await loadDashboardAnalyticsSnapshot(store);
  source.hubDisposals = { available:true, records:[] };
  const snapshots = new AsyncTtlCache<typeof source>(60_000,1);
  const responses = new AsyncTtlCache<unknown>(30_000,24);
  let loads = 0;
  const reader = async () => (await snapshots.getOrCreate('current',async () => { loads++; await wait(100); return source; })).value;
  const sessionId = 'HUB-CACHE-TEST', at = new Date().toISOString();
  await store.createSession({ id:sessionId,userId:actor.id,client:'api',tokenHash:'test',usedTokenHashes:[],csrfHash:'test',
    expiresAt:new Date(Date.now()+60_000).toISOString(),revokedAt:null,createdAt:at,updatedAt:at });
  const headers = { authorization:`Bearer ${issueToken(actor.id,actor.role,sessionId)}` };
  const app = express();
  app.get('/api/health',(_req,res) => res.json({ status:'ok' }));
  registerHubRoutes(app,store,reader,responses);
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const get = async (path:string) => { const res = await fetch(`${base}${path}`,{headers});assert.equal(res.status,200);return res; };
  try {
    let settled = false;
    const requests = Promise.all(['/api/hubs','/api/hubs','/api/hub-disposals','/api/hub-operations'].map(get)).then(result => { settled=true;return result; });
    await wait(15);
    assert.equal((await (await get('/api/health')).json()).status,'ok');
    assert.equal(settled,false,'A pending database read must not prevent health responses.');
    const results = await requests;
    assert.equal(loads,1,'All Hub tabs must use the shared in-flight source read.');
    assert.ok(results[0].headers.get('server-timing')?.includes('hub;dur='));
    assert.ok(results[1].headers.get('x-baliktela-cache') === 'COALESCED' || results[1].headers.get('x-baliktela-cache') === 'HIT');
    assert.equal((await get('/api/hubs')).headers.get('x-baliktela-cache'),'HIT');
    assert.equal((await get('/api/hubs?region=Central%20Visayas')).headers.get('x-baliktela-cache'),'MISS');
    assert.equal(loads,1,'A different filter reuses source data, never another user response.');
    snapshots.clear();responses.clear();
    await get('/api/hubs');assert.equal(loads,2);
    await store.revokeSession(sessionId,actor.id,new Date().toISOString());
    assert.equal((await fetch(`${base}/api/hubs`,{headers})).status,401,'Cached responses must never bypass current session checks.');
    assert.equal((await fetch(`${base}/api/hub-operations`)).status,401);
  } finally { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('slow request diagnostics contain route templates, not query strings, credentials or record IDs', async () => {
  const app = express(), messages:unknown[] = [];
  const stop = installRuntimeMonitoring(app,{slowRequestMs:0,log:(message,details) => messages.push({message,...details})});
  app.get('/api/private/:id',(_req,res) => res.json({ok:true}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address=server.address();assert.ok(address && typeof address !== 'string');
  try {
    await fetch(`http://127.0.0.1:${address.port}/api/private/secret-record?token=private-token`,{headers:{authorization:'Bearer private-credential'}});
    assert.ok(JSON.stringify(messages).includes('/api/private/:id'));
    for(const secret of ['secret-record','private-token','private-credential']) assert.ok(!JSON.stringify(messages).includes(secret));
  } finally { stop();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
});
