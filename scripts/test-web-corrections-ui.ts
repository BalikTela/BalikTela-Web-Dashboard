import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort } from '../server/dashboardAnalytics.js';
import { buildHubDirectory, buildHubDisposalMonitoring } from '../server/hubs.js';
import { buildDataQuality } from '../server/dataQuality.js';
import { buildGovernance } from '../server/governance.js';
import { planImport, commitImport, importCsv } from '../server/imports.js';
import { IMPORT_COLUMNS } from '../shared/imports.js';
import { matchesTransferStatus } from '../shared/workflows.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';

// Every API is intercepted and backed by disposable memory fixtures, never Supabase.
const now=new Date('2026-10-19T04:00:00Z'),app=express();serveWebApp(app);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const output='/tmp/baliktela-web-corrections-ui';await mkdir(output,{recursive:true});
const results:unknown[]=[];
try {
  for(const width of [375,1366,2560]){
    const seed=await createSeedData(),actor=seed.users[0];
    const base=seed.listings[0];seed.listings.push({...base,id:'DISPOSED',title:'Disposed mobile lot',disposedAt:'2026-10-18T01:00:00Z',disposedWeightKg:5},
      {...base,id:'PARTIAL',title:'Partially disposed mobile lot',disposedWeightKg:2},
      {...base,id:'REMAINDER',title:'Pending remainder lot',remainderPending:true});
    seed.transfers.push({...seed.transfers[0],id:'MOBILE-PROCESSED',status:'Processed',canonicalStatus:'processed'},
      {...seed.transfers[0],id:'MOBILE-COLLECTED',status:'Collected',canonicalStatus:'collected'});
    class FixtureStore extends MemoryStore {async loadHubDisposals(){return {available:true,records:[{id:'DISPOSAL-01',listingId:'DISPOSED',operatorId:'USR-REC-01',listingTitle:'Disposed mobile lot',category:'Cotton',weightKg:5,reason:'Damaged textile disposal record',disposedAt:'2026-10-18T01:00:00Z'}]};}}
    const store=new FixtureStore(seed);
    const original=await buildDashboardAnalytics(store,actor,{},undefined,now);
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let committed=0;
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname.replace(/^\/api/,''),query=Object.fromEntries(url.searchParams),body=request.method()==='GET'?{}:request.postDataJSON();
      if(path==='/auth/me')return route.fulfill({json:{user:actor,access:accessSummary(actor),storage:'isolated'}});
      if(path==='/analytics/dashboard')return route.fulfill({json:await buildDashboardAnalytics(store,actor,query,undefined,now)});
      if(path==='/barter/listings')return route.fulfill({json:{listings:await store.all('listings')}});
      if(path==='/material-batches')return route.fulfill({json:{batches:(await store.all('materialBatches')).map(batch=>({...batch,measurements:seed.measurements.filter(item=>item.batchId===batch.id)}))}});
      if(path==='/transfers')return route.fulfill({json:{transfers:(await store.all('transfers')).filter(item=>matchesTransferStatus(item.status,query.transactionStatus))}});
      if(path==='/barter/offers')return route.fulfill({json:{offers:await store.all('offers')}});
      if(path==='/facilities')return route.fulfill({json:{facilities:await store.all('facilities')}});
      if(path==='/recovery-records')return route.fulfill({json:{records:await store.all('recoveryRecords')}});
      if(path==='/hubs')return route.fulfill({json:await buildHubDirectory(store,actor,query)});
      if(path==='/hub-disposals')return route.fulfill({json:await buildHubDisposalMonitoring(store,actor,query,now)});
      if(path==='/data-quality'){const snapshot=await loadDashboardAnalyticsSnapshot(store),cohort=selectAnalyticsCohort(snapshot,actor,query,now);return route.fulfill({json:buildDataQuality(actor,cohort.currentBatches,cohort.currentTransfers,5,now,snapshot)});}
      if(path==='/governance')return route.fulfill({json:buildGovernance(actor,seed.configurations[0])});
      if(path==='/imports/options')return route.fulfill({json:{producers:seed.users.filter(user=>user.role==='Producer').map(user=>({id:user.id,name:user.fullName,region:user.region})),recipients:seed.users.filter(user=>user.role==='Recycler').map(user=>({id:user.id,name:user.fullName,organizationId:user.organizationId})),facilities:seed.facilities.map(item=>({id:item.id,name:item.name,organizationId:item.organizationId}))}});
      if(path==='/imports/preview')return route.fulfill({json:(await planImport(store,actor,importCsv(body),now)).preview});
      if(path==='/imports/commit'){committed++;return route.fulfill({json:await commitImport(store,actor,importCsv(body),body.previewHash,body.reason,now,body.startRow??0)});}
      return route.fulfill({status:404,json:{message:`Missing isolated fixture ${path}`}});
    });
    const navigate=async(name:string)=>{const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();await page.getByRole('button',{name,exact:true}).click();};
    const active=()=>page.locator('main [aria-hidden="false"]').first();
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Page overflow at ${width}`);
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);await page.getByText('Program Analytics',{exact:true}).waitFor();
    await navigate('Listing Oversight');
    assert.equal(await active().getByRole('combobox',{name:'Listing record type'}).count(),0);
    for(const status of ['Disposed','Partially disposed','Remainder pending']){
      await active().getByRole('combobox',{name:'Listing status'}).selectOption(status);
      await active().locator('tbody').getByText(status,{exact:true}).waitFor();
      assert.equal(await active().getByRole('button',{name:/^Manage /}).count(),0);
    }
    await active().getByRole('button',{name:'Reset filters',exact:true}).click();await fits();
    await navigate('Material Registry');await active().getByRole('button',{name:'View MB-2609-001',exact:true}).click();
    assert.equal(await active().getByText('Demo record',{exact:true}).count(),0);
    assert.equal(await active().getByText('Operational record',{exact:true}).count(),0);
    await page.getByRole('dialog').getByText('Source user ID',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Close batch detail'}).click();
    await active().getByRole('button',{name:'Import CSV'}).click();
    const dialog=page.getByRole('dialog',{name:'Import lifecycle data'});await dialog.waitFor();
    const controls=await dialog.locator('input[type="file"],button').evaluateAll(items=>items.filter(item=>item.getClientRects().length).map(item=>item.getBoundingClientRect().toJSON()));
    for(let a=0;a<controls.length;a++)for(let b=a+1;b<controls.length;b++)assert.ok(controls[a].right<=controls[b].left+1||controls[b].right<=controls[a].left+1||controls[a].bottom<=controls[b].top+1||controls[b].bottom<=controls[a].top+1,'Import controls must not overlap.');
    const csv=(bad=false)=>[IMPORT_COLUMNS.join(','),...Array.from({length:12},(_,i)=>`ui-${width}-${i},2026-08-05T01:00:00Z,USR-PROD-01,USR-REC-01,FAC-001,Cotton,100,90,80,Recycling,${bad?101:70}`)].join('\n');
    await dialog.getByLabel('Dataset CSV').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from(csv(true))});
    await dialog.getByRole('button',{name:'Preview file',exact:true}).click();
    await dialog.getByText(/12 invalid/).waitFor();assert.equal(committed,0);
    await dialog.getByLabel('Dataset CSV').setInputFiles({name:'demo.csv',mimeType:'text/csv',buffer:Buffer.from(csv())});
    await dialog.getByRole('button',{name:'Preview file',exact:true}).click();await dialog.getByText(/12 new.*0 invalid/).waitFor();
    assert.equal(committed,0);assert.equal((await store.all('materialBatches')).length,seed.materialBatches.length);
    await dialog.getByLabel('Import reason',{exact:true}).fill('Isolated browser acceptance');
    await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Import 12 rows'}).click();
    await dialog.getByRole('status').getByText(/12 imported/).waitFor();assert.equal(committed,1);
    await dialog.getByRole('button',{name:'Preview file',exact:true}).click();
    await dialog.getByText(/0 new.*12 already imported/).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Import 0 rows'}).isDisabled(),true);
    assert.equal(committed,1);
    assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,'Import modal must fit the viewport.');
    await page.screenshot({path:`${output}/import-${width}.png`});
    await dialog.getByRole('button',{name:'Close bulk import'}).click();
    await navigate('Overview');
    const expected=await buildDashboardAnalytics(store,actor,{},undefined,now);
    assert.equal(expected.circularFlow.collectedKg,original.circularFlow.collectedKg+1080);
    await active().locator('article').filter({has:page.getByText('Total Textiles Collected',{exact:true})}).getByText(expected.kpis[0].value,{exact:true}).waitFor();
    await navigate('Traceability');await page.getByRole('combobox',{name:'Workflow status',exact:true}).count();
    const more=page.getByRole('button',{name:/^More filters/});await more.click();await page.getByRole('combobox',{name:'Workflow status',exact:true}).selectOption('Completed');
    await active().getByText('MOBILE-PROCESSED',{exact:true}).waitFor();assert.equal(await active().getByText('MOBILE-COLLECTED',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Reset filters',exact:true}).click();
    await navigate('Recovery Monitoring');await active().getByText('Hub Disposal Monitoring',{exact:true}).waitFor();await active().getByText('Damaged textile disposal record',{exact:true}).waitFor();await fits();
    await page.screenshot({path:`${output}/recovery-${width}.png`,fullPage:true});
    await navigate('Facility Analytics');await active().getByRole('button',{name:'Hub Disposals',exact:true}).click();await active().getByText('Damaged textile disposal record',{exact:true}).waitFor();await fits();
    await navigate('Advanced Analytics');await active().getByText('Recovery evidence by material',{exact:true}).waitFor();assert.equal(await active().getByText('Waste and recovery trend',{exact:true}).count(),0);await fits();
    await navigate('Data Quality');await active().getByText('Checks and Source Records',{exact:true}).waitFor();await fits();
    await navigate('Governance & Policy');await active().getByText('Hub disposal oversight',{exact:true}).waitFor();assert.ok(!(await active().innerText()).includes('Verified completed kilograms / unique declared'));await fits();
    await active().getByText('PoC reporting scope',{exact:true}).waitFor();
    assert.match(await active().innerText(),/Original source classifications remain/);
    await page.screenshot({path:`${output}/governance-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);results.push({width,imports:committed,addedCollectionKg:1080,errors:0});await context.close();
  }
  console.log(JSON.stringify({results,screenshots:output,liveDatabaseWrites:0,emailsSent:0},null,2));
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
