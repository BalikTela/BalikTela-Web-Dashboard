import { config } from 'dotenv';
import assert from 'node:assert/strict';
import { SupabaseStore } from '../server/supabaseStore.js';
import { aggregateMaterialEvidence } from '../server/materialEvidence.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from '../server/dashboardAnalytics.js';
import { buildOperationalDemo } from '../server/analytics/operationalDemo.js';
import { buildOctoberDemo } from '../server/analytics/octoberDemo.js';
import { createSeedData } from '../server/seed.js';
import type { DatabaseShape } from '../server/types.js';

config({ path: '.env.supabase', quiet: true });
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL || !key) throw new Error('Supabase URL and server key are required in the ignored local profile.');
const store = new SupabaseStore(process.env.SUPABASE_URL, key);
try {
  const snapshot = await loadDashboardAnalyticsSnapshot(store);
  const expected = [buildOperationalDemo(), buildOctoberDemo()];
  const rows = <K extends keyof DatabaseShape>(name: K): DatabaseShape[K] => {
    const result: Array<DatabaseShape[K][number]> = [];
    for (const data of expected) result.push(...(data.domainTables.find(([key]) => key === name)?.[1] ?? []) as Array<DatabaseShape[K][number]>);
    return result as DatabaseShape[K];
  };
  const batchIds = new Set(rows('materialBatches').map(item => item.id));
  const batches = snapshot.allBatches.filter(item => batchIds.has(item.id));
  assert.equal(batches.length, batchIds.size); assert.ok(batches.every(item => item.isDemo));
  const synthetic = { batches, transfers: snapshot.allTransfers.filter(item => batchIds.has(item.batchId)),
    recovery: snapshot.recoveryRecords.filter(item => batchIds.has(item.batchId)),
    measurements: snapshot.measurements.filter(item => batchIds.has(item.batchId)), listings: snapshot.listings.filter(item => batchIds.has(item.batchId)) };
  const actual = aggregateMaterialEvidence(batches, synthetic.transfers, synthetic.recovery, synthetic);
  const planned = aggregateMaterialEvidence(rows('materialBatches'), rows('transfers'), rows('recoveryRecords'), { measurements: rows('measurements'), listings: rows('listings') });
  for (const field of ['generatedKg', 'collectedKg', 'sortedKg', 'reusedKg', 'recycledKg', 'completedKg', 'transactionCount', 'diversionRate', 'collectionConflicts', 'outcomeConflicts', 'unlinkedOutcomeKg', 'missingCollectionBatches'] as const) assert.equal(actual[field], planned[field], `Live synthetic ${field} must match the generated fixture.`);
  // This internal fixture actor selects platform scope without logging in, creating sessions or altering accounts.
  const actor = (await createSeedData()).users[0];
  const now = new Date();
  const data = await buildDashboardAnalytics(store, actor, { dateRange: 'Last 90 days' }, snapshot, now);
  const sum = (values: number[]) => Number(values.reduce((total, value) => total + value, 0).toFixed(6));
  assert.equal(sum(data.wasteTrend.map(item => item.collected)), data.circularFlow.collectedKg);
  assert.equal(sum(data.wasteTrend.map(item => item.recycled)), data.circularFlow.recycledKg);
  assert.equal(sum(data.wasteTrend.map(item => item.reused)), data.circularFlow.reusedKg);
  assert.equal(sum(data.regionalActivity.map(item => item.collectionKg)), data.circularFlow.collectedKg);
  assert.equal(sum(data.regionalActivity.map(item => item.recyclingKg)), data.circularFlow.recycledKg);
  assert.equal(data.impactMetrics.landfillAvoidedKg, null);
  process.stdout.write(JSON.stringify({ action: 'read-only-verification', matchedSyntheticBatches: batches.length,
    matchedSyntheticTransfers: synthetic.transfers.length, allTimeSyntheticKg: { declared: actual.generatedKg, collected: actual.collectedKg,
      reused: actual.reusedKg, recycled: actual.recycledKg, completedTransfers: actual.completedKg, confirmedRecoveryShare: actual.diversionRate },
    overviewPeriod: data.metadata.periodLabel, overview: data.kpis.slice(0, 5).map(item => ({ label: item.label, value: item.value })),
    evidence: data.materialEvidence, chartsAndRegionsReconciled: true, environmentalEquivalentsDisabled: true,
    writes: 0 }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ action: 'verification-failed', message: error instanceof assert.AssertionError ? error.message : 'Live read-only verification failed. No records were changed.' }) + '\n');
  process.exitCode = 1;
} finally { await store.close(); }
