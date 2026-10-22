import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {FDR, Transfer, emptyState, formatMoney, events, eventsRange, scheduleRange, eventById, eventHorizon, summary, forecast, upsertAsset, deleteAsset, recordPayment, removePayment, normalizeBackup, createCloudBackup, BankCatalog} from '../assets/data-engine.js';

const on = '2026-10-22';
const base = {id: 'monthly', type: 'FDR', name: 'Monthly deposit', ownerName: 'Owner', ownership: 'self', principal: 20000000, rate: 11.77, tds: 10, cycle: 1, cycleUnit: 'months', start: '2026-09-13', first: '2026-10-13', maturity: '2029-09-13', reference: '001234', notes: 'Keep the exact rate'};
const json = value => JSON.parse(JSON.stringify(value));
const androidPath = process.env.DEPOSITLY_ANDROID_SOURCE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Depositly/app/assets/index.html');

test('financial calculations and backups match the Android source', {skip: !fs.existsSync(androidPath)}, () => {
  const html = fs.readFileSync(androidPath, 'utf8'), android = vm.createContext({});
  for (const match of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].slice(0, 2)) vm.runInContext(match[1], android);
  const samples = [base,
    {...base, id: 'nsc', type: 'NSC', cycle: 3, first: '2026-12-13'},
    {...base, id: 'irregular', first: '2026-10-20', maturity: '2027-02-17'},
    {...base, id: 'hundred', cycle: 100, cycleUnit: 'days', first: FDR.days(base.start, 100), maturity: FDR.days(base.start, 100), tenureCount: 100, tenureUnit: 'days', autoRenew: true},
    {...base, id: 'renew', maturity: '2026-10-13', tenureCount: 1, tenureUnit: 'months', autoRenew: true},
    {...base, id: 'stop', maturity: '2026-10-13', tenureCount: 1, tenureUnit: 'months', autoRenew: true, renewalStop: '2027-01-13'},
    {...base, id: 'leap', start: '2024-02-29', first: '2024-03-29', maturity: '2025-02-28', tenureCount: 1, tenureUnit: 'years', autoRenew: true},
    {...base, id: 'endmonth', start: '2026-01-31', first: '2026-02-28', maturity: '2026-02-28', tenureCount: 1, tenureUnit: 'months', autoRenew: true}
  ];
  for (const asset of samples) {
    assert.equal(Transfer.validAsset(asset), android.Transfer.validAsset(asset));
    for (const horizon of [1, 30, 90, 100, 180, 360]) assert.deepEqual(FDR.amount(asset, horizon), json(android.FDR.amount(asset, horizon)));
    for (const through of ['2026-10-22', '2027-02-28', '2028-02-29', '2029-12-31']) {
      assert.deepEqual(FDR.schedule(asset, through), json(android.FDR.schedule(asset, through)));
      assert.equal(FDR.nextMaturity(asset, through), android.FDR.nextMaturity(asset, through));
      for (const from of ['2024-01-01', '2026-10-13', '2027-01-01']) {
        if (from > through) continue;
        assert.deepEqual(scheduleRange(asset, {from, through}), FDR.schedule(asset, through).filter(event => event.date >= from), `range parity ${asset.id}: ${from}–${through}`);
      }
    }
  }
  const state = {...emptyState(), assets: samples, extension: {retained: true}};
  const event = FDR.schedule(base, on)[0];
  state.paid[event.id] = {amount: event.net - 50, date: on, snapshot: Transfer.snapshot(event)};
  const exported = Transfer.exportData(state, undefined, '2026-10-22T00:00:00.000Z');
  assert.deepEqual(exported, json(android.Transfer.exportData(state, undefined, '2026-10-22T00:00:00.000Z')));
  assert.deepEqual(Transfer.migrate(exported), json(android.Transfer.migrate(exported)));
  assert.equal(Transfer.instrumentCSV(state), android.Transfer.instrumentCSV(state));
  assert.deepEqual(Transfer.readInstrumentCSV(Transfer.instrumentCSV(state)), json(android.Transfer.readInstrumentCSV(android.Transfer.instrumentCSV(state))));
});

test('360-day arithmetic, tax rounding and whole-unit presentation preserve exact data', () => {
  assert.deepEqual(FDR.amount(base, 30), {gross: 196167, tax: 19617, net: 176550});
  assert.equal(formatMoney(176550), '৳1,766');
  assert.equal(formatMoney(10000001), '৳1,00,001');
  assert.equal(formatMoney(10000001, {...emptyState(), currency: 'USD', numberFormat: 'international'}), '$100,001');
  assert.equal(FDR.months('2026-01-31', 1), '2026-02-28');
  assert.equal(FDR.months('2024-02-29', 12), '2025-02-28');
  const state = {...emptyState(), assets: [base]};
  const backup = Transfer.exportData(recordPayment(state, 'monthly:2026-10-13', {amount: 176550, date: on}));
  assert.equal(backup.paid['monthly:2026-10-13'].amount, 176550);
  assert.equal(backup.assets[0].rate, 11.77);
});

test('Self totals exclude Others while the calendar keeps both owners', () => {
  const other = {...base, id: 'other', ownership: 'others', ownerName: 'Family', principal: 90000000};
  let state = {...emptyState(), assets: [base, other]};
  state = recordPayment(state, 'monthly:2026-10-13', {amount: 176550, date: on});
  state = recordPayment(state, 'other:2026-10-13', {amount: 500000, date: on});
  const totals = summary(state, on);
  assert.equal(totals.principal, base.principal);
  assert.equal(totals.activeCount, 1);
  assert.equal(totals.received, 176550);
  assert.equal(totals.monthlyIncome, 176550);
  assert.equal(forecast(state, 360, on).net, FDR.amount(base, 360).net);
  assert.equal(events(state, '2026-10-31').length, 2);
  assert(totals.upcoming.every(event => event.asset.id === base.id));
  assert.equal(totals.allocations[0].percent, 100);
});

test('editing an investment preserves historical receipts and snapshots', () => {
  let state = {...emptyState(), assets: [base]};
  state = recordPayment(state, 'monthly:2026-10-13', {amount: 176550, date: on, notes: 'Paid exactly'});
  const before = JSON.stringify(state);
  const edited = {...base, name: 'Renamed', first: '2026-10-20'};
  const next = upsertAsset(state, edited);
  assert.equal(JSON.stringify(state), before, 'CRUD helpers must not mutate current state');
  const historical = events(next).find(event => event.id === 'monthly:2026-10-13');
  assert.equal(historical.historical, true);
  assert.equal(historical.asset.name, 'Monthly deposit');
  assert.equal(Transfer.migrate(Transfer.exportData(next)).paid[historical.id].snapshot.expected, 176550);
  assert.equal(Object.keys(removePayment(next, historical.id).paid).length, 0);
  assert.equal(deleteAsset(next, base.id).assets.length, 0);
  assert.equal(Object.keys(deleteAsset(next, base.id).paid).length, 0);
});

test('backups preserve phone preferences, aliases and unknown fields', () => {
  const state = {...emptyState(), currency: 'USD', numberFormat: 'international', dark: true, defaultDepositView: 'grid', assets: [{...base, type: 'NSC'}], customPreference: {future: true}};
  const cloud = createCloudBackup(state, {enabled: true, time: '08:45'});
  assert.equal(cloud.data.assets[0].type, 'Sanchaypatra');
  assert.equal(cloud.data.exportedAt, undefined);
  const restored = normalizeBackup(JSON.stringify(cloud));
  assert.deepEqual(restored.data, state);
  assert.deepEqual(restored.notificationSettings, {enabled: true, time: '08:45'});
  assert.equal(BankCatalog.length, 69);
  assert(BankCatalog.every(bank => bank.id && bank.name && !bank.logo));
  const raw = Transfer.exportData(state);
  assert.deepEqual(Transfer.migrate(raw), state, 'Android manual import reads the raw Transfer envelope');
  assert.deepEqual(normalizeBackup('\uFEFF' + JSON.stringify(raw)).data, state, 'UTF-8 BOM from a file is accepted');
  const withFutureReminder = createCloudBackup(state, {enabled: true, time: '08:45', futurePreference: {vibrate: true}});
  assert.deepEqual(normalizeBackup(withFutureReminder).notificationSettings.futurePreference, {vibrate: true});
});

test('malformed backup and payment data are rejected before they can replace records', () => {
  const state = {...emptyState(), assets: [base]};
  assert.throws(() => normalizeBackup('{bad json'), /valid JSON/);
  assert.throws(() => normalizeBackup({...Transfer.exportData(state), minReaderVersion: 99}), /newer version/);
  assert.throws(() => normalizeBackup({...Transfer.exportData(state), assets: [base, base]}), /duplicate/);
  assert.throws(() => normalizeBackup({...Transfer.exportData(state), assets: [{...base, first: '2026-02-30'}]}), /invalid/);
  assert.throws(() => normalizeBackup({...createCloudBackup(state), notificationSettings: {enabled: true, time: '25:00'}}), /reminder/);
  assert.throws(() => recordPayment(state, 'monthly:2026-10-13', {amount: 1.5, date: on}), /valid amount/);
  assert.throws(() => upsertAsset(state, {...base, ownership: 'others', ownerName: ''}), /Check/);
  assert.throws(() => Transfer.merge({...state, currency: 'BDT'}, {...state, currency: 'USD'}), /Currencies differ/);
});

test('renewal produces interest per term and returns principal only at the stop date', () => {
  const renewing = {...base, maturity: '2026-10-13', tenureCount: 1, tenureUnit: 'months', autoRenew: true, renewalStop: '2027-01-13'};
  const list = FDR.schedule(renewing, '2028-01-01');
  assert.equal(list.filter(event => event.principal).length, 1);
  assert.equal(list.at(-1).date, renewing.renewalStop);
  assert.equal(list.at(-1).net, base.principal);
  assert.equal(new Set(list.map(event => event.id)).size, list.length);
});

test('range lookups skip a century of daily renewals and preserve old or future receipts', () => {
  const daily = {...base, id: 'daily', start: '1900-01-01', first: '1900-01-02', maturity: '1900-01-02', tenureCount: 1, tenureUnit: 'days', cycle: 1, cycleUnit: 'days', autoRenew: true};
  assert(Transfer.validAsset(daily));
  const list = scheduleRange(daily, {from: '2026-10-01', through: '2026-10-31'});
  assert.equal(list.length, 31);
  assert.equal(list[0].date, '2026-10-01');
  assert.equal(list.at(-1).date, '2026-10-31');
  const state = {...emptyState(), assets: [daily]};
  const record = recordPayment(state, 'daily:2026-10-22', {amount: 750, date: '2026-10-22'});
  assert.equal(eventById(record, 'daily:2026-10-22').net, FDR.amount(daily, 1).net);
  assert.equal(eventsRange(record, {from: '2026-10-01', through: '2026-10-31'}).length, 31);
  assert.equal(eventsRange(record, {from: '2027-01-01', through: '2027-01-02', includeAllReceipts: true}).length, 3);
});

test('default events bound future generation but keep long-cycle next payouts and future receipts', () => {
  const distant = {...base, id: 'distant', start: '2026-01-01', first: '2036-01-01', maturity: '2046-01-01', cycle: 120, cycleUnit: 'months', tenureCount: 20, tenureUnit: 'years'};
  const state = {...emptyState(), assets: [base, distant]};
  const list = events(state);
  assert(list.some(event => event.id === 'distant:2036-01-01'));
  const future = recordPayment(state, 'monthly:2029-01-13', {amount: 100, date: '2029-01-13'});
  assert(events(future).some(event => event.id === 'monthly:2029-01-13'));
  assert(events(future).filter(event => event.asset.id === base.id && !future.paid[event.id]).every(event => event.date <= eventHorizon()));
});
