import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.env.RESPONSIVE_AUDIT_URL ?? 'http://127.0.0.1:5173';
const email = process.env.RESPONSIVE_AUDIT_EMAIL;
const password = process.env.RESPONSIVE_AUDIT_PASSWORD;
if (!email || !password) throw new Error('Supply RESPONSIVE_AUDIT_EMAIL and RESPONSIVE_AUDIT_PASSWORD privately. Published demo logins have been retired.');
const outputDirectory = process.env.RESPONSIVE_AUDIT_OUTPUT ?? '/tmp/baliktela-responsive';
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'wide', width: 2560, height: 1440 },
];
const pages = [
  { name: 'overview', navigation: 'Overview', heading: 'Overview' },
  { name: 'waste', navigation: 'Waste Analytics', heading: 'Waste Analytics' },
  { name: 'transactions', navigation: 'Traceability', heading: 'Transactions', loadingText: 'Loading traceability records…' },
  { name: 'stakeholders', navigation: 'Stakeholders', heading: 'Stakeholders' },
  { name: 'facilities', navigation: 'Facility Analytics', heading: 'Recycling Facilities' },
  { name: 'geographic', navigation: 'Geographic Insights', heading: 'Geographic Insights' },
  { name: 'advanced', navigation: 'Advanced Analytics', heading: 'Advanced Analytics' },
  { name: 'users', navigation: 'User Accounts', heading: 'User Accounts', loadingText: 'Loading registered accounts…' },
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'networkidle' });
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const loginLayout = await inspectLayout(page);
    results.push({ viewport: viewport.name, page: 'login', passed: loginLayout.documentWidth <= loginLayout.viewportWidth + 1 && loginLayout.overflowingText.length === 0, ...loginLayout });
    if (viewport.name === 'mobile' || viewport.name === 'wide') {
      await page.screenshot({ path: `${outputDirectory}/${viewport.name}-login.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    await page.getByText('Loading sample dashboard data').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.getByText('Program Analytics', { exact: true }).waitFor({ timeout: 30_000 });

    for (const target of pages) {
      if (target.name !== 'overview') {
        const menuButton = page.getByRole('button', { name: 'Open navigation' });
        if (await menuButton.isVisible()) await menuButton.click();
        await page.getByRole('button', { name: target.navigation, exact: true }).click();
        await page.getByRole('heading', { name: target.heading, exact: true }).first().waitFor();
        if (target.loadingText) await page.getByText(target.loadingText, { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 });
        await page.waitForTimeout(250);
      }

      const layout = await inspectLayout(page);
      const passed = layout.documentWidth <= layout.viewportWidth + 1 && layout.overflowingText.length === 0;
      results.push({ viewport: viewport.name, page: target.name, passed, ...layout });

      if (viewport.name === 'mobile' || viewport.name === 'wide') {
        await page.screenshot({ path: `${outputDirectory}/${viewport.name}-${target.name}.png`, fullPage: true });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter((result) => !result.passed);
console.log(JSON.stringify({ baseUrl, checked: results.length, failures, result: failures.length ? 'failed' : 'passed' }, null, 2));
if (failures.length) process.exitCode = 1;

async function inspectLayout(page) {
  return page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowingText: [...document.querySelectorAll('h1,h2,h3,p,button,a,span')]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return element.scrollWidth > element.clientWidth + 2 && style.overflowX === 'visible' && style.whiteSpace !== 'nowrap';
      })
      .slice(0, 8)
      .map((element) => element.textContent?.trim().slice(0, 80)),
  }));
}
