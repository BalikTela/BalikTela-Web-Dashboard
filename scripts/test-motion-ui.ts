import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { accessSummary } from '../server/access-control.js';
import { buildPredictiveReport } from '../server/analytics/predictive.js';

declare global {
  interface Window {
    __motionChecks: { entries: Array<{ target: string; duration: number }>; draws: WeakMap<HTMLCanvasElement, number> };
  }
}

const base = process.env.DASHBOARD_UI_URL ?? 'http://127.0.0.1:5174';
const output = '/tmp/baliktela-motion-ui';
const seed = await createSeedData();
const admin = seed.users[0];
const analytics = await buildDashboardAnalytics(new MemoryStore(seed), admin, {});
const listings = Array.from({ length: 24 }, (_, index) => ({ ...seed.listings[0], id: `MOTION-LIST-${index}`, title: `Motion listing ${index} (demo)` }));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks: string[] = [];
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    for (const reduced of [false, true]) {
      const context = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      let analyticsRequests = 0;
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      await page.addInitScript(() => {
        window.__motionChecks = { entries: [], draws: new WeakMap() };
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const result = animate.apply(this, args);
          window.__motionChecks.entries.push({ target: this.getAttribute('class') ?? '', duration: Number(result.effect?.getTiming().duration) });
          return result;
        };
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          const counts = window.__motionChecks.draws;
          counts.set(this.canvas, (counts.get(this.canvas) ?? 0) + 1);
          return clear.apply(this, args);
        };
      });
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/auth/me') return route.fulfill({ json: { user: admin, access: accessSummary(admin), storage: 'motion-fixture' } });
        if (path === '/api/analytics/dashboard') { analyticsRequests++; return route.fulfill({ json: analytics }); }
        if (path === '/api/barter/listings') return route.fulfill({ json: { listings } });
        if (path === '/api/configuration') return route.fulfill({ json: { configuration: seed.configurations[0] } });
        if (path === '/api/auth/sessions') return route.fulfill({ json: { sessions: [] } });
        if (path === '/api/analytics/predictive') return route.fulfill({ json: buildPredictiveReport({}) });
        return route.fulfill({ status: 404, json: { message: `Unexpected motion fixture request: ${path}` } });
      });
      const workspace = () => page.locator('main .workspace-page[aria-hidden="false"]');
      const navigate = async (name: string) => {
        const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (await toggle.isVisible()) await toggle.click();
        await page.getByRole('button', { name, exact: true }).click();
        const title = name === 'Configuration' ? 'Settings' : name;
        await page.waitForFunction(value => document.querySelector('header h1')?.textContent === value, title);
      };
      await page.goto(new URL('/dashboard', base).href);
      await page.getByText('Program Analytics', { exact: true }).waitFor();
      await workspace().evaluate(element => { (element as HTMLElement).dataset.motionIdentity = 'retained'; });
      await workspace().locator('.circular-flow').scrollIntoViewIfNeeded();
      await page.waitForTimeout(650);
      const entries = await page.evaluate(() => window.__motionChecks.entries);
      if (reduced) assert.equal(entries.length, 0, 'Reduced motion must skip programmatic entrances.');
      else {
        assert.ok(entries.some(entry => entry.target.includes('circular-flow-step')), 'Flow stages must reveal on entry.');
        assert.ok(entries.every(entry => entry.duration <= 540), 'Motion must remain short and finite.');
      }
      const beforeNavigation = analyticsRequests;
      await navigate('Waste Analytics');
      await workspace().getByText('Waste Stream Performance', { exact: true }).waitFor();
      await workspace().locator('canvas').first().waitFor({ state: 'visible' });
      await workspace().locator('canvas').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      const chart = workspace().locator('canvas').first();
      const pixels = await chart.evaluate(element => {
        const canvas = element as HTMLCanvasElement;
        return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.filter((value, index) => index % 4 === 3 && value > 0).length;
      });
      assert.ok(pixels > 1000, 'Charts must end with visible data in both motion modes.');
      if (!reduced) assert.ok(await chart.evaluate(element => (window.__motionChecks.draws.get(element as HTMLCanvasElement) ?? 0) > 5), 'Chart must render intermediate animation frames.');
      const draws = await chart.evaluate(element => window.__motionChecks.draws.get(element as HTMLCanvasElement) ?? 0);
      await page.waitForTimeout(250);
      assert.equal(await chart.evaluate(element => window.__motionChecks.draws.get(element as HTMLCanvasElement) ?? 0), draws, 'Settled charts must stop drawing.');
      await navigate('Overview');
      assert.equal(await workspace().getAttribute('data-motion-identity'), 'retained', 'Page transitions must preserve mounted page state.');
      assert.equal(analyticsRequests, beforeNavigation, 'Navigation must not add analytics requests.');
      await page.getByRole('button', { name: 'More filters', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'More filters', exact: true }).getAttribute('aria-expanded'), 'true');
      await page.getByRole('button', { name: 'More filters', exact: true }).click();
      await navigate('Listing Oversight');
      const pager = workspace().getByRole('navigation', { name: 'Listings pagination' });
      await pager.getByRole('button', { name: 'Next page', exact: true }).click();
      await pager.getByText('Page 2 of 3', { exact: true }).waitFor();
      assert.equal(await pager.getByRole('button', { name: 'Next page', exact: true }).evaluate(element => element === document.activeElement), true, 'Pagination transitions must retain keyboard focus.');
      await navigate('Stakeholders');
      await workspace().getByRole('button', { name: /View stakeholder detail/ }).first().click();
      await page.getByRole('button', { name: 'Close stakeholder detail' }).waitFor();
      await page.waitForTimeout(500);
      const dialog = page.getByRole('dialog');
      assert.ok((await dialog.boundingBox())!.width <= viewport.width, 'Drawer must fit the viewport.');
      await page.getByRole('button', { name: 'Close stakeholder detail' }).click();
      await navigate('Advanced Analytics');
      await workspace().getByRole('button', { name: 'Predictive', exact: true }).click();
      await workspace().getByRole('table', { name: 'Collection weekly projections' }).waitFor();
      await workspace().locator('canvas').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(100);
      const reducedEntries = await page.evaluate(() => window.__motionChecks.entries.length);
      await navigate('Hub Facilities');
      await workspace().locator('.progress-fill').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__motionChecks.entries.length), reducedEntries, 'Runtime reduced-motion changes must prevent further entrances.');
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 1).length), 0, 'No lingering or hidden-page animations after settling.');
      if (!reduced) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForTimeout(600);
        assert.ok(await page.evaluate(count => window.__motionChecks.entries.length > count, reducedEntries), 'Normal motion may be restored without reloading.');
      }
      await page.evaluate(() => {
        scrollTo(0, 0);
        document.querySelectorAll('main .overflow-x-auto').forEach(element => { element.scrollLeft = 0; });
      });
      await page.screenshot({ path: `${output}/facilities-${viewport.width}-${reduced ? 'reduced' : 'normal'}.png`, fullPage: true });
      await navigate('Configuration');
      await workspace().getByText('Platform Taxonomies', { exact: true }).waitFor();
      await workspace().getByRole('button', { name: 'Reset rules', exact: true }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
      await navigate('My Profile');
      await workspace().getByText('Profile and participation data', { exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Animations must not create page overflow.');
      assert.deepEqual(errors, []);
      checks.push(`${viewport.width}: ${reduced ? 'reduced' : 'normal'} motion, chart frames and final pixels, circular flow, cache, filters, pagination focus, drawer, predictive, runtime preference, no idle animation`);
      console.log(`Passed motion: ${viewport.width}px, ${reduced ? 'reduced' : 'normal'}`);
      await context.close();
    }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ result: 'passed', checks, screenshots: output, liveDatabaseWrites: 0 }, null, 2));
