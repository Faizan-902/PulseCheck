import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthClient,
  createPkceChallenge
} from '../src/services/google-oauth.js';

function makeSignedIdToken(payload, { kid = 'test-key-1', privateKey, alg = 'RS256' }) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('Google OAuth service', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key-1', use: 'sig', alg: 'RS256' };
  const clientId = 'google-client-id.apps.googleusercontent.com';
  const clientSecret = 'google-client-secret';

  it('builds a PKCE S256 challenge and Google authorization URL', () => {
    const verifier = 'test-code-verifier-1234567890';
    const challenge = createPkceChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const authUrl = new URL(
      buildGoogleAuthorizationUrl({
        clientId,
        redirectUri: 'http://localhost:5173/api/auth/google/callback',
        state: 'state-123',
        nonce: 'nonce-456',
        codeChallenge: challenge
      })
    );

    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.searchParams.get('client_id')).toBe(clientId);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('scope')).toBe('openid email profile');
    expect(authUrl.searchParams.get('state')).toBe('state-123');
    expect(authUrl.searchParams.get('nonce')).toBe('nonce-456');
    expect(authUrl.searchParams.get('code_challenge')).toBe(challenge);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('exchanges an authorization code and verifies a valid RS256 Google ID token', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = makeSignedIdToken(
      {
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: 'google-sub-123',
        email: 'Faizan@Example.com',
        email_verified: true,
        name: 'Faizan Khan',
        nonce: 'nonce-abc',
        iat: nowSec,
        exp: nowSec + 300
      },
      { privateKey }
    );
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }
      });
    });

    const oauth = createGoogleOAuthClient({ clientId, clientSecret, fetchImpl });
    const identity = await oauth.exchangeCodeForUser({
      code: 'auth-code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://localhost:5173/api/auth/google/callback',
      expectedNonce: 'nonce-abc'
    });

    expect(identity).toEqual({
      sub: 'google-sub-123',
      email: 'faizan@example.com',
      name: 'Faizan Khan'
    });
  });

  it.each([
    ['unverified email', { email_verified: false }],
    ['wrong audience', { aud: 'other-client.apps.googleusercontent.com' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['wrong nonce', { nonce: 'different-nonce' }],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 60 }]
  ])('rejects Google ID tokens with %s', async (_label, overrides) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = makeSignedIdToken(
      {
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: 'google-sub-123',
        email: 'faizan@example.com',
        email_verified: true,
        name: 'Faizan Khan',
        nonce: 'nonce-abc',
        iat: nowSec,
        exp: nowSec + 300,
        ...overrides
      },
      { privateKey }
    );
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
      }
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    });

    const oauth = createGoogleOAuthClient({ clientId, clientSecret, fetchImpl });
    await expect(
      oauth.exchangeCodeForUser({
        code: 'auth-code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'http://localhost:5173/api/auth/google/callback',
        expectedNonce: 'nonce-abc'
      })
    ).rejects.toThrow();
  });

  it('rejects Google ID tokens with an invalid RSA signature', async () => {
    const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = makeSignedIdToken(
      {
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: 'google-sub-123',
        email: 'faizan@example.com',
        email_verified: true,
        name: 'Faizan Khan',
        nonce: 'nonce-abc',
        iat: nowSec,
        exp: nowSec + 300
      },
      { privateKey: otherKey }
    );
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
      }
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    });

    const oauth = createGoogleOAuthClient({ clientId, clientSecret, fetchImpl });
    await expect(
      oauth.exchangeCodeForUser({
        code: 'auth-code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'http://localhost:5173/api/auth/google/callback',
        expectedNonce: 'nonce-abc'
      })
    ).rejects.toThrow();
  });
});
