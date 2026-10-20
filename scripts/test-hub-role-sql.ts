import { config } from 'dotenv';
import assert from 'node:assert/strict';
import postgres from 'postgres';

config({path:'.env.supabase',quiet:true});
if(!process.env.SUPABASE_DB_URL)throw new Error('A database connection profile is required.');
const sql=postgres(process.env.SUPABASE_DB_URL,{max:1,prepare:false,ssl:'require',connect_timeout:20});
try {
  await sql.begin(async tx=>{
    // Invoke the installed production trigger, but only on disposable temporary rows.
    await tx.unsafe('create temporary table hub_role_regression(id text primary key,role text,stakeholder text) on commit drop');
    await tx.unsafe('create trigger normalize_role before insert or update of role,stakeholder on hub_role_regression for each row execute function public.normalize_recycler_role()');
    await tx`insert into hub_role_regression values('hub','BalikTela Hub','Consumer / Beneficiary'),('consumer','Consumer','Consumer / Beneficiary'),('recycler','Recycler','Recycler / Upcycler'),('legacy','LGU/Collection Point','Collection personnel')`;
    const rows=await tx`select * from hub_role_regression order by id`;
    assert.equal(rows.find(row=>row.id==='hub')?.role,'BalikTela Hub');
    assert.equal(rows.find(row=>row.id==='hub')?.stakeholder,'Collection personnel');
    assert.equal(rows.find(row=>row.id==='consumer')?.role,'Consumer');
    assert.equal(rows.find(row=>row.id==='recycler')?.role,'Recycler');
    assert.equal(rows.find(row=>row.id==='legacy')?.role,'Recycler');
    const [converted]=await tx`update hub_role_regression set role='BalikTela Hub' where id='consumer' returning *`;
    assert.equal(converted.role,'BalikTela Hub');assert.equal(converted.stakeholder,'Collection personnel');
    const [recycler]=await tx`update hub_role_regression set role='Recycler',stakeholder='Recycler / Upcycler' where id='consumer' returning *`;
    assert.equal(recycler.role,'Recycler');assert.equal(recycler.stakeholder,'Recycler / Upcycler');
    const [renamed]=await tx`update hub_role_regression set stakeholder='Collection personnel' where id='hub' returning *`;
    assert.equal(renamed.role,'BalikTela Hub');
  });
  console.log(JSON.stringify({installedHubRoleTrigger:'passed',consumerToHub:'passed',realRecyclerPreserved:true,legacyLguBehaviorPreserved:true,permanentRowsWritten:0}));
} finally {await sql.end();}
