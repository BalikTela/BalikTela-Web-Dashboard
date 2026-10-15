import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.INVITATION_UI_URL ?? 'http://127.0.0.1:5173';
const output = process.env.AUTH_BRANDING_OUTPUT ?? '/tmp/baliktela-auth-branding';
const viewports = [
  { width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 1366, height: 768 }, { width: 1440, height: 900 },
  { width: 1920, height: 1080 }, { width: 2560, height: 1440 },
];
const scenarios = ['login', 'registration-unavailable', 'recovery', 'setup', 'password', 'confirmation', 'invalid', 'pending', 'restoring'];
const expectedLogos = [
  'DOST - Department of Science and Technology',
  'PCHRD - Philippine Council for Health Research and Development',
  'NU - National University',
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    for (const scenario of scenarios) {
      const page = await context.newPage();
      const errors = [];
      const imageRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.resourceType() === 'image' && request.url().includes('textile-study')) imageRequests.push(request.url()); });
      let releaseRestore;
      const restoring = new Promise(resolve => { releaseRestore = resolve; });
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/auth/link/resolve') return route.fulfill({ json: { email: 'branding@example.test', intent: scenario === 'confirmation' ? 'confirmation' : 'invite', requiresPassword: scenario !== 'confirmation', setupToken: 'branding-ui-fixture' } });
        if (path === '/api/auth/me' && scenario === 'restoring') await restoring;
        if (path === '/api/auth/me' && scenario === 'pending') return route.fulfill({ json: { user: { id: 'BRANDING-UI', fullName: 'Branding test', role: 'Researcher', accountStatus: 'Pending verification', scope: { aggregateOnly: true } }, access: { permissions: ['profile.read'] }, storage: 'ui-fixture' } });
        return route.fulfill({ status: 401, json: { message: 'No session in this isolated UI test.' } });
      });
      const suffix = scenario === 'registration-unavailable' ? '/?auth=register' : scenario === 'setup' ? '/?auth=setup' : ['password', 'confirmation'].includes(scenario) ? '/?auth=complete&type=invite&token_hash=branding-fixture' : scenario === 'invalid' ? '/?auth=complete' : '/';
      try {
        await page.goto(`${base}${suffix}`);
        if (scenario === 'restoring') await page.getByRole('status').filter({ hasText: 'Restoring secure session' }).waitFor();
        else if (scenario === 'pending') await page.getByRole('heading', { name: 'Account approval is pending' }).waitFor();
        else if (scenario === 'password') await page.getByRole('heading', { name: 'Create your password' }).waitFor();
        else if (scenario === 'confirmation') await page.getByRole('heading', { name: 'Check your email' }).waitFor();
        else if (scenario === 'invalid') await page.getByRole('heading', { name: 'Email link unavailable' }).waitFor();
        else if (scenario === 'setup') await page.getByRole('heading', { name: 'Set up your account' }).waitFor();
        else {
          await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
          if (scenario === 'recovery') await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
        }
        assert.equal(await page.getByRole('button', { name: 'Create participant account', exact: true }).count(), 0, 'Public registration must not be available on the web dashboard.');
        assert.equal(await page.getByLabel('Full name', { exact: true }).count(), 0);
        if (scenario === 'recovery') {
          await page.waitForFunction(() => document.activeElement?.matches('h1.auth-title'));
        }
        if (scenario === 'login') {
          const password = page.getByLabel('Password', { exact: true });
          await page.getByRole('button', { name: 'Show password', exact: true }).click();
          assert.equal(await password.getAttribute('type'), 'text');
          assert.equal(await page.getByRole('button', { name: 'Hide password', exact: true }).getAttribute('aria-pressed'), 'true');
          await page.getByRole('button', { name: 'Hide password', exact: true }).click();
          assert.equal(await password.getAttribute('type'), 'password');
        }
        if (viewport.width >= 1024) {
          const photo = await page.locator('.auth-visual img').evaluate(async image => {
            await image.decode();
            const frame = image.getBoundingClientRect();
            const workspace = document.querySelector('.auth-workspace').getBoundingClientRect();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 16;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0, 16, 16);
            const pixels = context.getImageData(0, 0, 16, 16).data;
            const colors = new Set();
            for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
            return { naturalWidth: image.naturalWidth, width: frame.width, height: frame.height, x: frame.x, workspaceRight: workspace.right, colors: colors.size };
          });
          assert.ok(photo.naturalWidth > 1000 && photo.width > 0 && photo.height > 0, 'The textile photograph must load.');
          assert.ok(photo.x >= photo.workspaceRight - 1, 'The photograph must not overlap the form workspace.');
          assert.ok(photo.colors > 40, 'The photograph must contain actual image content.');
        } else {
          assert.equal(await page.locator('.auth-visual').isVisible(), false);
          assert.deepEqual(imageRequests, [], 'Mobile must not download the desktop photograph.');
        }
        const logos = page.locator('.auth-branding img');
        const mainLogo = page.locator('.auth-workspace-header .auth-primary-logo');
        assert.equal(await mainLogo.getAttribute('alt'), 'BalikTelaPH');
        assert.equal(await page.getByRole('img', { name: 'BalikTelaPH', exact: true }).count(), 1, 'BalikTelaPH must appear only as the main logo.');
        const mainLogoLayout = await mainLogo.evaluate(async image => {
          await image.decode();
          const frame = image.getBoundingClientRect();
          const secure = document.querySelector('.auth-secure-label').getBoundingClientRect();
          return { naturalWidth: image.naturalWidth, width: frame.width, height: frame.height, right: frame.right, secureLeft: secure.left };
        });
        assert.ok(mainLogoLayout.naturalWidth > 0 && mainLogoLayout.width >= 88);
        assert.equal(mainLogoLayout.width, mainLogoLayout.height, 'The main logo must retain its original proportions.');
        assert.ok(mainLogoLayout.right <= mainLogoLayout.secureLeft, 'The main logo must not overlap the secure-access label.');
        assert.deepEqual(await logos.evaluateAll(images => images.map(image => image.alt)), expectedLogos);
        await logos.evaluateAll(images => Promise.all(images.map(image => image.decode())));
        const layout = await page.evaluate(() => {
          const header = document.querySelector('.auth-branding').getBoundingClientRect();
          const frames = [...document.querySelectorAll('.auth-branding-image')].map(element => {
            const frame = element.getBoundingClientRect();
            return { x: frame.x, y: frame.y, width: frame.width, height: frame.height, right: frame.right, bottom: frame.bottom };
          });
          const textOverflow = [...document.querySelectorAll('h1,h2,p,button,label')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible').map(element => element.textContent.slice(0, 80));
          return { viewportWidth: innerWidth, width: document.documentElement.scrollWidth, headerBottom: header.bottom, frames, textOverflow };
        });
        assert.ok(layout.width <= layout.viewportWidth + 1, `${viewport.width} ${scenario}: horizontal overflow`);
        assert.deepEqual(layout.textOverflow, [], `${viewport.width} ${scenario}: overflowing text`);
        for (const frame of layout.frames) {
          assert.ok(frame.width > 0 && frame.height > 0);
          assert.ok(frame.x >= 0 && frame.right <= viewport.width + 1 && frame.y >= 0 && frame.bottom <= layout.headerBottom + 1, `${viewport.width} ${scenario}: logo extends outside header`);
        }
        for (let index = 1; index < layout.frames.length; index++) {
          const before = layout.frames[index - 1], current = layout.frames[index];
          assert.ok(current.y > before.y + before.height / 2 || current.x >= before.right, 'Logos must follow reading order without overlap.');
        }
        assert.deepEqual(errors, []);
        if (scenario === 'login' && viewport.width === 375) {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          assert.ok(await page.locator('.auth-form').evaluate(element => parseFloat(getComputedStyle(element).animationDuration) <= 0.001), 'Reduced motion must disable the entrance animation.');
          await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        if (scenario === 'login' || (['setup', 'pending'].includes(scenario) && [375, 1366, 2560].includes(viewport.width))) await page.screenshot({ path: `${output}/${scenario}-${viewport.width}.png`, fullPage: true });
        checks.push(`${viewport.width}: ${scenario}`);
      } finally {
        releaseRestore();
        await page.unrouteAll({ behavior: 'wait' });
        await page.close();
      }
    }
    await context.close();
  }
  console.log(JSON.stringify({ result: 'passed', checks: checks.length, viewports: viewports.map(viewport => viewport.width), scenarios, screenshots: output, emailsSent: 0 }, null, 2));
} finally { await browser.close(); }
