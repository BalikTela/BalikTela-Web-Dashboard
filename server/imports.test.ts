import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { IMPORT_COLUMNS } from '../shared/imports.js';
import { issueToken } from './auth.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { commitImport, importCsv, planImport, registerImportRoutes } from './imports.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import { canonicalMutations, type RecordMutation } from './database/mutations.js';
import { installSecurity, securityErrorHandler } from './security.js';

const now = new Date('2026-10-19T04:00:00Z');
const row = (id='bulk-test-01', change:Record<string,string|number>={}) => ({external_id:id,registered_at:'2026-08-05T01:00:00Z',source_user_id:'USR-PROD-01',recipient_user_id:'USR-REC-01',facility_id:'FAC-001',material_category:'Cotton',declared_kg:100,collected_kg:90,sorted_kg:80,outcome:'Recycling',outcome_kg:70,...change});
function csv(rows = [row()]) { return [IMPORT_COLUMNS.join(','),...rows.map(item=>IMPORT_COLUMNS.map(column=>`"${String(item[column]).replaceAll('"','""')}"`).join(','))].join('\r\n'); }

test('bulk preview has no writes; commit adds coherent demo lifecycle and moves filtered analytics without changing original records', async()=>{
  const seed=await createSeedData(),original=structuredClone(seed),store=new MemoryStore(seed),admin=seed.users[0],file=csv();
  const before=await buildDashboardAnalytics(store,admin,{},undefined,now);
  const plan=await planImport(store,admin,file,now);
  assert.equal(plan.preview.valid,true);assert.equal(plan.preview.newRows,1);
  for(const [name,records] of Object.entries(original))assert.deepEqual(await store.all(name as keyof typeof seed),records);
  assert.ok(plan.groups.every(group=>canonicalMutations(group).length<200));
  assert.equal((await commitImport(store,admin,file,plan.preview.previewHash,'Demo import test',now)).complete,true);
  const after=await buildDashboardAnalytics(store,admin,{},undefined,now);
  assert.equal(after.circularFlow.generatedKg,before.circularFlow.generatedKg+100);
  assert.equal(after.circularFlow.collectedKg,before.circularFlow.collectedKg+90);
  assert.equal(after.circularFlow.recycledKg,before.circularFlow.recycledKg+70);
  assert.equal(after.materialEvidence.completedKg,before.materialEvidence.completedKg+90);
  assert.equal(after.operations.metrics.completedTransfers,before.operations.metrics.completedTransfers+1);
  assert.equal(after.materialEvidence.collectionConflicts,0);assert.equal(after.materialEvidence.outcomeConflicts,0);
  for(const [name,records] of Object.entries(original))for(const record of records)assert.deepEqual(await store.findById(name as keyof typeof seed,record.id),record,`${name} existing records must remain untouched.`);
  assert.equal((await store.all('users')).length,original.users.length);
  assert.deepEqual(await store.all('walletEntries'),original.walletEntries);
  const imported=(await store.all('materialBatches')).find(item=>item.id.startsWith('IMP-DEMO-'))!;
  assert.equal(imported.isDemo,true);
  const elsewhere=await buildDashboardAnalytics(store,admin,{region:'Central Visayas'},undefined,now);
  assert.equal(elsewhere.circularFlow.collectedKg,0);
});

test('retry skips prior rows, rejects changed external IDs and never manufactures additional records',async()=>{
  const seed=await createSeedData(),store=new MemoryStore(seed),admin=seed.users[0],file=csv();
  const plan=await planImport(store,admin,file,now);
  await commitImport(store,admin,file,plan.preview.previewHash,'First',now);
  const retry=await planImport(store,admin,file,now);
  assert.equal(retry.preview.skippedRows,1);assert.equal(retry.preview.newRows,0);
  const count=(await store.all('materialBatches')).length;
  const result=await commitImport(store,admin,file,retry.preview.previewHash,'Retry',now);
  assert.equal(result.importedRows,0);assert.equal(result.skippedRows,1);
  assert.equal((await store.all('materialBatches')).length,count);
  const changed=await planImport(store,admin,csv([row('bulk-test-01',{declared_kg:101})]),now);
  assert.equal(changed.preview.valid,false);assert.match(changed.preview.rows[0].message,/conflicts/);
});

test('all CSV rows are validated before committing; invalid balances, dates, roles, duplicate IDs and malformed files fail',async()=>{
  const seed=await createSeedData(),store=new MemoryStore(seed),admin=seed.users[0];
  const invalidChanges:Record<string,string|number>[]=[{collected_kg:110},{outcome_kg:81},{outcome:'Diversion'},{registered_at:'2026-02-30T01:00:00Z'},{registered_at:'2027-01-01T00:00:00Z'},{source_user_id:'USR-CONS-01'},{facility_id:'MISSING'},{declared_kg:'Infinity'},{collected_kg:-1},{collected_kg:'',sorted_kg:'',outcome:'Recycling'}];
  for(const change of invalidChanges) {
    const file=csv([row('good'),row('bad',change)]),plan=await planImport(store,admin,file,now);
    assert.equal(plan.preview.valid,false,JSON.stringify(change));
    await assert.rejects(commitImport(store,admin,file,plan.preview.previewHash,'Invalid file',now));
  }
  assert.equal((await planImport(store,admin,csv([row(),row()]),now)).preview.valid,false);
  await assert.rejects(planImport(store,admin,'wrong,columns\n1,2',now));
  await assert.rejects(planImport(store,admin,csv(Array.from({length:501},(_,i)=>row(`row-${i}`))),now));
  assert.equal((await store.all('materialBatches')).length,seed.materialBatches.length);
  assert.throws(()=>importCsv({csvChunks:['x'.repeat(8001)]}));
  assert.throws(()=>importCsv({csvChunks:[] }));
  const valid=await planImport(store,admin,csv(),now);
  await assert.rejects(commitImport(store,admin,csv(),'wrong','Wrong preview',now));
  assert.ok(valid.preview.valid);
});

test('bulk import is chunk-atomic, audit logged, transaction bounded and resumable after a later failure',async()=>{
  const seed=await createSeedData();let calls=0,fail=true;
  class FailingStore extends MemoryStore { async commit(writes:RecordMutation[]) { calls++;assert.ok(canonicalMutations(writes).length<=200);if(fail&&calls===2)throw new Error('Fixture outage');await super.commit(writes); } }
  const store=new FailingStore(seed),file=csv(Array.from({length:6},(_,i)=>row(`row-${i}`))),admin=seed.users[0];
  const plan=await planImport(store,admin,file,now);
  const partial=await commitImport(store,admin,file,plan.preview.previewHash,'Chunk test',now);
  assert.equal(partial.complete,false);assert.equal(partial.importedRows,5);
  fail=false;
  const retry=await planImport(store,admin,file,now);
  assert.equal(retry.preview.skippedRows,5);
  const complete=await commitImport(store,admin,file,retry.preview.previewHash,'Resume',now);
  assert.equal(complete.complete,true);assert.equal(complete.importedRows,1);
  assert.equal((await store.all('materialBatches')).filter(item=>item.id.startsWith('IMP-DEMO-')).length,6);
  assert.equal((await store.all('auditRecords')).filter(item=>item.action==='dataset.demo.imported').length,2);
});

test('import endpoints require current administrator access and respect existing request-security limits',async()=>{
  const seed=await createSeedData(),store=new MemoryStore(seed),app=express();installSecurity(app);registerImportRoutes(app,store);app.use(securityErrorHandler);
  const tokens=new Map<string,string>();
  for(const actor of seed.users){const id=`IMPORT-${actor.id}`,at=new Date().toISOString();await store.createSession({id,userId:actor.id,client:'api',tokenHash:'test',usedTokenHashes:[],csrfHash:'test',expiresAt:new Date(Date.now()+60000).toISOString(),revokedAt:null,createdAt:at,updatedAt:at});tokens.set(actor.role,issueToken(actor.id,actor.role,id));}
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const send=(role:string,path:string,body:Record<string,unknown>)=>fetch(`http://127.0.0.1:${address.port}/api/imports/${path}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${tokens.get(role)}`},body:JSON.stringify(body)});
  try{
    for(const role of ['Consumer','Producer','Recycler','Researcher','Government'])assert.equal((await send(role,'preview',{csvChunks:[csv()]})).status,403);
    const response=await send('Administrator','preview',{csvChunks:[csv()]});assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);
    const preview=await response.json();assert.equal(preview.valid,true);
    const committed=await send('Administrator','commit',{csvChunks:[csv()],previewHash:preview.previewHash,reason:'API fixture'});assert.equal(committed.status,200);assert.equal((await committed.json()).complete,true);
    await store.update('users',seed.users[0].id,{accountStatus:'Suspended'});assert.ok([401,403].includes((await send('Administrator','preview',{csvChunks:[csv()]})).status));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
