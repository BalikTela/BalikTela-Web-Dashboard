import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileAppUrl, resolveSiteRoute } from '../src/lib/siteRoutes.js';

test('public homepage stays separate from authenticated routes and normal section anchors', () => {
  for (const path of ['/', '/#about', '/?utm_source=pilot#community']) assert.equal(resolveSiteRoute(`https://example.test${path}`), 'home');
  for (const path of ['/login', '/login/', '/dashboard', '/dashboard/settings', '/auth/callback', '/?auth=register']) assert.equal(resolveSiteRoute(`https://example.test${path}`), 'workspace');
  for (const path of ['/missing', '/login-fake', '/dashboard-old']) assert.equal(resolveSiteRoute(`https://example.test${path}`), 'not-found');
});

test('invitation and password recovery callbacks retain precedence over the public homepage', () => {
  for (const path of ['/?auth=setup', '/?auth=setup&purpose=recovery', '/?auth=complete&type=invite&token_hash=fixture', '/?auth=recovery', '/#access_token=fixture&refresh_token=fixture&type=recovery', '/?resetToken=fixture', '/?error=access_denied', '/?code=fixture']) {
    assert.equal(resolveSiteRoute(`https://example.test${path}`), 'workspace', path);
  }
});

test('mobile download configuration accepts only an explicit HTTPS destination without credentials', () => {
  assert.equal(mobileAppUrl(' https://example.test/mobile?release=pilot '), 'https://example.test/mobile?release=pilot');
  for (const value of ['', undefined, 'javascript:alert(1)', 'http://example.test/app', 'https://name:secret@example.test/app', '/missing-app', 'baliktela://register-callback']) assert.equal(mobileAppUrl(value), null);
});
