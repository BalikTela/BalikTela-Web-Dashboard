import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import type { DashboardSourceSnapshot, Store } from './store.js';

const emptySnapshot: DashboardSourceSnapshot = {
  allBatches: [], allTransfers: [], measurements: [], recoveryRecords: [], listings: [], offers: [],
  users: [], organizations: [], facilities: [], walletEntries: [], interactions: [],
};

test('dashboard snapshot uses the optimized persistence adapter when available', async () => {
  let legacyReads = 0;
  const store = {
    loadDashboardSnapshot: async () => emptySnapshot,
    all: async () => { legacyReads += 1; return []; },
  } as unknown as Store;

  assert.equal(await loadDashboardAnalyticsSnapshot(store), emptySnapshot);
  assert.equal(legacyReads, 0);
});

test('dashboard snapshot falls back to canonical collection reads', async () => {
  let legacyReads = 0;
  const store = {
    loadDashboardSnapshot: async () => null,
    all: async () => { legacyReads += 1; return []; },
  } as unknown as Store;

  assert.deepEqual(await loadDashboardAnalyticsSnapshot(store), emptySnapshot);
  assert.equal(legacyReads, 11);
});
