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
const data=await createSeedData(),base=data.facilities[0],batch=data.materialBatches[0],record=data.recoveryRecords[0];
const scenarios=[['Vacant facility',1000,100,'Near capacity','Available'],['Nearly full facility',1000,900,'Available','Near capacity'],
  ['Full facility',1000,1000,'Available','At capacity'],['Overloaded facility',1000,1250,'Available','Over capacity'],
  ['Maintenance facility',1000,100,'Maintenance','Maintenance'],['Unconfigured facility',0,10,'Available','Capacity not configured']] as const;
data.facilities=scenarios.map(([name,capacity,,status],index)=>({...base,id:`FAC-CHECK-${index}`,name,monthlyCapacityKg:capacity,status}));
data.materialBatches=scenarios.map((_,index)=>({...batch,id:`BATCH-CHECK-${index}`,createdAt:'2026-09-02T01:00:00Z'}));
data.recoveryRecords=scenarios.map(([, ,intake],index)=>({...record,id:`INTAKE-CHECK-${index}`,batchId:`BATCH-CHECK-${index}`,facilityId:`FAC-CHECK-${index}`,
  stage:'Collection',inputWeightKg:intake,outputWeightKg:intake,residualWeightKg:0,lossWeightKg:0,status:'Validated',validatedBy:data.users[0].id,timestamp:'2026-09-03T01:00:00Z'}));
data.transfers=[];data.listings=[];data.measurements=[];
for(let index=0;index<scenarios.length;index++) {
  const operator={...data.users.find(item=>item.role==='Recycler')!,id:`HUB-CHECK-${index}`,role:'BalikTela Hub' as const,
    webHubOperator:true,scope:{...data.users[0].scope,facilityIds:[`FAC-CHECK-${index}`]}};
  data.users.push(operator);data.recoveryRecords[index].recordedBy=operator.id;
}
const analytics=await buildDashboardAnalytics(new MemoryStore(data),data.users[0],{dateRange:'Custom range',startDate:'2026-09-01',endDate:'2026-09-30'},undefined,new Date('2026-10-20T04:00:00Z'));
const registryData=structuredClone(data);
registryData.facilities=Array.from({length:7},(_,index)=>({...base,id:`REGISTERED-HUB-${index}`,name:`Registered Hub ${index+1}`,status:'Available'}));
registryData.users=[registryData.users[0],...registryData.users.filter(user=>user.role==='BalikTela Hub').slice(0,2).map(user=>({...user,scope:{...user.scope,facilityIds:[]}}))];
registryData.materialBatches=[];registryData.recoveryRecords=[];
const registryAnalytics=await buildDashboardAnalytics(new MemoryStore(registryData),registryData.users[0],{dateRange:'Custom range',startDate:'2026-09-01',endDate:'2026-09-30'},undefined,new Date('2026-10-20T04:00:00Z'));
const app=express();serveWebApp(app);const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const output='/tmp/baliktela-facility-capacity-ui';await mkdir(output,{recursive:true});
try {
  for(const width of [375,1366,2560]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let writes=0,showRegistry=false;
    await page.route('**/api/**',async route=>{
      if(route.request().method()!=='GET'){writes++;return route.fulfill({status:405,json:{message:'Read-only test'}});}
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/auth/me')return route.fulfill({json:{user:data.users[0],access:accessSummary(data.users[0]),storage:'isolated-fixture'}});
      if(path==='/api/analytics/dashboard')return route.fulfill({json:showRegistry?registryAnalytics:analytics});
      return route.fulfill({status:404,json:{message:`Unmocked ${path}`}});
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);await page.getByText('Program Analytics',{exact:true}).waitFor();
    const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
    await page.getByRole('button',{name:'Hub Facilities',exact:true}).click();
    const active=page.locator('main [aria-hidden="false"]');
    await active.getByRole('heading',{name:'Hub Facilities',exact:true}).waitFor();
    for(const label of ['Hub Collection & Disposal','Hub Management','Hub Directory','Hub Disposals'])
      assert.equal(await active.getByRole('button',{name:label,exact:true}).count(),0);
    for(const [name,capacity,intake,,expected] of scenarios){
      const row=active.getByRole('row').filter({has:page.getByText(name,{exact:true})});
      await row.getByText(expected,{exact:true}).waitFor();
      if(capacity>0){
        assert.match(await row.innerText(),new RegExp(`${intake/capacity*100}%`));
        const headroom=Math.abs(capacity-intake)/1000;
        await row.getByText(`${headroom} t ${intake>capacity?'over capacity':'remaining'}`,{exact:true}).waitFor();
      }else await row.getByText('Not available',{exact:true}).waitFor();
    }
    await active.locator('article').filter({has:page.getByText('Network utilization',{exact:true})}).getByText('Not available',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(writes,0);assert.deepEqual(errors,[]);
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/facilities-${width}.png`,fullPage:true});
    showRegistry=true;await page.reload();await page.getByText('Program Analytics',{exact:true}).waitFor();
    if(await menu.isVisible())await menu.click();await page.getByRole('button',{name:'Hub Facilities',exact:true}).click();
    await active.getByRole('table',{name:'Hub facility analytics'}).waitFor();
    await active.locator('article').filter({has:page.getByText('Registered Hubs',{exact:true})}).getByText('7',{exact:true}).waitFor();
    assert.equal(await active.locator('tbody tr').count(),7);
    assert.equal(await active.getByText('No operator assigned',{exact:true}).count(),0);
    assert.equal(await active.getByText('Available',{exact:true}).count(),7);
    for(const label of ['Assigned accounts','Disposed','Awaiting disposal'])assert.equal(await active.getByRole('columnheader',{name:label,exact:true}).count(),0);
    assert.ok(!/\bsites?\b/i.test(await active.innerText()));
    assert.equal(writes,0);assert.deepEqual(errors,[]);
    await page.screenshot({path:`${output}/registered-hubs-${width}.png`,fullPage:true});
    await context.close();console.log(`Facility capacity/status and analytics-only checks passed at ${width}px.`);
  }
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
