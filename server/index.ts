import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  accessSummary, authorize, isWithinOperationalScope, scopeAnalyticalBatches, scopeBatches, scopeFacilities,
  scopeOrganizations, scopeRecoveryRecords, scopeTransfers, type Permission,
} from './access-control.js';
import {
  AUTH_ACCESS_TTL_SECONDS, AUTH_REFRESH_TTL_SECONDS, REFRESH_COOKIE_NAME, createChallengeToken, createCsrfToken, createRefreshToken,
  hashSessionToken, issueToken, passwordPolicyError, publicUser, requireAuth, securitySubjectHash, sessionIdFromRefreshToken, type AuthenticatedRequest,
} from './auth.js';
import { createSeedData } from './seed.js';
import { createStore } from './store.js';
import { calculateOperationalMass, canIssueReward } from './domain.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, type DashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { AsyncTtlCache, dashboardAnalyticsCacheKey } from './asyncCache.js';
import { SupabaseIdentity } from './supabaseIdentity.js';
import { provisionedUserMutation } from './provisioning.js';
import { clientOrigin, isDefaultDemoPassword, validateProductionEnvironment } from './runtimeConfig.js';
import { serveWebApp } from './webApp.js';
import { facilityValues, organizationValues, saveManagement, registerManagementRoutes, ManagementError, number as managementNumber, choice as managementChoice, text as managementText } from './management.js';
import type { RecordMutation } from './database/mutations.js';
import type {
  AuthSessionRecord, CircularPathway, ConfigurationRecord, ConversationRecord, FacilityRecord, LifecycleEventRecord, ListingRecord, MaterialBatchRecord,
  MeasurementRecord, OfferRecord, RecoveryRecord, TransferRecord, UserRecord, UserRole, WeightStatus,
} from './types.js';

validateProductionEnvironment();
const port = Number(process.env.PORT ?? 4000);
const store = await createStore(await createSeedData());
const identity = new SupabaseIdentity();
const usesSupabaseAuth = store.mode === 'supabase' && identity.enabled;
const dummyPasswordHash = await bcrypt.hash('BalikTela-invalid-password-placeholder', 10);
const loginWindowSeconds = positiveEnv('AUTH_LOGIN_WINDOW_SECONDS', 15 * 60);
const loginMaxAttempts = positiveEnv('AUTH_LOGIN_MAX_ATTEMPTS', 5);
const loginLockSeconds = positiveEnv('AUTH_LOGIN_LOCK_SECONDS', 15 * 60);
const challengeRequestWindowSeconds = positiveEnv('AUTH_CHALLENGE_REQUEST_WINDOW_SECONDS', 60 * 60);
const challengeRequestLimit = positiveEnv('AUTH_CHALLENGE_REQUEST_LIMIT', 3);
const dashboardCacheTtlMs = positiveEnv('DASHBOARD_CACHE_TTL_SECONDS', 30) * 1_000;
const dashboardSnapshotTtlMs = positiveEnv('DASHBOARD_SNAPSHOT_TTL_SECONDS', 15) * 1_000;
const demoDelivery = process.env.NODE_ENV !== 'production' || process.env.AUTH_DEMO_DELIVERY === 'true';
const app = express();
const permit = (permission: Permission) => authorize(store, permission);
type DashboardAnalytics = Awaited<ReturnType<typeof buildDashboardAnalytics>>;
const dashboardAnalyticsCache = new AsyncTtlCache<DashboardAnalytics>(dashboardCacheTtlMs, 200);
const dashboardSnapshotCache = new AsyncTtlCache<DashboardAnalyticsSnapshot>(dashboardSnapshotTtlMs, 1);
const dashboardMutationPrefixes = ['/api/users', '/api/organizations', '/api/barter', '/api/facilities', '/api/material-batches', '/api/transfers', '/api/recovery-records', '/api/configuration'];

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(cors({ origin: clientOrigin(), credentials: true }));
app.use(express.json({ limit: '1mb' }));
// DELETE retains the record and follows the same authorization and lifecycle rules as PATCH.
app.use((req,_res,next)=>{
  if(req.method==='DELETE') {
    const softDeletes: Array<[RegExp,Record<string,unknown>]>=[
      [/^\/api\/users\/(?!me$)[^/]+$/, {accountStatus:'Deactivated'}],
      [/^\/api\/(organizations|facilities)\/[^/]+$/, {status:'Inactive'}],
      [/^\/api\/material-batches\/[^/]+$/, {action:'archive'}],
      [/^\/api\/barter\/listings\/[^/]+$/, {status:'Closed'}],
      [/^\/api\/barter\/offers\/[^/]+$/, {status:'Declined'}],
      [/^\/api\/recovery-records\/[^/]+$/, {action:'reverse'}],
      [/^\/api\/transfers\/[^/]+$/, {action:'cancel'}],
    ];
    const entry=softDeletes.find(([pattern])=>pattern.test(req.path));
    if(entry) {req.body={...(req.body ?? {}),...entry[1],note:req.body?.note ?? req.body?.reason};req.method='PATCH';}
  }
  next();
});
app.use((req, res, next) => {
  const mutatesDashboardData = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    && dashboardMutationPrefixes.some((prefix) => req.path.startsWith(prefix));
  if (mutatesDashboardData) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        dashboardAnalyticsCache.clear();
        dashboardSnapshotCache.clear();
        void warmDashboardSnapshot();
      }
    });
  }
  next();
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', storage: store.mode, timestamp: new Date().toISOString() }));

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  if (isDefaultDemoPassword(password)) return res.status(401).json({ message: 'The public demo password is disabled on deployed dashboards. Use your assigned account password.' });
  const limiter = rateLimitIdentity('login', email);
  const currentLimit = await store.findRateLimit(limiter.id);
  if (currentLimit?.lockedUntil && new Date(currentLimit.lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((new Date(currentLimit.lockedUntil).getTime() - Date.now()) / 1000));
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ message: 'Too many unsuccessful sign-in attempts. Try again later.', retryAfterSeconds: retryAfter });
  }
  let user = await store.findOne('users', (record) => record.email === email);
  const authenticatedIdentity = usesSupabaseAuth ? await identity.signIn(email, password) : null;
  const passwordMatches = usesSupabaseAuth ? Boolean(authenticatedIdentity) : await bcrypt.compare(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !passwordMatches) {
    const failed = await store.recordRateLimitFailure(limiter.id, 'login', limiter.subjectHash, new Date().toISOString(), loginWindowSeconds, loginMaxAttempts, loginLockSeconds);
    if (failed.lockedUntil) {
      res.setHeader('Retry-After', loginLockSeconds);
      return res.status(429).json({ message: 'Too many unsuccessful sign-in attempts. Try again later.', retryAfterSeconds: loginLockSeconds });
    }
    return res.status(401).json({ message: 'Incorrect email or password.', remainingAttempts: Math.max(0, loginMaxAttempts - failed.attempts) });
  }
  if (authenticatedIdentity) {
    if (user.authUserId && user.authUserId !== authenticatedIdentity.authUserId) return res.status(403).json({ message: 'This profile is linked to a different authentication identity.' });
    const emailVerifiedAt = authenticatedIdentity.emailConfirmedAt ?? user.emailVerifiedAt;
    const accountStatus = user.role === 'Consumer' && user.accountStatus==='Pending verification' && emailVerifiedAt ? 'Active' as const : user.accountStatus;
    user = await store.update('users', user.id, { authUserId: authenticatedIdentity.authUserId, passwordHash: null, emailVerifiedAt, accountStatus }) ?? user;
  }
  await store.clearRateLimit(limiter.id);
  if (['Suspended','Deactivated'].includes(user.accountStatus)) return res.status(403).json({ message: 'This account is suspended or deactivated. Contact a BalikTela administrator.' });
  const authentication = await startSession(user, req.body.client);
  const { session } = authentication;
  if (session.client === 'web') setRefreshCookie(res, authentication.refreshToken, session.expiresAt);
  await audit(user.id, 'auth.login', 'Session', session.id, `${session.client} session created.`);
  res.json(authenticationPayload(user, authentication));
});

app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  const passwordError = passwordPolicyError(password);
  if (!email.includes('@') || !String(req.body.fullName ?? '').trim()) return res.status(400).json({ message: 'Name and a valid email are required.' });
  if (passwordError) return res.status(400).json({ message: passwordError });
  if (req.body.consent !== true) return res.status(400).json({ message: 'Data Privacy Act consent is required for registration.' });
  if (await store.findOne('users', (record) => record.email === email)) return res.status(409).json({ message: 'An account already exists for this email.' });
  const now = new Date().toISOString();
  const userId = id('USR');
  const authIdentity = usesSupabaseAuth ? await identity.registerConsumer(email, password, userId, String(req.body.fullName).trim()) : null;
  const user: UserRecord = {
    id: userId, authUserId: authIdentity?.authUserId ?? null, email, passwordHash: usesSupabaseAuth ? null : await bcrypt.hash(password, 10), fullName: String(req.body.fullName).trim(), role: 'Consumer',
    organizationId: null, organization: 'Individual participant', city: String(req.body.city ?? '').trim(), region: String(req.body.region ?? '').trim(),
    joinedAt: now, consentAt: now, emailVerifiedAt: authIdentity?.emailConfirmedAt ?? null, passwordChangedAt: now, verification: 'Pending demo review', accountStatus: authIdentity?.emailConfirmedAt ? 'Active' : 'Pending verification',
    scope: { organizationIds: [], facilityIds: [], regions: [String(req.body.region ?? '').trim()].filter(Boolean), canExport: false, aggregateOnly: false },
    trustPlaceholder: 50,
    profile: { ageGroup: '', organizationSize: 'Individual', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: [], sustainabilityInterests: [] },
  };
  try {
    const mutation = await provisionedUserMutation(store, user);
    Object.assign(user, mutation.record);
    await saveManagement(store,user,[mutation],'user.registered',user.id,'Participant registration with privacy consent.');
  }
  catch (error) { if (authIdentity) await identity.deleteUser(authIdentity.authUserId).catch(() => undefined); throw error; }
  await audit(user.id, 'consumer.registered', 'User', user.id, 'Consumer self-registration with privacy consent.');
  if (usesSupabaseAuth && !user.emailVerifiedAt) {
    return res.status(201).json({ message: 'Account created. Check your email to confirm ownership before signing in.', requiresEmailVerification: true, user: publicUser(user) });
  }
  const verificationChallenge = await issueAuthChallenge(user, 'email_verification', req.body.client);
  const authentication = await startSession(user, req.body.client);
  const { session } = authentication;
  if (session.client === 'web') setRefreshCookie(res, authentication.refreshToken, session.expiresAt);
  await audit(user.id, 'auth.login', 'Session', session.id, `${session.client} session created after registration.`);
  res.status(201).json({ ...authenticationPayload(user, authentication), demoEmailVerificationToken: demoDelivery ? verificationChallenge.token : undefined });
});

app.post('/api/auth/password/forgot', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const genericMessage = 'If an eligible account exists, password-reset instructions have been prepared.';
  if (!email.includes('@')) return res.status(202).json({ message: genericMessage });
  const limiter = rateLimitIdentity('password_reset', email);
  const currentLimit = await store.findRateLimit(limiter.id);
  if (currentLimit?.lockedUntil && new Date(currentLimit.lockedUntil).getTime() > Date.now()) return res.status(202).json({ message: genericMessage });
  const requestState = await store.recordRateLimitFailure(limiter.id, 'password_reset', limiter.subjectHash, new Date().toISOString(), challengeRequestWindowSeconds, challengeRequestLimit, challengeRequestWindowSeconds);
  if (requestState.lockedUntil) return res.status(202).json({ message: genericMessage });
  const user = await store.findOne('users', (record) => record.email === email);
  if (!user || ['Suspended','Deactivated'].includes(user.accountStatus)) return res.status(202).json({ message: genericMessage });
  if (usesSupabaseAuth) {
    await identity.requestPasswordReset(email).catch(() => undefined);
    await audit(user.id, 'auth.password.reset.requested', 'User', user.id, 'Supabase password-recovery request accepted; delivery result intentionally undisclosed.');
    return res.status(202).json({ message: genericMessage });
  }
  const challenge = await issueAuthChallenge(user, 'password_reset', req.body.client);
  await audit(user.id, 'auth.password.reset.requested', 'User', user.id, 'Password-reset challenge requested.');
  res.status(202).json({ message: genericMessage, demoResetToken: demoDelivery ? challenge.token : undefined });
});

app.post('/api/auth/link/resolve', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!usesSupabaseAuth) return res.status(400).json({ message: 'Use the complete development invitation link, including its reset token.' });
  const result = await identity.resolveEmailLink({ accessToken: req.body.accessToken, refreshToken: req.body.refreshToken, tokenHash: req.body.tokenHash, type: req.body.type });
  const user = await store.findOne('users', record => record.authUserId === result.authUserId || (!record.authUserId && record.email === result.email));
  if (!user) return res.status(400).json({ message: 'The account profile linked to this invitation no longer exists. Contact an administrator.' });
  if (['Suspended','Deactivated'].includes(user.accountStatus)) return res.status(403).json({ message: 'This account is not available. Contact an administrator.' });
  if (!result.emailConfirmedAt) return res.status(400).json({ message: 'Email confirmation is required. Open the confirmation link from your email.' });
  await store.update('users', user.id, { authUserId: result.authUserId, emailVerifiedAt: result.emailConfirmedAt });
  const intent = req.body.type === 'recovery' ? 'recovery' : req.body.type === 'invite' || !user.passwordChangedAt ? 'invite' : 'confirmation';
  const requiresPassword = intent !== 'confirmation';
  res.json({ email: user.email, intent, requiresPassword, ...(requiresPassword ? { accessToken: result.accessToken, refreshToken: result.refreshToken } : {}) });
});

app.post('/api/auth/password/reset', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const password = String(req.body.password ?? '');
  const passwordError = passwordPolicyError(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  const consumedAt = new Date().toISOString();
  if (usesSupabaseAuth) {
    const link = await identity.resolveEmailLink({ accessToken: req.body.accessToken, refreshToken: req.body.refreshToken });
    const user = await store.findOne('users', (record) => record.authUserId === link.authUserId || (!record.authUserId && record.email === link.email));
    if (!user) return res.status(400).json({ message: 'The account profile linked to this authentication request no longer exists.' });
    if (['Suspended','Deactivated'].includes(user.accountStatus)) return res.status(403).json({ message: 'This account is not available. Contact an administrator.' });
    const result = await identity.setPasswordFromEmailLink(link.accessToken, link.refreshToken, password);
    const accountStatus = user.role === 'Consumer' && user.accountStatus==='Pending verification' ? 'Active' as const : user.accountStatus;
    await store.commit([{ name: 'users', previous: user, record: { ...user, authUserId: result.authUserId, passwordHash: null, passwordChangedAt: consumedAt, emailVerifiedAt: result.emailConfirmedAt ?? consumedAt, accountStatus } }]);
    const revokedSessions = await store.revokeUserSessions(user.id, consumedAt);
    await audit(user.id, 'auth.password.updated.from_link', 'User', user.id, `Password initialized or recovered through Supabase Auth; ${revokedSessions} application session(s) revoked.`);
    return res.json({ email: user.email, message: user.role !== 'Consumer' && user.accountStatus === 'Pending verification' ? 'Password created. Your email is confirmed. An administrator must approve your institutional access before you can use the dashboard.' : 'Password updated. Sign in with your private password.' });
  }
  const token = String(req.body.token ?? '');
  const challenge = await store.consumeAuthChallenge(hashSessionToken(token), 'password_reset', consumedAt);
  if (!challenge) return res.status(400).json({ message: 'This password-reset link is invalid, expired, or already used.' });
  const user = await store.findOne('users', (record) => record.id === challenge.userId);
  if (!user) return res.status(400).json({ message: 'The account linked to this reset request no longer exists.' });
  if (['Suspended','Deactivated'].includes(user.accountStatus)) return res.status(403).json({ message: 'This account is not available. Contact an administrator.' });
  const emailVerifiedAt = user.emailVerifiedAt ?? (user.role !== 'Consumer' && !user.passwordChangedAt ? consumedAt : null);
  const accountStatus = user.role === 'Consumer' && user.accountStatus==='Pending verification' && emailVerifiedAt ? 'Active' as const : user.accountStatus;
  await store.commit([{ name: 'users', previous: user, record: { ...user, passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: consumedAt, emailVerifiedAt, accountStatus } }]);
  const revokedSessions = await store.revokeUserSessions(user.id, consumedAt);
  await audit(user.id, 'auth.password.reset.completed', 'User', user.id, `Password reset completed; ${revokedSessions} active session(s) revoked.`);
  res.json({ email: user.email, message: user.role !== 'Consumer' && user.accountStatus === 'Pending verification' ? 'Password created and email confirmed. Administrator approval is still required.' : 'Password updated. Sign in with your new password.' });
});

app.post('/api/auth/email/verify', async (req, res) => {
  if (usesSupabaseAuth) return res.status(410).json({ message: 'Email confirmation is completed through the secure link sent by Supabase.' });
  const consumedAt = new Date().toISOString();
  const challenge = await store.consumeAuthChallenge(hashSessionToken(String(req.body.token ?? '')), 'email_verification', consumedAt);
  if (!challenge) return res.status(400).json({ message: 'This email-verification link is invalid, expired, or already used.' });
  const user = await store.findOne('users', (record) => record.id === challenge.userId);
  if (!user) return res.status(400).json({ message: 'The account linked to this verification request no longer exists.' });
  const accountStatus = user.role === 'Consumer' && user.accountStatus==='Pending verification' && user.passwordChangedAt ? 'Active' as const : user.accountStatus;
  await store.update('users', user.id, { emailVerifiedAt: consumedAt, accountStatus });
  await audit(user.id, 'auth.email.verified', 'User', user.id, 'Email ownership verified through a single-use challenge.');
  res.json({ message: user.role === 'Consumer' ? 'Email verified. Your participant account is ready.' : 'Email verified. Administrator approval may still be required.' });
});

app.post('/api/auth/email/resend-request', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const genericMessage = 'If an unverified account exists, another confirmation email has been requested.';
  if (!usesSupabaseAuth || !email.includes('@')) return res.status(202).json({ message: genericMessage });
  const user = await store.findOne('users', (record) => record.email === email);
  if (!user || user.emailVerifiedAt || ['Suspended','Deactivated'].includes(user.accountStatus)) return res.status(202).json({ message: genericMessage });
  const limiter = rateLimitIdentity('email_verification', email);
  const requestState = await store.recordRateLimitFailure(limiter.id, 'email_verification', limiter.subjectHash, new Date().toISOString(), challengeRequestWindowSeconds, challengeRequestLimit, challengeRequestWindowSeconds);
  if (!requestState.lockedUntil) {
    await identity.resendVerification(email).catch(() => undefined);
    await audit(user.id, 'auth.email.verification.requested', 'User', user.id, 'Supabase email confirmation request accepted; delivery result intentionally undisclosed.');
  }
  res.status(202).json({ message: genericMessage });
});

app.post('/api/auth/email/resend', requireAuth, permit('profile.read'), async (req: AuthenticatedRequest, res) => {
  const user = req.actor!;
  if (user.emailVerifiedAt) return res.json({ message: 'This email address is already verified.' });
  const limiter = rateLimitIdentity('email_verification', user.email);
  const currentLimit = await store.findRateLimit(limiter.id);
  if (currentLimit?.lockedUntil && new Date(currentLimit.lockedUntil).getTime() > Date.now()) return res.status(429).json({ message: 'Verification was requested recently. Try again later.' });
  const requestState = await store.recordRateLimitFailure(limiter.id, 'email_verification', limiter.subjectHash, new Date().toISOString(), challengeRequestWindowSeconds, challengeRequestLimit, challengeRequestWindowSeconds);
  if (requestState.lockedUntil) return res.status(429).json({ message: 'Verification request limit reached. Try again later.' });
  const challenge = await issueAuthChallenge(user, 'email_verification', req.body.client);
  await audit(user.id, 'auth.email.verification.requested', 'User', user.id, 'Email-verification challenge requested.');
  res.json({ message: 'Email-verification instructions have been prepared.', demoEmailVerificationToken: demoDelivery ? challenge.token : undefined });
});

app.post('/api/auth/password/change', requireAuth, permit('profile.update'), async (req: AuthenticatedRequest, res) => {
  const user = req.actor!;
  const currentPassword = String(req.body.currentPassword ?? '');
  const password = String(req.body.password ?? '');
  const passwordError = passwordPolicyError(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  if (usesSupabaseAuth) {
    if (!user.authUserId) return res.status(409).json({ message: 'This profile has not yet been linked to Supabase Auth.' });
    if (currentPassword === password) return res.status(400).json({ message: 'Choose a password that is different from the current password.' });
    const changed = await identity.changePassword(user.email, currentPassword, password);
    if (!changed || changed.authUserId !== user.authUserId) return res.status(400).json({ message: 'Current password is incorrect.' });
  } else {
    if (!(await bcrypt.compare(currentPassword, user.passwordHash ?? dummyPasswordHash))) return res.status(400).json({ message: 'Current password is incorrect.' });
    if (user.passwordHash && await bcrypt.compare(password, user.passwordHash)) return res.status(400).json({ message: 'Choose a password that is different from the current password.' });
  }
  const changedAt = new Date().toISOString();
  const accountStatus = user.role === 'Consumer' && user.accountStatus==='Pending verification' && user.emailVerifiedAt ? 'Active' as const : user.accountStatus;
  await store.update('users', user.id, { passwordHash: usesSupabaseAuth ? null : await bcrypt.hash(password, 10), passwordChangedAt: changedAt, accountStatus });
  const revokedSessions = await store.revokeUserSessions(user.id, changedAt);
  clearRefreshCookie(res);
  await audit(user.id, 'auth.password.changed', 'User', user.id, `Password changed; ${revokedSessions} active session(s) revoked.`);
  res.json({ message: 'Password changed. Sign in again on each device.' });
});

app.post('/api/auth/refresh', async (req, res) => {
  const bodyToken = String(req.body.refreshToken ?? '');
  const refreshToken = bodyToken || cookieValue(req.headers.cookie, REFRESH_COOKIE_NAME);
  const sessionId = sessionIdFromRefreshToken(refreshToken);
  if (!sessionId) return res.status(401).json({ message: 'A valid refresh credential is required.' });
  const session = await store.findSession(sessionId);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearRefreshCookie(res);
    return res.status(401).json({ message: 'The refresh session is invalid, revoked, or expired.' });
  }

  const presentedHash = hashSessionToken(refreshToken);
  if (session.usedTokenHashes.includes(presentedHash)) {
    await store.rotateSessionToken(session.id, presentedHash, '', '', new Date().toISOString());
    clearRefreshCookie(res);
    await audit(session.userId, 'auth.refresh.replay', 'Session', session.id, 'A previously used refresh token was replayed; the session was revoked.');
    return res.status(401).json({ message: 'Refresh-token replay detected. Sign in again.' });
  }
  if (!bodyToken && hashSessionToken(String(req.headers['x-csrf-token'] ?? '')) !== session.csrfHash) {
    return res.status(403).json({ message: 'Refresh request failed CSRF validation.' });
  }

  const user = await store.findOne('users', (record) => record.id === session.userId);
  if (!user || ['Suspended','Deactivated'].includes(user.accountStatus)) {
    await store.revokeSession(session.id, session.userId, new Date().toISOString());
    clearRefreshCookie(res);
    return res.status(403).json({ message: 'The account linked to this session is unavailable.' });
  }

  const nextRefreshToken = createRefreshToken(session.id);
  const nextCsrfToken = createCsrfToken();
  const rotated = await store.rotateSessionToken(session.id, presentedHash, hashSessionToken(nextRefreshToken), hashSessionToken(nextCsrfToken), new Date().toISOString());
  if (rotated !== 'rotated') {
    clearRefreshCookie(res);
    if (rotated === 'replayed') await audit(session.userId, 'auth.refresh.replay', 'Session', session.id, 'Concurrent refresh-token replay detected; the session was revoked.');
    return res.status(401).json({ message: rotated === 'replayed' ? 'Refresh-token replay detected. Sign in again.' : 'The refresh credential is invalid.' });
  }

  const accessToken = issueToken(user.id, user.role, session.id);
  const accessTokenExpiresAt = new Date(Date.now() + AUTH_ACCESS_TTL_SECONDS * 1000).toISOString();
  if (session.client === 'web' && !bodyToken) setRefreshCookie(res, nextRefreshToken, session.expiresAt);
  res.json({
    token: accessToken,
    accessToken,
    accessTokenExpiresAt,
    refreshToken: session.client === 'web' && !bodyToken ? undefined : nextRefreshToken,
    refreshTokenExpiresAt: session.expiresAt,
    csrfToken: session.client === 'web' && !bodyToken ? nextCsrfToken : undefined,
    session: sessionSummary(session, session.id),
  });
});

app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  const revokedAt = new Date().toISOString();
  const revoked = await store.revokeSession(req.auth!.sessionId, req.auth!.userId, revokedAt);
  clearRefreshCookie(res);
  if (revoked) await audit(req.auth!.userId, 'auth.logout', 'Session', req.auth!.sessionId, 'Active session revoked by logout.');
  res.status(204).end();
});

app.get('/api/auth/sessions', requireAuth, permit('profile.read'), async (req: AuthenticatedRequest, res) => {
  const sessions = (await store.listUserSessions(req.auth!.userId))
    .filter((session) => !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now())
    .map((session) => sessionSummary(session, req.auth!.sessionId));
  res.json({ sessions });
});

app.delete('/api/auth/sessions/:id', requireAuth, permit('profile.read'), async (req: AuthenticatedRequest, res) => {
  const revoked = await store.revokeSession(String(req.params.id), req.auth!.userId, new Date().toISOString());
  if (!revoked) return res.status(404).json({ message: 'Active session not found.' });
  if (req.params.id === req.auth!.sessionId) clearRefreshCookie(res);
  await audit(req.auth!.userId, 'auth.session.revoked', 'Session', String(req.params.id), 'Session revoked by its account owner.');
  res.status(204).end();
});

app.post('/api/auth/logout-all', requireAuth, permit('profile.read'), async (req: AuthenticatedRequest, res) => {
  const revokedSessions = await store.revokeUserSessions(req.auth!.userId, new Date().toISOString());
  clearRefreshCookie(res);
  await audit(req.auth!.userId, 'auth.logout.all', 'User', req.auth!.userId, `${revokedSessions} active session(s) revoked by the account owner.`);
  res.json({ revokedSessions });
});

app.get('/api/auth/me', requireAuth, permit('profile.read'), async (req: AuthenticatedRequest, res) => {
  res.json({ user: publicUser(req.actor!), access: accessSummary(req.actor!), storage: store.mode });
});

app.patch('/api/users/me', requireAuth, permit('profile.update'), async (req: AuthenticatedRequest, res) => {
  const current = await currentUser(req, res); if (!current) return;
  const profile = { ...current.profile,
    ageGroup: String(req.body.profile?.ageGroup ?? current.profile.ageGroup), organizationSize: String(req.body.profile?.organizationSize ?? current.profile.organizationSize),
    productionVolumeKg: Math.max(0, Number(req.body.profile?.productionVolumeKg ?? current.profile.productionVolumeKg)), recyclingPractices: String(req.body.profile?.recyclingPractices ?? current.profile.recyclingPractices),
    acceptedTextiles: stringArray(req.body.profile?.acceptedTextiles, current.profile.acceptedTextiles), sustainabilityInterests: stringArray(req.body.profile?.sustainabilityInterests, current.profile.sustainabilityInterests),
  };
  const updated = await store.update('users', current.id, { fullName: String(req.body.fullName ?? current.fullName).trim(), city: String(req.body.city ?? current.city).trim(), region: String(req.body.region ?? current.region).trim(), profile });
  await audit(current.id, 'profile.updated', 'User', current.id, 'Participant profile updated.');
  res.json({ user: publicUser(updated!) });
});

app.get('/api/users', requireAuth, permit('users.read'), async (_req: AuthenticatedRequest, res) => {
  res.json({ users: (await store.all('users')).map(publicUser) });
});

app.patch('/api/users/:id/verification', requireAuth, permit('users.manage'), async (req: AuthenticatedRequest, res) => {
  const verification = String(req.body.verification);
  if (!['Demo verified', 'Pending demo review'].includes(verification)) return res.status(400).json({ message: 'Select a valid verification state.' });
  const target = await store.findOne('users', (item) => item.id === req.params.id);
  if (!target) return res.status(404).json({ message: 'User account not found.' });
  if (verification==='Pending demo review' && target.role==='Administrator') {
    if(target.id===req.auth!.userId || (await store.all('users')).filter(item=>item.role==='Administrator'&&item.accountStatus==='Active').length<=1) throw new ManagementError('An active administrator must remain. Use another administrator to change this account.',409);
  }
  if (verification === 'Demo verified' && (!target.emailVerifiedAt || !target.passwordChangedAt)) {
    return res.status(409).json({ message: 'Email verification and replacement of the temporary password are required before administrator approval.' });
  }
  const updated = await store.update('users', String(req.params.id), { verification: verification as UserRecord['verification'], accountStatus: verification === 'Demo verified' ? 'Active' : 'Pending verification' });
  if (!updated) return res.status(500).json({ message: 'The user account could not be updated.' });
  const accessChanged = target.verification !== verification || target.accountStatus !== updated.accountStatus;
  const revokedSessions = accessChanged ? await store.revokeUserSessions(updated.id, new Date().toISOString()) : 0;
  if (usesSupabaseAuth && updated.authUserId) await identity.setSuspended(updated.authUserId, false);
  await audit(req.auth!.userId, 'user.verification.updated', 'User', updated.id, `Verification set to ${verification}.`);
  res.json({ user: publicUser(updated), revokedSessions });
});

app.post('/api/users', requireAuth, permit('users.manage'), async (req: AuthenticatedRequest, res) => {
  const role = String(req.body.role ?? '') as UserRole;
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const organizationId = String(req.body.organizationId ?? '').trim();
  const organization = await store.findOne('organizations', (item) => item.id === organizationId);
  if (!email.includes('@') || !String(req.body.fullName ?? '').trim() || !organization || !(['Administrator', 'Government', 'Researcher', 'Producer', 'Recycler', 'NGO', 'LGU/Collection Point', 'Upcycler'] as UserRole[]).includes(role)) return res.status(400).json({ message: 'A valid institutional role, organization, name, and email are required.' });
  if (await store.findOne('users', (item) => item.email === email)) return res.status(409).json({ message: 'An account already exists for this email.' });
  const now = new Date().toISOString();
  const aggregateOnly = role === 'Government' || role === 'Researcher';
  const userId = id('USR');
  const invitation = usesSupabaseAuth ? await identity.inviteInstitutionalUser(email, userId, role, String(req.body.fullName).trim()) : null;
  const password = usesSupabaseAuth ? null : String(req.body.temporaryPassword ?? 'BalikTelaDemo2026!');
  if (password) { const passwordError = passwordPolicyError(password); if (passwordError) return res.status(400).json({ message: `Temporary password: ${passwordError}` }); }
  const user: UserRecord = { id: userId, authUserId: invitation?.authUserId ?? null, email, passwordHash: password ? await bcrypt.hash(password, 10) : null, fullName: String(req.body.fullName).trim(), role, organizationId: organization.id, organization: organization.name, city: organization.city, region: organization.region, joinedAt: now, consentAt: now, emailVerifiedAt: invitation?.emailConfirmedAt ?? null, passwordChangedAt: null, verification: 'Pending demo review', accountStatus: 'Pending verification', scope: { organizationIds: aggregateOnly ? [] : [organization.id], facilityIds: [], regions: [organization.region], canExport: aggregateOnly, aggregateOnly }, trustPlaceholder: 50, profile: { ageGroup: '', organizationSize: '', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: organization.acceptedMaterials, sustainabilityInterests: [] } };
  try {
    const mutation = await provisionedUserMutation(store, user);
    Object.assign(user, mutation.record);
    await saveManagement(store,req.actor!,[mutation],'user.institutional.invited',user.id,`${role} invitation pending verification.`);
  }
  catch (error) { if (invitation) await identity.deleteUser(invitation.authUserId).catch(() => undefined); throw error; }
  if (usesSupabaseAuth) return res.status(201).json({ user: publicUser(user), message: invitation?.delivery === 'email' ? 'Invitation sent. The recipient must confirm the email and create a password before approval.' : 'Development invitation created. Configure production SMTP before deployment.', demoInvitationLink: demoDelivery ? invitation?.actionLink : undefined });
  const verificationChallenge = await issueAuthChallenge(user, 'email_verification', 'web');
  const invitationChallenge = await issueAuthChallenge(user, 'password_reset', 'web');
  res.status(201).json({ user: publicUser(user), temporaryPassword: password, demoEmailVerificationToken: demoDelivery ? verificationChallenge.token : undefined, demoInvitationLink: demoDelivery ? `${clientOrigin()}/?auth=invite&resetToken=${encodeURIComponent(invitationChallenge.token)}` : undefined });
});

app.patch('/api/users/:id', requireAuth, permit('users.manage'), async (req: AuthenticatedRequest, res) => {
  const target = await store.findOne('users', (item) => item.id === req.params.id); if (!target) return res.status(404).json({ message: 'User account not found.' });
  const role = (req.body.role ?? target.role) as UserRole;
  const roles: UserRole[] = ['Administrator', 'Government', 'Researcher', 'Producer', 'Recycler', 'Consumer', 'NGO', 'LGU/Collection Point', 'Upcycler'];
  if (!roles.includes(role)) return res.status(400).json({ message: 'Select a valid account role.' });
  const organizationId = req.body.organizationId === undefined ? target.organizationId : String(req.body.organizationId || '') || null;
  const organization = organizationId ? await store.findOne('organizations', (item) => item.id === organizationId) : null;
  const aggregateOnly = req.body.aggregateOnly === undefined ? target.scope.aggregateOnly : Boolean(req.body.aggregateOnly);
  const accountStatus = managementChoice(req.body.accountStatus ?? target.accountStatus,['Active','Pending verification','Suspended','Deactivated'],'Account status');
  if (target.id === req.auth!.userId && (role !== target.role || accountStatus !== 'Active')) return res.status(409).json({ message: 'Use another administrator account to change your own role or account status.' });
  if (target.role === 'Administrator' && (role !== 'Administrator' || accountStatus !== 'Active')) {
    const activeAdministrators = (await store.all('users')).filter((item) => item.role === 'Administrator' && item.accountStatus === 'Active');
    if (activeAdministrators.length <= 1) return res.status(409).json({ message: 'At least one active administrator account must remain.' });
  }
  if (accountStatus === 'Active' && (!target.emailVerifiedAt || !target.passwordChangedAt || (target.verification !== 'Demo verified' && req.body.approve !== true))) {
    return res.status(409).json({ message: 'Active access requires verified email, initialized password, and administrator approval.' });
  }
  if (organizationId && !organization) throw new ManagementError('Select a valid organization.');
  const patch: Partial<UserRecord> = { fullName:managementText(req.body.fullName ?? target.fullName,'Full name'), city:managementText(req.body.city ?? target.city,'City',false), region:managementText(req.body.region ?? target.region,'Region',false), role, organizationId, organization: organization?.name ?? 'Individual participant', accountStatus, scope: { organizationIds: organizationId && !aggregateOnly ? [organizationId] : [], facilityIds: stringArray(req.body.facilityIds, target.scope.facilityIds), regions: stringArray(req.body.regions, target.scope.regions), canExport: req.body.canExport === undefined ? target.scope.canExport : Boolean(req.body.canExport), aggregateOnly } };
  if (req.body.approve===true && accountStatus==='Active') patch.verification='Demo verified';
  const updated={...target,...patch};
  await saveManagement(store,req.actor!,[{name:'users',previous:target,record:updated}],'user.access.updated',target.id,String(req.body.reason ?? 'Account information or access updated.'));
  const accessChanged = target.role !== updated!.role || target.organizationId !== updated!.organizationId || target.accountStatus !== updated!.accountStatus || JSON.stringify(target.scope) !== JSON.stringify(updated!.scope);
  const revokedSessions = accessChanged ? await store.revokeUserSessions(target.id, new Date().toISOString()) : 0;
  if (usesSupabaseAuth && target.authUserId && target.accountStatus !== updated!.accountStatus) await identity.setSuspended(target.authUserId, ['Suspended','Deactivated'].includes(updated!.accountStatus));
  res.json({ user: publicUser(updated!), revokedSessions });
});

app.get('/api/organizations', requireAuth, permit('organizations.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const organizations = scopeOrganizations(actor, await store.all('organizations'));
  res.json({ organizations });
});

app.post('/api/organizations', requireAuth, permit('organizations.manage'), async (req: AuthenticatedRequest, res) => {
  const organization = organizationValues(req.body);
  await saveManagement(store,req.actor!,[{name:'organizations',record:organization}],'organization.created',organization.id,'Organization registered.');
  res.status(201).json({ organization });
});

app.patch('/api/organizations/:id', requireAuth, permit('organizations.manage'), async (req: AuthenticatedRequest, res) => {
  const current = await store.findOne('organizations', (item) => item.id === req.params.id); if (!current) return res.status(404).json({ message: 'Organization not found.' });
  const updated = organizationValues(req.body,current);
  if (updated.status === 'Inactive' && current.status !== 'Inactive') {
    const active = (await store.all('transfers')).filter(item=> !['Completed','Cancelled','Rejected'].includes(item.status));
    const batches = await store.all('materialBatches');
    const users = await store.all('users');
    if (active.some(item=>batches.some(batch=>batch.id===item.batchId && batch.sourceOrganizationId===current.id) || users.some(user=>user.organizationId===current.id && [item.providerId,item.recipientId].includes(user.id)))) throw new ManagementError('Resolve active transfers before deactivating this organization.',409);
  }
  const changes: RecordMutation[] = [{name:'organizations',previous:current,record:updated}];
  if (current.name !== updated.name) for (const user of (await store.all('users')).filter(item=>item.organizationId===current.id)) changes.push({name:'users',previous:user,record:{...user,organization:updated.name}});
  await saveManagement(store,req.actor!,changes,'organization.updated',current.id,String(req.body.reason ?? 'Organization information updated.'));
  res.json({ organization: updated });
});

app.get('/api/barter/listings', requireAuth, permit('listings.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const query = String(req.query.q ?? '').toLowerCase();
  const textileType = String(req.query.textileType ?? 'All textiles');
  let listings = (await store.all('listings'))
    .filter((item) => !query || [item.title, item.description, item.ownerName, item.city, item.region, item.batchId].join(' ').toLowerCase().includes(query))
    .filter((item) => textileType === 'All textiles' || item.textileType === textileType)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (actor.scope.aggregateOnly) listings = [];
  res.json({ listings });
});

app.post('/api/barter/listings', requireAuth, permit('listings.create'), async (req: AuthenticatedRequest, res) => {
  const user = await currentUser(req, res); if (!user) return;
  if (!canParticipate(user)) return res.status(403).json({ message: 'This institutional account must be verified before creating material records.' });
  const quantityKg = managementNumber(req.body.quantityKg,'Quantity',0.001);
  if (!String(req.body.title ?? '').trim() || !String(req.body.textileType ?? '').trim() || quantityKg <= 0) return res.status(400).json({ message: 'Title, material category, and a positive kilogram value are required.' });
  const createdAt = new Date().toISOString();
  const batchId = id('MB');
  const weightStatus = validWeightStatus(req.body.weightStatus);
  const batch: MaterialBatchRecord = {
    id: batchId, sourceUserId: user.id, sourceOrganizationId: user.organizationId, materialCategory: String(req.body.textileType),
    wasteSource: validWasteSource(req.body.wasteSource), wasteForm: validWasteForm(req.body.wasteForm), condition: validCondition(req.body.quality),
    circularPathway: validPathway(req.body.circularPathway), declaredWeightKg: quantityKg, currentWeightKg: quantityKg, weightStatus,
    secondaryQuantity: positiveOrNull(req.body.secondaryQuantity), secondaryUnit: String(req.body.secondaryUnit ?? '').trim() || null,
    city: String(req.body.city ?? user.city).trim(), region: String(req.body.region ?? user.region).trim(), currentStatus: 'Listed', currentCustodianId: user.id,
    createdAt, updatedAt: createdAt, isDemo: store.mode === 'memory-demo' || (user.role === 'Administrator' && req.body.isDemo === true),
  };
  const listing: ListingRecord = {
    id: id('LST'), batchId, ownerId: user.id, ownerOrganizationId: user.organizationId, ownerName: user.organization || user.fullName,
    title: String(req.body.title).trim(), description: String(req.body.description ?? '').trim(), textileType: batch.materialCategory,
    wasteSource: batch.wasteSource, wasteForm: batch.wasteForm, circularPathway: batch.circularPathway, quantityKg,
    weightStatus, quality: batch.condition, exchangeFor: String(req.body.exchangeFor ?? 'Open to circular exchange proposals').trim(),
    rewardCredits: Math.max(0, Number(req.body.rewardCredits ?? Math.round(quantityKg * 2))), city: batch.city, region: batch.region,
    status: 'Open', createdAt, isDemo: batch.isDemo,
  };
  const measurement: MeasurementRecord = { id: id('MSR'), batchId, transferId: null, stage: 'Declaration', weightKg: quantityKg, status: weightStatus, method: String(req.body.measurementMethod ?? (weightStatus === 'Estimated' ? 'Participant estimate' : 'Recorded scale')).trim(), recordedBy: user.id, verifiedBy: weightStatus === 'Verified' ? user.id : null, timestamp: createdAt, note: 'Initial material declaration.' };
  await saveManagement(store,user,[{name:'materialBatches',record:batch},{name:'measurements',record:measurement},{name:'listings',record:listing}],'material.listed',batch.id,`${quantityKg} kg material listed.`);
  res.status(201).json({ listing, batch, measurement });
});

app.get('/api/material-batches', requireAuth, permit('batches.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const batches = scopeBatches(actor, await store.all('materialBatches')).filter((batch) => matchesOperationalQuery(batch, req.query));
  const measurements = await store.all('measurements');
  res.json({ batches: batches.map((batch) => ({ ...batch, measurements: measurements.filter((measurement) => measurement.batchId === batch.id) })) });
});

app.get('/api/facilities', requireAuth, permit('facilities.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  let facilities = scopeFacilities(actor, await store.all('facilities'));
  const region = String(req.query.region ?? 'All regions'); const material = String(req.query.materialCategory ?? 'All textiles');
  facilities = facilities.filter((item) => (region === 'All regions' || item.region === region) && (material === 'All textiles' || item.acceptedMaterials.includes(material)));
  res.json({ facilities });
});

app.post('/api/facilities', requireAuth, permit('facilities.manage'), async (req: AuthenticatedRequest, res) => {
  const actor = req.actor!;
  const organization = await store.findOne('organizations', (item) => item.id === String(req.body.organizationId));
  if (!organization || !String(req.body.name ?? '').trim()) return res.status(400).json({ message: 'A valid organization and facility name are required.' });
  if (!isWithinOperationalScope(actor, { organizationIds: [organization.id] })) return res.status(403).json({ message: 'The selected organization is outside your assigned scope.' });
  if (organization.status === 'Inactive') throw new ManagementError('Select an active organization.');
  const facility = facilityValues({...req.body,city:req.body.city ?? organization.city,region:req.body.region ?? organization.region});
  if (actor.role !== 'Administrator') { facility.verification='Pending demo review'; facility.status='Pilot onboarding'; }
  await saveManagement(store,actor,[{name:'facilities',record:facility}],'facility.created',facility.id,'Facility registered.'); res.status(201).json({ facility });
});

app.patch('/api/facilities/:id', requireAuth, permit('facilities.manage'), async (req: AuthenticatedRequest, res) => {
  const actor = req.actor!;
  const current = await store.findOne('facilities', (item) => item.id === req.params.id); if (!current) return res.status(404).json({ message: 'Facility not found.' });
  if (!isWithinOperationalScope(actor, { organizationIds: [current.organizationId], facilityIds: [current.id] })) return res.status(403).json({ message: 'This facility is outside your assigned scope.' });
  const updated = facilityValues(req.body,current);
  const organization = await store.findById('organizations',updated.organizationId);
  if (!organization || !isWithinOperationalScope(actor,{organizationIds:[updated.organizationId]})) throw new ManagementError('Select an organization in your assigned scope.',403);
  if (actor.role !== 'Administrator') updated.verification=current.verification;
  if (updated.organizationId !== current.organizationId && (await store.all('recoveryRecords')).some(item=>item.facilityId===current.id)) throw new ManagementError('A facility with recovery history cannot change organizations.',409);
  await saveManagement(store,actor,[{name:'facilities',previous:current,record:updated}],'facility.updated',current.id,String(req.body.reason ?? 'Facility information updated.'));
  res.json({facility:updated});
});

app.get('/api/barter/listings/:id/matches', requireAuth, permit('listings.match'), async (req, res) => {
  const source = await store.findOne('listings', (item) => item.id === req.params.id);
  if (!source) return res.status(404).json({ message: 'Listing not found.' });
  const weights = (await store.findOne('configurations', (item) => item.id === 'platform'))?.matchingWeights ?? { category: 30, pathway: 15, region: 15, condition: 10, quantity: 10 };
  const matches = (await store.all('listings')).filter((item) => item.id !== source.id && item.ownerId !== source.ownerId && item.status === 'Open')
    .map((item) => ({ listing: item, score: matchScore(source, item, weights), reasons: matchReasons(source, item) })).filter((item) => item.score >= 35).sort((a, b) => b.score - a.score);
  res.json({ source, matches, method: `Configurable demo rules: category ${weights.category}, pathway ${weights.pathway}, region ${weights.region}, condition ${weights.condition}, quantity ${weights.quantity}. Recommendation only.` });
});

app.get('/api/barter/offers', requireAuth, permit('offers.read'), async (req: AuthenticatedRequest, res) => {
  const actor = req.actor!;
  const offers = (await store.all('offers')).filter((item) => actor.role === 'Administrator' || item.recipientId === actor.id || item.providerId === actor.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ offers });
});

app.post('/api/barter/listings/:id/offers', requireAuth, permit('offers.create'), async (req: AuthenticatedRequest, res) => {
  const user = await currentUser(req, res); if (!user) return;
  if (!canParticipate(user)) return res.status(403).json({ message: 'This institutional account must be verified before making an exchange proposal.' });
  const listing = await store.findOne('listings', (item) => item.id === req.params.id);
  if (!listing || !['Open', 'Matched'].includes(listing.status)) return res.status(404).json({ message: 'This listing is not available.' });
  if (listing.ownerId === user.id) return res.status(400).json({ message: 'You cannot make a proposal on your own listing.' });
  const quantityKg = managementNumber(req.body.quantityKg,'Quantity',0.001);
  if (quantityKg <= 0 || quantityKg > listing.quantityKg || !String(req.body.terms ?? '').trim()) return res.status(400).json({ message: 'Enter valid terms and a quantity within the available amount.' });
  const createdAt = new Date().toISOString();
  const offer: OfferRecord = { id: id('OFR'), listingId: listing.id, listingTitle: listing.title, recipientId: user.id, recipientName: user.organization || user.fullName, providerId: listing.ownerId, quantityKg, terms: String(req.body.terms).trim(), offeredCredits: Math.max(0, Number(req.body.offeredCredits ?? listing.rewardCredits)), status: 'Pending', createdAt, updatedAt: createdAt };
  offer.offeredCredits=managementNumber(req.body.offeredCredits ?? listing.rewardCredits,'Offered credits');
  const operations: RecordMutation[]=[{name:'offers',record:offer},{name:'listings',previous:listing,record:{...listing,status:'Matched'}}];
  const conversation=await store.findOne('conversations',item=>item.listingId===listing.id&&item.participantIds.includes(user.id));
  if(!conversation)operations.push({name:'conversations',record:{id:id('CNV'),listingId:listing.id,listingTitle:listing.title,participantIds:[listing.ownerId,user.id],participantNames:[listing.ownerName,user.organization||user.fullName],updatedAt:createdAt}});
  await saveManagement(store,user,operations,'offer.created',offer.id,`${quantityKg} kg exchange proposal created.`);
  res.status(201).json({ offer });
});

app.patch('/api/barter/offers/:id', requireAuth, permit('offers.manage'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const offer = await store.findOne('offers', (item) => item.id === req.params.id);
  if (!offer) return res.status(404).json({ message: 'Offer not found.' });
  if (req.body.action==='edit') {
    if (actor.role!=='Administrator' && actor.id!==offer.recipientId) throw new ManagementError('You cannot edit this proposal.',403);
    if (offer.status!=='Pending') throw new ManagementError('Only pending proposals can be edited.',409);
    const listing=await store.findById('listings',offer.listingId);
    if (!listing || !['Open','Matched'].includes(listing.status)) throw new ManagementError('The linked listing is not available.',409);
    const quantityKg=managementNumber(req.body.quantityKg ?? offer.quantityKg,'Requested weight',0.001);
    if(quantityKg>listing.quantityKg) throw new ManagementError('Requested weight exceeds available material.');
    const updated={...offer,quantityKg,terms:managementText(req.body.terms ?? offer.terms,'Terms'),offeredCredits:managementNumber(req.body.offeredCredits ?? offer.offeredCredits,'Credits'),updatedAt:new Date().toISOString()};
    await saveManagement(store,actor,[{name:'offers',previous:offer,record:updated}],'offer.corrected',offer.id,managementText(req.body.reason,'Reason'));
    return res.json({offer:updated});
  }
  const status = String(req.body.status);
  const providerDecision = offer.providerId === actor.id || actor.role === 'Administrator';
  const recipientWithdrawal = offer.recipientId === actor.id && status === 'Withdrawn';
  if ((!providerDecision && !recipientWithdrawal) || !['Accepted', 'Declined', 'Withdrawn'].includes(status) || offer.status !== 'Pending') return res.status(403).json({ message: 'This proposal cannot be updated by this account.' });
  const updatedAt = new Date().toISOString();
  const updated = {...offer,status:status as OfferRecord['status'],updatedAt};
  const changes: RecordMutation[] = [{name:'offers',previous:offer,record:updated}];
  if (status === 'Accepted') {
    const listing = await store.findOne('listings', (item) => item.id === offer.listingId);
    if (!listing) return res.status(404).json({ message: 'The listing linked to this proposal no longer exists.' });
    const batch = await store.findById('materialBatches',listing.batchId);
    if (!batch || batch.currentStatus === 'Archived' || !['Open','Matched'].includes(listing.status) || offer.quantityKg > listing.quantityKg) throw new ManagementError('This listing is no longer available for this offer.',409);
    changes.push({name:'listings',previous:listing,record:{...listing,status:'Reserved'}});
    changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:'Reserved',updatedAt}});
    const rewardRate = (await store.findOne('configurations', (item) => item.id === 'platform'))?.rewardCreditsPerVerifiedKg ?? 0;
    const event = lifecycleEvent('Offer accepted', actor, listing.city, 'Transfer reserved. Handover, receipt, and validation are still required.', null);
    const transfer: TransferRecord = { id: id('TRF'), listingId: listing.id, batchId: listing.batchId, offerId: offer.id, providerId: offer.providerId, recipientId: offer.recipientId, materialCategory: listing.textileType, agreedWeightKg: offer.quantityKg, handoverWeightKg: null, receiptWeightKg: null, verifiedWeightKg: null, status: 'Reserved', discrepancyKg: null, discrepancyReason: '', circularOutcome: null, agreedTerms: offer.terms, pendingRewardCredits: Math.round(offer.quantityKg * rewardRate), rewardIssuedAt: null, events: [event], createdAt: updatedAt, updatedAt, isDemo: store.mode === 'memory-demo' };
    changes.push({name:'transfers',record:transfer});
    for (const other of (await store.all('offers')).filter(item=>item.listingId===listing.id && item.id!==offer.id && item.status==='Pending')) changes.push({name:'offers',previous:other,record:{...other,status:'Declined',updatedAt}});
  }
  await saveManagement(store,actor,changes,'offer.decided',offer.id,String(req.body.reason ?? status));
  res.json({ offer: updated });
});

app.get('/api/transfers', requireAuth, permit('transfers.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const transfers = scopeTransfers(actor, await store.all('transfers'));
  res.json({ transfers: transfers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
});

app.patch('/api/transfers/:id', requireAuth, permit('transfers.manage'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const transfer = await store.findOne('transfers', (item) => item.id === req.params.id);
  if (!transfer) return res.status(404).json({ message: 'Transfer not found.' });
  if (!isWithinOperationalScope(actor, { userIds: [transfer.providerId, transfer.recipientId] })) return res.status(403).json({ message: 'This transfer is outside your assigned scope.' });
  const isAdmin = actor.role === 'Administrator';
  const isProvider = transfer.providerId === actor.id;
  const isRecipient = transfer.recipientId === actor.id;
  const action = String(req.body.action ?? '');
  const at = new Date().toISOString();
  if (['Completed','Cancelled','Rejected'].includes(transfer.status)) throw new ManagementError('This transfer is final. Its lifecycle history cannot be changed.',409);
  const batch = await store.findById('materialBatches',transfer.batchId);
  const listing = await store.findById('listings',transfer.listingId);
  if (!batch || !listing) throw new ManagementError('The transfer is missing its linked batch or listing.',409);
  const changes: RecordMutation[] = [];
  let patch: Partial<TransferRecord> = { updatedAt: at };
  let event: LifecycleEventRecord;
  let measurement: MeasurementRecord | null = null;

  if (action === 'handover' && transfer.status === 'Reserved' && (isProvider || isAdmin)) {
    const weightKg = validWeight(req.body.weightKg, res); if (weightKg === null) return;
    measurement = makeMeasurement(transfer, actor, 'Handover', weightKg, 'Measured', req.body.method, req.body.note);
    event = lifecycleEvent('Handover', actor, String(req.body.location ?? actor.city), `${weightKg} kg handed over.`, measurement.id);
    patch = { ...patch, status: 'Handed over', handoverWeightKg: weightKg, events: [...transfer.events, event] };
    changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:'In transit',currentWeightKg:weightKg,weightStatus:'Measured',updatedAt:at}});
  } else if (action === 'receipt' && transfer.status === 'Handed over' && (isRecipient || isAdmin)) {
    const weightKg = validWeight(req.body.weightKg, res); if (weightKg === null) return;
    const discrepancyKg = Number((weightKg - (transfer.handoverWeightKg ?? transfer.agreedWeightKg)).toFixed(3));
    const reason = String(req.body.discrepancyReason ?? '').trim();
    if (Math.abs(discrepancyKg) > 0.01 && !reason) return res.status(400).json({ message: 'Document a reason for the receipt weight discrepancy.' });
    measurement = makeMeasurement(transfer, actor, 'Receipt', weightKg, 'Measured', req.body.method, req.body.note);
    event = lifecycleEvent('Receipt', actor, String(req.body.location ?? actor.city), `${weightKg} kg received${discrepancyKg ? `; ${discrepancyKg > 0 ? '+' : ''}${discrepancyKg} kg variance documented` : ''}.`, measurement.id);
    patch = { ...patch, status: 'Received', receiptWeightKg: weightKg, discrepancyKg, discrepancyReason: reason, events: [...transfer.events, event] };
    changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:'Received',currentCustodianId:transfer.recipientId,currentWeightKg:weightKg,weightStatus:'Measured',updatedAt:at}});
  } else if (action === 'validate' && transfer.status === 'Received' && (isRecipient || isAdmin)) {
    const weightKg = validWeight(req.body.weightKg ?? transfer.receiptWeightKg, res); if (weightKg === null) return;
    if (weightKg > (transfer.receiptWeightKg ?? 0)) throw new ManagementError('Verified weight cannot exceed received weight.');
    measurement = makeMeasurement(transfer, actor, 'Validation', weightKg, 'Verified', req.body.method, req.body.note);
    event = lifecycleEvent('Validation', actor, String(req.body.location ?? actor.city), `${weightKg} kg verified.`, measurement.id);
    patch = { ...patch, status: 'Validated', verifiedWeightKg: weightKg, events: [...transfer.events, event] };
    changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:'Validated',currentWeightKg:weightKg,weightStatus:'Verified',updatedAt:at}});
  } else if (action === 'complete' && transfer.status === 'Validated' && (isRecipient || isAdmin)) {
    const outcome = validPathway(req.body.circularOutcome);
    if (outcome === 'For assessment') throw new ManagementError('Completion requires a confirmed circular outcome.');
    const rewardRate = (await store.findOne('configurations', (item) => item.id === 'platform'))?.rewardCreditsPerVerifiedKg ?? 0;
    const rewardCredits = Math.round((transfer.verifiedWeightKg ?? 0) * rewardRate);
    event = lifecycleEvent('Completion', actor, String(req.body.location ?? actor.city), `Validated material assigned to ${outcome.toLowerCase()}.`, null);
    patch = { ...patch, status: 'Completed', circularOutcome: outcome, pendingRewardCredits: rewardCredits, rewardIssuedAt: at, events: [...transfer.events, event] };
    changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:'Recovered',circularPathway:outcome,updatedAt:at}});
    changes.push({name:'listings',previous:listing,record:{...listing,status:'Completed'}});
    if (canIssueReward(transfer.status, 'Completed', transfer.rewardIssuedAt) && rewardCredits > 0) changes.push({name:'walletEntries',record:{ id: id('WLT'), userId: transfer.providerId, transferId: transfer.id, type: 'Earned', credits: rewardCredits, description: `Validated ${outcome.toLowerCase()} transfer completed`, createdAt: at }});
  } else if (action === 'resolve' && transfer.status === 'Disputed' && isAdmin) {
    const reason=managementText(req.body.note,'Resolution reason');
    const status=transfer.verifiedWeightKg!==null?'Validated':transfer.receiptWeightKg!==null?'Received':transfer.handoverWeightKg!==null?'Handed over':'Reserved';
    event=lifecycleEvent('Validation',actor,String(req.body.location ?? actor.city),`Dispute resolved: ${reason}`,null);
    patch={...patch,status,events:[...transfer.events,event]};
    changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:status==='Validated'?'Validated':status==='Received'?'Received':status==='Handed over'?'In transit':'Reserved',updatedAt:at}});
    changes.push({name:'listings',previous:listing,record:{...listing,status:'Reserved'}});
  } else if (['cancel', 'reject', 'dispute'].includes(action) && (isProvider || isRecipient || isAdmin)) {
    const status = action === 'cancel' ? 'Cancelled' : action === 'reject' ? 'Rejected' : 'Disputed';
    const type = action === 'cancel' ? 'Cancellation' : action === 'reject' ? 'Rejection' : 'Dispute';
    event = lifecycleEvent(type, actor, String(req.body.location ?? actor.city), managementText(req.body.note,'Reason'), null, 'Exception');
    patch = { ...patch, status, events: [...transfer.events, event] } as Partial<TransferRecord>;
    if (action !== 'dispute') {
      changes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:'Closed',updatedAt:at}});
      changes.push({name:'listings',previous:listing,record:{...listing,status:'Closed'}});
    }
  } else return res.status(400).json({ message: 'This lifecycle action is not valid for the current transfer state or account.' });

  if (measurement) changes.push({name:'measurements',record:measurement});
  const updated = {...transfer,...patch};
  await saveManagement(store,actor,[{name:'transfers',previous:transfer,record:updated},...changes],`transfer.${action}`,transfer.id,event.note);
  res.json({ transfer: updated });
});

app.get('/api/recovery-records', requireAuth, permit('recovery.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  let records = scopeRecoveryRecords(actor, await store.all('recoveryRecords'));
  const status = String(req.query.transactionStatus ?? 'All statuses'); const facilityId = String(req.query.facilityId ?? 'All facilities');
  records = records.filter((item) => (status === 'All statuses' || item.status === status) && (facilityId === 'All facilities' || item.facilityId === facilityId));
  res.json({ records: records.sort((a, b) => b.timestamp.localeCompare(a.timestamp)) });
});

app.post('/api/recovery-records', requireAuth, permit('recovery.create'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  if (!canParticipate(actor)) return res.status(403).json({ message: 'A verified recovery-partner account is required.' });
  const transfer = await store.findOne('transfers', (item) => item.id === String(req.body.transferId));
  const facility = await store.findOne('facilities', (item) => item.id === String(req.body.facilityId));
  const inputWeightKg = managementNumber(req.body.inputWeightKg,'Input weight',0.001);
  const outputWeightKg = managementNumber(req.body.outputWeightKg,'Output weight');
  const residualWeightKg = managementNumber(req.body.residualWeightKg ?? Number((inputWeightKg-outputWeightKg).toFixed(3)),'Residual weight');
  if (!transfer || !facility || inputWeightKg <= 0) return res.status(400).json({ message: 'Valid transfer, facility, and input weight are required.' });
  if (!isWithinOperationalScope(actor, { organizationIds: [facility.organizationId], facilityIds: [facility.id] })) return res.status(403).json({ message: 'This facility is outside your assigned scope.' });
  if (!isWithinOperationalScope(actor,{userIds:[transfer.providerId,transfer.recipientId]})) throw new ManagementError('This transfer is outside your assigned scope.',403);
  if (facility.status==='Inactive') throw new ManagementError('Select an active facility.');
  if (Math.abs(inputWeightKg-outputWeightKg-residualWeightKg)>0.01) throw new ManagementError('Input must equal output plus residual kilograms.');
  if (outputWeightKg !== null && outputWeightKg > inputWeightKg) return res.status(400).json({ message: 'Output weight cannot exceed input weight.' });
  const record: RecoveryRecord = { id: id('RCV'), transferId: transfer.id, batchId: transfer.batchId, facilityId: facility.id, organizationId: facility.organizationId, stage: ['Collection', 'Sorting', 'Processing', 'Recovery', 'Rejection'].includes(String(req.body.stage)) ? req.body.stage : 'Processing', inputWeightKg, outputWeightKg, residualWeightKg, outcome: req.body.stage === 'Rejection' ? 'Rejected' : req.body.outcome ? validPathway(req.body.outcome) : null, status: req.body.validate === true ? 'Validated' : 'Recorded', recordedBy: actor.id, validatedBy: req.body.validate === true ? actor.id : null, timestamp: new Date().toISOString(), note: String(req.body.note ?? ''), isDemo: store.mode === 'memory-demo' };
  if (record.outcome===null || record.outcome==='For assessment') throw new ManagementError('Select a confirmed recovery outcome.');
  await saveManagement(store,actor,[{name:'recoveryRecords',record}],'recovery.recorded',record.id,managementText(req.body.note,'Operational note')); res.status(201).json({ record });
});

app.get('/api/analytics/operations', requireAuth, permit('analytics.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const allBatches = await store.all('materialBatches');
  const allTransfers = await store.all('transfers');
  const allMeasurements = await store.all('measurements');
  const scopedBatches = scopeAnalyticalBatches(actor, allBatches).filter((batch) => matchesOperationalQuery(batch, req.query));
  const batchIds = new Set(scopedBatches.map((batch) => batch.id));
  const transfers = allTransfers.filter((transfer) => batchIds.has(transfer.batchId));
  const measurements = allMeasurements.filter((measurement) => batchIds.has(measurement.batchId));
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const completed = transfers.filter((transfer) => transfer.status === 'Completed');
  const mass = calculateOperationalMass(scopedBatches, transfers);
  const { verifiedKg, declaredKg, receivedKg } = mass;
  res.json({
    period: { start: '2026-09-01', end: '2026-09-21', label: 'Sep 1-21, 2026 · demo records' },
    scope: { role: actor.role, aggregateOnly: actor.scope.aggregateOnly, organizationIds: actor.scope.organizationIds },
    metrics: {
      batchCount: scopedBatches.length, declaredKg, measuredKg: sum(measurements.filter((item) => item.status === 'Measured').map((item) => item.weightKg)),
      verifiedKg, receivedKg, completedTransfers: completed.length, activeTransfers: transfers.filter((item) => !['Completed', 'Cancelled', 'Rejected'].includes(item.status)).length,
      diversionRate: mass.diversionRate,
      denominator: 'Verified kilograms in completed transfers / unique declared batch kilograms in scope',
    },
    massBalance: { declaredKg, handedOverKg: mass.handedOverKg, receivedKg, verifiedKg, discrepancyKg: mass.discrepancyKg },
    quality: { estimatedBatches: scopedBatches.filter((item) => item.weightStatus === 'Estimated').length, measuredBatches: scopedBatches.filter((item) => item.weightStatus === 'Measured').length, verifiedBatches: scopedBatches.filter((item) => item.weightStatus === 'Verified').length, discrepancyFlags: transfers.filter((item) => Math.abs(item.discrepancyKg ?? 0) > 0.01).length },
    environmentalImpact: { status: 'Disabled pending approved methodology', co2eKg: null, waterLiters: null, landfillAvoidedKg: null },
  });
});

app.get('/api/analytics/dashboard', requireAuth, permit('analytics.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const startedAt = performance.now();
  const result = await dashboardAnalyticsCache.getOrCreate(dashboardAnalyticsCacheKey(actor, req.query), async () => {
    const snapshot = await dashboardSnapshotCache.getOrCreate('current', () => loadDashboardAnalyticsSnapshot(store));
    return buildDashboardAnalytics(store, actor, req.query, snapshot.value);
  });
  const durationMs = performance.now() - startedAt;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Server-Timing', `dashboard;dur=${durationMs.toFixed(1)}`);
  res.setHeader('X-BalikTela-Cache', result.status);
  res.json(result.value);
});

app.get('/api/data-quality', requireAuth, permit('dataQuality.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const batches = scopeAnalyticalBatches(actor, await store.all('materialBatches')).filter((batch) => matchesOperationalQuery(batch, req.query));
  const batchIds = new Set(batches.map((item) => item.id));
  const transfers = (await store.all('transfers')).filter((item) => batchIds.has(item.batchId));
  const threshold = (await store.findOne('configurations', (item) => item.id === 'platform'))?.discrepancyThresholdPercent ?? 5;
  const issues = [
    ...batches.filter((item) => item.weightStatus === 'Estimated').map((item) => ({ id: `DQ-${item.id}-EST`, severity: 'Warning', category: 'Unverified measurement', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: `${item.materialCategory} has an estimated weight without measured or verified evidence.`, status: 'Open' })),
    ...batches.filter((item) => item.currentStatus === 'Reserved' && Date.now() - new Date(item.updatedAt).getTime() > 7 * 86400000).map((item) => ({ id: `DQ-${item.id}-STALE`, severity: 'Warning', category: 'Stale workflow', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: 'Reserved material has no lifecycle update for more than seven days.', status: 'Open' })),
    ...transfers.filter((item) => Math.abs(item.discrepancyKg ?? 0) / Math.max(item.handoverWeightKg ?? item.agreedWeightKg, 1) * 100 >= threshold).map((item) => ({ id: `DQ-${item.id}-VAR`, severity: 'Critical', category: 'Mass discrepancy', entityType: 'Transfer', entityId: actor.scope.aggregateOnly ? 'De-identified transfer' : item.id, description: `${Math.abs(item.discrepancyKg ?? 0).toFixed(1)} kg discrepancy exceeds the ${threshold}% threshold.`, status: item.status === 'Completed' ? 'Documented' : 'Open' })),
    ...transfers.filter((item) => item.status === 'Completed' && item.verifiedWeightKg === null).map((item) => ({ id: `DQ-${item.id}-VERIFY`, severity: 'Critical', category: 'Invalid completion', entityType: 'Transfer', entityId: actor.scope.aggregateOnly ? 'De-identified transfer' : item.id, description: 'Completed transfer has no verified weight.', status: 'Open' })),
  ];
  res.json({ thresholdPercent: threshold, summary: { totalIssues: issues.length, critical: issues.filter((item) => item.severity === 'Critical').length, warnings: issues.filter((item) => item.severity === 'Warning').length, validationCoveragePercent: batches.length ? Math.round(batches.filter((item) => item.weightStatus === 'Verified').length / batches.length * 100) : 0 }, issues });
});

app.get('/api/audit-records', requireAuth, permit('audit.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const query = String(req.query.q ?? '').toLowerCase(); const action = String(req.query.action ?? 'All actions');
  const records = (await store.all('auditRecords')).filter((item) => (!query || [item.actorId, item.action, item.entityType, item.entityId, item.details].join(' ').toLowerCase().includes(query)) && (action === 'All actions' || item.action === action)).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({ records: actor.scope.aggregateOnly ? records.map((item) => ({ ...item, actorId: 'Authorized actor', entityId: 'Restricted identifier', details:'Administrative activity recorded. Record-level details are restricted.' })) : records });
});

app.get('/api/configuration', requireAuth, permit('configuration.read'), async (_req, res) => {
  const configuration = await store.findOne('configurations', (item) => item.id === 'platform'); res.json({ configuration });
});

app.patch('/api/configuration', requireAuth, permit('configuration.manage'), async (req: AuthenticatedRequest, res) => {
  const current = await store.findOne('configurations', (item) => item.id === 'platform'); if (!current) return res.status(404).json({ message: 'Platform configuration not found.' });
  const matchingWeights = {...current.matchingWeights};
  for (const key of Object.keys(matchingWeights) as Array<keyof typeof matchingWeights>) matchingWeights[key]=managementNumber(req.body.matchingWeights?.[key] ?? matchingWeights[key],`${key} weight`);
  const updated: ConfigurationRecord = {...current,matchingWeights,discrepancyThresholdPercent:managementNumber(req.body.discrepancyThresholdPercent ?? current.discrepancyThresholdPercent,'Discrepancy threshold'),rewardCreditsPerVerifiedKg:managementNumber(req.body.rewardCreditsPerVerifiedKg ?? current.rewardCreditsPerVerifiedKg,'Reward rate'),updatedAt:new Date().toISOString(),updatedBy:req.actor!.id};
  if(updated.discrepancyThresholdPercent>100) throw new ManagementError('Discrepancy threshold cannot exceed 100%.');
  const baseline=(await createSeedData()).configurations[0];
  for (const key of ['materialCategories','wasteSources','wasteForms','circularPathways','facilityTypes','weightStatuses'] as const) {
    if(req.body[key]===undefined) continue;
    const values=req.body[key];
    if(!Array.isArray(values)||!values.length||values.some(item=>typeof item!=='string'||!item.trim())) throw new ManagementError(`${key} requires at least one valid value.`);
    if(key!=='materialCategories' && values.some(item=>!(baseline[key] as string[]).includes(item))) throw new ManagementError(`Unsupported ${key} value. Shared schema classifications must remain compatible with mobile.`);
    Object.assign(updated,{[key]:[...new Set(values.map(item=>item.trim()))]});
  }
  await saveManagement(store,req.actor!,[{name:'configurations',previous:current,record:updated}],'configuration.updated','platform',String(req.body.reason ?? 'Reference data and rules updated.'));
  res.json({configuration:updated});
});

app.get('/api/governance', requireAuth, permit('governance.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const configuration = await store.findOne('configurations', (item) => item.id === 'platform');
  res.json({ methodology: { environmentalImpact: 'Disabled pending approved methodology', predictiveAnalytics: 'Non-production; model validation required', prescriptiveAnalytics: 'Non-production; governance approval required', massAccounting: 'Verified completed kilograms / unique declared batch kilograms', version: configuration?.methodologyVersion ?? 'Not approved' }, privacy: { role: actor.role, aggregateOnly: actor.scope.aggregateOnly, exportAllowed: actor.scope.canExport, policy: actor.scope.aggregateOnly ? 'Aggregate/de-identified access' : 'Authorized organization or individual scope' }, policyIndicators: [{ label: 'Verified material completion', status: 'Available', caveat: 'Operational indicator only; not a statutory compliance claim.' }, { label: 'EPR reporting support', status: 'Preparation only', caveat: 'Requires regulator-approved definitions and reporting rules.' }, { label: 'Environmental equivalents', status: 'Disabled', caveat: 'No approved factors or methodology.' }] });
});

app.get('/api/reports', requireAuth, permit('reports.read'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  res.json({ reports: [
    { id: 'material-flow', name: 'Material Flow Summary', description: 'Declared, handed-over, received, and verified kilograms with denominator notes.', formats: ['CSV'], available: true },
    { id: 'data-quality', name: 'Data Quality Summary', description: 'Measurement status, discrepancies, and validation coverage.', formats: ['CSV'], available: true },
    { id: 'organizations', name: 'Organization Participation', description: actor.scope.aggregateOnly ? 'De-identified participation totals.' : 'Authorized organization activity.', formats: ['CSV'], available: true },
    { id: 'environmental-impact', name: 'Environmental Methodology Status', description: 'Methodology status only; no environmental equivalents are calculated.', formats: ['CSV'], available: true },
  ], scope: { role: actor.role, canExport: actor.scope.canExport || actor.role === 'Administrator', aggregateOnly: actor.scope.aggregateOnly } });
});

app.get('/api/reports/:reportId/export', requireAuth, permit('reports.export'), async (req: AuthenticatedRequest, res) => {
  const actor = await currentUser(req, res); if (!actor) return;
  const reportId = String(req.params.reportId);
  const batches = scopeAnalyticalBatches(actor, await store.all('materialBatches')); const transfers = (await store.all('transfers')).filter((item) => batches.some((batch) => batch.id === item.batchId));
  let rows: string[][]; let headers: string[];
  if (reportId === 'data-quality') { headers = ['Metric', 'Value']; rows = [['Estimated batches', String(batches.filter((item) => item.weightStatus === 'Estimated').length)], ['Measured batches', String(batches.filter((item) => item.weightStatus === 'Measured').length)], ['Verified batches', String(batches.filter((item) => item.weightStatus === 'Verified').length)], ['Transfer discrepancy flags', String(transfers.filter((item) => Math.abs(item.discrepancyKg ?? 0) > 0.01).length)]]; }
  else if (reportId === 'environmental-impact') { headers = ['Indicator', 'Status']; rows = [['Environmental impact', 'Disabled pending approved methodology'], ['Predictive analytics', 'Non-production'], ['Mass denominator', 'Verified completed kg / unique declared batch kg']]; }
  else { headers = ['Reporting period', 'Batch ID', 'Material category', 'Weight status', 'Declared kg', 'Current kg', 'Current status']; rows = batches.map((item) => ['Sep 1-21, 2026 demo', actor.scope.aggregateOnly ? 'De-identified' : item.id, item.materialCategory, item.weightStatus, String(item.declaredWeightKg), String(item.currentWeightKg), item.currentStatus]); }
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'); await audit(actor.id, 'report.exported', 'Report', reportId, `${rows.length} CSV rows exported under ${actor.role} scope.`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="baliktela-${reportId}-demo.csv"`); res.send(csv);
});

app.get('/api/barter/conversations', requireAuth, permit('messages.read'), async (req: AuthenticatedRequest, res) => {
  const actor = req.actor!;
  const conversations = (await store.all('conversations')).filter((item) => actor.role === 'Administrator' || item.participantIds.includes(actor.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ conversations });
});

app.get('/api/barter/conversations/:id/messages', requireAuth, permit('messages.read'), async (req: AuthenticatedRequest, res) => {
  const conversation = await authorizedConversation(req, res); if (!conversation) return;
  res.json({ conversation, messages: (await store.all('messages')).filter((item) => item.conversationId === conversation.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
});

app.post('/api/barter/conversations/:id/messages', requireAuth, permit('messages.create'), async (req: AuthenticatedRequest, res) => {
  const conversation = await authorizedConversation(req, res); if (!conversation) return;
  const user = await currentUser(req, res); if (!user) return;
  const body = String(req.body.body ?? '').trim(); if (!body) return res.status(400).json({ message: 'Message cannot be empty.' });
  const message = { id: id('MSG'), conversationId: conversation.id, senderId: user.id, senderName: user.organization || user.fullName, body, createdAt: new Date().toISOString() };
  await store.insert('messages', message); await store.update('conversations', conversation.id, { updatedAt: message.createdAt });
  res.status(201).json({ message });
});

app.get('/api/wallet', requireAuth, permit('wallet.read'), async (req: AuthenticatedRequest, res) => {
  const entries = (await store.all('walletEntries')).filter((item) => item.userId === req.actor!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ balance: entries.reduce((sum, entry) => sum + entry.credits, 0), entries });
});

registerManagementRoutes(app, store);
if (process.env.NODE_ENV === 'production' || process.env.SERVE_WEB === 'true') serveWebApp(app);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') return res.status(error.status).json({message:error.message});
  const message = error instanceof Error ? error.message : 'The authentication service could not complete this request.';
  if (error instanceof Error && error.name === 'SupabaseAuthError') return res.status(400).json({ message });
  console.error(error);
  return res.status(500).json({ message: 'The BalikTela service could not complete this request.' });
});
app.use((_req, res) => res.status(404).json({ message: 'API route not found.' }));
app.listen(port, '0.0.0.0', () => {
  console.log(`BalikTela API listening on http://localhost:${port} (${store.mode})`);
  if (process.env.DASHBOARD_PREWARM !== 'false') void warmDashboardSnapshot();
});

function id(prefix: string) { return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`; }
function positiveEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : fallback; }
async function warmDashboardSnapshot() {
  try {
    await dashboardSnapshotCache.getOrCreate('current', () => loadDashboardAnalyticsSnapshot(store));
  } catch (error) {
    console.error('Dashboard analytics snapshot prewarm failed.', error);
  }
}
function rateLimitIdentity(scope: 'login' | 'password_reset' | 'email_verification', subject: string) {
  const subjectHash = securitySubjectHash(subject);
  return { id: `ARL-${scope}-${subjectHash}`, subjectHash };
}
async function issueAuthChallenge(user: UserRecord, type: 'password_reset' | 'email_verification', requestedClient: unknown) {
  const now = new Date();
  const createdAt = now.toISOString();
  const client = ['web', 'mobile', 'api'].includes(String(requestedClient)) ? String(requestedClient) as 'web' | 'mobile' | 'api' : 'web';
  const ttlSeconds = type === 'password_reset' ? positiveEnv('AUTH_PASSWORD_RESET_TTL_SECONDS', 30 * 60) : positiveEnv('AUTH_EMAIL_VERIFICATION_TTL_SECONDS', 24 * 60 * 60);
  const token = createChallengeToken();
  await store.invalidateAuthChallenges(user.id, type, createdAt);
  const challenge = await store.createAuthChallenge({
    id: id('ACH'), userId: user.id, type, tokenHash: hashSessionToken(token), client,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), consumedAt: null, createdAt, updatedAt: createdAt,
  });
  return { token, challenge };
}
async function startSession(user: UserRecord, requestedClient: unknown) {
  const now = new Date();
  const sessionId = id('SES');
  const client = ['web', 'mobile', 'api'].includes(String(requestedClient)) ? String(requestedClient) as 'web' | 'mobile' | 'api' : 'web';
  const accessToken = issueToken(user.id, user.role, sessionId);
  const refreshToken = createRefreshToken(sessionId);
  const csrfToken = createCsrfToken();
  const session = await store.createSession({
    id: sessionId,
    userId: user.id,
    client,
    tokenHash: hashSessionToken(refreshToken),
    usedTokenHashes: [],
    csrfHash: hashSessionToken(csrfToken),
    expiresAt: new Date(now.getTime() + AUTH_REFRESH_TTL_SECONDS * 1000).toISOString(),
    revokedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return { accessToken, accessTokenExpiresAt: new Date(now.getTime() + AUTH_ACCESS_TTL_SECONDS * 1000).toISOString(), refreshToken, csrfToken, session };
}
type StartedSession = Awaited<ReturnType<typeof startSession>>;
function authenticationPayload(user: UserRecord, authentication: StartedSession) {
  const web = authentication.session.client === 'web';
  return {
    token: authentication.accessToken,
    accessToken: authentication.accessToken,
    accessTokenExpiresAt: authentication.accessTokenExpiresAt,
    refreshToken: web ? undefined : authentication.refreshToken,
    refreshTokenExpiresAt: authentication.session.expiresAt,
    csrfToken: web ? authentication.csrfToken : undefined,
    session: sessionSummary(authentication.session, authentication.session.id),
    user: publicUser(user), access: accessSummary(user), storage: store.mode,
  };
}
function sessionSummary(session: AuthSessionRecord, currentSessionId: string) {
  return { id: session.id, client: session.client, createdAt: session.createdAt, lastActiveAt: session.updatedAt, expiresAt: session.expiresAt, current: session.id === currentSessionId };
}
function cookieValue(header: string | undefined, name: string) {
  const value = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : '';
}
function setRefreshCookie(res: Response, token: string, expiresAt: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth', expires: new Date(expiresAt) });
}
function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth' });
}
function stringArray(value: unknown, fallback: string[]) { return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback; }
function positiveOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function validWeightStatus(value: unknown): WeightStatus { return ['Estimated', 'Measured', 'Verified'].includes(String(value)) ? value as WeightStatus : 'Estimated'; }
function validCondition(value: unknown): MaterialBatchRecord['condition'] { return ['Reusable', 'Recyclable', 'For assessment'].includes(String(value)) ? value as MaterialBatchRecord['condition'] : 'For assessment'; }
function validWasteSource(value: unknown): MaterialBatchRecord['wasteSource'] { return ['Pre-consumer', 'Post-consumer', 'Obsolete inventory', 'Household', 'Institutional'].includes(String(value)) ? value as MaterialBatchRecord['wasteSource'] : 'Unknown'; }
function validWasteForm(value: unknown): MaterialBatchRecord['wasteForm'] { return ['Garments', 'Offcuts', 'Fabric rolls', 'Fiber', 'Mixed textiles', 'Other'].includes(String(value)) ? value as MaterialBatchRecord['wasteForm'] : 'Other'; }
function validPathway(value: unknown): CircularPathway { return ['Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'For assessment'].includes(String(value)) ? value as CircularPathway : 'For assessment'; }
function validWeight(value: unknown, res: Response) { const weight = Number(value); if (!Number.isFinite(weight) || weight <= 0) { res.status(400).json({ message: 'Enter a positive weight in kilograms.' }); return null; } return Number(weight.toFixed(3)); }

async function currentUser(req: AuthenticatedRequest, res: Response) {
  if (req.actor) return req.actor;
  const user = await store.findById('users', req.auth!.userId);
  if (!user) { res.status(404).json({ message: 'User profile not found.' }); return null; }
  return user;
}

function canParticipate(user: UserRecord) { return user.role === 'Consumer' || (user.accountStatus === 'Active' && user.verification === 'Demo verified' && !user.scope.aggregateOnly); }
function lifecycleEvent(type: LifecycleEventRecord['type'], actor: UserRecord, location: string, note: string, measurementId: string | null, status: LifecycleEventRecord['status'] = 'Completed'): LifecycleEventRecord {
  return { id: id('EVT'), type, actorId: actor.id, actorName: actor.organization || actor.fullName, timestamp: new Date().toISOString(), status, location, note, measurementId };
}
function makeMeasurement(transfer: TransferRecord, actor: UserRecord, stage: MeasurementRecord['stage'], weightKg: number, status: WeightStatus, method: unknown, note: unknown): MeasurementRecord {
  return { id: id('MSR'), batchId: transfer.batchId, transferId: transfer.id, stage, weightKg, status, method: String(method ?? (status === 'Verified' ? 'Facility validation' : 'Recorded scale')), recordedBy: actor.id, verifiedBy: status === 'Verified' ? actor.id : null, timestamp: new Date().toISOString(), note: String(note ?? '') };
}
async function audit(actorId: string, action: string, entityType: string, entityId: string, details: string) { await store.insert('auditRecords', { id: id('AUD'), actorId, action, entityType, entityId, timestamp: new Date().toISOString(), details }); }

async function ensureConversation(listing: ListingRecord, user: UserRecord) {
  const existing = await store.findOne('conversations', (item) => item.listingId === listing.id && item.participantIds.includes(user.id)); if (existing) return existing;
  return store.insert('conversations', { id: id('CNV'), listingId: listing.id, listingTitle: listing.title, participantIds: [listing.ownerId, user.id], participantNames: [listing.ownerName, user.organization || user.fullName], updatedAt: new Date().toISOString() });
}
async function authorizedConversation(req: AuthenticatedRequest, res: Response): Promise<ConversationRecord | null> {
  const conversation = await store.findOne('conversations', (item) => item.id === req.params.id);
  if (!conversation) { res.status(404).json({ message: 'Conversation not found.' }); return null; }
  if (req.actor!.role !== 'Administrator' && !conversation.participantIds.includes(req.actor!.id)) { res.status(403).json({ message: 'You are not a participant in this conversation.' }); return null; }
  return conversation;
}
function matchScore(a: ListingRecord, b: ListingRecord, weights: ConfigurationRecord['matchingWeights']) { let score = 20; if (a.textileType === b.textileType) score += weights.category; if (a.circularPathway === b.circularPathway) score += weights.pathway; if (a.region === b.region) score += weights.region; if (a.quality === b.quality) score += weights.condition; if (Math.min(a.quantityKg, b.quantityKg) / Math.max(a.quantityKg, b.quantityKg) > 0.5) score += weights.quantity; return Math.min(100, score); }
function matchReasons(a: ListingRecord, b: ListingRecord) { return [a.textileType === b.textileType ? 'Same material category' : 'Complementary material category', a.circularPathway === b.circularPathway ? 'Same circular pathway' : 'Alternative pathway', a.region === b.region ? 'Same region' : 'Cross-region', a.quality === b.quality ? 'Similar condition' : 'Different condition']; }
function matchesOperationalQuery(batch: MaterialBatchRecord, query: Record<string, unknown>) {
  const region = String(query.region ?? 'All regions'); const category = String(query.materialCategory ?? query.textileType ?? 'All textiles');
  const source = String(query.wasteSource ?? 'All sources'); const pathway = String(query.circularPathway ?? 'All pathways'); const weight = String(query.weightStatus ?? 'All weight statuses');
  const organization = String(query.organizationId ?? 'All organizations');
  return (region === 'All regions' || batch.region === region) && (category === 'All textiles' || batch.materialCategory === category)
    && (source === 'All sources' || batch.wasteSource === source) && (pathway === 'All pathways' || batch.circularPathway === pathway)
    && (weight === 'All weight statuses' || batch.weightStatus === weight) && (organization === 'All organizations' || batch.sourceOrganizationId === organization);
}
function csvCell(value: string) { return `"${value.replaceAll('"', '""')}"`; }
