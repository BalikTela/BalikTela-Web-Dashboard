import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHubSimulation, HUB_SIMULATION_AT } from './analytics/hubSimulation.js';
import { buildOperationalDemo } from './analytics/operationalDemo.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { loadDashboardAnalyticsSnapshot, buildDashboardAnalytics } from './dashboardAnalytics.js';
import { buildHubStorageAnalytics } from './hubStorage.js';
import { buildHubOperations } from './hubOperations.js';
import { buildHubDirectory, buildHubDisposalMonitoring } from './hubs.js';
import { isApprovedHub } from '../shared/hubs.js';
import { hasPermission } from './access-control.js';
import { HUB_SIMULATION_PREFIX, isStorageSimulationOperator } from '../shared/hubStorage.js';

export async function simulationFixture() {
  const data = await createSeedData();
  const demo = buildOperationalDemo();
  const additional = demo.domainTables.find(([name]) => name === 'facilities')![1] as typeof data.facilities;
  data.facilities.push(...additional);
  const simulation = buildHubSimulation(data.facilities);
  data.users = [data.users[0], ...simulation.users];
  data.materialBatches = simulation.materialBatches; data.listings = simulation.listings; data.measurements = simulation.measurements;
  data.transfers = []; data.offers = []; data.recoveryRecords = []; data.walletEntries = []; data.systemInteractions = [];
  const store = new MemoryStore(data), source = await loadDashboardAnalyticsSnapshot(store);
  source.hubDisposals = { available: true, records: simulation.disposals };
  return { data, simulation, store, source, actor: data.users[0], now: new Date(HUB_SIMULATION_AT) };
}

test('small Hub fixture connects seven existing Hubs without login accounts, public stock, rewards or duplicate Hub records', async () => {
  const { data, simulation, source, actor, now } = await simulationFixture();
  assert.equal(data.facilities.length, 7); assert.equal(simulation.materialBatches.length, 7);
  assert.equal(simulation.measurements.length, 12); assert.equal(simulation.disposals.length, 4);
  assert.ok(simulation.users.every(item => item.authUserId === null && item.passwordHash === null && item.accountStatus === 'Deactivated'));
  assert.ok(simulation.users.every(item => !isApprovedHub(item)));
  assert.ok(simulation.users.every(item => !hasPermission(item, 'hubs.manage') && !hasPermission(item, 'analytics.read')));
  assert.ok(simulation.users.filter(item => item.stakeholder === 'BalikTela Hub').every(isStorageSimulationOperator));
  assert.ok(simulation.users.filter(item => item.stakeholder === 'BalikTela Hub').every(item => isStorageSimulationOperator({ ...item, stakeholder: '' } as typeof item)), 'Compact snapshots omit stakeholder labels.');
  assert.ok(simulation.users.every(item => !isStorageSimulationOperator({ ...item, authUserId: 'real-auth-identity' })));
  assert.ok(simulation.users.every(item => !isStorageSimulationOperator({ ...item, passwordHash: 'credential' })));
  assert.ok(simulation.listings.every(item => item.isDemo && item.availableWeightKg === 0 && item.status !== 'Open' && item.rewardCredits === 0));
  const result = buildHubStorageAnalytics(source, data.facilities, actor, now);
  for (const expected of simulation.scenarios) {
    const row = result.rows.find(item => item.id === expected.hubId)!;
    assert.equal(row.storedKg, expected.heldKg); assert.equal(row.reservedKg, expected.reservedKg);
    assert.equal(row.disposedKg, expected.disposedKg); assert.equal(row.containsSimulation, true);
    assert.equal(row.simulationOnly, true); assert.equal(row.selectable, false);
    assert.equal(row.status, expected.heldKg + expected.reservedKg >= expected.capacityKg * .9 ? 'Intake paused' : 'Available');
  }
});

test('Hub Management excludes disabled simulation-only profiles and counts without deleting historical evidence', async () => {
  const { source, actor, store } = await simulationFixture();
  const before=JSON.stringify(source);
  const hidden=await buildHubDirectory(store,actor,{},source);
  assert.deepEqual(hidden.hubs,[]);
  assert.deepEqual(hidden.regions,[]);
  assert.equal(hidden.summary.operators,0);
  assert.equal(hidden.summary.suspended,0);
  assert.equal(hidden.summary.unassignedFacilities,0);
  assert.equal(JSON.stringify(source),before,'Directory filtering must not change the source records or linked history.');

  const real={...structuredClone(actor),id:'REGISTERED-HUB',role:'BalikTela Hub' as const,authUserId:'registered-auth-id',
    fullName:'Registered Hub operator',email:'registered@example.test',organizationVerified:true,accountStatus:'Active' as const,
    scope:{...actor.scope,facilityIds:['FAC-001']}};
  source.users.push(real,
    {...structuredClone(real),id:'PENDING-HUB',organizationVerified:false,accountStatus:'Pending verification'},
    {...structuredClone(real),id:'SUSPENDED-HUB',accountStatus:'Suspended'},
    {...structuredClone(real),id:'REJECTED-HUB',organizationVerified:false,canonicalVerification:'rejected'});
  // A real identity must not be hidden merely because an old simulation identifier remains.
  const linked={...structuredClone(source.users.find(isStorageSimulationOperator)!),id:`${HUB_SIMULATION_PREFIX}OP-LINKED`,authUserId:'actual-auth-link'};
  source.users.push(linked);
  const result=await buildHubDirectory(store,actor,{},source);
  assert.deepEqual(new Set(result.hubs.map(item=>item.id)),new Set([real.id,'PENDING-HUB','SUSPENDED-HUB','REJECTED-HUB',linked.id]));
  assert.equal(result.summary.operators,5);
  assert.equal(result.summary.approved,1);
  assert.equal(result.summary.pending,1);
  assert.equal(result.summary.suspended,2);
  const government={...actor,role:'Government' as const,scope:{...actor.scope,aggregateOnly:true}};
  const regional=await buildHubDirectory(store,government,{},source);
  assert.deepEqual(regional.hubs,[]);
  assert.equal(regional.summary.operators,5);
  assert.equal(regional.regions.reduce((sum,row)=>sum+row.operators,0),5);
  assert.equal((await buildHubDirectory(store,actor,{region:'Central Visayas'},source)).summary.operators,0);
});

test('one complete synthetic lifecycle reserves, receives, pauses, partially disposes and reopens using the production calculators', async () => {
  const { data, source, actor, now } = await simulationFixture();
  const hubId = 'FAC-001', batchId = `${HUB_SIMULATION_PREFIX}BAT-${hubId}`;
  const receipt = source.measurements.find(item => item.batchId === batchId && item.canonicalStage === 'collection')!;
  const disposal = source.hubDisposals!.records.find(item => item.listingId === `${HUB_SIMULATION_PREFIX}LST-${hubId}`)!;
  source.measurements = source.measurements.filter(item => item.id !== receipt.id);
  source.hubDisposals!.records = source.hubDisposals!.records.filter(item => item.id !== disposal.id);
  const read = () => buildHubStorageAnalytics(source, data.facilities, actor, now).rows.find(item => item.id === hubId)!;
  let row = read(); assert.equal(row.storedKg, 0); assert.equal(row.reservedKg, 1800); assert.equal(row.status, 'Intake paused');
  source.measurements.push(receipt); row = read();
  assert.equal(row.storedKg, 1800); assert.equal(row.reservedKg, 0); assert.equal(row.status, 'Intake paused');
  source.hubDisposals!.records.push(disposal, { ...disposal }); row = read();
  assert.equal(row.storedKg, 1000); assert.equal(row.utilization, 50); assert.equal(row.status, 'Available');
  assert.equal(row.availableToReceiveKg, 800);
});

test('compact snapshot simulation starts empty without using missing stakeholder metadata or granting approval', async () => {
  const { source, actor } = await simulationFixture();
  source.users = source.users.map(user => ({ ...user, stakeholder: '' }));
  const result = buildHubStorageAnalytics(source, source.facilities, actor, new Date('2026-10-20T00:30:00Z'));
  assert.ok(result.rows.every(row => row.simulationOnly && row.status === 'Available' && row.storedKg === 0 && !row.selectable));
});

test('Overview, Registry source, Recovery Monitoring and storage reconcile the same simulation masses without invented transactions', async () => {
  const { simulation, source, actor, store, now } = await simulationFixture();
  const data = await buildDashboardAnalytics(store, actor, {}, source, now);
  assert.equal(data.kpis[0].value, '20.5 t');
  const operations = buildHubOperations(source, source.allBatches, actor, 'Simulation', now);
  assert.equal(operations.summary.sentKg, 20500); assert.equal(operations.summary.collectedKg, 17250);
  assert.equal(operations.summary.disposedKg, 2900);
  const ledger = await buildHubDisposalMonitoring(store, actor, {}, now, source);
  assert.equal(ledger.summary.disposedKg, 2900);
  assert.equal(data.hubStorage.rows.reduce((sum, row) => sum + row.storedKg!, 0), 14350);
  assert.equal(data.hubStorage.rows.reduce((sum, row) => sum + row.reservedKg!, 0), 3250);
  assert.equal(data.sharedActivity.completedTransfers, 0);
  assert.ok(data.engagementMetrics.registeredAccounts <= 1, 'Non-login fixtures must not inflate registered account counts.');
  assert.ok(simulation.materialBatches.every(item => simulation.listings.some(listing => listing.batchId === item.id)));
});
