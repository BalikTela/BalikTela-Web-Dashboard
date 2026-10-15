import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncTtlCache, dashboardAnalyticsCacheKey } from './asyncCache.js';
import type { UserRecord } from './types.js';

test('async cache reuses fresh values and expires them', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new AsyncTtlCache<number>(100, 10, () => now);
  const create = async () => ++calls;

  assert.deepEqual(await cache.getOrCreate('dashboard', create), { value: 1, status: 'MISS' });
  assert.deepEqual(await cache.getOrCreate('dashboard', create), { value: 1, status: 'HIT' });
  now += 101;
  assert.deepEqual(await cache.getOrCreate('dashboard', create), { value: 2, status: 'MISS' });
});

test('async cache coalesces concurrent requests and supports invalidation', async () => {
  let resolve!: (value: number) => void;
  const cache = new AsyncTtlCache<number>(1_000, 10);
  const first = cache.getOrCreate('dashboard', () => new Promise<number>((done) => { resolve = done; }));
  const second = cache.getOrCreate('dashboard', async () => 2);
  resolve(1);

  assert.deepEqual(await first, { value: 1, status: 'MISS' });
  assert.deepEqual(await second, { value: 1, status: 'COALESCED' });
  cache.clear();
  assert.equal(cache.size, 0);
});

test('dashboard cache keys isolate user scope and normalize filters', () => {
  const actor = {
    id: 'USR-1', role: 'Researcher', organizationId: 'ORG-1',
    scope: { aggregateOnly: true, canExport: false, facilityIds: ['FAC-2', 'FAC-1'], organizationIds: ['ORG-1'], regions: ['Metro Manila'] },
  } as UserRecord;
  const equivalent = { ...actor, scope: { ...actor.scope, facilityIds: ['FAC-1', 'FAC-2'] } };

  assert.equal(dashboardAnalyticsCacheKey(actor, { region: 'Metro Manila', city: '' }), dashboardAnalyticsCacheKey(equivalent, { city: '', region: 'Metro Manila' }));
  assert.notEqual(dashboardAnalyticsCacheKey(actor, { region: 'Metro Manila' }), dashboardAnalyticsCacheKey({ ...actor, id: 'USR-2' }, { region: 'Metro Manila' }));
});

test('invalidating during a read cannot repopulate the cache with pre-write data',async()=>{
  const cache=new AsyncTtlCache<number>(1000,10);
  let resolve!: (value:number)=>void;
  const old=cache.getOrCreate('dashboard',()=>new Promise<number>(done=>{resolve=done;}));
  cache.clear();
  assert.equal((await cache.getOrCreate('dashboard',async()=>2)).value,2);
  resolve(1);await old;
  assert.deepEqual(await cache.getOrCreate('dashboard',async()=>3),{value:2,status:'HIT'});
});
