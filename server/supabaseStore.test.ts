import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseStore } from './supabaseStore.js';
import { DatabaseOperationError } from './database/errors.js';
import { encodeFlowEvent, encodeRecord } from './database/codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from './database/schema.js';
import { createSeedData } from './seed.js';
import { IMPORT_RECORD_NAMES } from '../shared/imports.js';

type Row = Record<string, unknown> & { id: string };
const names = ['materialBatches','transfers','measurements','recoveryRecords','listings','offers','users',
  'organizations','facilities','walletEntries','systemInteractions'] as const;
const seed = await createSeedData();

test('export activity uses a bounded paged read of only report-export audit events in the selected dates', async () => {
  const requests: URL[] = [], start = '2026-07-31T16:00:00Z', end = '2026-10-20T04:00:00Z';
  const row = (id: string) => ({ id, actor_id: 'ADMIN', action: 'report.exported', entity_type: 'Report', entity_id: 'material-flow', details: {}, occurred_at: '2026-10-19T01:00:00Z' });
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async (input, options) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(options?.method ?? 'GET', 'GET'); assert.equal(url.pathname.split('/').at(-1), 'activity_logs');
    assert.equal(url.searchParams.get('action'), 'eq.report.exported'); assert.equal(url.searchParams.get('limit'), '500');
    assert.deepEqual(url.searchParams.getAll('occurred_at'), [`gte.${start}`, `lt.${end}`]);
    assert.ok(!url.searchParams.get('select')!.includes('*'));
    return Response.json(requests.length === 1 ? [row('A'), row('B')] : requests.length === 2 ? [row('C')] : []);
  });
  assert.deepEqual((await store.loadReportExportEvents(start, end)).map(item => item.id), ['A', 'B', 'C']);
  assert.equal(requests[1].searchParams.get('id'), 'gt.B'); assert.equal(requests[2].searchParams.get('id'), 'gt.C');
});

test('a failed export-audit page cannot masquerade as a complete partial total', async () => {
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async () => Response.json({ code: '42501', message: 'Denied' }, { status: 403 }));
  await assert.rejects(store.loadReportExportEvents('2026-08-01T00:00:00Z', '2026-10-20T00:00:00Z'), DatabaseOperationError);
});

test('stock confirmations read only their paginated audit action and fail closed on a partial feed', async () => {
  const requests: URL[] = [];
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async input => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.pathname.split('/').at(-1), 'activity_logs');
    assert.equal(url.searchParams.get('action'), 'eq.hub.stock.confirmed');
    assert.equal(url.searchParams.get('limit'), '500');
    return Response.json(requests.length === 1 ? [{ id: 'HSC-A', actor_id: 'ADMIN', action: 'hub.stock.confirmed',
      entity_type: 'facilities', entity_id: 'HUB', details: { stockKg: 0 }, occurred_at: '2026-10-23T01:00:00Z' }] : []);
  });
  assert.equal((await store.loadHubStockConfirmations())[0].id, 'HSC-A');
  assert.equal(requests[1].searchParams.get('id'), 'gt.HSC-A');
  const denied = new SupabaseStore('https://example.supabase.co', 'test-secret', async () => Response.json({ code: '42501', message: 'Denied' }, { status: 403 }));
  await assert.rejects(denied.loadHubStockConfirmations(), DatabaseOperationError);
});

test('legacy Hub authorization uses bounded read-only evidence queries, not full dashboard reads', async () => {
  for (const evidence of ['listings', 'measurements', 'hub_disposals', 'none']) {
    const paths: string[] = [];
    const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async (input, options) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!;
      paths.push(table);
      assert.equal(options?.method ?? 'GET', 'GET');
      assert.equal(url.searchParams.get('select'), 'id'); assert.equal(url.searchParams.get('limit'), '1');
      const key = table === 'listings' ? 'weighing_hub_id' : table === 'measurements' ? 'recorded_by' : 'operator_id';
      assert.equal(url.searchParams.get(key), 'eq.LEGACY-HUB');
      if (table === 'measurements') {
        assert.equal(url.searchParams.get('transfer_id'), 'is.null');
        assert.match(url.searchParams.get('or')!, /stage.eq.listing/);
        assert.match(url.searchParams.get('measured_at')!, /^lte\./);
      }
      return Response.json(table === evidence ? [{ id: 'evidence' }] : []);
    });
    assert.equal(await store.hasHubActivity('LEGACY-HUB'), evidence !== 'none');
    assert.ok(paths.length <= 3); assert.ok(paths.every(table => ['listings', 'measurements', 'hub_disposals'].includes(table)));
  }
});

test('legacy Hub authorization tolerates an absent optional disposal table but fails closed on denied evidence', async () => {
  for (const code of ['42P01', '42501']) {
    const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async input => {
      const table = new URL(String(input)).pathname.split('/').at(-1)!;
      return table === 'hub_disposals' ? Response.json({ code, message: 'private database details' }, { status: 403 }) : Response.json([]);
    });
    if (code === '42P01') assert.equal(await store.hasHubActivity('LEGACY-HUB'), false);
    else await assert.rejects(store.hasHubActivity('LEGACY-HUB'), error => error instanceof DatabaseOperationError && error.code === '42501');
  }
});
function fixture() {
  const tables = new Map<string, Row[]>();
  const row = (document: Record<string, unknown>) => {
    const { _id, ...values } = document;
    return JSON.parse(JSON.stringify({ id: String(_id), ...values })) as Row;
  };
  for (const name of names) tables.set(WEB_PERSISTENCE_COLLECTION_MAP[name], seed[name].map(record => row(encodeRecord(name, record))));
  tables.set('flow_events', seed.transfers.flatMap(transfer => transfer.events.map((event, index) =>
    row(encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1)))));
  tables.set('auth_account_security', seed.users.map(user => ({ id: `SEC-${user.id}`, user_id: user.id,
    email_verified_at: user.emailVerifiedAt, password_changed_at: user.passwordChangedAt })));
  return tables;
}
function provider(tables: Map<string, Row[]>, code = '57014', failTable = '') {
  let rpcs = 0; let reads = 0; let active = 0; let maxActive = 0;
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/rpc/')) {
      rpcs++;
      return Response.json({ code, message: 'Private provider details must not escape.' }, { status: 500 });
    }
    assert.equal(options?.method ?? 'GET', 'GET', 'Snapshot recovery must never write records.');
    reads++; active++; maxActive = Math.max(maxActive, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      const table = url.pathname.split('/').at(-1)!;
      if (table === failTable) return Response.json({ code: '42501', message: 'private permissions' }, { status: 403 });
      assert.ok(tables.has(table), `Unexpected table ${table}`);
      assert.equal(url.searchParams.get('order'), 'id.asc');
      const cursor = url.searchParams.get('id')?.replace(/^gt\./, '');
      const rows = [...tables.get(table)!].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .filter(row => cursor === undefined || row.id > cursor);
      // Simulate a provider cap below our requested size; short pages are not EOF.
      return Response.json(rows.slice(0, Math.min(73, Number(url.searchParams.get('limit')))));
    } finally { active--; }
  };
  return { fetcher, stats: () => ({ rpcs, reads, maxActive }) };
}

test('snapshot timeout falls back to bounded complete canonical reads with transfer evidence', async () => {
  const tables = fixture();
  const transfer = seed.transfers[0];
  const original = tables.get('flow_events')![0];
  tables.set('flow_events', Array.from({ length: 1205 }, (_, index) => ({ ...original,
    id: `EV-${String(index).padStart(5,'0')}`, transfer_id: transfer.id, sequence: index + 1 })));
  const providerMock = provider(tables);
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', providerMock.fetcher);
  const snapshot = (await store.loadDashboardSnapshot())!;
  assert.equal(snapshot.allBatches.length, seed.materialBatches.length);
  assert.equal(snapshot.allTransfers.length, seed.transfers.length);
  assert.equal(snapshot.measurements.length, seed.measurements.length);
  assert.equal(snapshot.allTransfers[0].events.length, 1205);
  assert.equal(snapshot.allTransfers[0].events[1204].id, 'EV-01204');
  assert.equal(snapshot.allTransfers[0].verifiedWeightKg, seed.measurements.filter(item => item.transferId === transfer.id && item.stage === 'Validation')
    .sort((a,b) => Date.parse(b.timestamp)-Date.parse(a.timestamp))[0]?.weightKg ?? null);
  assert.equal(snapshot.offers[0].listingTitle, seed.listings.find(item => item.id === snapshot.offers[0].listingId)?.title);
  assert.equal(snapshot.users[0].emailVerifiedAt, seed.users[0].emailVerifiedAt);
  assert.ok(providerMock.stats().maxActive <= 2);
  await store.loadDashboardSnapshot();
  assert.equal(providerMock.stats().rpcs, 1, 'Timeout cooldown must avoid repeating the expensive RPC.');
});

test('missing optimized snapshot function uses canonical fallback without a migration', async () => {
  const mock = provider(fixture(), 'PGRST202');
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', mock.fetcher);
  assert.equal((await store.loadDashboardSnapshot())?.allTransfers.length, seed.transfers.length);
});

test('snapshot permission failures are not masked by fallback reads', async () => {
  const mock = provider(fixture(), '42501');
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', mock.fetcher);
  await assert.rejects(store.loadDashboardSnapshot(), error => error instanceof DatabaseOperationError && error.code === '42501');
  assert.equal(mock.stats().reads, 0);
});

test('a failed fallback table cannot return a partial snapshot or false empty records', async () => {
  const mock = provider(fixture(), '57014', 'transfers');
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', mock.fetcher);
  await assert.rejects(store.loadDashboardSnapshot(), error => error instanceof DatabaseOperationError && error.operation === 'read transfers');
});

test('healthy optimized snapshot stays on the single-RPC path', async () => {
  let requests = 0;
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async input => {
    assert.match(String(input), /\/rpc\/get_dashboard_source_snapshot$/); requests++;
    return Response.json(Object.fromEntries(names.map(name => [name, []])));
  });
  assert.equal((await store.loadDashboardSnapshot())?.allTransfers.length, 0);
  assert.equal(requests, 1);
});

test('import lookups read only requested IDs and conflict fields, without joining full histories', async()=>{
  let active=0,maxActive=0,requests=0;
  const store=new SupabaseStore('https://example.supabase.co','test-secret',async(input,options)=>{
    const url=new URL(String(input));requests++;active++;maxActive=Math.max(maxActive,active);
    try {
      await new Promise(resolve=>setTimeout(resolve,1));
      assert.equal(options?.method??'GET','GET');assert.ok(!url.pathname.includes('/rpc/'));
      const table=url.pathname.split('/').at(-1)!;
      assert.ok(['material_batches','listings','match_requests','transfers','measurements','recovery_records'].includes(table));
      const selection=url.searchParams.get('select')!;assert.notEqual(selection,'*');assert.ok(!selection.includes('email'));
      const filters=url.searchParams.getAll('id');assert.ok(filters.some(value=>value.startsWith('in.')));
      assert.equal(url.searchParams.get('order'),'id.asc');
      if(filters.some(value=>value.startsWith('gt.')))return Response.json([]);
      return Response.json([{id:'target',is_demo:true,description:'Synthetic import fingerprint'}]);
    }finally{active--;}
  });
  const rows=await store.lookupImportRecords(IMPORT_RECORD_NAMES.map(name=>({name,ids:['target','missing']})));
  assert.equal(rows.length,6);assert.equal(requests,12);assert.ok(maxActive<=2);
  assert.equal(rows.find(item=>item.name==='listings')?.description,'Synthetic import fingerprint');
  assert.equal(rows.find(item=>item.name==='materialBatches')?.isDemo,true);
});
