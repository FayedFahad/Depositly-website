import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCloudBackup} from '../assets/cloud-sync.js';
const backup=()=>({format:'depositly-google-drive',version:1,data:{scope:'all',assets:[],paid:{}}});
test('cloud data validation rejects malformed envelopes and reminder settings', () => {
  assert.throws(() => validateCloudBackup('{'), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), version: 2}), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), data: {...backup().data, scope: 'selected'}}), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup({...backup(), notificationSettings: {enabled: true, time: '25:00'}}), error => error.code === 'INVALID_BACKUP');
  assert.throws(() => validateCloudBackup(backup(), () => { throw Error('Invalid amounts'); }), error => error.code === 'INVALID_BACKUP');
});
