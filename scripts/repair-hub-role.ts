import { config } from 'dotenv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

config({path:'.env.supabase',quiet:true});
const id=process.argv[process.argv.indexOf('--user-id')+1];
if(!process.argv.includes('--user-id') || !id || !/^[a-zA-Z0-9-]+$/.test(id))throw new Error('Provide an explicit --user-id.');
if(!process.env.SUPABASE_DB_URL)throw new Error('A database connection profile is required.');
const apply=process.argv.includes('--apply');
const sql=postgres(process.env.SUPABASE_DB_URL,{max:1,prepare:false,ssl:'require',connect_timeout:20});
try {
  const result=await sql.begin(apply?'isolation level serializable':'read only',async tx=>{
    await tx`set local lock_timeout = '5s'`;
    const [before]=apply?await tx`select * from public.users where id=${id} for update`:await tx`select * from public.users where id=${id}`;
    assert.ok(before,'Account not found.');
    if(before.role==='BalikTela Hub')return {alreadyCorrect:true,role:before.role,approvalUnchanged:true};
    const [audit]=await tx`select id,details from public.activity_logs where entity_id=${id} and action='user.access.updated' order by occurred_at desc limit 1`;
    assert.ok(audit,'An explicit administrator role-change audit is required.');
    const change=JSON.parse(audit.details.summary).changes.find((item:{collection:string;after?:{id:string}})=>item.collection==='users' && item.after?.id===id);
    assert.equal(change?.after?.role,'BalikTela Hub','Latest requested role is no longer Hub; refusing repair.');
    assert.equal(before.role,'Recycler');assert.equal(before.stakeholder,'Recycler / Upcycler');
    assert.equal(before.organization_verified,false,'Approval changed; refusing repair.');
    assert.equal(before.organization_id,change.after.organizationId);
    if(!apply)return {wouldRepair:true,requestedRole:'BalikTela Hub',approvalGranted:false,sourceAuditId:audit.id};
    const [after]=await tx`update public.users set role='BalikTela Hub',stakeholder='Collection personnel',updated_at=now() where id=${id} and role='Recycler' and organization_verified=false returning *`;
    assert.ok(after);assert.equal(after.role,'BalikTela Hub');assert.equal(after.stakeholder,'Collection personnel');
    const unaffected=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>!['role','stakeholder','updated_at'].includes(key)));
    assert.deepEqual(unaffected(after),unaffected(before),'Approval, scope and identity must remain unchanged.');
    const revoked=await tx`update public.sessions set revoked_at=now(),updated_at=now() where user_id=${id} and revoked_at is null returning id`;
    const summary={reason:'User-requested repair of legacy database normalization. Restore the explicit administrator Hub role request; no approval or assignment granted.',sourceAuditId:audit.id,
      changes:[{collection:'users',before:{id,role:before.role,stakeholder:before.stakeholder,organizationVerified:false},after:{id,role:after.role,stakeholder:after.stakeholder,organizationVerified:false}}]};
    await tx`insert into public.activity_logs(id,actor_id,action,entity_type,entity_id,details,ip_hash,occurred_at)
      values(${'AUD-'+randomUUID()},'SYSTEM-HUB-ROLE-REPAIR','user.role.repaired','users',${id},${tx.json({summary:JSON.stringify(summary)})},null,now())`;
    return {repaired:true,role:after.role,approvalGranted:false,hubAssignmentsChanged:false,revokedSessions:revoked.length,audited:true};
  });
  console.log(JSON.stringify(result));
} finally {await sql.end();}
