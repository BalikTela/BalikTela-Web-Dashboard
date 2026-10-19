import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.HOME_UI_URL ?? 'http://127.0.0.1:5174';
const output = '/tmp/baliktela-homepage';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [];
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1024, height: 600 }, { width: 1280, height: 650 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1512, height: 861 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await context.route('https://baliktelaprogressive.vercel.app/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Isolated mobile app destination fixture</h1>' }));
    const errors = [], api = [], privateModules = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url());
      if (/DashboardApp|GeographicMap|leaflet|chart\.js/.test(request.url())) privateModules.push(request.url());
    });
    await page.route('**/api/**', route => route.fulfill({ status: 401, json: { message: 'Isolated public-page test; no session.' } }));
    await page.goto(base);
    await page.getByRole('heading', { level: 1, name: 'BalikTelaPH', exact: true }).waitFor();
    const universityLink = page.getByRole('link', { name: 'National University (opens in a new tab)', exact: true });
    assert.equal(await universityLink.getAttribute('href'), 'https://www.nu.edu.ph/');
    assert.equal(await universityLink.getAttribute('target'), '_blank');
    assert.equal(await universityLink.getAttribute('rel'), 'noopener noreferrer');
    const photo = await page.locator('.home-hero-image').evaluate(async image => {
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 20, 20);
      const pixels = context.getImageData(0, 0, 20, 20).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return { width: image.naturalWidth, colors: colors.size };
    });
    assert.ok(photo.width > 1000 && photo.colors > 100, 'Hero photograph must be loaded and nonblank.');
    if (viewport.width >= 960) {
      const intro = await page.evaluate(() => {
        const hero = document.querySelector('.home-hero').getBoundingClientRect();
        const copy = document.querySelector('.home-hero-copy').getBoundingClientRect();
        const institutions = document.querySelector('.home-institutions').getBoundingClientRect();
        const logos = [...document.querySelectorAll('.home-institution-logos a')].map(element => element.getBoundingClientRect().toJSON());
        return { hero: hero.toJSON(), copy: copy.toJSON(), institutions: institutions.toJSON(), logos, height: innerHeight, width: innerWidth };
      });
      assert.ok(Math.abs(intro.institutions.bottom - intro.height) <= 1, `${viewport.width}x${viewport.height}: the institution strip must align with the viewport bottom, not just fit somewhere above it.`);
      assert.ok(intro.copy.top >= intro.hero.top && intro.copy.bottom <= intro.hero.bottom + 1, 'Hero text and both calls to action must not be clipped.');
      for (const logo of intro.logos) assert.ok(logo.top >= intro.institutions.top && logo.bottom <= intro.height && logo.left >= 0 && logo.right <= intro.width, 'Every institution logo must be fully visible without scrolling.');
    } else {
      const toggle = page.locator('#public-menu-toggle');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Open menu', exact: true }).waitFor();
      await toggle.click();
      await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'How it works', exact: true }).click();
      assert.equal(await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).count(), 0);
    }
    const appLink = page.getByRole('link', { name: /^Open the mobile app/ }).first();
    assert.equal(await appLink.getAttribute('href'), 'https://baliktelaprogressive.vercel.app/');
    assert.equal(await appLink.getAttribute('rel'), 'noopener noreferrer');
    const popupPromise = context.waitForEvent('page');
    await appLink.click();
    const popup = await popupPromise;
    await popup.getByRole('heading', { name: 'Isolated mobile app destination fixture' }).waitFor();
    await popup.close();
    const tabs = page.getByRole('tablist', { name: 'Textile pathways' });
    for (const label of ['Donate & redistribute', 'Recover & recycle', 'Reuse & barter']) {
      await tabs.getByRole('tab', { name: label, exact: true }).click();
      assert.equal(await tabs.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.getByRole('tabpanel').count(), 1);
    }
    await tabs.getByRole('tab', { name: 'Reuse & barter', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.getByRole('tab', { name: 'Donate & redistribute', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    const faq = page.getByRole('button', { name: 'Can anyone create a dashboard account?', exact: true });
    await faq.click();
    assert.equal(await faq.getAttribute('aria-expanded'), 'true');
    await page.getByRole('region', { name: 'Can anyone create a dashboard account?', exact: true }).waitFor();
    for (const id of ['about', 'how-it-works', 'platforms', 'community', 'faqs']) assert.equal(await page.locator(`#${id}`).count(), 1);
    const assets = await page.locator('.home-page img').evaluateAll(images => Promise.all(images.map(async image => { await image.decode(); return image.naturalWidth; })));
    assert.ok(assets.every(width => width > 0), 'All supplied logos and photos must render.');
    const privacyButton = page.getByRole('button', { name: 'Privacy & access', exact: true });
    await privacyButton.click();
    const dialog = page.getByRole('dialog', { name: 'Privacy & platform access' });
    await dialog.waitFor();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))), 'Dialog must contain keyboard focus.');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await privacyButton.evaluate(element => element === document.activeElement), true, 'Dialog close must restore trigger focus.');
    await privacyButton.click();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const layout = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('.home-page h1, .home-page h2, .home-page h3, .home-page p, .home-page button, .home-page a')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible').map(element => element.textContent.slice(0, 90)) }));
    assert.ok(layout.actual <= layout.width + 1, `${viewport.width}: horizontal page overflow`);
    assert.deepEqual(layout.overflow, [], `${viewport.width}: overflowing text`);
    assert.deepEqual(api, [], 'Public homepage must not send authentication or private data requests.');
    assert.deepEqual(privateModules, [], 'Public homepage must not load dashboard, map, or chart modules.');
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('.home-hero-copy').evaluate(element => getComputedStyle(element).animationName), 'none', 'Reduced motion must disable the hero animation.');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/hero-${viewport.width}.png` });
    await page.screenshot({ path: `${output}/homepage-${viewport.width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Explore the web dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in to your workspace', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/login');
    await page.getByRole('link', { name: 'BalikTelaPH home', exact: true }).click();
    await page.getByRole('heading', { name: 'BalikTelaPH', exact: true }).waitFor();
    if (viewport.width === 375) {
      await page.goto(new URL('/missing-public-page', base).href);
      await page.getByRole('heading', { name: 'This thread leads elsewhere.', exact: true }).waitFor();
    }
    checks.push(`${viewport.width}: public isolation, imagery, responsive layout, navigation, mobile app link, privacy dialog, keyboard tabs, FAQs, dashboard sign-in, home return`);
    await context.close();
  }
  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const motionPage = await motionContext.newPage();
  await motionPage.goto(base);
  await motionPage.getByRole('heading', { name: 'BalikTelaPH', exact: true }).waitFor();
  await motionPage.waitForTimeout(650);
  assert.equal(await motionPage.locator('.home-hero-copy').evaluate(element => Number(getComputedStyle(element).opacity)), 1);
  await motionPage.locator('#how-it-works').scrollIntoViewIfNeeded();
  await motionPage.waitForTimeout(650);
  assert.equal(await motionPage.locator('.home-path-layout').evaluate(element => Number(getComputedStyle(element).opacity)), 1, 'Scroll entrance must settle without leaving content hidden.');
  await motionPage.screenshot({ path: `${output}/pathways-motion-1440.png` });
  for (const viewport of [{ width: 960, height: 600 }, { width: 1366, height: 768 }, { width: 1512, height: 861 }, { width: 1512, height: 650 }, { width: 1920, height: 800 }, { width: 2560, height: 1440 }, { width: 2560, height: 1310 }, { width: 1512, height: 828 }]) {
    await motionPage.setViewportSize(viewport);
    await motionPage.evaluate(() => scrollTo(0, 0));
    const resized = await motionPage.evaluate(() => {
      const hero = document.querySelector('.home-hero').getBoundingClientRect();
      const copy = document.querySelector('.home-hero-copy').getBoundingClientRect();
      const logos = document.querySelector('.home-institutions').getBoundingClientRect();
      return Math.abs(logos.bottom - innerHeight) <= 1 && copy.top >= hero.top && copy.bottom <= hero.bottom + 1;
    });
    assert.ok(resized, `${viewport.width}x${viewport.height}: resizing must keep the hero copy and complete logo strip visible.`);
  }
  await motionContext.close();
  console.log(JSON.stringify({ result: 'passed', checks, resize: 'Eight desktop resize cases keep the logo strip aligned with the viewport bottom and the hero copy visible', motion: 'Normal and reduced-motion presentation verified', screenshots: output, liveDatabaseWrites: 0, emailsSent: 0 }, null, 2));
} finally { await browser.close(); }
