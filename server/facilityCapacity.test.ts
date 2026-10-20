import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import { facilityCapacityStatus } from '../shared/facilityCapacity.js';

const now = new Date('2026-10-20T04:00:00Z');
const query = { dateRange:'Custom range', startDate:'2026-09-01', endDate:'2026-09-30' };
async function fixture(intake = 100, status: 'Available' | 'Near capacity' | 'Maintenance' | 'Pilot onboarding' = 'Near capacity') {
  const data=await createSeedData(),admin=data.users[0],site={...data.facilities[0],id:'FAC-CAPACITY-TEST',monthlyCapacityKg:1000,currentIntakeKg:99999,status};
  data.facilities=[site];data.materialBatches=[{...data.materialBatches[0],id:'CAPACITY-BATCH',createdAt:'2026-09-02T01:00:00Z'}];
  data.measurements=[];data.transfers=[];data.listings=[];
  data.recoveryRecords=[{...data.recoveryRecords[0],id:'COLLECTION',batchId:'CAPACITY-BATCH',facilityId:site.id,
    stage:'Collection',inputWeightKg:intake,outputWeightKg:intake,residualWeightKg:0,lossWeightKg:0,status:'Validated',validatedBy:admin.id,timestamp:'2026-09-03T01:00:00Z'},
    {...data.recoveryRecords[0],id:'SORTING',batchId:'CAPACITY-BATCH',facilityId:site.id,stage:'Sorting',inputWeightKg:intake,
      outputWeightKg:intake*0.9,residualWeightKg:intake*0.1,lossWeightKg:0,status:'Validated',validatedBy:admin.id,timestamp:'2026-09-04T01:00:00Z'}];
  return {data,admin,site};
}

test('facility status uses the displayed utilization instead of a stale stored near-capacity flag',async()=>{
  const {data,admin,site}=await fixture();const before=structuredClone(data);
  const result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now),row=result.facilities[0];
  assert.equal(row.capacityKg,1000);assert.equal(row.intakeKg,100);assert.equal(row.utilization,10);assert.equal(row.status,'Available');
  assert.equal(row.capacityKg-row.intakeKg,900);
  assert.equal(site.status,'Near capacity','The shared stored operating record must not be rewritten.');
  assert.deepEqual(data,before);
});

test('capacity statuses agree with threshold boundaries and retain explicit operating conditions',()=>{
  for(const [value,status] of [[0,'Available'],[84.9,'Available'],[85,'Near capacity'],[99.9,'Near capacity'],[100,'At capacity'],[100.1,'Over capacity'],[150,'Over capacity']] as const)
    assert.equal(facilityCapacityStatus(value,1000,'Near capacity'),status);
  for(const status of ['Maintenance','Pilot onboarding','Inactive'])assert.equal(facilityCapacityStatus(10,1000,status),status);
  assert.equal(facilityCapacityStatus(0,0,'Available'),'Capacity not configured');
  assert.equal(facilityCapacityStatus(0,NaN,'Near capacity'),'Capacity not configured');
});

test('period capacity, intake and utilization share the same denominator without double-counting later stages',async()=>{
  const {data,admin}=await fixture(900,'Available');
  let result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now),row=result.facilities[0];
  assert.equal(row.capacityKg,1000);assert.equal(row.intakeKg,900);assert.equal(row.utilization,90);assert.equal(row.status,'Near capacity');
  result=await buildDashboardAnalytics(new MemoryStore(data),admin,{...query,endDate:'2026-09-15'},undefined,now);row=result.facilities[0];
  assert.equal(row.capacityKg,500);assert.equal(row.utilization,180);assert.equal(row.status,'Over capacity');
});

test('idle, zero-capacity and maintenance facilities keep coherent numeric and operational states',async()=>{
  const {data,admin}=await fixture(100,'Maintenance');
  let result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities[0].utilization,10);assert.equal(result.facilities[0].status,'Maintenance');
  data.facilities[0].status='Near capacity';data.recoveryRecords=[];
  result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities[0].utilization,0);assert.equal(result.facilities[0].status,'Available');
  data.facilities[0].monthlyCapacityKg=0;
  result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities[0].status,'Capacity not configured');
});

test('Hub performance retains directly linked history without login assignments and includes assigned Hubs once',async()=>{
  const {data,admin,site}=await fixture(900,'Available');
  let result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities[0].intakeKg,900);assert.equal(result.facilities[0].utilization,90);
  const hub={...structuredClone(data.users.find(user=>user.role==='Recycler')!),id:'HUB-CAPACITY-LOGIN',role:'BalikTela Hub' as const,
    webHubOperator:true,scope:{...admin.scope,facilityIds:[site.id]}};
  data.users.push(hub);
  result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities.length,1);assert.equal(result.facilities[0].capacityKg,1000);
  assert.equal(result.facilities[0].utilization,90);assert.equal(result.facilities[0].status,'Near capacity');
});

test('a measured Hub receipt updates intake and replaces rather than duplicates linked operation weights',async()=>{
  const {data,admin,site}=await fixture(100,'Available');
  const hub={...structuredClone(data.users.find(user=>user.role==='Recycler')!),id:'HUB-RECEIPT-LOGIN',role:'BalikTela Hub' as const,
    webHubOperator:true,scope:{...admin.scope,facilityIds:[site.id]}};
  data.users.push(hub);
  const seed=await createSeedData();
  data.measurements.push({...seed.measurements[0],id:'MEASURED-HUB-RECEIPT',batchId:'CAPACITY-BATCH',facilityId:site.id,
    transferId:null,canonicalStage:'collection',stage:'Receipt',recordedBy:hub.id,weightKg:100,status:'Measured',
    supersedesMeasurementId:null,timestamp:'2026-09-03T01:00:00Z'});
  let result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities[0].intakeKg,100,'Receipt plus collection/sorting is one handling intake, not three.');
  data.recoveryRecords=[];
  result=await buildDashboardAnalytics(new MemoryStore(data),admin,query,undefined,now);
  assert.equal(result.facilities[0].intakeKg,100,'Measured receipts work without historical processing records.');
  assert.equal(result.facilities[0].utilization,10);
});
