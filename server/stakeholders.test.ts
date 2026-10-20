import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { identifyHubOperators } from './stakeholders.js';
import { stakeholderGroupFor } from '../src/lib/stakeholderGroups.js';
import { permissionsFor } from './access-control.js';

const now=new Date('2026-10-19T04:00:00Z');
async function fixture(){
  const data=await createSeedData(),admin=data.users[0],recycler=data.users.find(item=>item.role==='Recycler')!,consumer=data.users.find(item=>item.role==='Consumer')!;
  const hub={...structuredClone(recycler),id:'ACTUAL-HUB',fullName:'Metro Hub operator',organizationId:null,organization:'',city:'',region:'',role:'Recycler' as const,
    organizationVerified:true,accountStatus:'Active' as const,canonicalVerification:'verified',scope:{...recycler.scope,facilityIds:[]}};
  const idle={...structuredClone(hub),id:'IDLE-HUB',fullName:'Cebu Hub operator',role:'BalikTela Hub' as const,city:'Cebu City',region:'Central Visayas',organizationVerified:false};
  data.users.push(hub,idle);
  const batch={...data.materialBatches[0],id:'ACTUAL-HUB-BATCH',region:'Metro Manila',createdAt:'2026-10-15T01:00:00Z',updatedAt:'2026-10-17T01:00:00Z',isDemo:false};
  data.materialBatches.push(batch);
  const listing={...data.listings[0],id:'ACTUAL-HUB-LISTING',batchId:batch.id,title:'Linen through Metro Hub',weighingHubId:hub.id,deliveryRoute:'via_hub' as const,quantityKg:95,
    availableWeightKg:0,reservedKg:0,status:'Completed' as const,createdAt:batch.createdAt,isDemo:false};
  data.listings.push(listing);
  data.transfers.push({...data.transfers[0],id:'ACTUAL-HUB-TRANSFER',listingId:listing.id,batchId:batch.id,recipientId:consumer.id,status:'Processed',
    receiptWeightKg:95,verifiedWeightKg:null,events:[],createdAt:batch.createdAt,updatedAt:batch.updatedAt,isDemo:false});
  const reading={...data.measurements[0],batchId:batch.id,transferId:null,canonicalStage:'listing' as const,stage:'Declaration' as const,recordedBy:hub.id,
    verifiedBy:hub.id,method:'Hub scale',status:'Verified' as const};
  data.measurements.push({...reading,id:'ACTUAL-HUB-OLD',weightKg:100,timestamp:'2026-10-15T02:00:00Z'},
    {...reading,id:'ACTUAL-HUB-NEW',weightKg:95,timestamp:'2026-10-16T02:00:00Z',supersedesMeasurementId:'ACTUAL-HUB-OLD'},
    {...reading,id:'ACTUAL-HUB-ESTIMATE',weightKg:999,status:'Estimated',timestamp:'2026-10-17T02:00:00Z'},
    {...reading,id:'ACTUAL-HUB-FUTURE',weightKg:800,timestamp:'2026-10-20T02:00:00Z'});
  return {data,admin,recycler,consumer,hub,idle,store:new MemoryStore(data)};
}

test('consumer and recycler directory grouping never changes the original account roles or includes NGOs',async()=>{
  assert.equal(stakeholderGroupFor('Consumer'),'consumers');assert.equal(stakeholderGroupFor('Recycler'),'consumers');
  assert.equal(stakeholderGroupFor('Producer'),'producers');assert.equal(stakeholderGroupFor('BalikTela Hub'),'hubs');assert.equal(stakeholderGroupFor('NGO'),null);
  const {data,admin,consumer,recycler,hub,store}=await fixture(),original=structuredClone(data),permissions=permissionsFor(consumer);
  const result=await buildDashboardAnalytics(store,admin,{},undefined,now);
  assert.ok(result.stakeholders.some(item=>item.id===recycler.id&&item.type==='Recycler'));
  assert.equal(result.stakeholders.find(item=>item.id===hub.id)?.accountRole,'Recycler');
  assert.deepEqual(data,original);assert.deepEqual(permissionsFor(consumer),permissions);
});

test('real legacy Hub profiles are classified by assignments and expose actual weighing and transfer links once',async()=>{
  const {store,admin,hub,recycler}=await fixture();
  const snapshot=await loadDashboardAnalyticsSnapshot(store),ids=identifyHubOperators(snapshot,now);
  assert.ok(ids.has(hub.id));assert.ok(!ids.has(recycler.id));
  const result=await buildDashboardAnalytics(store,admin,{},snapshot,now);
  const profile=result.stakeholders.find(item=>item.id===hub.id)!;
  assert.equal(result.stakeholders.filter(item=>item.id===hub.id).length,1);
  assert.equal(profile.type,'BalikTela Hub');assert.equal(profile.name,hub.fullName);assert.equal(profile.isDemo,false);
  assert.deepEqual(profile.hubActivity,{state:'Approved',assignedListings:1,awaitingWeighing:0,measurements:2,latestWeighedKg:95,
    lastWeighedAt:'2026-10-16T02:00:00Z',facilities:[],collectedBatches:0,collectedKg:null,disposalRecords:0,disposedKg:null});
  assert.deepEqual(profile.linkedTransferIds,['ACTUAL-HUB-TRANSFER']);assert.equal(profile.transactions,1);assert.equal(profile.participation,100);
  assert.equal(profile.recoveredKg,0);assert.equal(profile.recoveredAvailable,false,'Listing weighing must not manufacture final recovery.');
  assert.equal(result.stakeholders.find(item=>item.id===recycler.id)?.type,'Recycler');
});

test('registered idle Hubs show missing evidence rather than invented activity, and respect material and regional filters',async()=>{
  const {store,admin,idle,hub}=await fixture();
  const all=await buildDashboardAnalytics(store,admin,{},undefined,now),profile=all.stakeholders.find(item=>item.id===idle.id)!;
  assert.ok(profile);assert.equal(profile.hubActivity?.measurements,0);assert.equal(profile.hubActivity?.latestWeighedKg,null);assert.equal(profile.hubActivity?.state,'Pending approval');
  const material=await buildDashboardAnalytics(store,admin,{textileType:'Cotton'},undefined,now);
  assert.ok(!material.stakeholders.some(item=>item.id===idle.id));
  const regional=await buildDashboardAnalytics(store,admin,{region:'Central Visayas'},undefined,now);
  assert.ok(regional.stakeholders.some(item=>item.id===idle.id));assert.ok(!regional.stakeholders.some(item=>item.id===hub.id));
  const research={...admin,role:'Researcher' as const,scope:{...admin.scope,regions:['Central Visayas'],aggregateOnly:false}};
  const scoped=await buildDashboardAnalytics(store,research,{},undefined,now);
  assert.ok(!scoped.stakeholders.some(item=>item.id===hub.id));
  const government={...research,role:'Government' as const};
  assert.deepEqual((await buildDashboardAnalytics(store,government,{},undefined,now)).stakeholders,[]);
});

test('Hub stakeholder filter follows native assignment links even when a legacy account role is Recycler',async()=>{
  const {store,admin,hub}=await fixture();
  const result=await buildDashboardAnalytics(store,admin,{stakeholderType:'BalikTela Hub'},undefined,now);
  assert.equal(result.operations.metrics.batchCount,1);
  assert.deepEqual(result.transactions.map(item=>item.id),['ACTUAL-HUB-TRANSFER']);
  assert.equal(result.stakeholders.find(item=>item.id===hub.id)?.hubActivity?.latestWeighedKg,95);
});
