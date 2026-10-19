import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';

// Deliberate read failures against isolated fixtures, never shared Supabase data.
const seed = await createSeedData();
const analytics = await buildDashboardAnalytics(new MemoryStore(seed), seed.users[0], {});
const app = express(); serveWebApp(app);
const server = app.listen(0,'127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const output = '/tmp/baliktela-traceability-ui'; await mkdir(output,{recursive:true});
try {
  for (const width of [375,1366,2560]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const page = await context.newPage(); const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    let offerRequests=0, transferFails=false, offersFail=true, malformed=false, slow=false, writes=0;
    let many=false, missingName=false;
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname.replace(/^\/api/,'');
      if(request.method()!=='GET'){writes++;return route.fulfill({status:405,json:{message:'Read-only fixture'}});}
      if(path==='/auth/me')return route.fulfill({json:{user:seed.users[0],access:accessSummary(seed.users[0]),storage:'isolated'}});
      if(path==='/analytics/dashboard')return route.fulfill({json:analytics});
      if(path==='/transfers'){
        const region=url.searchParams.get('region');
        if(slow && region==='Metro Manila')await new Promise(resolve=>setTimeout(resolve,600));
        if(transferFails)return route.fulfill({status:503,json:{message:'Transfer service temporarily unavailable.'}});
        if(malformed)return route.fulfill({json:{}});
        const transfer={...seed.transfers[0],requesterName:missingName?null:'Metro Textile Review Requester',id:region==='Central Visayas'?'LATEST-SCOPE-TRANSFER':'TRACEABILITY-OK'};
        return route.fulfill({json:{transfers:many?Array.from({length:12},(_,index)=>({...transfer,id:`SEARCH-TRANSFER-${index}`,requesterName:index===11?'Second-page Requester':`Requester ${index}`})):[transfer]}});
      }
      if(path==='/barter/offers'){
        offerRequests++;
        return route.fulfill(offersFail?{status:503,json:{message:'Offer service temporarily unavailable.'}}:{json:{offers:seed.offers}});
      }
      return route.fulfill({status:404,json:{message:`Unmocked ${path}`}});
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByText('Program Analytics',{exact:true}).waitFor();
    const menu=page.getByRole('button',{name:'Open navigation',exact:true});
    if(await menu.isVisible())await menu.click();
    await page.getByRole('button',{name:'Traceability',exact:true}).click();
    const active=page.locator('main [aria-hidden="false"]').first();
    const retry=active.getByRole('button',{name:'Retry traceability records',exact:true});
    const refresh=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('baliktela:records-changed',{detail:'/transfers'})));
    await active.getByRole('button',{name:'TRACEABILITY-OK',exact:true}).waitFor();
    assert.equal(offerRequests,0,'Transfer monitoring must not wait for an unrelated offers lookup.');
    assert.equal(await active.locator('thead th').first().innerText(),'Requester');
    await active.locator('tbody').getByText('Metro Textile Review Requester',{exact:true}).waitFor();
    const search=active.getByRole('textbox',{name:'Search transfers',exact:true});
    await search.fill('  METRO TEXTILE  ');
    assert.equal(await active.locator('tbody tr').count(),1,'Requester search should ignore surrounding whitespace and letter case.');
    await search.fill('no matching requester');
    await active.getByText('No transfers match these filters.',{exact:true}).waitFor();
    await search.fill(seed.transfers[0].recipientId);
    await active.getByRole('button',{name:'TRACEABILITY-OK',exact:true}).waitFor();
    await search.fill('');

    await active.getByRole('button',{name:'Offers',exact:true}).click();
    await active.getByRole('alert').getByText('Offer service temporarily unavailable.').waitFor();
    offersFail=false;await retry.click();
    await active.locator('tbody').getByText(seed.offers[0].id,{exact:true}).waitFor();
    await active.getByRole('button',{name:'Transfers',exact:true}).last().click();
    await active.getByRole('button',{name:'TRACEABILITY-OK',exact:true}).waitFor();

    transferFails=true;await refresh();
    await retry.waitFor();
    assert.equal(await active.locator('tbody tr').count(),1,'A failed background refresh should retain the last successful records.');
    await page.getByRole('combobox',{name:/^Region/}).selectOption('Metro Manila');
    await retry.waitFor();
    assert.equal(await active.locator('tbody tr').count(),0,'A failed new filter must not display old-scope data.');
    transferFails=false;await retry.click();
    await active.getByRole('button',{name:'TRACEABILITY-OK',exact:true}).waitFor();
    malformed=true;await refresh();
    await active.getByRole('alert').getByText(/Transfers could not be read/).waitFor();
    assert.equal(await active.locator('tbody tr').count(),1);
    await page.screenshot({path:`${output}/retry-${width}.png`});
    malformed=false;await retry.click();await retry.waitFor({state:'hidden'});

    slow=true;
    await page.getByRole('combobox',{name:/^Region/}).selectOption('All regions');
    await active.getByRole('button',{name:'TRACEABILITY-OK',exact:true}).waitFor();
    await page.getByRole('combobox',{name:/^Region/}).selectOption('Metro Manila');
    await page.getByRole('combobox',{name:/^Region/}).selectOption('Central Visayas');
    await active.getByRole('button',{name:'LATEST-SCOPE-TRANSFER',exact:true}).waitFor();
    await page.waitForTimeout(800);
    assert.equal(await active.getByRole('button',{name:'TRACEABILITY-OK',exact:true}).count(),0,'Slow old requests must not replace the current scope.');
    many=true;await refresh();
    await active.getByRole('button',{name:'SEARCH-TRANSFER-0',exact:true}).waitFor();
    assert.equal(await active.locator('tbody tr').count(),10);
    await search.fill('second-page requester');
    await active.getByRole('button',{name:'SEARCH-TRANSFER-11',exact:true}).waitFor();
    assert.equal(await active.locator('tbody tr').count(),1,'Requester search must run before pagination.');
    await search.fill('');
    many=false;missingName=true;await refresh();
    await active.locator('tbody').getByText('Name unavailable',{exact:true}).waitFor();
    await search.fill(seed.transfers[0].recipientId);
    assert.equal(await active.locator('tbody tr').count(),1,'An unavailable account name must not prevent an ID lookup.');
    await search.fill('');
    missingName=false;await refresh();
    await active.locator('tbody').getByText('Metro Textile Review Requester',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);assert.equal(writes,0);
    await page.screenshot({path:`${output}/loaded-${width}.png`});
    await context.close();
    console.log(`Traceability failure recovery passed at ${width}px.`);
  }
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
