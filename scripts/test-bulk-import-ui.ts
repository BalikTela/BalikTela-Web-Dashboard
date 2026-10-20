import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { IMPORT_COLUMNS, IMPORT_COMMIT_ROWS } from '../shared/imports.js';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { planImport, commitImport, importCsv } from '../server/imports.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';

// The lost-response scenario and every write run only in disposable memory fixtures.
const app=express();serveWebApp(app);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const output='/tmp/baliktela-bulk-import-ui';await mkdir(output,{recursive:true});
const results:unknown[]=[];
try {
  for(const width of [390,1440]) {
    const seed=await createSeedData(),actor=seed.users[0],store=new MemoryStore(seed),now=new Date('2026-10-19T04:00:00Z');
    const initialBatches=seed.materialBatches.length,initialTransfers=seed.transfers.length;
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
    let lostResponse=true,commits=0;const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname.replace(/^\/api/,''),body=request.method()==='GET'?{}:request.postDataJSON();
      if(path==='/auth/me')return route.fulfill({json:{user:actor,access:accessSummary(actor),storage:'memory-demo'}});
      if(path==='/analytics/dashboard')return route.fulfill({json:await buildDashboardAnalytics(store,actor,Object.fromEntries(url.searchParams),undefined,now)});
      if(path==='/material-batches')return route.fulfill({json:{batches:await store.all('materialBatches')}});
      if(path==='/imports/options')return route.fulfill({json:{producers:[],recipients:[],facilities:[]}});
      if(path==='/imports/preview')return route.fulfill({json:(await planImport(store,actor,importCsv(body),now)).preview});
      if(path==='/imports/commit'){
        commits++;
        const result=await commitImport(store,actor,importCsv(body),body.previewHash,body.reason,now,body.startRow??0);
        assert.ok(result.importedRows<=IMPORT_COMMIT_ROWS);
        if(lostResponse){lostResponse=false;return route.fulfill({status:504,json:{message:'The import response timed out.'}});}
        return route.fulfill({json:result});
      }
      return route.fulfill({status:404,json:{message:'Unused isolated test endpoint'}});
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByText('Program Analytics',{exact:true}).waitFor();
    const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
    await page.getByRole('button',{name:'Material Registry',exact:true}).click();
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Import lifecycle data'});
    const csv=[IMPORT_COLUMNS.join(','),...Array.from({length:500},(_,index)=>
      `bulk-ui-${width}-${index},2026-08-05T01:00:00Z,USR-PROD-01,USR-REC-01,FAC-001,Cotton,100,90,80,Recycling,70`)].join('\n');
    await dialog.getByLabel('Dataset CSV').setInputFiles({name:'500-demo.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await dialog.getByRole('button',{name:'Preview file',exact:true}).click();
    await dialog.getByText(/500 new.*0 already imported/).waitFor();
    for(const [label,value] of [['Total Textiles Declared','50 t'],['Textiles Physically Received','45 t'],['Confirmed reuse','0 t'],['Confirmed recycling','35 t']]){
      const total=dialog.locator('dl > div').filter({has:page.getByText(label,{exact:true})});
      await total.getByText(value,{exact:true}).waitFor();
      assert.equal(await total.locator('dt').evaluate(element=>element.scrollWidth>element.clientWidth+1),false,'Import metric labels must fit.');
    }
    assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false);
    await page.screenshot({path:`${output}/import-preview-${width}.png`,fullPage:true});
    await dialog.getByLabel('Import reason',{exact:true}).fill('Isolated 500-row retry test');await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button',{name:'Import 500 rows'}).click();
    await dialog.getByRole('alert').getByText(/Some rows may already be saved/).waitFor();
    assert.equal((await store.all('materialBatches')).length,initialBatches+25);
    assert.equal(await dialog.getByRole('button',{name:/Import \d+ rows/}).count(),0,'A failed response must invalidate the stale preview.');
    await dialog.getByRole('button',{name:'Preview file',exact:true}).click();
    await dialog.getByText(/475 new.*25 already imported/).waitFor();
    await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Import 475 rows'}).click();
    await dialog.getByRole('status').getByText(/475 imported.*25 already present/).waitFor({timeout:60000});
    assert.equal((await store.all('materialBatches')).length,initialBatches+500);
    assert.equal((await store.all('transfers')).length,initialTransfers+500);
    assert.equal(commits,21,'Retry must skip the saved window and finish the remaining windows.');
    assert.equal(await dialog.getByRole('progressbar',{name:'Import progress'}).getAttribute('value'),'500');
    assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${output}/import-complete-${width}.png`,fullPage:true});
    await dialog.getByRole('button',{name:'Preview file',exact:true}).click();
    await dialog.getByText(/0 new.*500 already imported/).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Import 0 rows'}).isDisabled(),true);
    assert.deepEqual(errors,[]);results.push({width,rows:500,commitRequests:commits,duplicateRows:0,liveWrites:0});
    await context.close();
  }
  console.log(JSON.stringify({results,screenshots:output}));
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
