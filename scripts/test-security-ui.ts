import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';
import { installSecurity, securityErrorHandler } from '../server/security.js';
import { serveWebApp } from '../server/webApp.js';

// Serve the built frontend with enforced production headers, never the live database/API.
const app = express();
installSecurity(app, { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://security-ui.invalid' });
serveWebApp(app);
app.use(securityErrorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No security UI test port.');
const base = `http://127.0.0.1:${address.port}`;
try {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/api/**', route => route.fulfill({ status: 401, json: { message: 'Isolated security check.' } }));
    await page.goto(`${base}/login`);
    const blocked = await page.evaluate(async () => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
      const script = document.createElement('script');
      script.textContent = 'window.__baliktelaInlineExecuted = true';
      document.head.append(script);
      await new Promise(resolve => setTimeout(resolve, 50));
      return { executed: Boolean((window as unknown as Record<string, unknown>).__baliktelaInlineExecuted), violations };
    });
    assert.equal(blocked.executed, false, 'Injected inline JavaScript must not execute.');
    assert.ok(blocked.violations.some(item => item.startsWith('script-src')), 'The browser must enforce CSP, not just receive a header.');
  } finally { await browser.close(); }
  for (const file of ['test-home-ui.mjs', 'test-dashboard-ui.ts', 'test-hubs-ui.ts', 'test-reports-ui.ts', 'test-predictive-ui.ts', 'test-motion-ui.ts', 'test-session-invalidation-ui.ts']) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${file}`], {
        stdio: 'inherit', env: { ...process.env, HOME_UI_URL: base, DASHBOARD_UI_URL: base, PREDICTIVE_UI_URL: base },
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${file} failed (${code}).`)));
    });
  }
  console.log('Production security headers: public, dashboard, reports, predictive and motion browser checks passed.');
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
