import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo} from '../assets/demo-data.js';
import {summary,events,isSelf,formatMoney} from '../assets/data-engine.js';

test('demo uses ten lakh of Self principal and exact round payouts across date boundaries',()=>{
 for(const on of ['2026-10-24','2027-02-28','2028-02-29','2027-01-01']){
  const state=makeDemo(on),totals=summary(state,on);
  assert.equal(totals.principal,100000000);
  assert.equal(formatMoney(totals.principal,state),'৳10,00,000');
  assert.equal(totals.monthlyIncome,750000);
  assert(state.assets.every(asset=>asset.principal%10000000===0));
  const schedule=events(state,undefined,on);
  assert(schedule.filter(payment=>isSelf(payment.asset)).every(payment=>payment.net%25000===0),'payouts remain exact multiples of 250 taka without display rounding');
  assert(Object.values(state.paid).every(receipt=>receipt.date<on));
  for(const payment of schedule.filter(payment=>state.paid[payment.id]))assert.equal(state.paid[payment.id].amount,payment.net);
 }
});

test('each demo starts fresh without changing another workspace',()=>{
 const first=makeDemo('2026-10-24');first.assets[0].principal=1;first.paid={};
 const next=makeDemo('2026-10-24');
 assert.equal(next.assets[0].principal,40000000);
 assert(Object.keys(next.paid).length>0);
});
