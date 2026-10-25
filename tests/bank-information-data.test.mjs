import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {Transfer, emptyState, normalizeBackup, createCloudBackup, upsertBankAccount, deleteBankAccount, bankAccountText, BankCatalog} from '../assets/data-engine.js';

const sample = {id: 'bank1', bankId: 'ab-bank-plc', bankName: 'AB Bank PLC', accountTitle: 'Sample Holder', accountNumber: '00123456789', branchName: 'Main branch', routingNumber: '000123456', accountType: 'Savings'};
const json = value => JSON.parse(JSON.stringify(value));
const androidPath = process.env.DEPOSITLY_ANDROID_SOURCE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Depositly/app/assets/index.html');

test('legacy imports default to no bank accounts and current fields preserve exact text', () => {
  assert.deepEqual(Transfer.migrate({version: 2, assets: [], paid: {}}).bankAccounts, []);
  const state = Transfer.migrate({...emptyState(), bankAccounts: [sample]});
  assert.deepEqual(state.bankAccounts, [sample]);
  assert.notEqual(state.bankAccounts[0], sample);
  assert(Transfer.validBankAccount({...sample, bankId: undefined, accountType: undefined}));
  assert(Transfer.validBankAccount({...sample, bankId: '', accountType: ''}));
  assert(Transfer.validBankAccount({...sample, accountNumber: 'AB-001 234'}));
  assert(BankCatalog.some(bank => bank.id === sample.bankId));
});

test('bank account validation rejects malformed lists and single-line fields', () => {
  for (const key of ['bankName', 'accountTitle', 'accountNumber', 'branchName', 'routingNumber']) {
    for (const value of ['', '   ', undefined, 123, null]) assert.equal(Transfer.validBankAccount({...sample, [key]: value}), false, key);
  }
  for (const key of ['bankId', 'bankName', 'accountTitle', 'accountNumber', 'branchName', 'routingNumber', 'accountType']) {
    for (const value of ['\n', '\r', '\t', '\0', '\x7f', '\x85', '\u2028', '\u2029']) assert.equal(Transfer.validBankAccount({...sample, [key]: 'a' + value + 'b'}), false, key);
  }
  for (const [key, max] of [['bankId', 100], ['bankName', 150], ['accountTitle', 120], ['accountNumber', 100], ['branchName', 150], ['routingNumber', 100], ['accountType', 100]]) {
    assert.equal(Transfer.validBankAccount({...sample, [key]: 'a'.repeat(max + 1)}), false, key);
  }
  for (const id of ['', 'bad/id', 'bad:id', 'a'.repeat(101)]) assert.equal(Transfer.validBankAccount({...sample, id}), false);
  for (const bankAccounts of [null, {}, 'bad', [sample, sample], [{...sample, accountNumber: 123}], Array.from({length: 501}, (_, index) => ({...sample, id: 'bank' + index}))]) {
    assert.throws(() => Transfer.migrate({...emptyState(), bankAccounts}), /bank account/);
  }
});

test('bank CRUD preserves deposits and receipts without mutating existing account data', () => {
  const state = emptyState(), before = JSON.stringify(state), {id, ...draft} = sample;
  const added = upsertBankAccount(state, draft);
  assert.equal(JSON.stringify(state), before);
  assert(Transfer.validBankAccount(added.bankAccounts[0]));
  assert.equal(added.bankAccounts[0].accountNumber, sample.accountNumber);
  assert.equal(added.bankAccounts[0].routingNumber, sample.routingNumber);
  assert.equal(added.assets, state.assets);
  assert.equal(added.paid, state.paid);
  const edited = upsertBankAccount(added, {...added.bankAccounts[0], accountType: 'Current'});
  assert.equal(edited.bankAccounts.length, 1);
  assert.equal(edited.bankAccounts[0].id, added.bankAccounts[0].id);
  assert.equal(added.bankAccounts[0].accountType, 'Savings');
  assert.deepEqual(deleteBankAccount(edited, edited.bankAccounts[0].id).bankAccounts, []);
  assert.throws(() => upsertBankAccount(state, {...sample, accountTitle: ''}), /Choose a bank/);
  const full = {...state, bankAccounts: Array.from({length: 500}, (_, index) => ({...sample, id: 'limit' + index}))};
  assert.throws(() => upsertBankAccount(full, sample), /500 bank accounts/);
  assert.equal(upsertBankAccount(full, {...full.bankAccounts[0], accountType: 'Current'}).bankAccounts.length, 500);
});

test('full and cloud backups include bank accounts while selected deposit exports and CSV exclude them', () => {
  const state = {...emptyState(), bankAccounts: [sample]};
  const backup = Transfer.exportData(state);
  assert.deepEqual(Transfer.migrate(JSON.parse(JSON.stringify(backup))).bankAccounts, [sample]);
  assert.deepEqual(normalizeBackup(createCloudBackup(state)).data, state);
  assert.notEqual(backup.bankAccounts[0], sample);
  const selected = Transfer.exportData(state, []);
  assert.equal(Object.hasOwn(selected, 'bankAccounts'), false);
  assert.equal(Transfer.instrumentCSV(state).includes(sample.accountNumber), false);
  assert.equal(Transfer.instrumentCSV(state).includes(sample.accountTitle), false);
});

test('bank merges are duplicate-safe, keep current conflicts and enforce the account limit', () => {
  const state = {...emptyState(), bankAccounts: [sample]}, second = {...sample, id: 'bank2', accountNumber: '00987654321'};
  const incoming = {...emptyState(), bankAccounts: [{...sample, accountTitle: 'Changed elsewhere'}, second]};
  const merged = Transfer.merge(state, incoming);
  assert.equal(merged.bankAdded, 1);
  assert.equal(merged.bankDuplicates, 0);
  assert.equal(merged.bankConflicts, 1);
  assert.deepEqual(merged.state.bankAccounts, [sample, second]);
  assert.deepEqual(state.bankAccounts, [sample]);
  const duplicate = Transfer.merge(state, state);
  assert.equal(duplicate.bankDuplicates, 1);
  assert.equal(duplicate.bankAdded, 0);
  assert.equal(duplicate.bankConflicts, 0);
  assert.deepEqual(Transfer.merge(state, emptyState()).state.bankAccounts, [sample]);
  const full = {...emptyState(), bankAccounts: Array.from({length: 500}, (_, index) => ({...sample, id: 'limit' + index}))};
  assert.throws(() => Transfer.merge(full, state), /500-bank-account/);
});

test('sharing uses only the five requested text fields in their exact order', () => {
  assert.equal(bankAccountText(sample), 'Account Title: Sample Holder\nBank Name: AB Bank PLC\nBranch Name: Main branch\nAccount Number: 00123456789\nRouting Number: 000123456');
});

test('bank validation, backups and merge results match Android', {skip: !fs.existsSync(androidPath)}, () => {
  const android = vm.createContext({}), html = fs.readFileSync(androidPath, 'utf8');
  for (const match of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].slice(0, 2)) vm.runInContext(match[1], android);
  const state = {...emptyState(), bankAccounts: [sample]}, timestamp = '2026-10-25T00:00:00.000Z';
  for (const account of [sample, {...sample, accountType: undefined}, {...sample, routingNumber: 123}, {...sample, accountNumber: 'line\nbreak'}]) {
    assert.equal(Transfer.validBankAccount(account), android.Transfer.validBankAccount(account));
  }
  for (const selection of [undefined, []]) assert.deepEqual(Transfer.exportData(state, selection, timestamp), json(android.Transfer.exportData(state, selection, timestamp)));
  const backup = Transfer.exportData(state, undefined, timestamp);
  assert.deepEqual(Transfer.migrate(backup), json(android.Transfer.migrate(backup)));
  assert.deepEqual(json(android.Transfer.migrate(Transfer.exportData(state)).bankAccounts), [sample]);
  const incoming = {...emptyState(), bankAccounts: [{...sample, id: 'bank2'}, {...sample, accountType: 'Current'}]};
  assert.deepEqual(Transfer.merge(state, incoming), json(android.Transfer.merge(state, incoming)));
});
