import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudSync, validateCloudBackup, DRIVE_SCOPE, BACKUP_FILE_NAME } from '../assets/cloud-sync.js';

const backup = () => ({ format: 'depositly-google-drive', version: 1, data: { format: 'bd.fdr.vault.entries', formatVersion: 1, minReaderVersion: 1, version: 1, scope: 'all', assets: [], paid: {}, currency: 'BDT' }, notificationSettings: {enabled: true, time: '09:30'} });
const profile = { sub: 'account-a', email: 'person@example.com', name: 'Person' };
const file = id => ({ id, name: BACKUP_FILE_NAME, createdTime: '2026-10-22T09:00:00Z' });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), text: async () => JSON.stringify(data) });
function harness(responses, { scopes = true } = {}) {
  const requests = [];
  const fakeGoogle = {
    initTokenClient: config => ({ requestAccessToken: () => queueMicrotask(() => config.callback({ access_token: 'test-memory-token', expires_in: 3600, scope: DRIVE_SCOPE })) }),
    hasGrantedAllScopes: () => scopes
  };
  const cloud = createCloudSync({
    googleProvider: () => fakeGoogle,
    validateData: value => ({ ...value, validated: true }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (!responses.length) throw Error('Unexpected request');
      const next = responses.shift();
      return typeof next === 'function' ? next(url, options) : response(next);
    }
  });
  return { cloud, requests };
}

test('sign-in reads the same private Android snapshot without uploading', async () => {
  const { cloud, requests } = harness([profile, {files: [file('phone-backup')]}, backup()]);
  const result = await cloud.connect();
  assert.equal(result.user.email, profile.email);
  assert.equal(result.latest.file.id, 'phone-backup');
  assert.equal(result.latest.data.validated, true);
  const list = new URL(requests[1].url);
  assert.equal(list.searchParams.get('spaces'), 'appDataFolder');
  assert.equal(list.searchParams.get('orderBy'), 'createdTime desc');
  assert.match(list.searchParams.get('q'), /depositly-backup\.json/);
  assert.ok(requests.every(request => request.options.method === 'GET'));
  assert.ok(!JSON.stringify(cloud.getStatus()).includes('test-memory-token'));
});

test('a newer phone backup blocks an upload before any write', async () => {
  const { cloud, requests } = harness([profile, {files: [file('old')]}, backup(), {files: [file('new-from-phone')]}]);
  await cloud.connect();
  await assert.rejects(cloud.upload(backup(), {expectedFileId: 'old'}), error => error.code === 'CLOUD_CONFLICT' && error.remoteFile.id === 'new-from-phone');
  assert.ok(requests.every(request => request.options.method === 'GET'));
});

test('reviewed backup creates a new immutable Android-compatible snapshot', async () => {
  const { cloud, requests } = harness([profile, {files: [file('old')]}, backup(), {files: [file('old')]}, file('web-new'), {files: [file('web-new')]}]);
  await cloud.connect();
  const result = await cloud.upload(backup(), {expectedFileId: 'old'});
  const writes = requests.filter(request => request.options.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, 'POST');
  assert.match(writes[0].options.body, /"parents":\["appDataFolder"\]/);
  assert.match(writes[0].options.body, /"format":"depositly-google-drive"/);
  assert.match(writes[0].options.body, /"notificationSettings":\{"enabled":true,"time":"09:30"\}/);
  assert.equal(result.file.id, 'web-new');
  assert.equal(result.newerBackup, null);
});

test('upload requires explicit review even when the account has no backup', async () => {
  const { cloud, requests } = harness([profile, {files: []}]);
  await cloud.connect();
  await assert.rejects(cloud.upload(backup()), error => error.code === 'REVIEW_REQUIRED');
  assert.equal(requests.length, 2);
});

test('new account may save only when it was explicitly reviewed as empty', async () => {
  const { cloud } = harness([profile, {files: []}, {files: []}, file('first'), {files: [file('first')]}]);
  await cloud.connect();
  const result = await cloud.upload(backup(), {expectedFileId: null});
  assert.equal(result.file.id, 'first');
});

test('disconnect invalidates pending responses and clears account memory', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { cloud } = harness([profile, {files: []}, async () => { await pending; return response({files: [file('late')]}); }]);
  await cloud.connect();
  const read = cloud.readLatest();
  cloud.disconnect();
  release();
  await assert.rejects(read, error => error.code === 'ACCOUNT_CHANGED');
  assert.deepEqual(cloud.getStatus().user, null);
  assert.equal(cloud.getStatus().connected, false);
  assert.equal(cloud.getStatus().phase, 'disconnected');
});

test('expired authorization never silently reauthorizes or saves', async () => {
  const { cloud, requests } = harness([profile, {files: []}, () => response({}, 401)]);
  await cloud.connect();
  await assert.rejects(cloud.readLatest(), error => error.code === 'AUTH_REQUIRED');
  assert.equal(cloud.getStatus().connected, false);
  assert.ok(requests.every(request => request.options.method === 'GET'));
});

test('missing Drive consent prevents all API calls', async () => {
  const { cloud, requests } = harness([], {scopes: false});
  await assert.rejects(cloud.connect(), error => error.code === 'MISSING_SCOPE');
  assert.equal(requests.length, 0);
  assert.equal(cloud.getStatus().connected, false);
});

test('cloud data validation rejects malformed envelopes and reminder settings', () => {
  assert.throws(() => validateCloudBackup('{'), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), version: 2}), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), data: {...backup().data, scope: 'selected'}}), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), notificationSettings: {enabled: true, time: '25:00'}}), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup(backup(), () => { throw Error('Invalid amounts'); }), error => error.code === 'INVALID_BACKUP');
});
