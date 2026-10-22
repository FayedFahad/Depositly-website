import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStore} from '../assets/workspace-store.js';

const KEY = 'depositly.test';
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[KEY, initial]]);
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}
const store = storage => createWorkspaceStore({storage, key: KEY});

test('a loaded workspace saves successive revisions normally', () => {
  const storage = memoryStorage(), vault = store(storage);
  assert.equal(vault.load(), null);
  vault.save({data: {assets: ['a']}, updatedAt: 'one'});
  vault.save({data: {assets: ['a', 'b']}, updatedAt: 'two'});
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).data.assets, ['a', 'b']);
  assert.equal(vault.isBlocked, false);
});

test('a stale tab cannot overwrite another tab even before a storage event arrives', () => {
  const storage = memoryStorage(JSON.stringify({data: {assets: ['a']}}));
  const first = store(storage), second = store(storage);
  first.load();
  second.load();
  first.save({data: {assets: ['a', 'new-from-first']}});
  assert.throws(() => second.save({data: {assets: ['a', 'stale-second']}}), error => error.code === 'WORKSPACE_CONFLICT');
  assert.equal(second.isBlocked, true);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).data.assets, ['a', 'new-from-first']);
});

test('an external change event latches the block until a deliberate reload', () => {
  const storage = memoryStorage(), vault = store(storage);
  vault.load();
  vault.markChangedExternally();
  assert.equal(vault.isBlocked, true);
  assert.throws(() => vault.save({data: {}}), error => error.code === 'WORKSPACE_CONFLICT');
  vault.load();
  assert.equal(vault.isBlocked, false);
  vault.save({data: {reloaded: true}});
  assert.equal(JSON.parse(storage.getItem(KEY)).data.reloaded, true);
});

test('removing a saved workspace in another tab prevents stale restoration', () => {
  const storage = memoryStorage(), vault = store(storage);
  vault.load();
  vault.save({data: {assets: ['a']}});
  storage.setItem(KEY, null);
  assert.throws(() => vault.save({data: {assets: ['a', 'b']}}), error => error.code === 'WORKSPACE_CONFLICT');
});

test('failed writes keep the revision and allow retry without losing the original', () => {
  const storage = memoryStorage(JSON.stringify({data: {original: true}})), vault = store(storage);
  vault.load();
  const normalWrite = storage.setItem;
  storage.setItem = () => { throw Error('Quota exceeded'); };
  assert.throws(() => vault.save({data: {new: true}}), error => error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(JSON.parse(storage.getItem(KEY)).data.original, true);
  storage.setItem = normalWrite;
  vault.save({data: {new: true}});
  assert.equal(JSON.parse(storage.getItem(KEY)).data.new, true);
});

test('malformed saved copy remains intact until an explicit recovery save', () => {
  const storage = memoryStorage('{broken'), vault = store(storage);
  assert.throws(() => vault.load(), error => error.code === 'INVALID_WORKSPACE');
  assert.equal(storage.getItem(KEY), '{broken');
  vault.save({data: {restoredFromBackup: true}});
  assert.equal(JSON.parse(storage.getItem(KEY)).data.restoredFromBackup, true);
});

test('unopened and unreadable stores cannot overwrite unknown data', () => {
  const storage = memoryStorage(), vault = store(storage);
  assert.throws(() => vault.save({data: {}}), error => error.code === 'WORKSPACE_NOT_LOADED');
  storage.getItem = () => { throw Error('Access denied'); };
  assert.throws(() => vault.load(), error => error.code === 'STORAGE_UNAVAILABLE');
  assert.throws(() => vault.save({data: {}}), error => error.code === 'WORKSPACE_NOT_LOADED');
});
