import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import { createRefreshToken, hashSessionToken, issueToken, passwordPolicyError, publicUser, requireAuth, securitySubjectHash, sessionIdFromRefreshToken, type AuthenticatedRequest } from './auth.js';

test('issued access tokens carry a required session identifier', () => {
  const token = issueToken('USR-TEST', 'Administrator', 'SES-TEST');
  const request = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
  let nextCalled = false;
  const response = {
    status() { return this; },
    json() { return this; },
  } as unknown as Response;

  requireAuth(request, response, (() => { nextCalled = true; }) as NextFunction);

  assert.equal(nextCalled, true);
  assert.equal(request.auth?.userId, 'USR-TEST');
  assert.equal(request.auth?.sessionId, 'SES-TEST');
});

test('token hashing is deterministic and changes with the token', () => {
  assert.equal(hashSessionToken('token-a'), hashSessionToken('token-a'));
  assert.notEqual(hashSessionToken('token-a'), hashSessionToken('token-b'));
});

test('public users exclude password hashes and provider identity identifiers', () => {
  assert.deepEqual(publicUser({ id: 'USR-TEST', passwordHash: 'private-hash', authUserId: 'provider-private-id' }), { id: 'USR-TEST' });
});

test('opaque refresh credentials identify their session without exposing the secret', () => {
  const token = createRefreshToken('SES-TEST');
  assert.equal(sessionIdFromRefreshToken(token), 'SES-TEST');
  assert.notEqual(hashSessionToken(token), token);
  assert.equal(hashSessionToken(token).length, 64);
  assert.equal(sessionIdFromRefreshToken('invalid'), null);
});

test('password policy requires length and mixed character classes', () => {
  assert.match(passwordPolicyError('short') ?? '', /12 characters/);
  assert.match(passwordPolicyError('alllowercase12!') ?? '', /uppercase/);
  assert.match(passwordPolicyError('MixedLetters!!') ?? '', /number/);
  assert.match(passwordPolicyError('MixedLetters12') ?? '', /symbol/);
  assert.equal(passwordPolicyError('StrongPassword12!'), null);
  assert.match(passwordPolicyError('StrongPassword12!' + 'é'.repeat(40))!, /72 UTF-8 bytes/);
});

test('access-token verification pins HS256 and rejects structured identity claims', () => {
  const secret = process.env.JWT_SECRET ?? 'baliktela-demo-secret-change-before-deployment';
  const response = { status() { return this; }, json() { return this; } } as unknown as Response;
  for (const token of [
    jwt.sign({ userId: 'USR-TEST', role: 'Administrator', sessionId: 'SES-TEST', tokenType: 'access' }, secret, { algorithm: 'HS384', issuer: 'baliktela-api' }),
    jwt.sign({ userId: { id: 'USR-TEST' }, role: 'Administrator', sessionId: 'SES-TEST', tokenType: 'access' }, secret, { issuer: 'baliktela-api' }),
  ]) {
    let called = false;
    requireAuth({ headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest, response, () => { called = true; });
    assert.equal(called, false);
  }
});

test('rate-limit subjects are normalized and server-derived', () => {
  assert.equal(securitySubjectHash(' Admin@Example.com '), securitySubjectHash('admin@example.com'));
  assert.notEqual(securitySubjectHash('admin@example.com'), securitySubjectHash('other@example.com'));
});

test('production cannot initialize a password that deployed sign-in rejects', () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.match(passwordPolicyError('BalikTelaDemo2026!') ?? '', /private password/);
    assert.equal(passwordPolicyError('PrivateChosenPassword2026!'), null);
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
