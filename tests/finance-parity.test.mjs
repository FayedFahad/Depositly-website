import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {FDR, Transfer, emptyState, scheduleRange, events, eventsRange, eventById, currentInvestmentBalance, cashEventLabel, forecast, summary, createCloudBackup, normalizeBackup, recordPayment, removePayment} from '../assets/data-engine.js';

const json = value => JSON.parse(JSON.stringify(value));
const androidPath = process.env.DEPOSITLY_ANDROID_SOURCE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Depositly/app/assets/index.html');
const base = {id:'example',type:'FDR',name:'Example deposit',ownerName:'Sample Holder',ownership:'self',principal:30000000,rate:8,tds:15,start:'2026-10-01',first:'2027-01-09',maturity:'2027-01-09',cycle:100,cycleUnit:'days',tenureCount:100,tenureUnit:'days',autoRenew:true};
const state = assets => ({...emptyState(),assets});
const compound = {...base,id:'compound',interestType:'compound',principal:10000000,rate:10,tds:10,start:'2024-01-01',first:'2025-01-01',maturity:'2025-01-01',cycle:12,cycleUnit:'months',tenureCount:1,tenureUnit:'years'};

test('web schedules, range windows, compound balances and interchange match the current phone', {skip:!fs.existsSync(androidPath)}, () => {
  const android = vm.createContext({}), html = fs.readFileSync(androidPath,'utf8');
  for (const block of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].slice(0,2)) vm.runInContext(block[1],android);
  const samples = [base,{...base,id:'legacy-quarter',cycle:3,cycleUnit:'months',first:'2027-01-01'},
    {...base,id:'month-end',start:'2026-01-31',first:'2026-02-28',maturity:'2026-02-28',cycle:1,cycleUnit:'months',tenureCount:1,tenureUnit:'months'},
    {...base,id:'custom-day',first:'2026-10-15',maturity:'2027-03-30',cycle:14,tenureCount:180},
    {...base,id:'short-term',first:'2026-10-11',maturity:'2026-10-11',cycle:1,cycleUnit:'months',tenureCount:10},
    {...base,id:'half-year',first:'2027-04-01',maturity:'2027-10-01',cycle:6,cycleUnit:'months',tenureCount:1,tenureUnit:'years'},
    {...base,id:'nsc',type:'NSC',autoRenew:true},compound,{...compound,id:'compound-stop',renewalStop:'2027-01-01'},
    {...compound,id:'compound-no-renew',autoRenew:false},{...base,id:'day-compound',interestType:'compound'}];
  for (const asset of samples) {
    assert.equal(Transfer.validAsset(asset),android.Transfer.validAsset(asset));
    for (const through of ['2026-10-01','2027-01-09','2027-04-19','2027-07-28','2028-02-29']) {
      assert.deepEqual(FDR.schedule(asset,through),json(android.FDR.schedule(asset,through)),asset.id);
      for (const from of ['2024-01-01','2026-10-01','2027-01-09','2027-04-01']) if(from<=through) {
        const expected=FDR.schedule(asset,through).filter(event=>event.date>=from);
        assert.deepEqual(scheduleRange(asset,{from,through}),expected,asset.id+' range '+from+'–'+through);
        assert.deepEqual(scheduleRange(asset,{from,through,limit:1}),expected.slice(0,1),asset.id+' limited range');
      }
      assert.equal(FDR.compoundBalance(asset,through),android.FDR.compoundBalance(asset,through));
    }
  }
  const input=state(samples),date='2026-10-26T00:00:00.000Z';
  assert.deepEqual(Transfer.exportData(input,undefined,date),json(android.Transfer.exportData(input,undefined,date)));
  assert.deepEqual(Transfer.migrate(Transfer.exportData(input)),json(android.Transfer.migrate(android.Transfer.exportData(input))));
  assert.equal(Transfer.instrumentCSV(input),android.Transfer.instrumentCSV(input));
  assert.deepEqual(Transfer.readInstrumentCSV(Transfer.instrumentCSV(input)),json(android.Transfer.readInstrumentCSV(android.Transfer.instrumentCSV(input))));
});

test('exact day payouts, month fractions and original calendar anchors use the confirmed rules', () => {
  assert.deepEqual(FDR.schedule(base,'2027-07-28').map(event=>[event.date,event.net]),[['2027-01-09',566667],['2027-04-19',566667],['2027-07-28',566667]]);
  for(const months of [1,3,6,12]) {const gross=Math.round(10000000*.1*months/12);assert.equal(FDR.periodAmount({...base,principal:10000000,rate:10,tds:15},months,'months').net,gross-Math.round(gross*.15));}
  const monthly={...base,start:'2026-01-31',first:'2026-02-28',maturity:'2026-02-28',cycle:1,cycleUnit:'months',tenureCount:1,tenureUnit:'months'};
  assert.deepEqual(FDR.schedule(monthly,'2026-05-31').map(event=>event.date),['2026-02-28','2026-03-31','2026-04-30','2026-05-31']);
  const nsc={...base,type:'NSC',autoRenew:true};
  assert.equal(FDR.schedule(nsc,'2028-01-01').length,2);
  assert.equal(FDR.schedule(nsc,'2028-01-01').at(-1).principal,base.principal);
});

test('legacy repairs preserve receipt snapshots and require persistence only for actual financial changes', () => {
  const old={...base,cycle:3,cycleUnit:'months',first:'2027-01-01'},input=state([old]);
  input.paid['example:2027-01-01']={amount:510000,date:'2027-01-01',notes:'Original receipt'};
  assert(Transfer.needsMigration(input));
  const repaired=Transfer.migrate(input);
  assert.equal(repaired.assets[0].cycle,100);assert.equal(repaired.assets[0].first,'2027-01-09');
  assert.equal(repaired.paid['example:2027-01-01'].snapshot.expected,510000);
  assert.equal(repaired.paid['example:2027-01-01'].amount,510000);
  assert(!Transfer.needsMigration(repaired));assert(!Transfer.needsMigration(state([base])));
  const plainLegacy={...base};delete plainLegacy.cycleUnit;delete plainLegacy.autoRenew;
  assert(Transfer.needsMigration(state([plainLegacy])));
  assert(!Transfer.needsMigration(Transfer.migrate(state([plainLegacy]))));
});

test('compound totals and forecasts use only completed net capitalizations and safe unavailable states', () => {
  const input=state([compound]),on='2026-10-26';
  assert.equal(currentInvestmentBalance(compound,on).amount,11881000);
  assert.equal(summary(input,on).principal,11881000);assert.equal(summary(input,on).fdr,11881000);
  assert.equal(forecast(input,30,on).net,89107);assert.equal(forecast(input,30,on).assets[0].currentBalance,11881000);
  assert.equal(input.assets[0].principal,10000000);assert.deepEqual(FDR.schedule(compound,'2199-12-31'),[]);
  const stopped={...compound,renewalStop:'2027-01-01'},cash=FDR.schedule(stopped,'2027-01-01');
  assert.equal(cash.length,2);assert.equal(cash[0].net,1069290);assert.equal(cash[1].principal,11881000);
  const overflow=state([{...compound,principal:1e13}]);
  assert.equal(currentInvestmentBalance(overflow.assets[0],on).amount,null);
  assert.equal(summary(overflow,on).principal,null);assert.equal(forecast(overflow,30,on).net,null);
  assert.equal(summary(overflow,on).balanceErrors.length,1);assert.equal(forecast(overflow,30,on).errors.length,1);
});

test('compound backups and CSV require reader 6 and explicit unambiguous tenure', () => {
  const input=state([compound]),backup=createCloudBackup(input);
  assert.equal(backup.data.minReaderVersion,6);assert.equal(normalizeBackup(backup).data.assets[0].interestType,'compound');
  assert.throws(()=>normalizeBackup({...backup,data:{...backup.data,minReaderVersion:5}}),/reader version 6/);
  const csv=Transfer.instrumentCSV(input);assert.match(csv,/Compound FDR/);assert.match(csv,/,"Interest type"/);
  assert.equal(Transfer.readInstrumentCSV(csv).assets[0].interestType,'compound');
  for(const field of ['tenureCount','tenureUnit']) {
    const missing={...compound};delete missing[field];assert(!Transfer.validAsset(missing));assert.throws(()=>Transfer.migrate(state([missing])),/tenure/);
  }
  const year={...compound,autoRenew:false,start:'2024-01-01',first:'2025-01-01',maturity:'2025-01-01'};
  assert.equal(FDR.schedule(year,year.maturity)[0].net,900000,'A leap-year calendar tenure uses 12/12');
});

test('all cash APIs credit legacy receipts to the corrected term and preserve the remaining-payment receipt', () => {
  const old={...base,cycle:3,cycleUnit:'months',first:'2027-01-01'},legacy=FDR.legacySchedule(old,'2027-01-09');
  let input=state([base]);
  for(const event of legacy.filter(event=>!event.principal)) input.paid[event.id]={amount:event.net,date:event.date,snapshot:Transfer.snapshot(event)};
  const id='example:2027-01-09',original=json(input.paid);
  assert.equal(events(input,'2027-01-09').find(event=>event.id===id).net,11334);
  assert.equal(eventsRange(input,{from:'2027-01-09',through:'2027-01-09'}).find(event=>event.id===id).net,11334,'Window credit includes earlier receipts outside that window');
  assert.equal(eventById(input,id).net,11334);assert.equal(cashEventLabel(eventById(input,id)),'Remaining interest');
  input=recordPayment(input,id,{amount:11334,date:'2027-01-09'});
  assert.equal(input.paid[id].snapshot.expected,11334);assert.equal(cashEventLabel(eventById(input,id)),'Remaining interest');
  assert.deepEqual(Object.fromEntries(Object.entries(input.paid).filter(([key])=>key!==id)),original);
  const reloaded=Transfer.migrate(Transfer.exportData(input));assert.equal(cashEventLabel(eventById(reloaded,id)),'Remaining interest');
  assert.equal(eventById(removePayment(reloaded,id),id).net,11334);
  const full=state([base]);full.paid[legacy[0].id]={amount:600000,date:legacy[0].date,snapshot:Transfer.snapshot(legacy[0])};
  assert(!eventsRange(full,{from:'2027-01-09',through:'2027-01-09'}).some(event=>event.id===id));
});

test('a covered distant corrected payment is not reintroduced by next-payment fallback', () => {
  const future={...base,id:'future',start:'2030-01-01',first:'2030-04-11',maturity:'2030-04-11'},old={...future,first:'2030-04-01',cycle:3,cycleUnit:'months'};
  const receipt=FDR.legacySchedule(old,future.maturity)[0],input=state([future]);
  input.paid[receipt.id]={amount:600000,date:receipt.date,snapshot:Transfer.snapshot(receipt)};
  const list=events(input,undefined,'2026-10-26');
  assert(!list.some(event=>event.id==='future:2030-04-11'));
  assert(list.some(event=>event.id==='future:2030-07-20'));
});
