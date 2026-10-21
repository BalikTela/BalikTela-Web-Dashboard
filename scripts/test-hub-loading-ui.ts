import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from '../server/dashboardAnalytics.js';
import { buildHubDirectory } from '../server/hubs.js';
import { buildHubOperations } from '../server/hubOperations.js';
import { serveWebApp } from '../server/webApp.js';

const data=await createSeedData(),admin=data.users[0];
const operator={...structuredClone(data.users.find(user=>user.role==='Recycler')!),id:'HUB-LOADING-TEST',
  role:'BalikTela Hub' as const,fullName:'Hub loading check',scope:{...admin.scope,facilityIds:[data.facilities[0].id]}};
data.users.push(operator);
const store=new MemoryStore(data),source=await loadDashboardAnalyticsSnapshot(store);
source.hubDisposals={available:true,records:[]};
const app=express();serveWebApp(app);
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
await mkdir('/tmp/baliktela-hub-loading',{recursive:true});
try {
  for(const viewport of [{width:1440,height:900},{width:375,height:812}]) {
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();
    let facilityReads=0,failFacilities=viewport.width===1440;
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),query=Object.fromEntries(url.searchParams);
      switch(url.pathname) {
        case '/api/auth/me':return route.fulfill({json:{user:admin,access:accessSummary(admin),storage:'isolated-test'}});
        case '/api/analytics/dashboard':return route.fulfill({json:await buildDashboardAnalytics(store,admin,query,source)});
        case '/api/hubs':return route.fulfill({json:await buildHubDirectory(store,admin,query,source)});
        case '/api/hub-operations':return route.fulfill({json:buildHubOperations(source,source.allBatches,admin,'All time')});
        case '/api/facilities':
          facilityReads++;
          if(failFacilities)return route.fulfill({status:503,json:{message:'Assignment lookup unavailable.'}});
          return route.fulfill({json:{facilities:data.facilities}});
        default:return route.fulfill({json:{}});
      }
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByText('Program Analytics',{exact:true}).waitFor();
    const menu=page.getByRole('button',{name:'Open navigation',exact:true});
    if(await menu.isVisible())await menu.click();
    await page.getByRole('button',{name:'Recovery Monitoring',exact:true}).click();
    await page.getByRole('button',{name:'Hub Management',exact:true}).click();
    const manage=page.getByRole('button',{name:'Manage Hub Hub loading check',exact:true});
    await manage.waitFor();assert.equal(facilityReads,0,'Directory loading must not request assignment details.');
    if(failFacilities) {
      await manage.click();await page.getByRole('alert').getByText('Assignment lookup unavailable.').waitFor();
      assert.equal(await page.getByRole('dialog').count(),0);assert.ok(await manage.isEnabled());
      failFacilities=false;
    }
    await manage.click();
    const editor=page.getByRole('dialog');await editor.waitFor();
    assert.equal(facilityReads,viewport.width===1440?2:1);
    await editor.getByLabel('Assigned Hub').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`/tmp/baliktela-hub-loading/editor-${viewport.width}.png`,fullPage:true});
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
    await editor.waitFor({state:'hidden'});assert.deepEqual(errors,[]);
    console.log(`Hub on-demand assignments, error recovery and layout passed at ${viewport.width}px.`);
    await context.close();
  }
} finally {await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
