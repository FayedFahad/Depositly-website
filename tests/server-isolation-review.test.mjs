import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiHandler} from '../server/api.mjs';
import {cookieNames, encryptCookie} from '../server/auth-session.mjs';

const secret = 'server-isolation-regression-test-key-with-32-bytes';
const origin = 'https://depositly.example';
const now = Date.UTC(2026, 9, 22, 12);
const identity = {sub: 'account-a', email: 'a@example.com', name: 'Account A'};
const session = overrides => ({version: 1, user: identity, binding: 'private-browser-binding', csrfToken: 'private-csrf-test-token', accessToken: 'expired-google-access', refreshToken: 'previous-google-refresh', accessExpiresAt: now - 1, createdAt: now - 10000, expiresAt: now + 100000, ...overrides});
function responseRecorder() {
  const headers = new Map();
  return {statusCode: 200, writableEnded: false,
    getHeader: name => headers.get(name.toLowerCase()),
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    end(body) { this.body = body; this.writableEnded = true; },
    json() { return JSON.parse(Buffer.from(this.body).toString('utf8')); }};
}
function requestFor(path, payload, headers = {}) {
  const names = cookieNames(true);
  const binding = encryptCookie({nonce: payload.binding, expiresAt: now + 100000}, 'binding', secret);
  return {url: path, method: 'POST', body: {}, headers: {origin, cookie: `${names.session}=${encryptCookie(payload, 'session', secret)}; ${names.binding}=${binding}`, ...headers}};
}
function handler(fetchImpl = async () => { throw Error('Google should not be called'); }) {
  return createApiHandler({env: {APP_ORIGIN: origin, GOOGLE_CLIENT_SECRET: 'server-only-client-secret', SESSION_SECRET: secret}, now: () => now, fetchImpl});
}

test('invalid CSRF cannot refresh Google tokens before rejecting a backup write', async () => {
  const calls = [];
  const api = handler(async (url, options) => {
    calls.push({url, options});
    return new Response(JSON.stringify({access_token: 'new-access', refresh_token: 'rotated-new-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.appdata'}), {status: 200});
  });
  const response = responseRecorder();
  await api(requestFor('/api/drive/backup', session(), {'x-depositly-account': identity.sub}), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'CSRF_FAILED');
  assert.equal(calls.length, 0, 'a rejected CSRF request must not consume or rotate the persistent refresh token');
});

test('sign-out account guard rejects a different expected account before changing cookies', async () => {
  const response = responseRecorder();
  await handler()(requestFor('/api/auth/logout', session({accessExpiresAt: now + 100000}), {'x-csrf-token': 'private-csrf-test-token', 'x-depositly-account': 'account-b'}), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'ACCOUNT_CHANGED');
  assert.equal(response.getHeader('Set-Cookie'), undefined, 'a mismatched account cannot sign out the current browser session');
});

test('cookie binding rejects a late session cookie without exposing old account data', async () => {
  const request = requestFor('/api/auth/session', session({accessExpiresAt: now + 100000}));
  request.method = 'GET';
  const names = cookieNames(true);
  request.headers.cookie = request.headers.cookie.replace(new RegExp(`${names.binding}=[^;]+`), `${names.binding}=${encryptCookie({nonce: 'new-after-signout', expiresAt: now + 100000}, 'binding', secret)}`);
  const response = responseRecorder();
  await handler()(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().authenticated, false);
  assert.equal(response.json().user, undefined);
});
