import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { accessSummary } from '../server/access-control.js';
import { serveWebApp } from '../server/webApp.js';

// Isolated browser fixtures only; no shared records or account mutations.
const data=await createSeedData(),base=data.facilities[0],batch=data.materialBatches[0],record=data.recoveryRecords[0],listing=data.listings[0];
const scenarios=[['Vacant facility',1000,100,'Near capacity','Available'],['Threshold facility',1000,900,'Available','Intake paused'],
  ['Full facility',1000,1000,'Available','Intake paused'],['Historical overloaded facility',1000,1250,'Available','Intake paused'],
  ['Maintenance facility',1000,100,'Maintenance','Maintenance'],['Small occupied facility',1000,10,'Available','Available'],
  ['Reserved facility',1000,100,'Available','Intake paused']] as const;
data.facilities=scenarios.map(([name,capacity,,status],index)=>({...base,id:`FAC-CHECK-${index}`,name,storageCapacityKg:capacity,monthlyCapacityKg:capacity,status}));
data.materialBatches=scenarios.map((_,index)=>({...batch,id:`BATCH-CHECK-${index}`,createdAt:'2026-09-02T01:00:00Z'}));
data.recoveryRecords=scenarios.map(([, ,intake],index)=>({...record,id:`INTAKE-CHECK-${index}`,batchId:`BATCH-CHECK-${index}`,facilityId:`FAC-CHECK-${index}`,
  stage:'Collection',inputWeightKg:intake,outputWeightKg:intake,residualWeightKg:0,lossWeightKg:0,status:'Validated',validatedBy:data.users[0].id,timestamp:'2026-09-03T01:00:00Z'}));
data.transfers=[];data.listings=[];data.measurements=[];
for(let index=0;index<scenarios.length;index++) {
  const operator={...data.users.find(item=>item.role==='Recycler')!,id:`HUB-CHECK-${index}`,role:'BalikTela Hub' as const,
    webHubOperator:true,accountStatus:'Active' as const,organizationVerified:true,canonicalVerification:'verified',scope:{...data.users[0].scope,facilityIds:[`FAC-CHECK-${index}`]}};
  data.users.push(operator);data.recoveryRecords[index].recordedBy=operator.id;
}
const consumer=data.users.find(user=>user.role==='Consumer')!;
data.materialBatches.push({...batch,id:'INCOMING-STORAGE',sourceUserId:consumer.id,declaredWeightKg:800,createdAt:'2026-09-04T01:00:00Z'});
data.listings.push({...listing,id:'INCOMING-LISTING',batchId:'INCOMING-STORAGE',ownerId:consumer.id,weighingHubId:'HUB-CHECK-6',
  status:'Open',canonicalStatus:'available',deliveryRoute:'via_hub',createdAt:'2026-09-04T01:00:00Z'});
const now=new Date('2026-10-20T04:00:00Z');
class FixtureStore extends MemoryStore { async loadHubDisposals(){return {available:true,records:[]};} }
const analytics=await buildDashboardAnalytics(new FixtureStore(data),data.users[0],{dateRange:'Custom range',startDate:'2026-09-01',endDate:'2026-09-30'},undefined,now);
const cleared=structuredClone(analytics);
// A fresh analytics response after two unique partial disposals: 900 kg -> 500 kg -> 0 kg.
const {loadDashboardAnalyticsSnapshot}=await import('../server/dashboardAnalytics.js');
const source=await loadDashboardAnalyticsSnapshot(new FixtureStore(data));
const disposalListing={...listing,id:'STORAGE-DISPOSAL-LISTING',batchId:'BATCH-CHECK-1',weighingHubId:'HUB-CHECK-1'};
source.listings.push(disposalListing);
source.hubDisposals={available:true,records:[400,500].map((weightKg,index)=>({id:`DISPOSAL-${index}`,listingId:disposalListing.id,operatorId:'HUB-CHECK-1',listingTitle:disposalListing.title,category:'Cotton',weightKg,reason:'Fixture disposal',disposedAt:'2026-10-19T00:00:00Z'}))};
const afterDisposal=await buildDashboardAnalytics(new FixtureStore(data),data.users[0],{},source,now);
cleared.hubStorage=afterDisposal.hubStorage;
const registryData=structuredClone(data);
registryData.facilities=Array.from({length:7},(_,index)=>({...base,id:`REGISTERED-HUB-${index}`,name:`Registered Hub ${index+1}`,status:'Available'}));
registryData.users=[registryData.users[0],...registryData.users.filter(user=>user.role==='BalikTela Hub').slice(0,2).map(user=>({...user,scope:{...user.scope,facilityIds:[]}}))];
registryData.materialBatches=[];registryData.recoveryRecords=[];
const registryAnalytics=await buildDashboardAnalytics(new FixtureStore(registryData),registryData.users[0],{dateRange:'Custom range',startDate:'2026-09-01',endDate:'2026-09-30'},undefined,now);
const app=express();serveWebApp(app);const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const output='/tmp/baliktela-facility-capacity-ui';await mkdir(output,{recursive:true});
try {
  for(const width of [375,1366,2560]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let writes=0,showRegistry=false,showCleared=false;
    await page.route('**/api/**',async route=>{
      if(route.request().method()!=='GET'){writes++;return route.fulfill({status:405,json:{message:'Read-only test'}});}
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/auth/me')return route.fulfill({json:{user:data.users[0],access:accessSummary(data.users[0]),storage:'isolated-fixture'}});
      if(path==='/api/analytics/dashboard')return route.fulfill({json:showRegistry?registryAnalytics:showCleared?cleared:analytics});
      return route.fulfill({status:404,json:{message:`Unmocked ${path}`}});
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);await page.getByText('Program Analytics',{exact:true}).waitFor();
    const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
    await page.getByRole('button',{name:'Hub Facilities',exact:true}).click();
    const active=page.locator('main [aria-hidden="false"]');
    await active.getByRole('heading',{name:'Hub Facilities',exact:true}).waitFor();
    await active.getByRole('columnheader',{name:'Storage capacity',exact:true}).waitFor();
    assert.match(await active.innerText(),/Current stock and incoming reservations/);
    assert.equal(await active.getByRole('columnheader',{name:'Period capacity',exact:true}).count(),0);
    for(const label of ['Hub Collection & Disposal','Hub Management','Hub Directory','Hub Disposals'])
      assert.equal(await active.getByRole('button',{name:label,exact:true}).count(),0);
    for(const [name,capacity,intake,,expected] of scenarios){
      const row=active.getByRole('row').filter({has:page.getByText(name,{exact:true})});
      await row.getByText(expected,{exact:true}).waitFor();
      if(capacity>0){
        assert.match(await row.innerText(),new RegExp(`${intake/capacity*100}%`));
        const headroom=Math.max(0,capacity*0.9-intake-(name==='Reserved facility'?800:0))/1000;
        await row.getByText(`${headroom} t headroom`,{exact:true}).waitFor();
      }else await row.getByText('Not available',{exact:true}).waitFor();
    }
    const reservedRow=active.getByRole('row').filter({has:page.getByText('Reserved facility',{exact:true})});
    await reservedRow.getByText('90% with reservations',{exact:true}).waitFor();
    await reservedRow.getByText('10%',{exact:true}).waitFor();
    assert.equal(await active.getByText('Over capacity',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(writes,0);assert.deepEqual(errors,[]);
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/facilities-${width}.png`,fullPage:true});
    showCleared=true;await page.reload();await page.getByText('Program Analytics',{exact:true}).waitFor();
    if(await menu.isVisible())await menu.click();await page.getByRole('button',{name:'Hub Facilities',exact:true}).click();
    const reopened=active.getByRole('row').filter({has:page.getByText('Threshold facility',{exact:true})});
    await reopened.getByText('Available',{exact:true}).waitFor();
    await reopened.getByText('0%',{exact:true}).waitFor();
    await reopened.getByText('0.9 t headroom',{exact:true}).waitFor();
    await page.screenshot({path:`${output}/disposal-reopens-${width}.png`,fullPage:true});
    showRegistry=true;await page.reload();await page.getByText('Program Analytics',{exact:true}).waitFor();
    if(await menu.isVisible())await menu.click();await page.getByRole('button',{name:'Hub Facilities',exact:true}).click();
    await active.getByRole('table',{name:'Hub facility analytics'}).waitFor();
    await active.locator('article').filter({has:page.getByText('Registered Hubs',{exact:true})}).getByText('7',{exact:true}).waitFor();
    assert.equal(await active.locator('tbody tr').count(),7);
    assert.equal(await active.getByText('No operator assigned',{exact:true}).count(),0);
    assert.equal(await active.getByText('No approved operator',{exact:true}).count(),7);
    for(const label of ['Assigned accounts','Disposed','Awaiting disposal'])assert.equal(await active.getByRole('columnheader',{name:label,exact:true}).count(),0);
    assert.ok(!/\bsites?\b/i.test(await active.innerText()));
    assert.equal(writes,0);assert.deepEqual(errors,[]);
    await page.screenshot({path:`${output}/registered-hubs-${width}.png`,fullPage:true});
    await context.close();console.log(`Facility capacity/status and analytics-only checks passed at ${width}px.`);
  }
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
