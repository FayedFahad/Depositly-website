import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {createApiHandler} from '../server/api.mjs';
import {encryptCookie, decryptCookie, serializeCookie, SESSION_SECONDS} from '../server/auth-session.mjs';
import {registryQuery} from '../server/registry-drive.mjs';

const CLIENT_ID = '688859064258-h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SESSION_SECRET = 'only-test-material-not-a-production-key-'.repeat(2);
const backup = (tag = 'a') => ({format: 'depositly-google-drive', version: 1, data: {format: 'bd.fdr.vault.entries', formatVersion: 1, minReaderVersion: 1, version: 1, scope: 'all', assets: [], paid: {}, currency: 'BDT', testTag: tag}, notificationSettings: {enabled: true, time: '09:30'}});
const googleResponse = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});

function cookieJar() {
  const values = new Map();
  return {
    values,
    header() { return [...values].map(([name, value]) => `${name}=${value}`).join('; '); },
    accept(response) {
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';'), separator = pair.indexOf('='), name = pair.slice(0, separator), value = pair.slice(separator + 1);
        if (/Max-Age=0(?:;|$)/.test(header)) values.delete(name); else values.set(name, value);
      }
    }
  };
}
async function setup(context, {configured = true} = {}) {
  let clock = Date.UTC(2026, 9, 22, 9), sequence = 0;
  const env = {GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: configured ? 'fake-server-only-client-secret' : '', SESSION_SECRET: configured ? SESSION_SECRET : ''};
  const calls = [], snapshots = new Map(), revoked = new Set();
  snapshots.set('user-a', [{file: {id: 'phone-a', name: 'depositly-backup.json', createdTime: '2026-10-22T08:00:00Z'}, backup: backup('a')}]);
  snapshots.set('user-b', [{file: {id: 'phone-b', name: 'depositly-backup.json', createdTime: '2026-10-22T08:00:00Z'}, backup: backup('b')}]);
  const googleFetch = async (url, options) => {
    const endpoint = new URL(url), form = new URLSearchParams(options.body || '');
    calls.push({url: endpoint, options});
    if (url === 'https://oauth2.googleapis.com/token') {
      const account = form.get('grant_type') === 'refresh_token' ? form.get('refresh_token')?.replace('refresh-', '') : form.get('code');
      if (!['user-a', 'user-b'].includes(account) || revoked.has(account)) return googleResponse({error: 'invalid_grant'}, 400);
      const tokens = {access_token: `access-${account}`, expires_in: 3600, token_type: 'Bearer', scope: DRIVE_SCOPE};
      if (form.get('grant_type') === 'authorization_code') tokens.refresh_token = `refresh-${account}`;
      return googleResponse(tokens);
    }
    const account = options.headers.Authorization?.replace('Bearer access-', '');
    if (!snapshots.has(account)) return googleResponse({error: {message: 'Not authorized'}}, 401);
    if (endpoint.pathname === '/oauth2/v3/userinfo') return googleResponse({sub: account, email: `${account}@example.com`, name: account === 'user-a' ? 'Alice' : 'Bob', given_name: account === 'user-a' ? 'Alice' : 'Bob'});
    if (endpoint.pathname === '/drive/v3/files') {
      assert.equal(endpoint.searchParams.get('spaces'), 'appDataFolder');
      const registry=endpoint.searchParams.get('q')===registryQuery;
      if(!registry)assert.equal(endpoint.searchParams.get('q'), "name = 'depositly-backup.json' and trashed = false");
      return googleResponse({files: (registry?snapshots.get(account):snapshots.get(account).slice(0, 1)).map(item => item.file)});
    }
    if (endpoint.pathname.startsWith('/drive/v3/files/')) {
      const item = snapshots.get(account).find(item => item.file.id === endpoint.pathname.split('/').at(-1));
      return item ? googleResponse(endpoint.searchParams.has('fields')?item.file:item.backup) : googleResponse({error: 'not_found'}, 404);
    }
    if (endpoint.pathname === '/upload/drive/v3/files') {
      assert.equal(options.method, 'POST');
      const parts = [...options.body.matchAll(/Content-Type: application\/json; charset=UTF-8\r\n\r\n([\s\S]*?)\r\n--/g)];
      assert.equal(parts.length, 2);
      const metadata = JSON.parse(parts[0][1]), content = JSON.parse(parts[1][1]);
      assert(metadata.name==='depositly-backup.json'||/^Depositly-.*\.json$/.test(metadata.name));
      assert.deepEqual(metadata.parents, ['appDataFolder']);
      const file = {id: `web-${account}-${++sequence}`, name: metadata.name, createdTime: new Date(clock).toISOString(),...(metadata.appProperties?{appProperties:metadata.appProperties}:{})};
      snapshots.get(account).unshift({file, backup: content});
      return googleResponse(file);
    }
    throw Error(`Unexpected Google request ${endpoint.pathname}`);
  };
  let handler = createApiHandler({env, fetchImpl: googleFetch, now: () => clock});
  const server = http.createServer((request, response) => handler(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  env.APP_ORIGIN = origin;
  context.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, {jar, method = 'GET', data, body, headers = {}} = {}) {
    const response = await fetch(`${origin}${path}`, {method, redirect: 'manual', body: data !== undefined ? JSON.stringify(data) : body, headers: {...(jar?.header() ? {Cookie: jar.header()} : {}), ...(method === 'POST' ? {Origin: origin} : {}), ...(data !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}});
    jar?.accept(response);
    return response;
  }
  async function login(account = 'user-a', jar = cookieJar(), {returnTo} = {}) {
    const startPath = '/api/auth/start' + (returnTo === undefined ? '' : '?' + new URLSearchParams({returnTo}));
    const start = await request(startPath, {jar});
    assert.equal(start.status, 302);
    const authorization = new URL(start.headers.get('location'));
    const callback = await request(`/api/auth/callback?code=${account}&state=${encodeURIComponent(authorization.searchParams.get('state'))}`, {jar});
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), `${origin}/#dashboard`);
    const session = await (await request('/api/auth/session', {jar})).json();
    assert.equal(session.authenticated, true);
    return {jar, session, authorization};
  }
  return {env, calls, snapshots, revoked, origin, request, login, advance: milliseconds => {clock += milliseconds;}, coldStart: () => {handler = createApiHandler({env, fetchImpl: googleFetch, now: () => clock});}};
}

test('configuration reports only missing names and never returns secret values', async context => {
  const {request} = await setup(context, {configured: false});
  const response = await request('/api/auth/config'), config = await response.json();
  assert.equal(config.configured, false);
  assert.deepEqual(config.missing, ['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']);
  assert.ok(config.redirectUri.endsWith('/api/auth/callback'));
  assert.equal(config.loginUrl, '/api/auth/start');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await request('/api/auth/start')).status, 503);
  assert.equal((await (await request('/api/auth/session')).json()).authenticated, false);
});

test('authorization uses code, state, PKCE and offline access with encrypted persistent cookies', async context => {
  const {login, calls, origin} = await setup(context);
  const {jar, session, authorization} = await login();
  assert.equal(authorization.origin, 'https://accounts.google.com');
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
  assert.equal(authorization.searchParams.get('access_type'), 'offline');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  const tokenExchange = calls.find(call => call.url.hostname === 'oauth2.googleapis.com');
  const parameters = new URLSearchParams(tokenExchange.options.body);
  assert.match(parameters.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(parameters.get('client_secret'), 'fake-server-only-client-secret');
  assert.equal(session.user.sub, 'user-a');
  assert.ok(session.csrfToken && session.expiresAt);
  assert.ok(!JSON.stringify(session).includes('access-user-a') && !JSON.stringify(session).includes('refresh-user-a'));
  assert.ok(!jar.header().includes('access-user-a') && !jar.header().includes('refresh-user-a'));
  const secure = serializeCookie('__Host-depositly_session', 'encrypted', {secure: true});
  assert.match(secure, /HttpOnly; SameSite=Lax/);
  assert.match(secure, /; Secure$/);
  assert.ok(secure.includes(`Max-Age=${SESSION_SECONDS}`));
  assert.ok(!secure.includes('Domain='));
});

test('OAuth returns to the canonical dashboard for default, explicit and legacy targets', async context => {
  const {login, origin} = await setup(context);
  for (const returnTo of [undefined, '/#dashboard', '/#overview', 'https://another.example/steal-session', '//another.example/#dashboard']) {
    const {authorization} = await login('user-a', cookieJar(), {returnTo});
    assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
    assert.equal(authorization.searchParams.has('returnTo'), false, 'Google only receives the fixed callback URL');
  }
});

test('cancelled legacy sign-in returns its error to the dashboard without creating a session', async context => {
  const {request, calls, origin} = await setup(context), jar = cookieJar();
  const start = await request('/api/auth/start?' + new URLSearchParams({returnTo: '/#overview'}), {jar});
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = await request('/api/auth/callback?' + new URLSearchParams({error: 'access_denied', state}), {jar});
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), `${origin}/?auth_error=ACCESS_DENIED#dashboard`);
  assert.equal(calls.length, 0);
  assert.equal(jar.values.has('depositly_oauth'), false);
  assert.equal((await (await request('/api/auth/session', {jar})).json()).authenticated, false);
});

test('a new server instance restores the account and silently renews Google access', async context => {
  const setupData = await setup(context), {jar, session} = await setupData.login();
  const cookieBefore = jar.values.get('depositly_session');
  setupData.advance(3_600_001);
  setupData.coldStart();
  const refreshed = await (await setupData.request('/api/auth/session', {jar})).json();
  assert.equal(refreshed.authenticated, true);
  assert.equal(refreshed.user.sub, 'user-a');
  assert.equal(refreshed.csrfToken, session.csrfToken);
  assert.ok(refreshed.expiresAt > session.expiresAt);
  assert.notEqual(jar.values.get('depositly_session'), cookieBefore);
  assert.equal(setupData.calls.filter(call => new URLSearchParams(call.options.body || '').get('grant_type') === 'refresh_token').length, 1);
  setupData.advance(3_600_001);
  assert.equal((await (await setupData.request('/api/auth/session', {jar})).json()).authenticated, true, 'refresh token must survive a renewal response that omits it');
});

test('each Google account can read only its own appData backup and stale account headers fail', async context => {
  const {login, request, calls} = await setup(context), alice = await login('user-a'), bob = await login('user-b');
  const a = await (await request('/api/drive/latest', {jar: alice.jar, headers: {'X-Depositly-Account': 'user-a'}})).json();
  const b = await (await request('/api/drive/latest', {jar: bob.jar, headers: {'X-Depositly-Account': 'user-b'}})).json();
  assert.equal(a.latest.file.id, 'phone-a');
  assert.equal(b.latest.file.id, 'phone-b');
  assert.equal(a.latest.backup.data.testTag, 'a');
  assert.equal(b.latest.backup.data.testTag, 'b');
  const count = calls.length;
  const mismatched = await request('/api/drive/latest', {jar: alice.jar, headers: {'X-Depositly-Account': 'user-b'}});
  assert.equal(mismatched.status, 403);
  assert.equal((await mismatched.json()).error.code, 'ACCOUNT_CHANGED');
  assert.equal(calls.length, count);
});

test('uploads and sign-out reject incorrect origins and CSRF tokens before writes', async context => {
  const {login, request, calls, advance} = await setup(context), {jar, session} = await login();
  advance(3_600_001);
  const count = calls.length;
  const rejected = await request('/api/drive/backup', {jar, method: 'POST', data: {backup: backup(), expectedFileId: 'phone-a'}});
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, 'CSRF_FAILED');
  const logout = await request('/api/auth/logout', {jar, method: 'POST', headers: {Origin: 'https://untrusted.example', 'X-CSRF-Token': session.csrfToken}});
  assert.equal(logout.status, 403);
  assert.equal(calls.length, count, 'a rejected write must not refresh or rotate Google credentials');
  assert.equal((await (await request('/api/auth/session', {jar})).json()).authenticated, true);
});

test('sign-out fences late session renewal without revoking Android Google access', async context => {
  const {login, request, calls} = await setup(context), {jar, session} = await login();
  const lateSessionCookie = jar.values.get('depositly_session'), oldBinding = jar.values.get('depositly_binding'), count = calls.length;
  const logout = await request('/api/auth/logout', {jar, method: 'POST', headers: {'X-CSRF-Token': session.csrfToken}});
  assert.equal(logout.status, 200);
  assert.equal(jar.values.has('depositly_session'), false);
  assert.notEqual(jar.values.get('depositly_binding'), oldBinding);
  assert.equal(calls.length, count, 'ordinary sign-out must not revoke the shared Google grant');
  jar.values.set('depositly_session', lateSessionCookie);
  const reopened = await (await request('/api/auth/session', {jar})).json();
  assert.equal(reopened.authenticated, false, 'a late renewal cannot resurrect a logged-out session');
});

test('OAuth callback rejects state mismatches and pending callbacks after sign-out', async context => {
  const {request, calls} = await setup(context), jar = cookieJar();
  const start = await request('/api/auth/start', {jar}), target = new URL(start.headers.get('location'));
  const bad = await request('/api/auth/callback?code=user-a&state=wrong', {jar});
  assert.match(bad.headers.get('location'), /\?auth_error=AUTH_STATE_INVALID#dashboard$/);
  assert.equal(calls.length, 0);
  const secondStart = await request('/api/auth/start', {jar}), state = new URL(secondStart.headers.get('location')).searchParams.get('state');
  const pendingTransaction = jar.values.get('depositly_oauth');
  await request('/api/auth/logout', {jar, method: 'POST'});
  jar.values.set('depositly_oauth', pendingTransaction);
  const stale = await request(`/api/auth/callback?code=user-a&state=${state}`, {jar});
  assert.match(stale.headers.get('location'), /\?auth_error=AUTH_STATE_INVALID#dashboard$/);
  assert.equal(calls.length, 0);
  assert.ok(target.searchParams.get('state'));
});

test('an unsolicited OAuth callback cannot sign out an existing Google account', async context => {
  const {login, request, calls} = await setup(context), {jar} = await login();
  const sessionCookie = jar.values.get('depositly_session'), count = calls.length;
  const response = await request('/api/auth/callback?code=untrusted&state=untrusted', {jar});
  assert.match(response.headers.get('location'), /\?auth_error=AUTH_STATE_INVALID#dashboard$/);
  assert.equal(jar.values.get('depositly_session'), sessionCookie);
  assert.equal(calls.length, count);
  assert.equal((await (await request('/api/auth/session', {jar})).json()).authenticated, true);
});

test('a newer phone snapshot blocks server-side writes and keeps all snapshots', async context => {
  const {login, request, snapshots, calls} = await setup(context), {jar, session} = await login();
  snapshots.get('user-a').unshift({file: {id: 'phone-new', name: 'depositly-backup.json'}, backup: backup('new')});
  const response = await request('/api/drive/backup', {jar, method: 'POST', headers: {'X-CSRF-Token': session.csrfToken}, data: {backup: backup(), expectedFileId: 'phone-a'}});
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.error.code, 'CLOUD_CONFLICT');
  assert.equal(result.error.remoteFile.id, 'phone-new');
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.pathname === '/upload/drive/v3/files').length, 0);
  assert.equal(snapshots.get('user-a').length, 2);
});

test('a reviewed gzip upload creates an immutable Android-compatible snapshot', async context => {
  const {login, request, snapshots} = await setup(context), {jar, session} = await login();
  const uploaded = backup('website');
  uploaded.data.padding = 'repeated investment notes '.repeat(200_000);
  const compressed = gzipSync(JSON.stringify({backup: uploaded, expectedFileId: 'phone-a'}));
  assert.ok(compressed.length < 4_000_000);
  const response = await request('/api/drive/backup', {jar, method: 'POST', body: compressed, headers: {'Content-Type': 'application/octet-stream', 'X-Depositly-Encoding': 'gzip', 'X-CSRF-Token': session.csrfToken}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  const result = await response.json();
  assert.match(result.file.id, /^web-user-a-/);
  assert.equal(result.backup.data.padding, uploaded.data.padding);
  assert.equal(result.backup.notificationSettings.time, '09:30');
  assert.equal(snapshots.get('user-a').length, 2);
  const latest = await (await request('/api/drive/latest', {jar})).json();
  assert.equal(latest.latest.file.id, result.file.id);
  assert.equal(latest.latest.backup.data.testTag, 'website');
});

test('malformed, incomplete and oversized compressed backups cannot create snapshots', async context => {
  const {login, request, snapshots} = await setup(context), {jar, session} = await login();
  const headers = {'X-CSRF-Token': session.csrfToken};
  const selected = backup(); selected.data.scope = 'selected';
  assert.equal((await request('/api/drive/backup', {jar, method: 'POST', headers, data: {backup: selected, expectedFileId: 'phone-a'}})).status, 400);
  assert.equal((await request('/api/drive/backup', {jar, method: 'POST', headers: {...headers, 'X-Depositly-Encoding': 'gzip'}, body: 'not gzip'})).status, 400);
  const bomb = gzipSync(Buffer.alloc(20_100_001, 'a'));
  const oversized = await request('/api/drive/backup', {jar, method: 'POST', headers: {...headers, 'X-Depositly-Encoding': 'gzip'}, body: bomb});
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'BACKUP_TOO_LARGE');
  const oversizedWireBody = await request('/api/drive/backup', {jar, method: 'POST', headers, body: Buffer.alloc(4_000_001, 'a')});
  assert.equal(oversizedWireBody.status, 413, 'the transport limit must return a clear error rather than dropping the socket');
  assert.equal(snapshots.get('user-a').length, 1);
});

test('revoked refresh tokens end the website session without leaking Google details', async context => {
  const {login, request, revoked, advance} = await setup(context), {jar} = await login();
  revoked.add('user-a'); advance(3_600_001);
  const response = await request('/api/auth/session', {jar});
  assert.equal(response.status, 401);
  const error = await response.json();
  assert.equal(error.error.code, 'AUTH_REQUIRED');
  assert.ok(!JSON.stringify(error).includes('refresh-user-a'));
  assert.equal(jar.values.has('depositly_session'), false);
});

test('encrypted cookies reject tampering, wrong purpose, wrong key and expiration', () => {
  const payload = {expiresAt: 2000, private: 'fake-refresh-token'};
  const value = encryptCookie(payload, 'session', SESSION_SECRET);
  assert.deepEqual(decryptCookie(value, 'session', SESSION_SECRET, 1000), payload);
  assert.ok(!value.includes(payload.private));
  assert.equal(decryptCookie(value, 'binding', SESSION_SECRET, 1000), null);
  assert.equal(decryptCookie(value, 'session', SESSION_SECRET + 'different', 1000), null);
  assert.equal(decryptCookie(value, 'session', SESSION_SECRET, 2001), null);
  const fields = value.split('.'); fields[2] = (fields[2][0] === 'A' ? 'B' : 'A') + fields[2].slice(1);
  assert.equal(decryptCookie(fields.join('.'), 'session', SESSION_SECRET, 1000), null);
});

test('registry endpoints sync quietly, retain dated versions, and enforce account and CSRF guards',async context=>{
 const api=await setup(context),{jar,session}=await api.login();
 const headers={'X-Depositly-Account':'user-a','X-CSRF-Token':session.csrfToken};
 const pulled=await (await api.request('/api/drive/registry',{jar,headers})).json();assert.equal(pulled.backup.data.testTag,'a');assert.deepEqual(pulled.heads,['phone-a']);
 assert.equal((await api.request('/api/drive/save-version',{jar,method:'POST',data:{backup:pulled.backup,parents:pulled.heads},headers:{'X-Depositly-Account':'user-a'}})).status,403);
 assert.equal((await api.request('/api/drive/registry',{jar,headers:{'X-Depositly-Account':'user-b'}})).status,403);
 const saved=await api.request('/api/drive/save-version',{jar,method:'POST',data:{backup:pulled.backup,parents:pulled.heads},headers});assert.equal(saved.status,200);const written=await saved.json();
 assert.match(written.file.name,/^Depositly-2026-/);assert.equal(api.snapshots.get('user-a').length,2);assert.equal(api.snapshots.get('user-b').length,1);
 const latest=await (await api.request('/api/drive/registry',{jar,headers})).json();assert.deepEqual(latest.heads,[written.file.id]);
 const unchanged=await (await api.request('/api/drive/registry?known='+written.file.id,{jar,headers})).json();assert.equal(unchanged.unchanged,true);
 const history=await (await api.request('/api/drive/versions',{jar,headers})).json();assert.equal(history.files.length,2);
 const old=await (await api.request('/api/drive/version?id=phone-a',{jar,headers})).json();assert.equal(old.backup.data.testTag,'a');
 assert((await api.request('/api/drive/version?id=phone-b',{jar,headers})).status>=400);
 assert(!api.calls.some(call=>call.options.method==='DELETE'));
});
