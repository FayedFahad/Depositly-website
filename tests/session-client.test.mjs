import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createCloudSync, validateCloudBackup} from '../assets/cloud-sync.js';
import {Transfer, emptyState, createCloudBackup} from '../assets/data-engine.js';

const user = {sub: '111111111111111111111', name: 'Farah Rahman', email: 'farah@example.com', picture: 'https://lh3.googleusercontent.com/profile'};
const csrfToken = 'private-session-csrf-token';
const file = id => ({id, name: 'depositly-backup.json', createdTime: '2026-10-22T09:00:00Z'});
const backup = () => createCloudBackup(emptyState(), {enabled: true, time: '09:30'});
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const verifiedSession = () => ({authenticated: true, user, csrfToken, expiresAt: Date.now() + 12 * 60 * 60 * 1000});

function serverHarness(overrides = {}) {
  const requests = [], navigations = [];
  const server = {
    configured: true, missing: [], session: verifiedSession(), latest: {file: file('phone-latest'), backup: backup()},
    ...overrides
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url, 'https://depositly.example');
    const request = {url: parsed, options}; requests.push(request);
    if (server.handle) {
      const handled = await server.handle(request);
      if (handled !== undefined) return handled;
    }
    switch (parsed.pathname) {
      case '/api/auth/config': return response({configured: server.configured, missing: server.missing});
      case '/api/auth/session': return response(server.session || {authenticated: false, user: null});
      case '/api/drive/latest': return response({latest: server.latest});
      case '/api/drive/backup': return response({file: file('web-saved'), newerBackup: null});
      case '/api/auth/logout': server.session = null; return response({ok: true});
      default: throw Error(`Unexpected API endpoint: ${parsed.pathname}`);
    }
  };
  const create = extra => createCloudSync({fetchImpl, validateData: Transfer.migrate, navigate: url => navigations.push(url), ...extra});
  return {server, requests, navigations, create};
}

test('a verified cookie session restores identity across a new client instance', async () => {
  const {create, requests} = serverHarness();
  const first = create();
  await first.restore();
  assert.equal(first.getStatus().authenticated, true);
  assert.equal(first.getStatus().connected, true);
  assert.deepEqual(first.getStatus().user, user);
  const second = create();
  assert.equal(second.getStatus().connected, false, 'cached profile data alone never authenticates');
  await second.restore();
  assert.equal(second.getStatus().connected, true);
  assert.equal(second.getStatus().user.sub, user.sub);
  assert.equal(requests.filter(request => request.url.pathname === '/api/auth/session').length, 2);
  assert(!JSON.stringify(second.getStatus()).includes(csrfToken), 'CSRF token stays private to the client module');
});

test('signed-out session response never displays a remembered account as connected', async () => {
  const {create} = serverHarness({session: null});
  const cloud = create();
  await cloud.restore();
  assert.equal(cloud.getStatus().authenticated, false);
  assert.equal(cloud.getStatus().connected, false);
  assert.equal(cloud.getStatus().user, null);
});

test('a malformed replacement session cannot retain a previous account as authenticated', async () => {
  const {create, server} = serverHarness();
  const cloud = create();
  await cloud.restore();
  assert.equal(cloud.getStatus().user.sub, user.sub);
  server.session = {authenticated: true, user: {sub: 'new-user-without-email'}, csrfToken};
  await assert.rejects(cloud.restore(), error => error.code === 'INVALID_ACCOUNT');
  assert.equal(cloud.getStatus().authenticated, false);
  assert.equal(cloud.getStatus().connected, false);
  assert.equal(cloud.getStatus().user, null);
});

test('Google setup gaps produce actionable missing environment names before navigation', async () => {
  const {create, navigations} = serverHarness({configured: false, missing: ['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']});
  const cloud = create();
  await assert.rejects(cloud.connect(), error => error.code === 'ACCOUNT_SETUP_REQUIRED' && error.missing.includes('GOOGLE_CLIENT_SECRET') && error.missing.includes('SESSION_SECRET'));
  assert.deepEqual(navigations, []);
  assert.equal(cloud.getStatus().connected, false);
});

test('sign-in uses top-level same-origin navigation without an SDK or popup', async () => {
  const {create, navigations, requests} = serverHarness({session: null});
  const cloud = create();
  await cloud.prepare();
  const result = await cloud.connect();
  assert.equal(result.redirecting, true);
  assert.equal(navigations.length, 1);
  const target = new URL(navigations[0], 'https://depositly.example');
  assert.equal(target.origin, 'https://depositly.example');
  assert.equal(target.pathname, '/api/auth/start');
  assert.equal(target.searchParams.get('returnTo'), '/#dashboard');
  assert.equal(requests.filter(request => request.url.pathname === '/api/auth/config').length, 1, 'prepared readiness is reused for the click');
  assert(requests.every(request => request.url.origin === 'https://depositly.example'));
  assert.equal(cloud.getStatus().connected, false, 'navigation does not imply a completed Google login');
});

test('dashboard sign-in targets accept the canonical route and normalize legacy overview', async () => {
  for (const returnTo of ['/#dashboard', '/#overview']) {
    const {create, navigations} = serverHarness({session: null});
    await create().connect({returnTo});
    const target = new URL(navigations[0], 'https://depositly.example');
    assert.equal(target.origin, 'https://depositly.example');
    assert.equal(target.pathname, '/api/auth/start');
    assert.equal(target.searchParams.get('returnTo'), '/#dashboard');
  }
});

test('other allowed workspace sign-in targets remain relative to this website', async () => {
  for (const page of ['deposits', 'calendar', 'payments', 'backup', 'settings']) {
    const {create, navigations} = serverHarness({session: null});
    await create().connect({returnTo: '/#' + page});
    const target = new URL(navigations[0], 'https://depositly.example');
    assert.equal(target.origin, 'https://depositly.example');
    assert.equal(target.pathname, '/api/auth/start');
    assert.equal(target.searchParams.get('returnTo'), '/#' + page);
  }
});

test('a supplied return URL cannot redirect Google sign-in away from this website', async () => {
  for (const returnTo of ['https://another.example/steal-session', '//another.example/#dashboard', '/#dashboard?next=https://another.example', '/#overview/../backup', '/#unknown', null]) {
    const {create, navigations} = serverHarness({session: null});
    await create().connect({returnTo});
    const target = new URL(navigations[0], 'https://depositly.example');
    assert.equal(target.origin, 'https://depositly.example');
    assert.equal(target.pathname, '/api/auth/start');
    assert.equal(target.searchParams.get('returnTo'), '/#dashboard');
  }
});

test('Drive reads validate the Android snapshot and use cookie credentials without bearer tokens', async () => {
  const {create, requests} = serverHarness();
  const cloud = create();
  await cloud.restore();
  const latest = await cloud.readLatest();
  assert.equal(latest.file.id, 'phone-latest');
  assert.equal(latest.backup.format, 'depositly-google-drive');
  assert.equal(latest.data.version, 2);
  const drive = requests.find(request => request.url.pathname === '/api/drive/latest');
  assert.equal(new Headers(drive.options.headers).get('X-Depositly-Account'), user.sub);
  for (const {url, options} of requests) {
    assert.equal(url.origin, 'https://depositly.example');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
  }
});

test('saving a reviewed backup sends CSRF and account guards to the same-origin endpoint', async () => {
  const {create, requests} = serverHarness();
  const cloud = create();
  await cloud.restore();
  const result = await cloud.upload(backup(), {expectedFileId: 'phone-latest'});
  assert.equal(result.file.id, 'web-saved');
  const request = requests.find(request => request.url.pathname === '/api/drive/backup');
  assert.equal(request.options.method, 'POST');
  const headers = new Headers(request.options.headers);
  assert.equal(headers.get('X-CSRF-Token'), csrfToken);
  assert.equal(headers.get('X-Depositly-Account'), user.sub);
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(headers.has('Authorization'), false);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.expectedFileId, 'phone-latest');
  assert.equal(payload.backup.format, 'depositly-google-drive');
  assert.deepEqual(payload.backup.notificationSettings, {enabled: true, time: '09:30'});
});

test('large compatible snapshots are gzip encoded before the server request', async () => {
  const {create, requests} = serverHarness();
  const cloud = create();
  await cloud.restore();
  const large = backup();
  large.data.futureCompatibleExtension = 'x'.repeat(4_300_000);
  await cloud.upload(large, {expectedFileId: null});
  const request = requests.find(request => request.url.pathname === '/api/drive/backup');
  assert.equal(new Headers(request.options.headers).get('X-Depositly-Encoding'), 'gzip');
  const bytes = Buffer.from(await new Response(request.options.body).arrayBuffer());
  const payload = JSON.parse(gunzipSync(bytes).toString('utf8'));
  assert.equal(payload.expectedFileId, null);
  assert.equal(payload.backup.data.futureCompatibleExtension.length, 4_300_000);
});

test('failed logout preserves verified identity until the server confirms sign-out', async () => {
  const {create, requests} = serverHarness({handle: request => request.url.pathname === '/api/auth/logout' ? response({error: {code: 'SERVER_UNAVAILABLE', message: 'Try again later.'}}, 503) : undefined});
  const cloud = create();
  await cloud.restore();
  await assert.rejects(cloud.disconnect(), error => error.code === 'SERVER_UNAVAILABLE');
  assert.equal(cloud.getStatus().connected, true);
  assert.equal(cloud.getStatus().user.sub, user.sub);
  const request = requests.find(request => request.url.pathname === '/api/auth/logout');
  assert.equal(request.options.method, 'POST');
  assert.equal(new Headers(request.options.headers).get('X-CSRF-Token'), csrfToken);
  assert.equal(new Headers(request.options.headers).get('X-Depositly-Account'), user.sub);
});

test('confirmed sign-out invalidates an in-flight response from the previous account', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const {create} = serverHarness({handle: async request => {
    if (request.url.pathname === '/api/drive/latest') { await pending; return response({latest: {file: file('late-old-account'), backup: backup()}}); }
  }});
  const cloud = create();
  await cloud.restore();
  const read = cloud.readLatest();
  await cloud.disconnect();
  release();
  await assert.rejects(read, error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(cloud.getStatus().connected, false);
  assert.equal(cloud.getStatus().user, null);
});

test('a changed server account clears identity and surfaces the guard error', async () => {
  const {create} = serverHarness({handle: request => request.url.pathname === '/api/drive/latest' ? response({error: {code: 'ACCOUNT_CHANGED', message: 'The active Google account changed.'}}, 409) : undefined});
  const cloud = create();
  await cloud.restore();
  await assert.rejects(cloud.readLatest(), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(cloud.getStatus().authenticated, false);
  assert.equal(cloud.getStatus().connected, false);
  assert.equal(cloud.getStatus().user, null);
});

test('Drive conflicts preserve server file metadata without uploading to Google from the browser', async () => {
  const remoteFile = file('new-phone-backup');
  const {create, requests} = serverHarness({handle: request => request.url.pathname === '/api/drive/backup' ? response({error: {code: 'CLOUD_CONFLICT', message: 'A newer backup is available.', remoteFile}}, 409) : undefined});
  const cloud = create();
  await cloud.restore();
  await assert.rejects(cloud.upload(backup(), {expectedFileId: 'old'}), error => error.code === 'CLOUD_CONFLICT' && error.remoteFile.id === remoteFile.id);
  assert(requests.every(request => request.url.origin === 'https://depositly.example'));
  assert.equal(cloud.getStatus().connected, true);
});

test('malformed cloud data is rejected without applying it to a workspace', async () => {
  assert.throws(() => validateCloudBackup({...backup(), version: 9}, Transfer.migrate), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), notificationSettings: {enabled: true, time: '29:00'}}, Transfer.migrate), error => error.code === 'INVALID_BACKUP');
  const invalid = backup(); invalid.data.assets = [{id: 'broken'}];
  const {create} = serverHarness({latest: {file: file('invalid'), backup: invalid}});
  const cloud = create();
  await cloud.restore();
  await assert.rejects(cloud.readLatest(), error => error.code === 'INVALID_BACKUP');
});
