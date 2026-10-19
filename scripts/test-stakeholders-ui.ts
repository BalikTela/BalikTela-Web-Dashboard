import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';

// Only disposable fixtures are used; no authentication or business records are changed live.
const seed=await createSeedData(),admin=seed.users[0],recycler=seed.users.find(item=>item.role==='Recycler')!,consumer=seed.users.find(item=>item.role==='Consumer')!;
const hub={...structuredClone(recycler),id:'HUB-OPERATOR',fullName:'Metro Hub operator',organizationId:null,organization:'',city:'',region:'',organizationVerified:true,
  canonicalVerification:'verified',scope:{...recycler.scope,facilityIds:[]}};
seed.users.push(hub,{...structuredClone(hub),id:'IDLE-HUB',fullName:'Cebu Hub operator',role:'BalikTela Hub',city:'Cebu City',region:'Central Visayas',organizationVerified:false});
const batch={...seed.materialBatches[0],id:'HUB-BATCH',createdAt:'2026-10-15T01:00:00Z',updatedAt:'2026-10-16T01:00:00Z',isDemo:false};seed.materialBatches.push(batch);
seed.listings.push({...seed.listings[0],id:'HUB-LISTING',batchId:batch.id,weighingHubId:hub.id,deliveryRoute:'via_hub',quantityKg:95,createdAt:batch.createdAt,isDemo:false});
seed.measurements.push({...seed.measurements[0],id:'HUB-WEIGHING',batchId:batch.id,transferId:null,canonicalStage:'listing',stage:'Declaration',recordedBy:hub.id,
  weightKg:95,status:'Verified',verifiedBy:hub.id,timestamp:'2026-10-16T01:00:00Z'});
seed.transfers.push({...seed.transfers[0],id:'HUB-LINKED-TRANSFER',listingId:'HUB-LISTING',batchId:batch.id,recipientId:consumer.id,status:'Processed',
  receiptWeightKg:95,verifiedWeightKg:null,createdAt:batch.createdAt,updatedAt:batch.updatedAt,events:[],isDemo:false});
const store=new MemoryStore(seed),now=new Date('2026-10-19T04:00:00Z');
const app=express();serveWebApp(app);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const directory='/tmp/baliktela-stakeholders-ui';await mkdir(directory,{recursive:true});const results:unknown[]=[];
try {
  for(const width of [375,1440,2560]){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];let writes=0;
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'){writes++;return route.fulfill({status:405,json:{message:'Read-only fixture'}});}
      if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:admin,access:accessSummary(admin),storage:'isolated'}});
      if(url.pathname==='/api/analytics/dashboard')return route.fulfill({json:await buildDashboardAnalytics(store,admin,Object.fromEntries(url.searchParams),undefined,now)});
      return route.fulfill({status:404,json:{message:'Unused fixture endpoint'}});
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);await page.getByText('Program Analytics',{exact:true}).waitFor();
    const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
    await page.getByRole('button',{name:'Stakeholders',exact:true}).click();const active=page.locator('main [aria-hidden="false"]').first();
    await active.getByRole('button',{name:'Producers',exact:true}).waitFor();
    assert.equal(await active.getByRole('button',{name:'NGOs',exact:true}).count(),0);
    assert.equal(await active.getByRole('button',{name:'Consumers',exact:true}).count(),0);
    assert.equal(await active.getByRole('button',{name:'Recyclers',exact:true}).count(),0);
    await active.getByRole('button',{name:'Consumers & Recyclers',exact:true}).click();
    const report=await buildDashboardAnalytics(store,admin,{},undefined,now);
    for(const id of [recycler.id,consumer.id])await active.getByText(report.stakeholders.find(item=>item.id===id)!.name,{exact:true}).waitFor();
    assert.equal(await active.getByText(hub.fullName,{exact:true}).count(),0);
    await active.getByRole('button',{name:'BalikTela Hubs',exact:true}).click();
    assert.equal(await active.getByRole('button',{name:'BalikTela Hubs',exact:true}).getAttribute('aria-pressed'),'true');
    await active.getByText(hub.fullName,{exact:true}).waitFor();await active.getByText('Cebu Hub operator',{exact:true}).waitFor();
    await active.getByText('0.095 t',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${directory}/hubs-${width}.png`,fullPage:true});
    await active.getByRole('button',{name:/Metro Hub operator/}).click();const drawer=page.getByRole('dialog');
    await drawer.getByText('Hub operations',{exact:true}).waitFor();await drawer.getByText(/^HUB-LINKED-TRANSFER · /).waitFor();
    await drawer.getByText('No facility assigned',{exact:false}).waitFor();
    const bounds=await drawer.boundingBox();assert.ok(bounds);assert.equal(bounds.x,0);assert.equal(bounds.y,0);assert.equal(bounds.width,width);assert.equal(bounds.height,1000);
    await page.screenshot({path:`${directory}/hub-detail-${width}.png`});
    assert.equal(await drawer.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,
      JSON.stringify(await drawer.locator('*').evaluateAll(items=>items.filter(item=>item.clientWidth>0&&item.scrollWidth>item.clientWidth+1).map(item=>({tag:item.tagName,className:item.className,text:item.textContent?.slice(0,80)})))));
    assert.equal(writes,0);assert.deepEqual(errors,[]);results.push({width,tabs:3,actualRolesUnchanged:true,hubLinkedTransfers:1,writes,pageErrors:0});
    await context.close();
  }
  console.log(JSON.stringify({results,screenshots:directory}));
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
