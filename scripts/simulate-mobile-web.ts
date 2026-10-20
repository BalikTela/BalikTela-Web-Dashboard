import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { SupabaseStore } from '../server/supabaseStore.js';
import { saveManagement } from '../server/management.js';
import { decodeRecord } from '../server/database/codecs.js';
import { aggregateMaterialEvidence } from '../server/materialEvidence.js';

// Intentional live testing: credentials/state are generated into ignored, owner-only files.
const credentialsPath = '.env.e2e-review';
const statePath = '.env.e2e-state.json';
const roles = ['CONSUMER_A', 'CONSUMER_B', 'HUB', 'ADMIN'] as const;
type Role = typeof roles[number];
interface Account { email: string; name: string; authId?: string; profileId?: string; registeredAt?: string; confirmedAt?: string; role?: string }
interface Journey { runId: string; mobile: string; web: string; createdAt: string; accounts: Record<Role, Account>; step?: string;
  checks?: Array<{ step: string; result: string; at: string }>;
  listing?: { id: string; batchId: string; title: string }; requestId?: string; transferId?: string;
  analyticsBefore?: Record<string, unknown>; analyticsAfter?: Record<string, unknown>;
  report?: string;
}
let phase = process.argv[2] ?? 'status';
config({ path: '.env.supabase', quiet: true });
config({ path: credentialsPath, quiet: true });
let state: Journey | undefined;
async function save() { await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); }
async function checkpoint(step: string, result: string) {
  assert.ok(state); state.step=step; state.checks ??=[]; state.checks.push({step,result,at:new Date().toISOString()});
  await save(); console.log(JSON.stringify({step,result}));
}
async function mobileSession(browser: Browser, role: Role) {
  assert.ok(state); const account: Account=state.accounts[role];
  const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${state.mobile}/login`,{waitUntil:'networkidle',timeout:45_000});
  if(role==='HUB')await page.getByRole('radio',{name:/^Recycler/}).check();
  await page.getByLabel('Email address',{exact:true}).fill(account.email);
  await page.getByLabel('Password',{exact:true}).fill(process.env[`E2E_${role}_PASSWORD`]!);
  const responsePromise=page.waitForResponse(response=>response.url().includes('/auth/v1/token')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  assert.equal((await responsePromise).status(),200,'Normal mobile password sign-in must succeed.');
  await page.waitForTimeout(2500);
  return {context,page};
}
async function webSession(browser: Browser) {
  assert.ok(state);const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(`${state.web}/login`,{waitUntil:'networkidle',timeout:60_000});
  await page.getByLabel('Email address',{exact:true}).fill(state.accounts.ADMIN.email);
  await page.getByLabel('Password',{exact:true}).fill(process.env.E2E_ADMIN_PASSWORD!);
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const response=await responsePromise;assert.equal(response.status(),200,'Normal web admin sign-in must succeed.');
  const identity=await response.json();assert.equal(identity.user.id,state.accounts.ADMIN.profileId);assert.equal(identity.user.role,'Administrator');
  await page.getByText('Program Analytics',{exact:true}).waitFor({timeout:90_000});
  return {context,page,token:String(identity.accessToken??identity.token)};
}
async function rememberSession(context: BrowserContext, role: Role) {
  await writeFile(`.env.e2e-session-${role}.json`,JSON.stringify(await context.storageState()),{mode:0o600});
}
async function navigateWeb(page: Page, name: string) {
  const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
  await page.getByRole('button',{name,exact:true}).click();
}
async function submitMobile(page: Page, resource: string, action: () => Promise<unknown>) {
  const pending=page.waitForResponse(response=>response.url().endsWith('/rpc/mobile_mutate')
    && response.request().method()==='POST' && response.request().postDataJSON()?.p_resource===resource,{timeout:45_000});
  await action();
  let response: import('playwright-core').Response;
  try {response=await pending;}
  catch(error) {
    console.log(JSON.stringify({resource,alerts:await page.getByRole('alert').allTextContents(),
      validation:await page.locator('input:invalid,select:invalid,textarea:invalid').evaluateAll(items=>items.map(element=>{const field=element as HTMLInputElement;return {name:field.name,type:field.type,message:field.validationMessage};}))}));
    await page.screenshot({path:`/tmp/baliktela-e2e-review/${state!.runId}/mobile-submit-failed.png`,fullPage:true});
    throw error;
  }
  const result=await response.json();
  assert.equal(response.status(),200,`The mobile ${resource.split('/')[0]} action must succeed.`);
  return result.data as Record<string, any>;
}
async function markDemoRecords() {
  assert.ok(state?.listing);const journey=state;
  const store=new SupabaseStore(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!);
  try {
    const actor=await store.findById('users',journey.accounts.ADMIN.profileId!);
    assert.ok(actor?.role==='Administrator' && actor.email===journey.accounts.ADMIN.email);
    const listing=await store.findById('listings',journey.listing!.id),batch=await store.findById('materialBatches',journey.listing!.batchId);
    assert.ok(listing && batch && listing.ownerId===journey.accounts.CONSUMER_A.profileId && listing.title===journey.listing!.title && batch.sourceUserId===listing.ownerId);
    const mutations: import('../server/database/mutations.js').RecordMutation[]=[];
    if(!listing.isDemo)mutations.push({name:'listings',previous:listing,record:{...listing,isDemo:true}});
    if(!batch.isDemo)mutations.push({name:'materialBatches',previous:batch,record:{...batch,isDemo:true}});
    if(journey.transferId) {
      const transfer=await store.findById('transfers',journey.transferId);
      assert.ok(transfer?.batchId===batch.id && transfer.providerId===journey.accounts.CONSUMER_A.profileId && transfer.recipientId===journey.accounts.CONSUMER_B.profileId);
      if(!transfer.isDemo)mutations.push({name:'transfers',previous:transfer,record:{...transfer,isDemo:true}});
    }
    if(mutations.length)await saveManagement(store,actor,mutations,'test.fixture.classified',batch.id,`Synthetic E2E TEST ${journey.runId}; classification only, no status, measurement or lifecycle evidence changed.`);
  } finally {await store.close();}
}
async function runJourney() {
  assert.ok(state);const journey=state;
  const output=`/tmp/baliktela-e2e-review/${journey.runId}`;await mkdir(output,{recursive:true,mode:0o700});
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const live=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    if(phase==='verify-access') {
      assert.ok(journey.listing && journey.transferId);
      for(const role of ['CONSUMER_A','CONSUMER_B','HUB'] as const) {
        const context=await browser.newContext();
        try {
          const login=await context.request.post(`${journey.web}/api/auth/login`,{data:{email:journey.accounts[role].email,password:process.env[`E2E_${role}_PASSWORD`],client:'api'}});
          assert.equal(login.status(),200);const identity=await login.json();assert.equal(identity.user.id,journey.accounts[role].profileId);
          const headers={Authorization:`Bearer ${identity.accessToken??identity.token}`};
          assert.equal((await context.request.get(`${journey.web}/api/users`,{headers})).status(),403,'Test participants must not access account administration.');
          if(role!=='HUB') {
            assert.equal(identity.user.role,'Consumer');
            assert.equal((await context.request.get(`${journey.web}/api/hubs`,{headers})).status(),403);
            assert.equal((await context.request.post(`${journey.web}/api/barter/listings`,{headers,data:{}})).status(),403,'Web Consumers must not receive Producer listing-creation access.');
            const transfers=await context.request.get(`${journey.web}/api/transfers?dateRange=All%20time`,{headers});assert.equal(transfers.status(),200);
            const rows=(await transfers.json()).transfers;
            assert.ok(rows.some((row:Record<string,unknown>)=>row.id===journey.transferId));
            assert.ok(rows.every((row:Record<string,unknown>)=>row.providerId===journey.accounts[role].profileId||row.recipientId===journey.accounts[role].profileId));
          } else {
            const hubs=await context.request.get(`${journey.web}/api/hubs`,{headers});assert.equal(hubs.status(),200);
            assert.deepEqual((await hubs.json()).hubs.map((row:Record<string,unknown>)=>row.id),[journey.accounts.HUB.profileId]);
            const denied=await context.request.patch(`${journey.web}/api/hubs/${journey.accounts.HUB.profileId}`,{headers,data:{action:'approve',reason:`E2E TEST ${journey.runId}; self-approval must be denied.`}});
            assert.equal(denied.status(),403);
            const response=await context.request.get(`${journey.web}/api/weighing?dateRange=All%20time`,{headers});assert.equal(response.status(),200);const weighing=await response.json();
            assert.ok(weighing.tasks.every((row:Record<string,unknown>)=>row.batchId===journey.listing!.batchId));
            assert.ok(weighing.history.every((row:Record<string,unknown>)=>row.operatorId===journey.accounts.HUB.profileId));
          }
          await context.request.post(`${journey.web}/api/auth/logout`,{headers,data:{}});
          await checkpoint(`access-${role}`,'passed; normal login, scoped records, no account-administration or role crossover privileges');
        } finally {await context.close();}
      }return;
    }
    if(phase==='inspect-hub') {
      assert.ok(journey.listing);const {context,page}=await mobileSession(browser,'HUB');
      try {
        await page.goto(`${journey.mobile}/hub`,{waitUntil:'networkidle'});
        await page.getByRole('textbox',{name:'Search weighing tasks',exact:true}).fill(journey.listing.title);
        await page.waitForTimeout(3000);await page.screenshot({path:`${output}/mobile-hub-queue-diagnostic.png`,fullPage:true});
        console.log(JSON.stringify({headings:(await page.locator('h1,h2,h3').allTextContents()).filter(text=>/E2E|weigh|textile/i.test(text)),
          ownListingLinks:await page.locator(`a[href*="${journey.listing.id}"]`).allTextContents(),alerts:await page.getByRole('alert').allTextContents(),
          visibleTestText:await page.getByText(journey.listing.title,{exact:true}).count()}));
      } finally {await context.close();}return;
    }
    if(phase==='login-check') {
      for(const role of ['CONSUMER_A','CONSUMER_B','HUB'] as const) {
        const {context,page}=await mobileSession(browser,role);
        try {
          if(role!=='HUB') {
            assert.notEqual(new URL(page.url()).pathname,'/login');
            await page.goto(`${journey.mobile}/profile`,{waitUntil:'networkidle'});
            await page.getByText(journey.accounts[role].email,{exact:true}).waitFor();
            await checkpoint(`mobile-login-${role}`,'passed; normal password login and matching profile');
          } else {
            await page.screenshot({path:`${output}/hub-before-approval.png`,fullPage:true});
            await checkpoint('hub-before-approval',`observed ${new URL(page.url()).pathname}; no weighing was submitted`);
          }
          await page.screenshot({path:`${output}/login-${role}.png`,fullPage:true});await rememberSession(context,role);
        } finally {await context.close();}
      }
      const {context,page}=await webSession(browser);
      try {await page.screenshot({path:`${output}/admin-dashboard-before.png`,fullPage:true});await rememberSession(context,'ADMIN');await checkpoint('web-admin-login','passed; normal password login and exact new Administrator profile');}
      finally {await context.close();}
      return;
    }
    if(phase==='inspect-post') {
      const {context,page}=await mobileSession(browser,'CONSUMER_A');
      try {
        await page.goto(`${journey.mobile}/post`,{waitUntil:'networkidle'});
        console.log(JSON.stringify({labels:await page.locator('label').allTextContents(),
          selects:await page.locator('select').evaluateAll((items,hubId)=>items.map(element=>{const item=element as HTMLSelectElement;return {name:item.name,options:item.options.length,containsTestHub:[...item.options].some(option=>option.value===hubId)};}),journey.accounts.HUB.profileId)}));
        await page.screenshot({path:`${output}/mobile-post-form.png`,fullPage:true});
      } finally {await context.close();}return;
    }
    if(phase==='post-listing') {
      if(!journey.analyticsBefore) {
        const admin=await webSession(browser);
        try {
          const response=await admin.context.request.get(`${journey.web}/api/analytics/dashboard`,{headers:{Authorization:`Bearer ${admin.token}`}});
          assert.equal(response.status(),200);const data=await response.json();
          journey.analyticsBefore={sharedActivity:data.sharedActivity,circularFlow:data.circularFlow,kpis:data.kpis,asOf:new Date().toISOString()};await save();
        } finally {await admin.context.close();}
      }
      const title=`E2E TEST Linen ${journey.runId}`;
      const existing=await live.from('listings').select('id,batch_id,title,owner_id').eq('owner_id',journey.accounts.CONSUMER_A.profileId!).eq('title',title);
      assert.ok(!existing.error && existing.data.length<=1);
      if(existing.data.length===1){journey.listing={id:existing.data[0].id,batchId:existing.data[0].batch_id,title};await save();}
      if(!journey.listing) {
        const {context,page}=await mobileSession(browser,'CONSUMER_A');
        try {
          await page.goto(`${journey.mobile}/post`,{waitUntil:'networkidle'});
          await page.getByRole('radio',{name:/^Weighing hub first/}).check();
          await page.locator('select[name="weighing_hub_id"]').selectOption(journey.accounts.HUB.profileId!);
          await page.getByLabel('Listing title',{exact:true}).fill(title);
          await page.locator('select[name="category"]').selectOption('Linen');
          await page.locator('select[name="waste_source"]').selectOption('Household');
          await page.locator('select[name="waste_form"]').selectOption('Fabric rolls');
          await page.locator('select[name="pathway"]').selectOption('Reuse');
          await page.getByRole('combobox',{name:'Location',exact:true}).fill('Quezon City, Metro Manila, Philippines');
          await page.getByLabel('Unit, floor, building or landmark (optional)',{exact:true}).fill('E2E TEST ONLY - no physical site');
          await page.getByLabel('Description',{exact:true}).fill(`SYNTHETIC E2E TEST ${journey.runId}. No physical textiles, sale, pickup or disposal. Only the labeled test Consumer B should request this fixture.`);
          await page.getByLabel('Looking for',{exact:true}).fill(`TEST ONLY ${journey.runId}; no real exchange`);
          const result=await submitMobile(page,'listings',()=>page.getByRole('button',{name:'Create listing',exact:true}).click());
          assert.ok(result.id && result.batch_id);journey.listing={id:String(result.id),batchId:String(result.batch_id),title};await save();
          await page.goto(`${journey.mobile}/item/${journey.listing.id}`,{waitUntil:'networkidle'});
          await page.getByRole('heading',{name:title,exact:true}).waitFor();
          await page.screenshot({path:`${output}/consumer-a-listing-created.png`,fullPage:true});
        } finally {await context.close();}
      }
      await markDemoRecords();
      const listing=await live.from('listings').select('available_weight_kg,weighing_hub_id,delivery_route,is_demo').eq('id',journey.listing.id).single();
      assert.ok(!listing.error && listing.data.weighing_hub_id===journey.accounts.HUB.profileId && listing.data.delivery_route==='via_hub' && listing.data.is_demo);
      assert.equal(listing.data.available_weight_kg,null);
      await checkpoint('listing-created','passed; Consumer A created one demo-classified, unknown-weight listing assigned to the test Hub');return;
    }
    if(phase==='weigh') {
      assert.ok(journey.listing);
      const before=await live.from('measurements').select('id').eq('batch_id',journey.listing.batchId).eq('stage','listing');
      assert.ok(!before.error && before.data.length<=1,'Unexpected duplicate weighing records.');
      if(!before.data.length) {
        const consumer=await mobileSession(browser,'CONSUMER_B');
        try {
          await consumer.page.goto(`${journey.mobile}/item/${journey.listing.id}`,{waitUntil:'networkidle'});
          await consumer.page.getByRole('heading',{name:journey.listing.title,exact:true}).waitFor();
          assert.equal(await consumer.page.getByRole('button',{name:/^Request a match/}).count(),0,'An unweighed via-Hub listing must not accept quantity requests.');
          assert.equal(await consumer.page.getByRole('button',{name:/^Save hub weight$/i}).count(),0,'A Consumer must not have a Hub weight-entry action.');
          await consumer.page.screenshot({path:`${output}/consumer-b-awaiting-hub.png`,fullPage:true});
          await checkpoint('request-gated-before-weighing','passed; Consumer cannot weigh or submit a weight-based match before Hub weighing');
        } finally {await consumer.context.close();}
        const {context,page}=await mobileSession(browser,'HUB');
        try {
          await page.goto(`${journey.mobile}/hub`,{waitUntil:'networkidle'});
          await page.getByRole('textbox',{name:'Search weighing tasks',exact:true}).fill(journey.listing.title);
          await page.getByText(journey.listing.title,{exact:true}).first().waitFor();
          await page.screenshot({path:`${output}/mobile-hub-assigned-task.png`,fullPage:true});
          await page.getByRole('link',{name:'Weigh textile',exact:true}).click();
          await page.locator('input[name="weight_kg-value"]').fill('12.5');
          await page.locator('select[name="weight_status"]').selectOption('Verified');
          await page.getByLabel('Scale and measurement details',{exact:true}).fill(`SYNTHETIC E2E TEST ${journey.runId}; simulated scale 12.5 kg, not an actual physical measurement.`);
          await submitMobile(page,`listings/${journey.listing.id}/weigh`,()=>page.getByRole('button',{name:/^Save hub weight$/i}).click());
          await page.screenshot({path:`${output}/mobile-hub-weighed.png`,fullPage:true});
        } finally {await context.close();}
      }
      const records=await live.from('measurements').select('id,recorded_by,weight_kg,weight_status,stage').eq('batch_id',journey.listing.batchId).eq('stage','listing');
      assert.ok(!records.error && records.data.length===1);assert.equal(Number(records.data[0].weight_kg),12.5);assert.equal(records.data[0].recorded_by,journey.accounts.HUB.profileId);
      await checkpoint('hub-weighed','passed; exactly one assigned-Hub listing measurement, 12.5 kg = 0.0125 t; not receipt/recovery evidence');return;
    }
    if(phase==='request') {
      assert.ok(journey.listing);
      const existing=await live.from('match_requests').select('id,requester_id').eq('listing_id',journey.listing.id);
      assert.ok(!existing.error && existing.data.length<=1);
      if(existing.data.length){assert.equal(existing.data[0].requester_id,journey.accounts.CONSUMER_B.profileId);journey.requestId=existing.data[0].id;await save();}
      if(!journey.requestId) {
        const {context,page}=await mobileSession(browser,'CONSUMER_B');
        try {
          await page.goto(`${journey.mobile}/item/${journey.listing.id}`,{waitUntil:'networkidle'});
          await page.locator('input[name="requested_kg-value"]').fill('12.5');
          await page.getByLabel('Your terms or message',{exact:true}).fill(`SYNTHETIC E2E TEST ${journey.runId}; simulated reuse request, no real pickup/payment.`);
          const result=await submitMobile(page,'match-requests',()=>page.getByRole('button',{name:/^Request a match/}).click());
          assert.ok(result.id);journey.requestId=String(result.id);await save();
          await page.goto(`${journey.mobile}/transfer/${journey.requestId}`,{waitUntil:'networkidle'});
          await page.getByRole('heading',{name:journey.listing.title,exact:true}).first().waitFor();
          await page.screenshot({path:`${output}/consumer-b-requested.png`,fullPage:true});
        } finally {await context.close();}
      }
      await checkpoint('consumer-b-requested','passed; one 12.5 kg request linked to the existing listing and Consumer B');return;
    }
    if(['accept','handover','receipt','complete'].includes(phase)) {
      assert.ok(journey.listing && journey.requestId);
      const action=phase==='accept'?'accepted':phase;
      const expected=({accept:'reserved',handover:'handed_over',receipt:'received',complete:'completed'} as Record<string,string>)[phase];
      const role=phase==='receipt'?'CONSUMER_B':'CONSUMER_A';
      const existing=await live.from('transfers').select('id,status,provider_id,recipient_id').eq('match_request_id',journey.requestId);
      assert.ok(!existing.error && existing.data.length<=1);
      if(existing.data.length){journey.transferId=existing.data[0].id;await save();}
      if(existing.data[0]?.status!==expected) {
        const {context,page}=await mobileSession(browser,role);
        try {
          await page.goto(`${journey.mobile}/transfer/${journey.requestId}`,{waitUntil:'networkidle'});
          await page.getByRole('combobox',{name:'Next step',exact:true}).selectOption(action);
          await page.getByLabel('Evidence or note',{exact:true}).fill(`SYNTHETIC E2E TEST ${journey.runId}; simulated ${phase}, no physical handover/receipt or verified recovery claim.`);
          await submitMobile(page,`match-requests/${journey.requestId}/${action}`,()=>page.getByRole('button',{name:/^Update transfer$/}).click());
          await page.screenshot({path:`${output}/mobile-${phase}.png`,fullPage:true});
        } finally {await context.close();}
      }
      const transfer=await live.from('transfers').select('id,status,provider_id,recipient_id,batch_id').eq('match_request_id',journey.requestId).single();
      assert.ok(!transfer.error);assert.equal(transfer.data.status,expected);assert.equal(transfer.data.provider_id,journey.accounts.CONSUMER_A.profileId);assert.equal(transfer.data.recipient_id,journey.accounts.CONSUMER_B.profileId);assert.equal(transfer.data.batch_id,journey.listing.batchId);
      journey.transferId=transfer.data.id;await save();await markDemoRecords();
      await checkpoint(`transfer-${phase}`,`passed; native status ${expected}, same batch/request/participants; no duplicate transfer`);return;
    }
    if(phase==='verify-web') {
      assert.ok(journey.listing);
      const {context,page,token}=await webSession(browser);
      try {
        const read=async(path:string)=>{
          const response=await context.request.get(`${journey.web}/api/${path}`,{headers:{Authorization:`Bearer ${token}`},timeout:90_000});
          assert.equal(response.status(),200,`Web ${path.split('?')[0]} must load.`);return response.json();
        };
        const batches=(await read('material-batches?dateRange=All%20time')).batches;
        const batch=batches.find((item:Record<string,unknown>)=>item.id===journey.listing!.batchId);
        assert.ok(batch && batch.isDemo && batch.sourceUserId===journey.accounts.CONSUMER_A.profileId);
        await navigateWeb(page,'Material Registry');
        let active=page.locator('main [aria-hidden="false"]').first();
        await active.getByRole('textbox',{name:'Search batch records',exact:true}).fill(journey.listing.batchId);
        await active.getByRole('button',{name:journey.listing.batchId,exact:true}).waitFor();
        await page.screenshot({path:`${output}/web-material-registry.png`,fullPage:true});
        await navigateWeb(page,'Traceability');active=page.locator('main [aria-hidden="false"]').first();
        await active.getByRole('button',{name:'Weighing Monitoring',exact:true}).click();
        await active.getByRole('textbox',{name:'Search weighing records',exact:true}).fill(journey.listing.title);
        await active.getByRole('combobox',{name:'Weighing queue status',exact:true}).selectOption('All states');
        await active.getByText(journey.listing.title,{exact:true}).first().waitFor();
        const monitoring=await read('weighing?dateRange=All%20time');
        const task=monitoring.tasks.find((item:Record<string,unknown>)=>item.id===journey.listing!.id);
        assert.ok(task && task.hubId===journey.accounts.HUB.profileId);
        const measurement=monitoring.history.find((item:Record<string,unknown>)=>item.batchId===journey.listing!.batchId);
        if(measurement){assert.equal(measurement.weightKg,12.5);assert.equal(measurement.operatorId,journey.accounts.HUB.profileId);}
        await page.screenshot({path:`${output}/web-weighing-${measurement?'measured':'awaiting'}.png`,fullPage:true});
        if(journey.transferId) {
          const raw=await live.from('transfers').select('status').eq('id',journey.transferId).single();assert.ok(!raw.error);
          let transfer: Record<string,any>|undefined;
          for(let attempt=0;attempt<8;attempt++) {
            transfer=(await read('transfers?dateRange=All%20time')).transfers.find((item:Record<string,unknown>)=>item.id===journey.transferId);
            if(transfer?.canonicalStatus===raw.data.status)break;
            await page.waitForTimeout(5000);
          }
          assert.ok(transfer);assert.equal(transfer.canonicalStatus,raw.data.status);
          assert.equal(transfer.requesterName,journey.accounts.CONSUMER_B.name);assert.equal(transfer.batchId,journey.listing.batchId);
          assert.equal(transfer.verifiedWeightKg,null,'A listing scale measurement must not manufacture independently verified receipt.');
          await active.getByRole('button',{name:'Transfers',exact:true}).first().click();
          await active.getByRole('textbox',{name:'Search transfers',exact:true}).fill(journey.accounts.CONSUMER_B.name);
          await active.getByRole('button',{name:journey.transferId,exact:true}).waitFor();
          await page.screenshot({path:`${output}/web-transfer-${raw.data.status}.png`,fullPage:true});
          if(raw.data.status==='completed') {
            assert.equal(transfer.receiptWeightKg,12.5);
            assert.deepEqual(transfer.events.map((item:Record<string,unknown>)=>item.canonicalStage),['reserved','handover','receipt','completion']);
            const analytics=await read('analytics/dashboard');journey.analyticsAfter={sharedActivity:analytics.sharedActivity,circularFlow:analytics.circularFlow,kpis:analytics.kpis,asOf:new Date().toISOString()};await save();
            const listing=await live.from('listings').select('available_weight_kg,reserved_kg,is_demo').eq('id',journey.listing.id).single();
            assert.ok(!listing.error);assert.equal(Number(listing.data.available_weight_kg),0);assert.equal(Number(listing.data.reserved_kg),0);assert.ok(listing.data.is_demo);
            const reward=await live.from('reward_ledger').select('points').eq('transfer_id',journey.transferId);assert.ok(!reward.error);assert.equal(reward.data.reduce((sum,item)=>sum+Number(item.points),0),0);
            await navigateWeb(page,'Overview');await page.getByText('Program Analytics',{exact:true}).waitFor();await page.screenshot({path:`${output}/web-overview-after.png`,fullPage:true});
          }
        }
        await checkpoint('web-reconciliation',`passed; matching mobile listing, batch, assigned Hub, ${measurement?'12.5 kg measurement':'unknown weight'}${journey.transferId?', native transfer state and requester name':''}`);
      } finally {await context.close();}return;
    }
    if(phase==='approve-hub') {
      const {context,page}=await webSession(browser);
      try {
        await navigateWeb(page,'Recovery Monitoring');
        const active=page.locator('main [aria-hidden="false"]').first();
        await active.getByRole('button',{name:'Hub Management',exact:true}).click();
        await active.getByRole('textbox',{name:'Search Hub accounts',exact:true}).fill(journey.accounts.HUB.email);
        const row=active.locator('tbody tr').filter({hasText:journey.accounts.HUB.email});await row.waitFor();
        await page.screenshot({path:`${output}/web-hub-pending.png`,fullPage:true});
        if(!(await row.innerText()).includes('Approved')) {
          await row.getByRole('button',{name:`Manage Hub ${journey.accounts.HUB.name}`,exact:true}).click();
          const dialog=page.getByRole('dialog');
          await dialog.getByRole('combobox',{name:'Access decision',exact:true}).selectOption('approve');
          await dialog.getByRole('textbox',{name:'Administrative reason',exact:true}).fill(`E2E TEST ${journey.runId}; synthetic Hub approval only; no physical operation.`);
          const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/hubs/${journey.accounts.HUB.profileId}`&&response.request().method()==='PATCH');
          await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
          assert.equal((await responsePromise).status(),200);await dialog.waitFor({state:'hidden'});
          await row.getByText('Approved',{exact:true}).waitFor();
        }
        await page.screenshot({path:`${output}/web-hub-approved.png`,fullPage:true});
        await checkpoint('web-hub-approved','passed; actual administrator Hub Management approval');
      } finally {await context.close();}
      const hub=await mobileSession(browser,'HUB');
      try {
        assert.notEqual(new URL(hub.page.url()).pathname,'/login');
        await hub.page.goto(`${journey.mobile}/hub`,{waitUntil:'networkidle'});
        await hub.page.getByRole('heading',{name:/Textile weighing/i}).waitFor();
        await hub.page.screenshot({path:`${output}/mobile-hub-approved.png`,fullPage:true});await rememberSession(hub.context,'HUB');
        await checkpoint('mobile-hub-approved','passed; re-login reflects web approval and shows weighing workspace');
      } finally {await hub.context.close();}
      return;
    }
    throw new Error('Journey phase not implemented.');
  } finally {await browser.close();}
}
async function main() {
  if (phase === 'prepare') {
    for (const path of [credentialsPath, statePath]) {
      try { await access(path); throw new Error('An E2E file already exists. Resume it instead of overwriting credentials.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
    const runId = `${date}-${randomUUID().slice(0, 6)}`;
    const baseEmail=process.env.E2E_EMAIL_BASE??'';
    assert.match(baseEmail,/^[a-zA-Z0-9._-]+@gmail\.com$/,'Set E2E_EMAIL_BASE to the approved Gmail inbox before preparing a new journey.');
    const mailbox=baseEmail.split('@')[0];
    const accounts = Object.fromEntries(roles.map(role => [role, {
      email: `${mailbox}+e2e-${runId}-${role.toLowerCase().replaceAll('_', '-')}@gmail.com`,
      name: `E2E TEST ${role.replaceAll('_', ' ')} ${runId}`,
    }])) as Journey['accounts'];
    const credentials = roles.flatMap(role => [`E2E_${role}_EMAIL=${accounts[role].email}`, `E2E_${role}_PASSWORD=BtE2e!7${randomBytes(24).toString('base64url')}`]).join('\n') + '\n';
    await writeFile(credentialsPath, credentials, { flag: 'wx', mode: 0o600 });
    state = { runId, mobile: 'https://baliktelaprogressive.vercel.app', web: 'https://baliktelaph.com', createdAt: new Date().toISOString(), accounts };
    await writeFile(statePath, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ result: 'prepared', runId, accounts, passwords: 'Generated privately; never printed.', credentialsPath }));
    return;
  }
  state = JSON.parse(await readFile(statePath, 'utf8')) as Journey;
  if(phase==='transfer-flow' && process.argv.includes('--live')) {
    for(const step of ['request','accept','verify-web','handover','verify-web','receipt','verify-web','complete','verify-web','verify-access']) {phase=step;await runJourney();}
    return;
  }
  if(['login-check','approve-hub','inspect-post','inspect-hub','post-listing','weigh','request','accept','handover','receipt','complete','verify-web','verify-access'].includes(phase) && process.argv.includes('--live')) {await runJourney();return;}
  assert.ok(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY, 'Server credentials are required.');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if(phase==='close-sessions'&&process.argv.includes('--live')) {
    for(const role of roles) {
      const account:Account=state.accounts[role];
      const response:Response=await fetch(`${state.web}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:account.email,password:process.env[`E2E_${role}_PASSWORD`],client:'api'})});
      assert.equal(response.status,200);const identity=await response.json();assert.equal(identity.user.id,account.profileId);
      const headers={Authorization:`Bearer ${identity.accessToken??identity.token}`,'Content-Type':'application/json'};
      const logout:Response=await fetch(`${state.web}/api/auth/logout-all`,{method:'POST',headers,body:'{}'});assert.equal(logout.status,200);
      assert.equal((await fetch(`${state.web}/api/auth/me`,{headers})).status,401,'Finished test sessions must be invalidated.');
      const mobile:SupabaseClient=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
      const login:Awaited<ReturnType<typeof mobile.auth.signInWithPassword>>=await mobile.auth.signInWithPassword({email:account.email,password:process.env[`E2E_${role}_PASSWORD`]!});
      assert.ok(!login.error&&login.data.user?.id===account.authId);assert.ok(!(await mobile.auth.signOut({scope:'global'})).error);
    }
    await checkpoint('session-cleanup','passed; all finished test-account web/mobile sessions revoked; four accounts remain usable by normal sign-in');return;
  }
  if(phase==='finalize') {
    const journey=state;assert.ok(journey.listing && journey.requestId && journey.transferId && journey.analyticsAfter);
    for(const required of ['mobile-login-CONSUMER_A','mobile-login-CONSUMER_B','web-admin-login','web-hub-approved','mobile-hub-approved',
      'listing-created','hub-weighed','consumer-b-requested','transfer-accept','transfer-handover','transfer-receipt','transfer-complete',
      'access-CONSUMER_A','access-CONSUMER_B','access-HUB'])assert.ok(journey.checks?.some(check=>check.step===required&&check.result.startsWith('passed')),`Missing completed check: ${required}`);
    const complete=[...journey.checks!].reverse().find(check=>check.step==='transfer-complete')!;
    assert.ok(journey.checks!.some(check=>check.step==='web-reconciliation'&&check.at>complete.at),'Completion must be verified in web, not just database.');
    const profiles=await supabase.from('users').select('id,auth_user_id,role,organization_verified').in('id',roles.map(role=>journey.accounts[role].profileId!));
    assert.ok(!profiles.error&&profiles.data.length===4);assert.equal(new Set(profiles.data.map(item=>item.auth_user_id)).size,4);
    for(const role of roles)assert.equal(profiles.data.find(item=>item.id===journey.accounts[role].profileId)?.role,role==='ADMIN'?'Administrator':role==='HUB'?'Recycler':'Consumer');
    const listingResult=await supabase.from('listings').select('id,batch_id,owner_id,available_weight_kg,reserved_kg,is_demo').eq('id',journey.listing.id).single();
    assert.ok(!listingResult.error);assert.ok(listingResult.data.is_demo);assert.equal(Number(listingResult.data.available_weight_kg),0);assert.equal(Number(listingResult.data.reserved_kg),0);
    const transfers=await supabase.from('transfers').select('id,status,is_demo').eq('match_request_id',journey.requestId);
    assert.ok(!transfers.error&&transfers.data.length===1&&transfers.data[0].status==='completed'&&transfers.data[0].is_demo);
    const readings=await supabase.from('measurements').select('*').eq('batch_id',journey.listing.batchId);
    assert.ok(!readings.error&&readings.data.length===1);assert.equal(readings.data[0].stage,'listing');assert.equal(Number(readings.data[0].weight_kg),12.5);
    const recovery=await supabase.from('recovery_records').select('*').eq('batch_id',journey.listing.batchId);assert.ok(!recovery.error);
    const store=new SupabaseStore(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
    let evidence: ReturnType<typeof aggregateMaterialEvidence>;
    let missingGeography=false;
    try {
      const batch=await store.findById('materialBatches',journey.listing.batchId),transfer=await store.findById('transfers',journey.transferId),listing=await store.findById('listings',journey.listing.id);
      assert.ok(batch&&transfer&&listing&&batch.isDemo);assert.equal(transfer.receiptWeightKg,12.5);assert.equal(transfer.verifiedWeightKg,null);
      assert.deepEqual(transfer.events.map(item=>item.canonicalStage),['reserved','handover','receipt','completion']);
      assert.equal(new Set(transfer.events.map(item=>item.id)).size,4);
      assert.equal(batch.sourceUserId,journey.accounts.CONSUMER_A.profileId);
      missingGeography=!batch.city||!batch.region;
      evidence=aggregateMaterialEvidence([batch],[transfer],recovery.data.map(row=>decodeRecord('recoveryRecords',{...row,_id:row.id})),
        {listings:[listing],measurements:readings.data.map(row=>decodeRecord('measurements',{...row,_id:row.id}))});
      assert.equal(evidence.completedKg,12.5);assert.equal(evidence.completedReportedWeight,1);assert.equal(evidence.reusedKg+evidence.recycledKg,0);assert.equal(evidence.diversionRate,null);
    } finally {await store.close();}
    const directory=`test-results/mobile-web-e2e/${journey.runId}`;await mkdir(`${directory}/images`,{recursive:true,mode:0o700});
    const selectedImages=[['hub-before-approval.png','Hub pending approval'],['web-hub-approved.png','Administrator approves Hub'],
      ['mobile-hub-weighed.png','Hub records simulated 12.5 kg'],['consumer-b-requested.png','Consumer B requests the textile'],
      ['mobile-complete.png','Mobile transfer completion'],['web-transfer-completed.png','Web transfer and requester'],['web-overview-after.png','Web overview after completion']];
    for(const [file] of selectedImages)await writeFile(`${directory}/images/${file}`,await readFile(`/tmp/baliktela-e2e-review/${journey.runId}/${file}`),{mode:0o600});
    const before=journey.analyticsBefore as {kpis?:Array<{label:string;value:string}>;sharedActivity?:Record<string,number>};
    const after=journey.analyticsAfter as typeof before;
    const escape=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const changes=(after.kpis??[]).map(item=>({metric:item.label,before:before.kpis?.find(old=>old.label===item.label)?.value??'Not recorded',after:item.value}));
    const findings=[
      'The tested mobile route completes an exchange, not independently verified recycling. The 12.5 kg receipt is reported; listing weighing is not a verified receipt or final outcome. No collection/recovery/disposal evidence was invented.',
      ...(missingGeography?['The new mobile batch has no structured city/region although a free-text address was entered. Data Quality correctly records an additional geography gap. Regional allocation needs a mobile/shared-contract decision; no guessed location was written.']:[]),
      'The current mobile Consumer account may share and request textiles. Web Consumer Producer-only creation remains denied. The test did not change either Consumer into a Producer.',
      'The approved mobile Hub is stored once as Recycler under the installed compatibility contract. No role trigger or database function was changed.',
      'The new Administrator was intentionally provisioned through a server-side, audited setup operation after real email confirmation. Subsequent administrator login and Hub approval used normal web authentication and UI.',
    ];
    const result={result:'passed',runId:journey.runId,completedAt:new Date().toISOString(),mobile:journey.mobile,web:journey.web,
      fixture:{accounts:4,listingId:journey.listing.id,batchId:journey.listing.batchId,requestId:journey.requestId,transferId:journey.transferId,
        listings:1,transfers:1,hubMeasurements:1,flowEvents:4,weightKg:12.5,weightTonnes:0.0125,remainingKg:0,reservedKg:0,isDemo:true},
      evidence:{completedKg:evidence.completedKg,reportedReceipts:evidence.completedReportedWeight,validatedCollectionKg:evidence.collectedKg,
        confirmedReuseKg:evidence.reusedKg,confirmedRecyclingKg:evidence.recycledKg,recoveryShare:evidence.diversionRate,landfillAvoidedKg:null},
      checks:journey.checks,changes,findings,preExistingBusinessRecordsChanged:0,mobileSourceChanges:0,sharedSchemaOrFunctionChanges:0,
      accountRetention:'Four labeled test accounts remain available. Passwords are in ignored owner-only .env.e2e-review, never in this report. Retire the test Administrator after review.'};
    await writeFile(`${directory}/result.json`,JSON.stringify(result,null,2),{mode:0o600});
    const when=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'full',timeStyle:'short'}).format(new Date());
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BalikTelaPH Mobile to Web Test</title>
      <style>body{font:15px/1.6 system-ui,sans-serif;color:#23342d;margin:0;background:#f7f9f8}main{max-width:1120px;margin:auto;padding:32px 20px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}a{color:#17644b}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce4de}th{background:#edf3ef}.scroll{overflow:auto}.status{color:#17644b;font-weight:700}figure{margin:24px 0;border-top:1px solid #dce4de;padding-top:16px}img{display:block;max-width:100%;max-height:800px;object-fit:contain;object-position:left top}code{overflow-wrap:anywhere}li{margin:8px 0}small{color:#607068}@media print{figure{break-inside:avoid}body{background:white}}</style>
      <main><p class="status">PASSED: live mobile transaction to web monitoring</p><h1>BalikTelaPH End-to-End Experience</h1><p>${escape(when)} · Run <code>${escape(journey.runId)}</code></p>
      <p>Two Consumers, one approved Hub (stored as Recycler), and one new test Administrator. A synthetic 12.5 kg textile was listed, weighed, requested, accepted, handed over, received, completed, and matched in the deployed web dashboard.</p>
      <p><a href="${journey.mobile}">Mobile app</a> · <a href="${journey.web}/dashboard">Web dashboard</a></p><h2>Test References</h2><p>Listing / batch: <code>${escape(journey.listing.id)}</code><br>Request / transfer: <code>${escape(journey.transferId)}</code><br>Title: ${escape(journey.listing.title)}</p>
      <h2>Measured Test Results</h2><ul><li>One listing, one batch, one request, one transfer, one Hub weighing, four ordered lifecycle events.</li><li>12.5 kg = 0.0125 metric tonnes. Remaining and reserved stock: 0 kg.</li><li>Only reported receipt evidence exists. Confirmed collection/reuse/recycling and landfill diversion are not established by this route.</li><li>Both Consumers are denied web Producer creation and account administration. Hub self-approval is denied and its directory/history are scoped.</li></ul>
      <h2>Observed Overview Changes</h2><p>Platform figures include existing demo and operational records. These displayed totals are rounded; the test transfer itself is exactly 0.0125 t.</p><div class="scroll"><table><thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead><tbody>${changes.map(row=>`<tr><td>${escape(row.metric)}</td><td>${escape(row.before)}</td><td>${escape(row.after)}</td></tr>`).join('')}</tbody></table></div>
      <h2>Findings and Boundaries</h2><ul>${findings.map(finding=>`<li>${escape(finding)}</li>`).join('')}</ul>
      <h2>Execution Evidence</h2><div class="scroll"><table><thead><tr><th>Step</th><th>Result</th></tr></thead><tbody>${journey.checks!.map(check=>`<tr><td>${escape(check.step)}</td><td>${escape(check.result)}</td></tr>`).join('')}</tbody></table></div>
      <h2>Screenshots</h2>${selectedImages.map(([file,label])=>`<figure><figcaption>${escape(label)}</figcaption><a href="images/${file}"><img src="images/${file}" alt="${escape(label)}" loading="lazy"></a></figure>`).join('')}
      <h2>Safety and Retention</h2><p>No pre-existing business records, mobile source, shared schema, or database functions were modified. Only the new labeled test fixtures and normal authentication/audit records were created. Test business records are classified as demo data.</p><p>Passwords remain in the ignored, owner-only <code>.env.e2e-review</code> file and are omitted here. The four test accounts remain available; retire the test Administrator when review is complete.</p><small>This test verifies the executed route and stated role checks, not every mobile feature or absence of security vulnerabilities.</small></main></html>`;
    await writeFile(`${directory}/report.html`,html,{mode:0o600});journey.report=`${directory}/report.html`;await checkpoint('journey-finished','passed; live transaction journey reconciled and evidence report generated');
    console.log(JSON.stringify({result:'passed',report:journey.report,fixture:result.fixture,evidence:result.evidence,missingStructuredGeography:missingGeography,preExistingBusinessRecordsChanged:0}));return;
  }
  if (phase === 'status') {
    const result = [];
    for (const role of roles) {
      const account: Account = state.accounts[role];
      if (!account.authId) { result.push({ account: role, email: account.email, registered: false }); continue; }
      const auth = await supabase.auth.admin.getUserById(account.authId);
      assert.ok(!auth.error && auth.data.user?.email === account.email, 'Test identity mismatch.');
      const profiles = await supabase.from('users').select('id,auth_user_id,role,organization_verified,account_status')
        .eq('auth_user_id', account.authId);
      assert.ok(!profiles.error && profiles.data.length === 1, 'Expected one test profile per identity.');
      account.confirmedAt = auth.data.user.email_confirmed_at;
      account.profileId = profiles.data[0].id;
      account.role = profiles.data[0].role;
      result.push({ account: role, email: account.email, confirmed: Boolean(account.confirmedAt), profileCount: profiles.data.length,
        role: account.role, approvedHub: profiles.data[0].organization_verified === true, accountStatus: profiles.data[0].account_status });
    }
    await save(); console.log(JSON.stringify({ runId: state.runId, result, changes: 0 }, null, 2)); return;
  }
  if (phase === 'promote-admin' && process.argv.includes('--live')) {
    const account: Account = state.accounts.ADMIN;
    assert.ok(account.confirmedAt && account.authId && account.profileId, 'Confirm and check the new admin identity first.');
    const store = new SupabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
    try {
      const existing = await store.findById('users', account.profileId);
      assert.ok(existing && existing.authUserId === account.authId && existing.email === account.email && existing.fullName === account.name,
        'Only the exact new test identity may be provisioned.');
      assert.ok(existing.emailVerifiedAt && existing.passwordChangedAt, 'Normal email verification and password initialization are required.');
      if (existing.role !== 'Administrator') {
        assert.equal(existing.role, 'Consumer');
        const owner = await store.findOne('users', user => user.email === process.env.PRIMARY_ADMIN_EMAIL && user.role === 'Administrator' && user.accountStatus === 'Active');
        assert.ok(owner, 'An existing active owner must authorize the audited provisioning operation.');
        await saveManagement(store, owner, [{ name: 'users', previous: existing, record: { ...existing,
          role: 'Administrator', accountStatus: 'Active', verification: 'Demo verified', canonicalVerification: 'verified', organizationVerified: true,
          scope: { organizationIds: [], facilityIds: [], regions: [], aggregateOnly: false, canExport: true },
        } }], 'test.administrator.provisioned', existing.id, `User-authorized E2E TEST ${state.runId}; new test profile only, no existing account modified.`);
      }
      account.role = 'Administrator'; await save();
      console.log(JSON.stringify({ account: 'ADMIN', role: account.role, authentication: 'Normal Supabase password login', existingAccountChanges: 0 }));
    } finally { await store.close(); }
    return;
  }
  if (phase !== 'signup' || !process.argv.includes('--live')) throw new Error('Use prepare, status, signup --live, or promote-admin --live.');
  const output = `/tmp/baliktela-e2e-review/${state.runId}`;
  await mkdir(output, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    for (const role of roles) {
      const account: Account = state.accounts[role];
      if (account.registeredAt) continue;
      state.step = `signup-${role}`; await save();
      const existing = await supabase.from('users').select('id').eq('email', account.email);
      assert.ok(!existing.error && existing.data.length === 0, 'An unrecognized profile already uses this alias; stop instead of changing it.');
      const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
      const page = await context.newPage();
      try {
        await page.goto(`${state.mobile}/signup`, { waitUntil: 'networkidle', timeout: 45_000 });
        if (role === 'HUB') await page.getByRole('radio', { name: /^Recycler/ }).check();
        await page.getByLabel('Full name', { exact: true }).fill(account.name);
        await page.getByRole('combobox', { name: 'Location', exact: true }).fill('Quezon City, Metro Manila, Philippines');
        await page.getByLabel('Unit, floor, building or landmark (optional)', { exact: true }).fill('TEST PROFILE ONLY - no physical collection site');
        await page.getByLabel('Email address', { exact: true }).fill(account.email);
        const password = process.env[`E2E_${role}_PASSWORD`]; assert.ok(password);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByLabel('Confirm password', { exact: true }).fill(password);
        const responsePromise = page.waitForResponse(response => response.url().includes('/auth/v1/signup') && response.request().method() === 'POST', { timeout: 45_000 });
        await page.getByRole('button', { name: 'Create account', exact: true }).click();
        const response = await responsePromise;
        const payload = await response.json();
        if (!response.ok()) {
          await page.screenshot({ path: `${output}/signup-${role}-failed.png`, fullPage: true });
          console.log(JSON.stringify({ account: role, status: response.status(), code: /^[a-zA-Z0-9_]+$/.test(payload.code) ? payload.code : 'signup_failed' }));
          throw new Error('Signup was not accepted. No automatic retry.');
        }
        const identity = payload.user ?? payload;
        assert.ok(identity.id && identity.email === account.email && identity.identities?.length, 'Signup did not establish a fresh identity.');
        account.authId = identity.id; account.registeredAt = new Date().toISOString(); await save();
        await page.getByText(/Check your email to confirm/i).first().waitFor({ timeout: 15_000 });
        await page.screenshot({ path: `${output}/signup-${role}-confirmation.png`, fullPage: true });
        console.log(JSON.stringify({ account: role, email: account.email, signup: 'accepted', waitingForEmailConfirmation: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  state.step = 'waiting-for-email-confirmation'; await save();
}
try { await main(); }
catch (error) {
  const privateValues = Object.entries(process.env).filter(([key, value]) => /PASSWORD|SECRET|TOKEN|DB_URL/.test(key) && value && value.length > 8).map(([, value]) => value!);
  let detail = error instanceof Error ? error.stack ?? error.message : 'Unknown failure';
  for (const value of privateValues) detail = detail.replaceAll(value, '[redacted]');
  await writeFile('.env.e2e-error.txt', detail, { mode: 0o600 });
  console.error(JSON.stringify({ result: 'stopped', phase, step: state?.step, detail: 'Private diagnostics saved in ignored .env.e2e-error.txt. No automatic retry or cleanup.' }));
  process.exitCode = 1;
}
