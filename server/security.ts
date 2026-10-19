import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { clientOrigin } from './runtimeConfig.js';
import { DatabaseOperationError } from './database/errors.js';

type Environment = Record<string, string | undefined>;

export function installSecurity(app: Express, env: Environment = process.env, limits = { api: 600, auth: 60 }) {
  const production = env.NODE_ENV === 'production';
  const origins = new Set([clientOrigin(env), ...(!production ? ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5173', 'http://127.0.0.1:5173'] : [])]);
  const imageOrigins = env.SUPABASE_URL ? [new URL(env.SUPABASE_URL).origin] : [];
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  app.use(helmet({
    // Inline styles are required by Chart.js/Leaflet and the dedicated print view, never inline scripts.
    contentSecurityPolicy: production ? { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', ...imageOrigins],
      fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      upgradeInsecureRequests: [],
    } } : false,
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
  }));
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('X-Request-ID', randomUUID());
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    const origin = req.get('Origin');
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // CORS alone hides responses; it does not stop a hostile site from submitting a mutation.
    if (!safe && ((origin && !origins.has(origin)) || req.get('Sec-Fetch-Site') === 'cross-site')) {
      return res.status(403).json({ message: 'This request origin is not permitted.' });
    }
    next();
  });
  app.use(cors({ origin: (origin, done) => done(null, !origin || origins.has(origin)), credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  }));
  const limiter = (limit: number, windowMs: number) => rateLimit({ windowMs, limit,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Too many requests. Please wait before trying again.' },
  });
  // Bounded, per-process IP limits complement persistent per-account login/code limits.
  const apiLimit = limiter(limits.api, 60_000);
  app.use('/api', (req, res, next) => req.path === '/health' ? next() : apiLimit(req, res, next));
  const authLimit = limiter(limits.auth, 15 * 60_000);
  app.use('/api/auth', (req, res, next) => req.method === 'POST' && !['/refresh', '/logout', '/logout-all'].includes(req.path) ? authLimit(req, res, next) : next());
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type') ?? '')) {
      // Bodyless DELETE requests are valid; HTML form submissions are never accepted.
      if (req.method !== 'DELETE' || req.get('Content-Type') || Number(req.get('Content-Length') ?? 0) > 0) {
        return res.status(415).json({ message: 'Send request bodies as application/json.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api', (req, res, next) => {
    if (req.body !== undefined && (req.body === null || Array.isArray(req.body) || typeof req.body !== 'object')) return res.status(400).json({ message: 'The request body must be a JSON object.' });
    req.body ??= {};
    let nodes = 0;
    function valid(value: unknown, depth = 0): boolean {
      if (++nodes > 10_000 || depth > 12) return false;
      if (typeof value === 'string') return value.length <= 8_000;
      if (typeof value === 'number') return Number.isFinite(value);
      if (Array.isArray(value)) return value.length <= 200 && value.every(item => valid(item, depth + 1));
      if (value && typeof value === 'object') return Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && key.length <= 100 && valid(item, depth + 1));
      return true;
    }
    if (!valid(req.body)) return res.status(400).json({ message: 'The request body contains unsupported or excessive values.' });
    if (Object.keys(req.query).length > 30 || Object.values(req.query).some(value => typeof value !== 'string' || value.length > 500)) return res.status(400).json({ message: 'Query parameters must be bounded, single text values.' });
    for (const key of ['password', 'currentPassword']) {
      if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || Buffer.byteLength(req.body[key], 'utf8') > 72)) return res.status(400).json({ message: 'Passwords must be text and at most 72 UTF-8 bytes.' });
    }
    if (req.body.email !== undefined && (typeof req.body.email !== 'string' || req.body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email))) return res.status(400).json({ message: 'Enter a valid email address.' });
    next();
  });
}

export const securityErrorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const err = error as { status?: unknown; type?: string; name?: string; message?: string; code?: unknown };
  const status = err?.name === 'SupabaseAuthError' ? 400 : typeof err?.status === 'number' && Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  if (status >= 500 || err?.name === 'SupabaseAuthError') {
    // Never log request bodies, credentials, provider messages, SQL details or URL query strings.
    const code = typeof err?.code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(err.code) && !/^sb_(?:secret|publishable)_/i.test(err.code) ? err.code : 'unavailable';
    const route = typeof req.route?.path === 'string' && /^\/[a-zA-Z0-9_:/.-]{0,199}$/.test(req.route.path) ? req.route.path : 'unmatched';
    console.error('Request failed.', {
      requestId: res.getHeader('X-Request-ID'),
      method: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method) ? req.method : 'OTHER',
      route, status, type: error instanceof DatabaseOperationError ? 'database' : err?.name === 'SupabaseAuthError' ? 'identity' : 'internal', code,
      ...(error instanceof DatabaseOperationError ? { operation: error.operation } : {}),
    });
  }
  const safeDomainError = error instanceof Error && ['ManagementError', 'ReportingInputError', 'MutationConflict'].includes(error.constructor.name);
  const message = err?.type === 'entity.parse.failed' ? 'Malformed JSON request.'
    : status === 413 ? 'The request body is too large.'
    : status === 404 ? 'Resource not found.'
    : err?.name === 'SupabaseAuthError' ? 'The identity provider could not complete this request. Contact an administrator or try again later.'
    : safeDomainError && status < 500 ? err.message
    : status < 500 ? 'The request could not be accepted.' : 'The BalikTela service could not complete this request.';
  res.status(status).json({ message, requestId: res.getHeader('X-Request-ID') });
};
