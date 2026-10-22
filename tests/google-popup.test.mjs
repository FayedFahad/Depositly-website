import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudSync, DRIVE_SCOPE} from '../assets/cloud-sync.js';

const profile = {sub: 'popup-test-account', email: 'popup@example.com', name: 'Popup test'};
function googleHarness({popupError, oauthError} = {}) {
  let calls = 0;
  const google = {
    initTokenClient: config => ({requestAccessToken() {
      calls++;
      queueMicrotask(() => {
        if (popupError) config.error_callback({type: popupError});
        else if (oauthError) config.callback({error: oauthError});
        else config.callback({access_token: 'fake-popup-test-token', expires_in: 3600, scope: DRIVE_SCOPE});
      });
    }}),
    hasGrantedAllScopes: () => true
  };
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    let data;
    if (new URL(url).pathname === '/oauth2/v3/userinfo') data = profile;
    else if (new URL(url).pathname === '/drive/v3/files') data = {files: []};
    else throw Error('Unexpected network request');
    return {ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data)};
  };
  return {google, fetchImpl, requests, get popupCalls() { return calls; }};
}

test('a ready Google SDK opens its popup on the original click call stack', async () => {
  const harness = googleHarness();
  const cloud = createCloudSync({googleProvider: () => harness.google, fetchImpl: harness.fetchImpl});
  const connecting = cloud.connect();
  // This assertion occurs before any await/microtask can continue connect().
  assert.equal(harness.popupCalls, 1, 'requestAccessToken must run synchronously from connect() when Google is ready');
  const result = await connecting;
  assert.equal(result.user.email, profile.email);
  assert.equal(result.latest, null);
});

test('cold SDK loading never opens a delayed popup and requires a fresh click', async () => {
  const harness = googleHarness();
  let completeLoading;
  const loading = new Promise(resolve => { completeLoading = resolve; });
  const cloud = createCloudSync({googleProvider: () => loading, fetchImpl: harness.fetchImpl});
  const connecting = cloud.connect();
  assert.equal(harness.popupCalls, 0);
  completeLoading(harness.google);
  await assert.rejects(connecting, error => error.code === 'GOOGLE_READY');
  assert.equal(harness.popupCalls, 0, 'finishing an asynchronous script load must never auto-open a popup');
  assert.equal(cloud.getStatus().busy, false);
  const retry = cloud.connect();
  assert.equal(harness.popupCalls, 1, 'the second explicit click must use the prepared SDK synchronously');
  await retry;
});

test('preparing an asynchronous SDK before the click keeps popup creation synchronous', async () => {
  const harness = googleHarness();
  const cloud = createCloudSync({googleProvider: async () => harness.google, fetchImpl: harness.fetchImpl});
  await cloud.prepare();
  assert.equal(harness.popupCalls, 0, 'preloading cannot start authorization without a click');
  const connecting = cloud.connect();
  assert.equal(harness.popupCalls, 1, 'prepared SDK must not be awaited again inside the click path');
  await connecting;
});

for (const [googleErrorType, expectedCode] of [
  ['popup_failed_to_open', 'POPUP_FAILED_TO_OPEN'],
  ['popup_closed', 'POPUP_CLOSED'],
  ['unknown', 'GOOGLE_POPUP_UNKNOWN']
]) {
  test(`Google ${googleErrorType} preserves its distinct diagnostic`, async () => {
    const harness = googleHarness({popupError: googleErrorType});
    const cloud = createCloudSync({googleProvider: () => harness.google, fetchImpl: harness.fetchImpl});
    await assert.rejects(cloud.connect(), error => error.code === expectedCode && error.googleErrorType === googleErrorType);
    assert.equal(harness.requests.length, 0, 'a failed popup must not make authenticated API requests');
    assert.equal(cloud.getStatus().connected, false);
    assert.equal(cloud.getStatus().busy, false);
  });
}

test('OAuth origin mismatch retains its safe Google reason for setup guidance', async () => {
  const harness = googleHarness({oauthError: 'origin_mismatch'});
  const cloud = createCloudSync({googleProvider: () => harness.google, fetchImpl: harness.fetchImpl});
  await assert.rejects(cloud.connect(), error => error.googleErrorCode === 'origin_mismatch');
  assert.equal(harness.requests.length, 0);
  assert.equal(cloud.getStatus().connected, false);
});

test('OAuth diagnostics reject arbitrary text instead of treating it as an error code', async () => {
  const unsafeReason = '<script>untrusted</script>?access_token=do-not-repeat';
  const harness = googleHarness({oauthError: unsafeReason});
  const cloud = createCloudSync({googleProvider: () => harness.google, fetchImpl: harness.fetchImpl});
  await assert.rejects(cloud.connect(), error => {
    assert.notEqual(error.googleErrorCode, unsafeReason);
    assert.ok(!error.message.includes(unsafeReason));
    return true;
  });
  assert.equal(harness.requests.length, 0);
});
