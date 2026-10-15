import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Response } from 'express';
import { createRefreshToken, hashSessionToken, issueToken, passwordPolicyError, requireAuth, securitySubjectHash, sessionIdFromRefreshToken, type AuthenticatedRequest } from './auth.js';

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
});

test('rate-limit subjects are normalized and server-derived', () => {
  assert.equal(securitySubjectHash(' Admin@Example.com '), securitySubjectHash('admin@example.com'));
  assert.notEqual(securitySubjectHash('admin@example.com'), securitySubjectHash('other@example.com'));
});
