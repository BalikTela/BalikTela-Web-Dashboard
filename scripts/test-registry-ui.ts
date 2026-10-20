import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { ORGANIZATION_TYPES } from '../shared/registry.js';

// Exercise real routes in an isolated MemoryStore, never the shared database.
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address(); assert.ok(address && typeof address !== 'string');
await new Promise<void>(resolve => listener.close(() => resolve()));
const base = `http://127.0.0.1:${address.port}`;
const child = spawn(process.execPath, ['build/server/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', SERVE_WEB: 'true', PORT: String(address.port), CLIENT_ORIGIN: base, JWT_SECRET: randomUUID() + randomUUID(),
    SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', MONGODB_URI: '', AUTH_DEMO_DELIVERY: 'true', DASHBOARD_PREWARM: 'false', AUTH_LOGIN_MAX_ATTEMPTS: '100' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const directory = '/tmp/baliktela-registry-ui';
await mkdir(directory, { recursive: true });
try {
  for (let attempt = 0; ; attempt++) {
    try {
      const health = await fetch(`${base}/api/health`).then(response => response.json());
      assert.equal(health.status, 'ok'); break;
    } catch {
      if (child.exitCode !== null || attempt > 80) throw new Error(`Isolated registry API did not start: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  async function api(path: string, body?: Record<string, unknown>, token?: string, expected = 200, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`); return result;
  }
  const credentials = { email: 'admin@baliktela.demo', password: 'BalikTelaDemo2026!', client: 'api' };
  const token = (await api('/auth/login', credentials)).accessToken;
  assert.equal((await api('/auth/me', undefined, token)).storage, 'memory-demo');
  const organization = { name: 'Isolated registry API test', type: 'Producer', city: 'Manila', region: 'Metro Manila' };
  await api('/organizations', { ...organization, recordLabel: 'Demo' }, token, 400);
  await api('/facilities', { name: 'Invalid parent', organizationId: 'ORG-REC-01' }, token, 400);
  const org = (await api('/organizations', organization, token, 201)).organization;
  assert.equal(org.recordLabel, 'Operational');
  assert.equal(org.type,'Producer/Retailer');
  await api('/organizations',{...organization,type:'Consumer'},token,400);
  await api('/organizations',{...organization,type:'BalikTela Hub'},token,400);
  const hubBody = { name: 'Isolated API Hub', organizationId: org.id, city: 'Manila', region: 'Metro Manila', storageCapacityKg:1000 };
  for (const storageCapacityKg of [null,0,-1,'',undefined]) await api('/facilities', {...hubBody,storageCapacityKg}, token,400);
  await api('/facilities', { ...hubBody, isDemo: true }, token, 400);
  const hub = (await api('/facilities', hubBody, token, 201)).facility;
  assert.equal(hub.isDemo, false); assert.equal(hub.verification, 'Pending review');
  await api('/organizations/ORG-REC-01', { recordLabel: 'Operational' }, token, 400, 'PATCH');
  await api('/facilities/FAC-001', { isDemo: false }, token, 400, 'PATCH');
  await api(`/organizations/${org.id}`, { status: 'Inactive' }, token, 200, 'PATCH');
  await api('/facilities', hubBody, token, 400);
  await api(`/organizations/${org.id}`, { status: 'Pending review' }, token, 200, 'PATCH');
  const researcher = (await api('/auth/login', { ...credentials, email: 'researcher@baliktela.demo' })).accessToken;
  await api('/organizations', organization, researcher, 403);
  await api('/facilities', hubBody, researcher, 403);
  const consumerId='USR-CONS-01';
  const oldConsumerToken=(await api('/auth/login',{...credentials,email:'consumer@baliktela.demo'})).accessToken;
  const promoted=(await api(`/users/${consumerId}`,{role:'BalikTela Hub',organizationId:org.id,reason:'Explicit Hub role test'},token,200,'PATCH')).user;
  assert.equal(promoted.role,'BalikTela Hub');assert.equal(promoted.stakeholder,'Collection personnel');assert.equal(promoted.organizationVerified,false);
  await api('/auth/me',undefined,oldConsumerToken,401);
  const pendingHub=(await api('/hubs',undefined,token)).hubs.find((item:{id:string})=>item.id===consumerId);
  assert.equal(pendingHub.role,'BalikTela Hub');assert.equal(pendingHub.state,'Pending approval');
  const hubToken=(await api('/auth/login',{...credentials,email:'consumer@baliktela.demo'})).accessToken;
  const permissions=(await api('/auth/me',undefined,hubToken)).access.permissions;
  for(const permission of ['listings.create','offers.create','recovery.create'])assert.equal(permissions.includes(permission),false);
  const demoted=(await api(`/users/${consumerId}`,{role:'Consumer',organizationId:null,approve:true,reason:'Restore isolated consumer'},token,200,'PATCH')).user;
  assert.equal(demoted.stakeholder,'Consumer / Beneficiary');
  assert.equal((await api('/hubs',undefined,token)).hubs.some((item:{id:string})=>item.id===consumerId),false);

  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const results = [];
  for (const width of [375, 1366, 2560]) {
    const context: BrowserContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page: Page = await context.newPage(); const errors: string[] = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/login`);
    await page.getByLabel('Email address', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Organizations', exact: true }).click();
    const dialog = () => page.locator('dialog[open]');
    const save = async (path: string, method: string) => {
      const response = page.waitForResponse(item => new URL(item.url()).pathname === `/api${path}` && item.request().method() === method);
      await dialog().getByRole('button', { name: 'Save changes', exact: true }).click();
      const received = await response; assert.ok(received.ok(), await received.text());
      await dialog().waitFor({ state: 'hidden' }); return received.json();
    };
    const cleanOptions = async () => {
      assert.equal(await dialog().getByLabel('Record classification').count(), 0);
      assert.equal(/demo|sample/i.test((await dialog().locator('option').allTextContents()).join(' ')), false);
      assert.equal(await dialog().evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      assert.equal(await dialog().getByLabel('Current intake (t)').count(),0);
      assert.equal(await dialog().getByLabel('Monthly capacity (t)').count(),0);
    };
    const name = `Registry browser ${width}`;
    await page.getByRole('button',{name:'Edit BalikTela Research Team (demo)',exact:true}).click();
    const legacyType=dialog().getByLabel('Organization type',{exact:true});
    assert.equal(await legacyType.inputValue(),'Research institution');
    assert.deepEqual(await legacyType.locator('option').allTextContents(),[...ORGANIZATION_TYPES]);
    await dialog().getByLabel('Change reason').fill('Preserve legacy registry while normalizing type');
    const legacy=(await save('/organizations/ORG-BT-01','PATCH')).organization;
    assert.equal(legacy.type,'Research institution');assert.equal(legacy.recordLabel,'Demo');assert.equal(legacy.id,'ORG-BT-01');
    await page.getByRole('button', { name: 'Organization', exact: true }).click();
    await cleanOptions();
    assert.deepEqual(await dialog().getByLabel('Organization type',{exact:true}).locator('option').allTextContents(),[...ORGANIZATION_TYPES]);
    assert.equal(await dialog().getByLabel('Organization type',{exact:true}).inputValue(),'Producer/Retailer');
    await dialog().getByLabel('Organization type',{exact:true}).selectOption('School');
    await dialog().getByLabel('Organization name', { exact: true }).fill(name);
    await dialog().getByLabel('City', { exact: true }).fill('Manila');
    await dialog().getByLabel('Organization status').selectOption('Active');
    await dialog().getByLabel('Verification', { exact: true }).selectOption('Verified');
    await dialog().getByLabel('Change reason').fill('Isolated browser registration');
    await page.screenshot({ path: `${directory}/organization-${width}.png`, fullPage: true });
    const created = (await save('/organizations', 'POST')).organization;
    assert.equal(created.recordLabel, 'Operational'); assert.equal(created.status, 'Active');assert.equal(created.type,'School');
    await page.getByRole('button', { name: 'Hub', exact: true }).click();
    await cleanOptions();
    assert.equal(await dialog().getByLabel('Organization', { exact: true }).inputValue(), '');
    await dialog().getByLabel('Hub name').fill(`${name} Hub`);
    await dialog().getByLabel('Organization', { exact: true }).selectOption(created.id);
    await dialog().getByLabel('City', { exact: true }).fill('Manila');
    await dialog().getByLabel('Storage capacity (t)').fill('1.5');
    await dialog().getByLabel('Change reason').fill('Isolated Hub registration');
    await page.screenshot({ path: `${directory}/hub-${width}.png`, fullPage: true });
    const registered = (await save('/facilities', 'POST')).facility;
    assert.equal(registered.isDemo, false); assert.equal(registered.storageCapacityKg, 1500);
    assert.equal((await api('/analytics/dashboard',undefined,token)).hubStorage.rows.find((item:{id:string})=>item.id===registered.id).capacityKg,1500);
    assert.equal(registered.verification, 'Pending review');
    await page.getByRole('button', { name: `Edit ${name} Hub`, exact: true }).click();
    await cleanOptions();
    await dialog().getByLabel('Verification', { exact: true }).selectOption('Verified');
    await dialog().getByLabel('Storage capacity (t)').fill('2');
    await dialog().getByLabel('Change reason').fill('Isolated verification check');
    assert.equal((await save(`/facilities/${registered.id}`, 'PATCH')).facility.verification, 'Verified');
    const storage=(await api('/analytics/dashboard',undefined,token)).hubStorage.rows.find((item:{id:string})=>item.id===registered.id);
    assert.equal(storage.capacityKg,2000);assert.equal(storage.capacitySource,'Configured');
    const navigate=async(name:string)=>{
      if(await menu.isVisible())await menu.click();
      await page.getByRole('button',{name,exact:true}).click();
    };
    await api(`/users/${consumerId}`,{role:'Consumer',organizationId:null,approve:true,reason:'Reset isolated consumer for responsive role test'},token,200,'PATCH');
    await navigate('User Accounts');
    await page.getByPlaceholder('Search users',{exact:true}).fill('Ana Dela Cruz');
    const accountRow=()=>page.getByRole('row').filter({has:page.getByText('Ana Dela Cruz',{exact:true})});
    await accountRow().getByRole('button',{name:'Manage access',exact:true}).click();
    const accessEditor=page.getByRole('dialog',{name:'Manage account · Ana Dela Cruz',exact:true});
    await accessEditor.waitFor();
    assert.equal(await accessEditor.getByLabel('Role',{exact:true}).evaluate(element=>Array.from((element as HTMLSelectElement).options).filter(option=>option.value==='BalikTela Hub').length),1);
    await accessEditor.getByLabel('Role',{exact:true}).selectOption('BalikTela Hub');
    await accessEditor.getByLabel('Organization',{exact:true}).selectOption(created.id);
    await accessEditor.getByLabel('Administrative reason').fill('Explicit Hub role browser test');
    await accessEditor.getByRole('button',{name:'Save account',exact:true}).click();
    await accessEditor.waitFor({state:'hidden'});
    await accountRow().getByText('BalikTela Hub',{exact:true}).waitFor();
    await page.screenshot({path:`${directory}/hub-role-${width}.png`,fullPage:true});
    await page.reload();
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    await navigate('User Accounts');
    await page.getByPlaceholder('Search users',{exact:true}).fill('Ana Dela Cruz');
    await accountRow().getByText('BalikTela Hub',{exact:true}).waitFor();
    await accountRow().getByRole('button',{name:'Manage access',exact:true}).click();
    assert.equal(await accessEditor.getByLabel('Role',{exact:true}).inputValue(),'BalikTela Hub');
    assert.equal(await accessEditor.getByLabel('Role',{exact:true}).evaluate(element=>Array.from((element as HTMLSelectElement).options).filter(option=>option.value==='BalikTela Hub').length),1);
    await accessEditor.getByRole('button',{name:'Cancel',exact:true}).click();
    await navigate('Recovery Monitoring');
    await page.getByRole('button',{name:'Hub Management',exact:true}).click();
    await page.getByLabel('Search Hub accounts').fill('Ana Dela Cruz');
    await page.getByRole('row').filter({has:page.getByText('Ana Dela Cruz',{exact:true})}).getByText('Pending approval',{exact:true}).waitFor();
    const readback = await api('/organizations', undefined, token);
    assert.equal(readback.organizations.find((item: { id: string }) => item.id === created.id).recordLabel, 'Operational');
    assert.equal(readback.organizations.find((item: { id: string }) => item.id === created.id).type,'School');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    results.push({ width, organization: 'Operational', hubIsDemo: false, pageErrors: 0 });
    await context.close();
  }
  console.log(JSON.stringify({ results, screenshots: directory, liveDatabaseWrites: 0, apiPermissionAndProvenanceChecks: 'passed' }, null, 2));
} finally {
  await browser?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
}
