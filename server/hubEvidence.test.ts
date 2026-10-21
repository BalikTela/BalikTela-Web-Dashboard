import assert from 'node:assert/strict';
import test from 'node:test';
import { createHubCollectionEvidence } from './hubEvidence.js';
import { createSeedData } from './seed.js';
import { loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { MemoryStore } from './store.js';

test('indexed Hub evidence preserves corrections, future cutoffs, duplicate handling and conflicting collections', async () => {
  const data=await createSeedData(), source=await loadDashboardAnalyticsSnapshot(new MemoryStore(data));
  const batchId=data.materialBatches[0].id, operator=data.users[0].id;
  source.recoveryRecords=[];
  const base={...data.measurements[0],batchId,recordedBy:operator,canonicalStage:'collection' as const,
    weightKg:10,status:'Measured' as const,timestamp:'2026-10-01T00:00:00Z',supersedesMeasurementId:null};
  const correction={...base,id:'CORRECTION',weightKg:12,supersedesMeasurementId:base.id};
  source.measurements=[base,correction,{...correction},{...base,id:'FUTURE',supersedesMeasurementId:correction.id,timestamp:'2026-11-01T00:00:00Z'}];
  const now=new Date('2026-10-21T00:00:00Z'),hubIds=new Set([operator]);
  const before=structuredClone(source);
  const indexed=createHubCollectionEvidence(source,hubIds,now);
  assert.equal(indexed(batchId)?.weightKg,12);
  for(let index=0;index<500;index++) assert.equal(indexed(`ABSENT-${index}`),null);
  assert.deepEqual(source,before);
  source.recoveryRecords=[{...data.recoveryRecords[0],batchId,recordedBy:operator,validatedBy:operator,stage:'Collection',status:'Validated',
    inputWeightKg:9,outputWeightKg:10,timestamp:'2026-10-01T00:00:00Z'}];
  assert.equal(createHubCollectionEvidence(source,hubIds,now)(batchId),null,'An invalid collection must not fall through to a valid measurement.');
  source.recoveryRecords[0].inputWeightKg=10;
  assert.equal(createHubCollectionEvidence(source,hubIds,now)(batchId)?.weightKg,10);
  source.recoveryRecords.push({...source.recoveryRecords[0],id:'SECOND-COLLECTION'});
  assert.equal(createHubCollectionEvidence(source,hubIds,now)(batchId),null);
});
