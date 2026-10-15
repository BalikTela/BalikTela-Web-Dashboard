import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createChallengeToken, hashSessionToken, securitySubjectHash } from './auth.js';
import type { Store } from './store.js';
import type { SupabaseIdentity } from './supabaseIdentity.js';

export async function createPasswordSetupGrant(store: Store, userId: string, providerSessionId?: string) {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 600_000).toISOString();
  if (providerSessionId) {
    // Claim the provider session before invalidating older grants, so link replay cannot cancel a valid setup.
    await store.createAuthChallenge({ id: `ACH-LINK-${hashSessionToken(providerSessionId)}`, userId, type: 'password_reset', tokenHash: hashSessionToken(`link-proof:${providerSessionId}`), client: 'web', expiresAt: new Date(now.getTime() + 1_800_000).toISOString(), consumedAt: createdAt, createdAt, updatedAt: createdAt });
  }
  const token = createChallengeToken();
  await store.invalidateAuthChallenges(userId, 'password_reset', createdAt);
  await store.createAuthChallenge({ id: `ACH-${randomUUID()}`, userId, type: 'password_reset', tokenHash: hashSessionToken(token), client: 'web', expiresAt, consumedAt: null, createdAt, updatedAt: createdAt });
  return token;
}

interface SetupDependencies {
  store: Store;
  identity: Pick<SupabaseIdentity, 'requestSetupCode' | 'verifySetupCode'>;
  enabled: boolean;
}

export function registerSetupRoutes(app: Express, { store, identity, enabled }: SetupDependencies) {
  const genericMessage = 'If an eligible account exists, a new code has been requested. Use the newest recovery code from your email.';
  const invalidMessage = 'The code is invalid, expired, or already used. Request a new code.';
  async function reserveAttempt(subject: string, limit: number, seconds: number) {
    const subjectHash = securitySubjectHash(subject);
    const id = `ARL-email_verification-${subjectHash}`;
    const existing = await store.findRateLimit(id);
    if (existing?.lockedUntil && Date.parse(existing.lockedUntil) > Date.now()) return false;
    const state = await store.recordRateLimitFailure(id, 'email_verification', subjectHash, new Date().toISOString(), seconds, limit + 1, seconds);
    return state.attempts <= limit;
  }

  app.post('/api/auth/setup/request', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return res.status(400).json({ message: 'Email codes require Supabase Auth. Use your development invitation link.' });
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const ipAllowed = await reserveAttempt(`setup-send-ip:${req.ip}`, 20, 3600);
    const allowed = await reserveAttempt(`setup-send-email:${email}`, 3, 3600);
    if (!email.includes('@') || !ipAllowed || !allowed) return res.status(202).json({ message: genericMessage });
    const user = await store.findOne('users', record => record.email === email);
    if (user?.authUserId && !['Suspended', 'Deactivated'].includes(user.accountStatus)) {
      try {
        await identity.requestSetupCode(email);
        await store.invalidateAuthChallenges(user.id, 'password_reset', new Date().toISOString());
      } catch (error) {
        // Keep the public response generic; operators still need a safe delivery diagnostic.
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : 'unknown';
        console.warn('Supabase setup email request failed.', { code });
      }
    }
    res.status(202).json({ message: genericMessage });
  });

  app.post('/api/auth/setup/verify', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return res.status(400).json({ message: 'Email codes require Supabase Auth. Use your development invitation link.' });
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const code = String(req.body.code ?? '').trim();
    const purpose = req.body.purpose;
    const ipAllowed = await reserveAttempt(`setup-verify-ip:${req.ip}`, 30, 900);
    const allowed = await reserveAttempt(`setup-verify-email:${email}`, 5, 900);
    if (!ipAllowed || !allowed) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ message: 'Too many code attempts. Wait 15 minutes before trying again.' });
    }
    if (!email.includes('@') || !/^\d{6,10}$/.test(code) || !['invite', 'recovery'].includes(purpose)) return res.status(400).json({ message: invalidMessage });
    const user = await store.findOne('users', record => record.email === email);
    if (!user?.authUserId || ['Suspended', 'Deactivated'].includes(user.accountStatus) || (purpose === 'invite' && (user.role === 'Consumer' || user.passwordChangedAt))) return res.status(400).json({ message: invalidMessage });
    try {
      const verified = await identity.verifySetupCode(user.authUserId, email, code, purpose);
      if (verified.authUserId !== user.authUserId || verified.email !== email || !verified.emailConfirmedAt) return res.status(400).json({ message: invalidMessage });
      await store.update('users', user.id, { emailVerifiedAt: verified.emailConfirmedAt });
      const token = await createPasswordSetupGrant(store, user.id);
      return res.json({ email, setupToken: token, intent: user.passwordChangedAt ? 'recovery' : 'invite', expiresInSeconds: 600 });
    } catch (error) {
      if (error instanceof Error && error.name === 'SupabaseAuthError') return res.status(400).json({ message: invalidMessage });
      throw error;
    }
  });
}
