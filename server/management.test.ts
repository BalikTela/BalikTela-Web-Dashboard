import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { canonicalMutations, rememberCanonicalRow, mergeJson } from './database/mutations.js';
import { facilityValues, organizationValues, number, registerManagementRoutes } from './management.js';
import { issueToken } from './auth.js';
import { hasPermission } from './access-control.js';
import { provisionedUserMutation } from './provisioning.js';

test('provisioning reuses a shared Auth-trigger profile and keeps deactivated users inactive',async()=>{
  const seed=await createSeedData();
  seed.users[1].authUserId='shared-auth-identity';
  const store=new MemoryStore(seed);
  const draft={...seed.users[1],id:'WEB-GENERATED-ID',fullName:'Invited account',accountStatus:'Pending verification' as const};
  const mutation=await provisionedUserMutation(store,draft);
  assert.equal(mutation.record.id,seed.users[1].id);
  assert.ok(mutation.previous);
  await store.commit([mutation]);
  assert.equal((await store.all('users')).length,seed.users.length);
  const disabled=canonicalMutations([{name:'users',previous:seed.users[1],record:{...seed.users[1],accountStatus:'Deactivated'}}]);
  assert.equal(disabled[0].values.active,false);
});

test('management validation rejects invalid numbers and maps organization/facility statuses',()=>{
  for(const value of [NaN,Infinity,-1,'',null]) assert.throws(()=>number(value,'Weight'));
  const org=organizationValues({name:'Test NGO',type:'NGO',city:'Manila',region:'Metro Manila',status:'Inactive'});
  assert.equal(org.status,'Inactive');
  assert.throws(()=>organizationValues({...org,contactEmail:'broken'}));
  assert.equal(facilityValues({name:'Test facility',organizationId:org.id,city:org.city,region:org.region,status:'Inactive',storageCapacityKg:1000}).status,'Inactive');
});

test('atomic memory writes roll back when a later operation conflicts',async()=>{
  const seed=await createSeedData(); const store=new MemoryStore(seed); const before=seed.organizations[0];
  await assert.rejects(store.commit([{name:'organizations',previous:before,record:{...before,name:'Should roll back'}},{name:'users',record:seed.users[0]}]));
  assert.equal((await store.findById('organizations',before.id))?.name,before.name);
});

test('canonical updates contain only changed fields and preserve lifecycle evidence',async()=>{
  const seed=await createSeedData();const user=seed.users[0];
  const writes=canonicalMutations([{name:'users',previous:user,record:{...user,fullName:'Renamed'}}]);
  assert.equal(writes[0].values.name,'Renamed');
  assert.equal(Object.hasOwn(writes[0].values,'passwordHash'),false);
  assert.equal(Object.hasOwn(writes[0].values,'profile'),false);
  const transfer=seed.transfers[0];
  assert.equal(canonicalMutations([{name:'transfers',previous:transfer,record:{...transfer,agreedTerms:'Corrected'}}]).filter(item=>item.table==='flow_events').length,0);
  const batch=seed.materialBatches[0];
  assert.deepEqual(canonicalMutations([{name:'materialBatches',previous:batch,record:{...batch,city:'New city'}}])[0].values.location,{city:'New city',region:batch.region});
});

test('deactivated users and research roles cannot mutate management records',async()=>{
  const seed=await createSeedData();
  assert.equal(hasPermission({...seed.users[0],accountStatus:'Deactivated'},'users.manage'),false);
  for(const permission of ['batches.manage','listings.manage','recovery.manage'] as const) assert.equal(hasPermission(seed.users.find(item=>item.role==='Researcher')!,permission),false);
});

test('shared mobile status aliases and additional JSON fields survive administrative updates',async()=>{
  const seed=await createSeedData();
  const transfer=rememberCanonicalRow({...seed.transfers[0],status:'Received' as const},{status:'collected'});
  const mutation=canonicalMutations([{name:'transfers',previous:transfer,record:{...transfer,status:'Validated'}}])[0];
  assert.equal(mutation.expected.status,'collected');assert.equal(mutation.values.status,'validated');
  const batch=rememberCanonicalRow({...seed.materialBatches[0],currentStatus:'Received' as const},{current_status:'processing'});
  const validated=canonicalMutations([{name:'materialBatches',previous:batch,record:{...batch,currentStatus:'Validated',weightStatus:'Verified'}}])[0];
  assert.equal(validated.expected.current_status,'processing');assert.equal(validated.values.current_status,'received');
  assert.deepEqual(mergeJson({city:'Old',latitude:14.5,nested:{mobile:true}},{city:'New',nested:{web:true}}),{city:'New',latitude:14.5,nested:{mobile:true,web:true}});
});

test('optimistic guards preserve native nulls from mobile-created profiles',async()=>{
  const seed=await createSeedData();
  const user=rememberCanonicalRow(seed.users[1],{city:null,profile:null});
  const mutation=canonicalMutations([{name:'users',previous:user,record:{...user,city:'Different city',profile:{...user.profile,organizationSize:'Null guard test'}}}])[0];
  assert.equal(mutation.expected.city,null);
  assert.equal(mutation.expected.profile,null);
});

test('batch CRUD and recovery corrections retain historical records and enforce role restrictions',async()=>{
  const seed=await createSeedData();const store=new MemoryStore(seed);const app=express();app.use(express.json());registerManagementRoutes(app,store);
  app.use((error:Error & {status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??500).json({message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Test server unavailable.');
  const at=new Date().toISOString();const expiresAt=new Date(Date.now()+60000).toISOString();
  const tokens=new Map<string,string>();
  for(const user of seed.users.filter(item=>['Administrator','Researcher'].includes(item.role))) {
    const sessionId=`CRUD-${user.id}`;await store.createSession({id:sessionId,userId:user.id,client:'api',tokenHash:'test',usedTokenHashes:[],csrfHash:'test',expiresAt,revokedAt:null,createdAt:at,updatedAt:at});
    tokens.set(user.role,issueToken(user.id,user.role,sessionId));
  }
  const send=async(path:string,body:Record<string,unknown>,role='Administrator',method='PATCH')=>{
    const response=await fetch(`http://127.0.0.1:${address.port}${path}`,{method,headers:{'content-type':'application/json',authorization:`Bearer ${tokens.get(role)}`},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  try {
    const created=await send('/api/material-batches',{sourceUserId:'USR-PROD-01',materialCategory:'Cotton',wasteSource:'Pre-consumer',wasteForm:'Offcuts',condition:'Recyclable',circularPathway:'Recycling',declaredWeightKg:10,weightStatus:'Measured',method:'Test scale',reason:'Test registration'},'Administrator','POST');
    assert.equal(created.status,201);const id=created.body.batch.id;
    assert.equal((await send('/api/material-batches',{sourceUserId:'USR-PROD-01',materialCategory:'Cotton',wasteSource:'Pre-consumer',wasteForm:'Offcuts',condition:'Recyclable',circularPathway:'Recycling',declaredWeightKg:10,weightStatus:'Verified',method:'Cannot self-verify via registry',reason:'Rejected third status'},'Administrator','POST')).status,400);
    const historyCount=(await store.all('measurements')).length;
    await store.update('materialBatches',id,{weightStatus:'Verified',currentWeightKg:8});
    const metadata=await send(`/api/material-batches/${id}`,{city:'Updated city',reason:'Metadata only'});
    assert.equal(metadata.status,200);assert.equal(metadata.body.batch.weightStatus,'Verified');assert.equal(metadata.body.batch.currentWeightKg,8);
    assert.equal((await store.all('measurements')).length,historyCount);
    assert.equal((await send(`/api/material-batches/${id}`,{weightStatus:'Verified',reason:'Cannot assign third status'})).status,400);
    assert.equal((await send(`/api/material-batches/${id}`,{declaredWeightKg:12,method:'Reweighed',reason:'Correction'})).status,200);
    assert.equal((await store.findById('materialBatches',id))?.weightStatus,'Measured');
    const remeasurement=(await store.all('measurements')).filter(item=>item.batchId===id).at(-1)!;
    assert.equal(remeasurement.status,'Measured');assert.equal(remeasurement.verifiedBy,null);
    assert.equal((await store.all('measurements')).filter(item=>item.batchId===id).length,2);
    assert.equal((await send(`/api/material-batches/${id}`,{action:'archive',reason:'Duplicate'})).body.batch.currentStatus,'Archived');
    assert.equal((await send(`/api/material-batches/${id}`,{declaredWeightKg:15,reason:'Blocked'})).status,409);
    assert.equal((await send(`/api/material-batches/${id}`,{action:'restore',reason:'Restore'})).body.batch.currentStatus,'Recorded');
    assert.equal((await send(`/api/material-batches/${id}`,{reason:'Forbidden'},'Researcher')).status,403);
    assert.equal((await send('/api/material-batches/MB-2609-004',{action:'archive',reason:'Completed transfer'})).status,409);
    assert.equal((await send('/api/recovery-records/RCV-001',{action:'edit',reason:'Cannot overwrite validated history'})).status,409);
    const correction=await send('/api/recovery-records/RCV-001',{action:'correct',inputWeightKg:89,outputWeightKg:85,residualWeightKg:4,outcome:'Redistribution',reason:'New reading'});
    assert.equal(correction.status,200);assert.notEqual(correction.body.record.id,'RCV-001');
    assert.equal((await store.findById('recoveryRecords','RCV-001'))?.status,'Reversed');
    assert.equal((await send(`/api/recovery-records/${correction.body.record.id}`,{action:'validate',reason:'Checked'})).body.record.status,'Validated');
    assert.equal((await send(`/api/recovery-records/${correction.body.record.id}`,{action:'correct',inputWeightKg:1,outputWeightKg:2,residualWeightKg:0,outcome:'Recycling',reason:'Invalid'})).status,400);
    assert.equal((await send(`/api/recovery-records/${correction.body.record.id}`,{action:'correct',inputWeightKg:89,outputWeightKg:85.005,residualWeightKg:4,lossWeightKg:0,outcome:'Recycling',reason:'Analytics would reject five grams of imbalance'})).status,400);
    await store.update('recoveryRecords',correction.body.record.id,{status:'Recorded',inputWeightKg:89,outputWeightKg:85.005,residualWeightKg:4,lossWeightKg:0,validatedBy:null});
    assert.equal((await send(`/api/recovery-records/${correction.body.record.id}`,{action:'validate',reason:'Reject legacy imbalanced data'})).status,400);
    await store.update('recoveryRecords',correction.body.record.id,{inputWeightKg:-10,outputWeightKg:-10,residualWeightKg:0,lossWeightKg:0});
    assert.equal((await send(`/api/recovery-records/${correction.body.record.id}`,{action:'validate',reason:'Reject balanced negative weights'})).status,400);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
