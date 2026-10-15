import { createHash, createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { UserRecord, UserRole } from './types.js';
import { isDefaultDemoPassword } from './runtimeConfig.js';

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; role: UserRole; sessionId: string };
  actor?: UserRecord;
}

const secret = process.env.JWT_SECRET ?? 'baliktela-demo-secret-change-before-deployment';
export const AUTH_ACCESS_TTL_SECONDS = positiveInteger(process.env.AUTH_ACCESS_TTL_SECONDS, 15 * 60);
export const AUTH_REFRESH_TTL_SECONDS = positiveInteger(process.env.AUTH_REFRESH_TTL_SECONDS, 30 * 24 * 60 * 60);
export const REFRESH_COOKIE_NAME = 'baliktela_refresh';

export function issueToken(userId: string, role: UserRole, sessionId: string) {
  return jwt.sign({ userId, role, sessionId, tokenType: 'access' }, secret, { expiresIn: AUTH_ACCESS_TTL_SECONDS, issuer: 'baliktela-api' });
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createRefreshToken(sessionId: string) {
  return `${sessionId}.${randomBytes(48).toString('base64url')}`;
}

export function createCsrfToken() {
  return randomBytes(32).toString('base64url');
}

export function createChallengeToken() {
  return randomBytes(32).toString('base64url');
}

export function securitySubjectHash(value: string) {
  return createHmac('sha256', secret).update(value.trim().toLowerCase()).digest('hex');
}

export function passwordPolicyError(password: string) {
  if (isDefaultDemoPassword(password)) return 'Choose a private password. The published demo password cannot be used on deployed dashboards.';
  if (password.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Include uppercase and lowercase letters.';
  if (!/\d/.test(password)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include at least one symbol.';
  return null;
}

export function sessionIdFromRefreshToken(token: string) {
  const separator = token.indexOf('.');
  if (separator < 1 || separator === token.length - 1) return null;
  const sessionId = token.slice(0, separator);
  return /^SES-[A-Z0-9-]+$/.test(sessionId) ? sessionId : null;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, secret, { issuer: 'baliktela-api' }) as { userId?: string; role?: UserRole; sessionId?: string; tokenType?: string };
    if (!payload.userId || !payload.role || !payload.sessionId || payload.tokenType !== 'access') throw new Error('Session-bound access token required.');
    req.auth = { userId: payload.userId, role: payload.role, sessionId: payload.sessionId };
    next();
  } catch {
    return res.status(401).json({ message: 'Your session is invalid or has expired.' });
  }
}

export function publicUser<T extends { passwordHash: unknown }>(user: T) {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
