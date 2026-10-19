import assert from 'node:assert/strict';
import test from 'node:test';
import { canModerateListing, listingDisplayStatus, matchesTransferStatus } from '../shared/workflows.js';
import { filterListings, emptyListingFilters } from '../src/lib/listingFilters.js';
import { canActOnTransfer, hasPermission, scopeRecoveryRecords } from './access-control.js';
import { buildHubDirectory, buildHubDisposalMonitoring } from './hubs.js';
import { buildGovernance } from './governance.js';
import { buildDataQuality, QUALITY_CHECKS } from './dataQuality.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { canonicalMutations } from './database/mutations.js';

const now=new Date('2026-10-19T04:00:00Z');
test('displayed listing status, filters and moderation agree on disposal and remainder locks',async()=>{
  const seed=await createSeedData(),base=seed.listings[0];
  for(const [patch,label] of [[{disposedAt:now.toISOString()},'Disposed'],[{disposedWeightKg:2},'Partially disposed'],[{remainderPending:true},'Remainder pending']] as const){
    const listing={...base,...patch};assert.equal(listingDisplayStatus(listing),label);assert.equal(canModerateListing(listing),false);
    assert.equal(filterListings([listing],'',{...emptyListingFilters,status:label}).length,1);
    assert.equal(filterListings([listing],'',{...emptyListingFilters,status:'Open'}).length,0);
  }
  assert.equal(canModerateListing({...base,reservedKg:1}),false);
  assert.equal(canModerateListing({...base,status:'Unknown'}),false);
});

test('native mobile transfer states use one status grouping in both analytics and traceability',()=>{
  for(const state of ['Completed','Processed'])assert.equal(matchesTransferStatus(state,'Completed'),true);
  for(const state of ['Handed over','Collected','In progress'])assert.equal(matchesTransferStatus(state,'In transit'),true);
  for(const state of ['Received','Processing'])assert.equal(matchesTransferStatus(state,'In sorting'),true);
  for(const state of ['Reserved','Accepted'])assert.equal(matchesTransferStatus(state,'Pending validation'),true);
  assert.equal(matchesTransferStatus('Validated','Pending validation'),false);
  assert.equal(matchesTransferStatus('Closed','Completed'),false);
  assert.equal(matchesTransferStatus('Unknown','Completed'),false);
});

test('processing and collection events persist with native stages rather than null stages',async()=>{
  const seed=await createSeedData(),transfer=seed.transfers[0];
  const writes=canonicalMutations([{name:'transfers',record:{...transfer,events:[{...transfer.events[0],id:'PROCESSING',type:'Processing'},{...transfer.events[0],id:'COLLECTION',type:'Collection'}]}}]);
  assert.deepEqual(writes.filter(item=>item.table==='flow_events').map(item=>item.values.stage),['processing','collection']);
});

test('completed mobile activity never substitutes an agreed quantity when its final weight is missing',async()=>{
  const seed=await createSeedData();seed.transfers[0].receiptWeightKg=null;seed.transfers[0].verifiedWeightKg=null;seed.measurements=[];
  const view=await buildDashboardAnalytics(new MemoryStore(seed),seed.users[0],{},undefined,now);
  assert.equal(view.transactions[0].weightKg,null);assert.equal(view.transactions[0].weightEvidence,'Final weight missing');
});

test('Producer and Consumer cannot cross supply, request or verification roles, even for an owned historical transfer',async()=>{
  const seed=await createSeedData(),producer=seed.users.find(user=>user.role==='Producer')!,consumer=seed.users.find(user=>user.role==='Consumer')!;
  assert.equal(hasPermission(producer,'listings.create'),true);assert.equal(hasPermission(producer,'offers.create'),false);
  assert.equal(hasPermission(consumer,'offers.create'),true);assert.equal(hasPermission(consumer,'listings.create'),false);
  assert.equal(hasPermission(consumer,'analytics.read'),false);assert.equal(hasPermission(consumer,'batches.manage'),false);
  const transfer={providerId:producer.id,recipientId:consumer.id};
  assert.equal(canActOnTransfer(producer,transfer,'handover'),true);assert.equal(canActOnTransfer(consumer,transfer,'receipt'),true);
  for(const action of ['validate','complete']){assert.equal(canActOnTransfer(consumer,transfer,action),false);assert.equal(canActOnTransfer(producer,{...transfer,recipientId:producer.id},action),false);}
  assert.equal(canActOnTransfer(consumer,{...transfer,providerId:consumer.id},'handover'),false);
  assert.equal(canActOnTransfer(producer,{...transfer,recipientId:producer.id},'receipt'),false);
});

test('Hub disposal ledger preserves archived history, excludes invalid/future weights, protects identities and never claims diversion',async()=>{
  const seed=await createSeedData(),admin=seed.users[0],hub={...seed.users.find(user=>user.role==='Recycler')!,organizationVerified:true};
  seed.users[seed.users.findIndex(user=>user.id===hub.id)]=hub;
  const listing=seed.listings[0];listing.weighingHubId=hub.id;seed.materialBatches[0].currentStatus='Archived';
  const base={id:'DIS-1',listingId:listing.id,operatorId:hub.id,listingTitle:listing.title,category:'Cotton',weightKg:5,reason:'Damaged textile disposal',disposedAt:'2026-10-18T01:00:00Z'};
  class DisposalStore extends MemoryStore { async loadHubDisposals(){return {available:true,records:[base,{...base},{...base,id:'BAD',weightKg:-2},{...base,id:'FUTURE',disposedAt:'2027-01-01T00:00:00Z'},{...base,id:'ORPHAN',listingId:'MISSING'}]};} }
  const store=new DisposalStore(seed),before=structuredClone(seed);
  const view=await buildHubDisposalMonitoring(store,admin,{dateRange:'All time'},now);
  assert.equal(view.summary.records,1);assert.equal(view.summary.disposedKg,5);assert.equal(view.summary.invalidRecords,1);assert.equal(view.summary.missingLinks,1);assert.equal(view.landfillAvoidedKg,null);
  assert.equal((await buildHubDisposalMonitoring(store,hub,{dateRange:'All time'},now)).summary.disposedKg,5);
  const consumer=seed.users.find(user=>user.role==='Consumer')!;
  assert.equal((await buildHubDisposalMonitoring(store,consumer,{dateRange:'All time'},now)).summary.records,0);
  const government=seed.users.find(user=>user.role==='Government')!;
  const aggregate=await buildHubDisposalMonitoring(store,government,{dateRange:'All time'},now);
  assert.equal(aggregate.records.length,0);assert.equal(aggregate.summary.disposedKg,5);
  assert.ok(!JSON.stringify(aggregate).includes(hub.id));assert.ok(!JSON.stringify(aggregate).includes(listing.id));
  assert.equal((await buildHubDisposalMonitoring(store,admin,{region:'Central Visayas',dateRange:'All time'},now)).summary.records,0);
  assert.deepEqual(seed,before);
});

test('approved Hub recovery monitoring includes assigned batches but directory never exposes unrelated operators',async()=>{
  const seed=await createSeedData(),hub={...seed.users.find(user=>user.role==='Recycler')!,role:'BalikTela Hub' as const,organizationId:null,organizationVerified:true,scope:{organizationIds:[],facilityIds:[],regions:[],canExport:false,aggregateOnly:false}};
  seed.users[seed.users.findIndex(user=>user.id===hub.id)]=hub;
  seed.listings.find(item=>item.batchId===seed.recoveryRecords[0].batchId)!.weighingHubId=hub.id;
  const snapshot=await loadDashboardAnalyticsSnapshot(new MemoryStore(seed));
  assert.equal(scopeRecoveryRecords(hub,seed.recoveryRecords,snapshot).length,seed.recoveryRecords.length);
  assert.equal(scopeRecoveryRecords({...hub,organizationVerified:false},seed.recoveryRecords.map(item=>({...item,recordedBy:'OTHER'})),snapshot).length,0);
  const directory=await buildHubDirectory(new MemoryStore(seed),hub);
  assert.deepEqual(directory.hubs.map(user=>user.id),[hub.id]);
});

test('facility capacity includes idle matching sites, preserves record labels, and never invents processing duration',async()=>{
  const seed=await createSeedData();seed.facilities.push({...seed.facilities[0],id:'IDLE',name:'Idle operational Hub',isDemo:false,monthlyCapacityKg:100});
  const result=await buildDashboardAnalytics(new MemoryStore(seed),seed.users[0],{},undefined,now);
  const idle=result.facilities.find(item=>item.id==='IDLE')!;
  assert.ok(idle);assert.equal(idle.intakeKg,0);assert.equal(idle.processedAvailable,false);assert.equal(idle.isDemo,false);assert.equal(idle.processingTimeDays,0);assert.ok(idle.capacityKg>0);
});

test('quality checks identify missing geography, dangling listing links and stage imbalance with explicit source rules',async()=>{
  const seed=await createSeedData();seed.materialBatches[0].city='';seed.transfers[0].listingId='MISSING';seed.recoveryRecords[0].outputWeightKg=1000;
  const snapshot=await loadDashboardAnalyticsSnapshot(new MemoryStore(seed));
  const result=buildDataQuality(seed.users[0],seed.materialBatches,seed.transfers,5,now,snapshot);
  for(const category of ['Location incomplete','Broken lifecycle reference','Stage mass imbalance'])assert.ok(result.issues.some(item=>item.category===category));
  assert.equal(result.checkedBatches,seed.materialBatches.length);assert.deepEqual(result.checks,QUALITY_CHECKS);
  const aggregate=buildDataQuality({...seed.users[0],scope:{...seed.users[0].scope,aggregateOnly:true}},seed.materialBatches,seed.transfers,5,now,snapshot);
  for(const item of seed.materialBatches)assert.ok(!JSON.stringify(aggregate).includes(item.id));
});

test('governance matches current recovery formula and actual export permission without prescriptive or compliance claims',async()=>{
  const seed=await createSeedData(),admin={...seed.users[0],scope:{...seed.users[0].scope,canExport:false}};
  const view=buildGovernance(admin,seed.configurations[0]);assert.equal(view.privacy.exportAllowed,true);
  assert.match(view.methodology.massAccounting,/validated collection/);assert.ok(!('prescriptiveAnalytics' in view.methodology));
  assert.match(view.methodology.predictiveAnalytics,/synthetic/);assert.match(view.methodology.environmentalImpact,/not calculated/);
  const researcher=seed.users.find(user=>user.role==='Researcher')!;
  assert.equal(buildGovernance({...researcher,scope:{...researcher.scope,canExport:false}},null).privacy.exportAllowed,false);
});
