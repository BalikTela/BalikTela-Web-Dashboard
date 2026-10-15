import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalMutations, type RecordMutation } from '../server/database/mutations.js';
import { createSeedData } from '../server/seed.js';
import type { DatabaseShape } from '../server/types.js';

interface SqlEngine {
  exec(sql:string):Promise<unknown>;
  query<T>(sql:string,params?:unknown[]):Promise<{rows:T[]}>;
  close():Promise<void>;
}
const enginePath=process.env.CRUD_SQL_ENGINE ?? '/tmp/baliktela-sql-validation/node_modules/@electric-sql/pglite/dist/index.js';
const {PGlite}=await import(enginePath) as {PGlite:new()=>SqlEngine};
const db=new PGlite();
const migration=(name:string)=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const commit=(writes:RecordMutation[])=>db.query('select public.apply_management_mutations($1::jsonb)',[JSON.stringify(canonicalMutations(writes))]);
try {
  await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
  await db.exec(await migration('20261007040000_baliktela_schema_v2.sql'));
  await db.exec(await migration('20261010090000_supabase_auth_identity.sql'));
  await db.exec(await migration('20261014090000_management_transactions.sql'));
  await db.exec(await migration('20261014100000_management_conflict_response.sql'));
  const seed=await createSeedData();
  const writes=Object.entries(seed).flatMap(([name,records])=>records.map((record:DatabaseShape[keyof DatabaseShape][number])=>({name:name as keyof DatabaseShape,record} as RecordMutation)));
  await commit(writes);
  const org=seed.organizations[0];
  const renamed={...org,name:'SQL Updated Organization'};
  await commit([{name:'organizations',previous:org,record:renamed}]);
  assert.equal((await db.query<{name:string}>('select name from public.organizations where id=$1',[org.id])).rows[0].name,renamed.name);
  await assert.rejects(commit([{name:'organizations',previous:org,record:{...org,name:'Stale overwrite'}}]),(error:unknown)=>(error as {code:string}).code==='PT409');
  await assert.rejects(commit([{name:'organizations',previous:renamed,record:{...renamed,name:'Must roll back'}},{name:'facilities',record:{...seed.facilities[0],id:'SQL-INVALID',organizationId:org.id,monthlyCapacityKg:1,name:'Invalid type',type:'Invalid' as never}}]));
  assert.equal((await db.query<{name:string}>('select name from public.organizations where id=$1',[org.id])).rows[0].name,renamed.name);
  const user=seed.users[0];
  await db.query('update public.users set bio=$1, profile=profile || $2::jsonb where id=$3',['Mobile-owned biography',JSON.stringify({mobile_only:'Preserved'}),user.id]);
  await commit([{name:'users',previous:user,record:{...user,fullName:'SQL Updated Admin'}}]);
  const preserved=(await db.query<{bio:string;profile:{mobile_only:string}}>('select bio,profile from public.users where id=$1',[user.id])).rows[0];
  assert.equal(preserved.bio,'Mobile-owned biography');assert.equal(preserved.profile.mobile_only,'Preserved');
  await assert.rejects(commit([{name:'users',previous:{...user,fullName:'SQL Updated Admin'},record:{...user,fullName:'SQL Updated Admin',accountStatus:'Deactivated'}}]));
  const recovery=seed.recoveryRecords[0];
  await commit([{name:'recoveryRecords',previous:recovery,record:{...recovery,status:'Reversed'}}]);
  assert.equal((await db.query<{status:string}>('select status from public.recovery_records where id=$1',[recovery.id])).rows[0].status,'reversed');
  await db.exec('set role anon;');
  await assert.rejects(db.query('select public.apply_management_mutations($1::jsonb)',['[]']));
  await db.exec('reset role;');
  console.log(JSON.stringify({result:'passed',engine:'isolated PostgreSQL',checks:['migration syntax against canonical schema','canonical seed insertion','updates and stale-write conflicts','multi-table rollback','mobile-field preservation','last-administrator protection','recovery reversal','anonymous RPC denial']},null,2));
} finally {await db.close();}
