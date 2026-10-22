import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountWorkspaces, accountWorkspaceKey, LEGACY_WORKSPACE_KEY} from '../assets/account-workspaces.js';

const a = {sub: '111111111111111111111', name: 'Account A', email: 'a@example.com'};
const b = {sub: '222222222222222222222', name: 'Account B', email: 'b@example.com'};
const payload = (owner, marker) => ({data: {assets: [{id: marker}], paid: {}}, owner, reminders: {enabled: true, time: '09:00'}, dirty: true, updatedAt: '2026-10-22T00:00:00Z'});
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

test('verified subjects isolate durable accounts and signed-out guest records', () => {
  const storage = memoryStorage(), manager = createAccountWorkspaces({storage});
  assert.equal(manager.openGuest(), null);
  manager.save(payload(null, 'guest'));
  assert.equal(manager.openAccount(a), null);
  manager.save(payload(a.sub, 'a-record'));
  assert.equal(manager.openAccount(b), null);
  manager.save(payload(b.sub, 'b-record'));
  assert.equal(manager.openAccount(a).data.assets[0].id, 'a-record');
  assert.equal(manager.openGuest().data.assets[0].id, 'guest');
  assert.equal(manager.activeSub, null);
  assert.notEqual(manager.guestKey, accountWorkspaceKey(a));
  assert.notEqual(accountWorkspaceKey(a), accountWorkspaceKey(b));
  const reopened = createAccountWorkspaces({storage});
  assert.equal(reopened.openAccount(b).data.assets[0].id, 'b-record');
});

test('a switch cannot save previous-user records into the new account', () => {
  const storage = memoryStorage(), manager = createAccountWorkspaces({storage});
  manager.openAccount(a);
  const first = manager.save(payload(a.sub, 'a-record'));
  manager.openAccount(b);
  assert.throws(() => manager.save(first), error => error.code === 'ACCOUNT_WORKSPACE_MISMATCH');
  assert.throws(() => manager.save(payload(null, 'unreviewed-guest')), error => error.code === 'ACCOUNT_WORKSPACE_MISMATCH');
  assert.equal(storage.getItem(accountWorkspaceKey(b)), null);
  manager.openGuest();
  assert.throws(() => manager.save(first), error => error.code === 'ACCOUNT_WORKSPACE_MISMATCH');
});

test('identity must come from a verified sub and never from an email or remembered name', () => {
  const storage = memoryStorage(), manager = createAccountWorkspaces({storage});
  manager.openAccount(a);
  for (const invalid of [null, {}, {email: a.email}, {sub: ''}, {sub: '../guest'}, {sub: 'has whitespace'}, {sub: 123}]) {
    assert.throws(() => manager.openAccount(invalid), error => error.code === 'ACCOUNT_IDENTITY_REQUIRED');
    assert.equal(manager.activeKey, null);
    assert.throws(() => manager.save(payload(a.sub, 'stale')), error => error.code === 'WORKSPACE_NOT_LOADED');
  }
  assert.equal(accountWorkspaceKey({...a, email: b.email}), accountWorkspaceKey(a));
});

test('same-sub legacy data requires explicit review and is copied without deleting the recovery source', () => {
  const raw = JSON.stringify(payload(a.sub, 'legacy-a'));
  const storage = memoryStorage({[LEGACY_WORKSPACE_KEY]: raw}), manager = createAccountWorkspaces({storage});
  assert.equal(manager.openAccount(a), null, 'legacy data must not load automatically');
  assert.throws(() => manager.adoptLegacy({confirmed: true}), error => error.code === 'LEGACY_REVIEW_REQUIRED');
  const review = manager.inspectLegacy();
  assert.equal(review.eligible, true);
  assert.equal(review.ownerMatches, true);
  assert.equal(review.deposits, 1);
  assert.throws(() => manager.adoptLegacy(), error => error.code === 'LEGACY_REVIEW_REQUIRED');
  const adopted = manager.adoptLegacy({confirmed: true});
  assert.equal(adopted.data.assets[0].id, 'legacy-a');
  assert.equal(adopted.owner, a.sub);
  assert.equal(storage.getItem(LEGACY_WORKSPACE_KEY), raw);
  assert.equal(manager.openAccount(a).data.assets[0].id, 'legacy-a');
});

test('different-account and signed-out views reveal no legacy financial details', () => {
  const storage = memoryStorage({[LEGACY_WORKSPACE_KEY]: JSON.stringify(payload(a.sub, 'private-a-record'))});
  const manager = createAccountWorkspaces({storage});
  for (const open of [() => manager.openAccount(b), () => manager.openGuest()]) {
    assert.equal(open(), null);
    const review = manager.inspectLegacy();
    assert.equal(review.available, true);
    assert.equal(review.eligible, false);
    assert.equal(review.deposits, undefined);
    assert.equal(review.receipts, undefined);
    assert.equal(review.payload, undefined);
    assert.doesNotMatch(JSON.stringify(review), /private-a-record/);
    assert.throws(() => manager.adoptLegacy({confirmed: true}), error => error.code === 'LEGACY_REVIEW_REQUIRED');
  }
});

test('unassigned legacy guest records need explicit review before assignment', () => {
  const raw = JSON.stringify(payload(null, 'old-guest'));
  const storage = memoryStorage({[LEGACY_WORKSPACE_KEY]: raw}), manager = createAccountWorkspaces({storage});
  manager.openAccount(b);
  assert.equal(manager.inspectLegacy().ownerMatches, false);
  const adopted = manager.adoptLegacy({confirmed: true});
  assert.equal(adopted.owner, b.sub);
  assert.equal(adopted.data.assets[0].id, 'old-guest');
  assert.equal(storage.getItem(LEGACY_WORKSPACE_KEY), raw);
});

test('legacy review cannot overwrite a destination or copy a changed source', () => {
  const storage = memoryStorage({[LEGACY_WORKSPACE_KEY]: JSON.stringify(payload(a.sub, 'legacy-a'))});
  const manager = createAccountWorkspaces({storage});
  manager.openAccount(a);
  manager.inspectLegacy();
  storage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify(payload(a.sub, 'new-legacy-a')));
  assert.throws(() => manager.adoptLegacy({confirmed: true}), error => error.code === 'WORKSPACE_CONFLICT');
  assert.equal(storage.getItem(accountWorkspaceKey(a)), null);
  manager.save(payload(a.sub, 'current-a'));
  assert.equal(manager.inspectLegacy().eligible, false);
  assert.throws(() => manager.adoptLegacy({confirmed: true}), error => error.code === 'LEGACY_REVIEW_REQUIRED');
  assert.equal(manager.openAccount(a).data.assets[0].id, 'current-a');
});

test('stale-tab conflicts remain scoped to their account and do not block another account', () => {
  const storage = memoryStorage(), first = createAccountWorkspaces({storage}), second = createAccountWorkspaces({storage});
  first.openAccount(a); second.openAccount(a);
  first.save(payload(a.sub, 'new-first'));
  assert.throws(() => second.save(payload(a.sub, 'stale-second')), error => error.code === 'WORKSPACE_CONFLICT');
  assert.equal(second.isBlocked, true);
  assert.equal(second.openAccount(b), null);
  second.save(payload(b.sub, 'own-b'));
  assert.equal(second.markChangedExternally(accountWorkspaceKey(a)), false);
  assert.equal(second.isBlocked, false);
  assert.equal(second.markChangedExternally(accountWorkspaceKey(b)), true);
  assert.equal(second.isBlocked, true);
  assert.equal(second.openAccount(b).data.assets[0].id, 'own-b');
  assert.equal(second.isBlocked, false);
  assert.equal(second.markChangedExternally(null), true, 'localStorage.clear blocks the active revision');
});

test('failed writes preserve original records and failed opens cannot keep a previous account active', () => {
  const storage = memoryStorage(), manager = createAccountWorkspaces({storage});
  manager.openAccount(a); manager.save(payload(a.sub, 'kept-a'));
  const originalSet = storage.setItem;
  storage.setItem = () => { throw Error('Quota exceeded'); };
  assert.throws(() => manager.save(payload(a.sub, 'lost-a')), error => error.code === 'STORAGE_UNAVAILABLE');
  storage.setItem = originalSet;
  assert.equal(manager.openAccount(a).data.assets[0].id, 'kept-a');
  storage.setItem(accountWorkspaceKey(b), '{invalid');
  assert.throws(() => manager.openAccount(b), error => error.code === 'INVALID_WORKSPACE');
  assert.equal(manager.activeSub, b.sub);
  assert.equal(manager.hasSavedWorkspace, true);
  assert.throws(() => manager.save(payload(a.sub, 'stale-a')), error => error.code === 'ACCOUNT_WORKSPACE_MISMATCH');
  assert.equal(storage.getItem(accountWorkspaceKey(a)).includes('kept-a'), true);
});

test('remembered profiles omit OAuth credentials and explicit credential envelopes are rejected', () => {
  const storage = memoryStorage(), manager = createAccountWorkspaces({storage});
  const user = {...a, access_token: 'access-secret', refresh_token: 'refresh-secret', id_token: 'id-secret', sessionToken: 'cookie-secret'};
  manager.openAccount(user);
  manager.save({...payload(a.sub, 'a-record'), profile: user});
  const stored = storage.getItem(accountWorkspaceKey(a));
  assert.doesNotMatch(stored, /access-secret|refresh-secret|id-secret|cookie-secret/);
  assert.deepEqual(JSON.parse(stored).profile, a);
  assert.throws(() => manager.save({...payload(a.sub, 'a-record'), refresh_token: 'secret'}), error => error.code === 'WORKSPACE_CREDENTIALS_REJECTED');
});
