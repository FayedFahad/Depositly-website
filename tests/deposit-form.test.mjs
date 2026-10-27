import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {draftDeposit,firstPayoutEstimate,inferredTenure,depositFormChoices} from '../assets/deposit-form.js';
import {FDR,Transfer} from '../assets/data-engine.js';

const values={name:'Example deposit',type:'FDR',interestType:'simple',ownership:'self',ownerName:'Example Holder',bankId:'ab-bank-plc',bankName:'AB Bank PLC',principal:'300000',rate:'8',tds:'15',payoutChoice:'3',start:'2026-10-01',tenureChoice:'3years',autoRenew:'on',notes:'Keep this note',reference:'00123'};
const androidPath=process.env.DEPOSITLY_ANDROID_SOURCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../Depositly/app/assets/index.html');
const customTerm=(count,unit)=>({tenureChoice:'custom',customTenureCount:String(count),customTenureUnit:unit});

test('deposit drafts match the actual phone form across presets, custom terms, edits and interest types',{skip:!fs.existsSync(androidPath)},()=>{
 const html=fs.readFileSync(androidPath,'utf8'),phone=vm.createContext({console});
 for(const block of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].slice(0,2))vm.runInContext(block[1],phone);
 vm.runInContext('const days=FDR.days,months=FDR.months;'+html.slice(html.indexOf('function tenureChoice('),html.indexOf('function linkedDepositsForAccount('))+html.slice(html.indexOf('function draftInvestment('),html.indexOf('function syncInvestmentForm(')),phone);
 const changes=[{}, {payoutChoice:'1'}, {payoutChoice:'6'}, {payoutChoice:'12'}, {payoutChoice:'100'}, {tenureChoice:'100days'},
  {payoutChoice:'custom',customPayoutCount:'90',customPayoutUnit:'days',tenureChoice:'1year',start:'2026-10-27',rate:'8.25'},
  {payoutChoice:'custom',customPayoutCount:'14',customPayoutUnit:'days',...customTerm(180,'days')},
  {payoutChoice:'custom',customPayoutCount:'2',customPayoutUnit:'months',...customTerm(9,'months')},
  {payoutChoice:'1',...customTerm(10,'days')},
  {interestType:'compound',tenureChoice:'1year'}, {interestType:'compound',...customTerm(7,'days')},
  {interestType:'compound',start:'2024-01-01',...customTerm(366,'days'),autoRenew:undefined},
  {type:'NSC'}, {type:'NSC',interestType:'compound'}, {autoRenew:undefined}];
 for(const change of changes){
  const input={...values,...change},old={...draftDeposit(values),id:'existing',renewalStop:'2032-10-01'};
  for(const previous of [undefined,old]){
   phone.input=input;phone.previous=previous;
   const expected=JSON.parse(JSON.stringify(vm.runInContext('draftInvestment(input,previous)',phone))),actual=draftDeposit(input,previous);
   if(!previous)delete expected.id;
   assert.deepEqual(actual,expected,JSON.stringify(change));
   phone.input=actual;assert.equal(depositFormChoices(actual).tenureChoice,vm.runInContext('tenureChoice(input).choice',phone));
  }
 }
});

test('100-day payout and tenure presets save exact-day contracts and preserve supplied fields',()=>{
 for(const change of [{payoutChoice:'100'},{tenureChoice:'100days'},{payoutChoice:'custom',customPayoutCount:'100',customPayoutUnit:'days'},customTerm(100,'days')]){
  const a=draftDeposit({...values,...change});assert.equal(a.cycle,100);assert.equal(a.cycleUnit,'days');assert.equal(a.tenureCount,100);assert.equal(a.tenureUnit,'days');assert.equal(a.first,'2027-01-09');assert.equal(a.maturity,'2027-01-09');assert.equal(a.reference,'00123');assert.equal(a.notes,values.notes);assert.equal(firstPayoutEstimate(a),566667);
  assert.deepEqual(FDR.schedule(a,'2027-07-28').map(p=>p.date),['2027-01-09','2027-04-19','2027-07-28']);
 }
});

test('custom 90-day input derives the screenshot schedule; independent dates cannot change it',()=>{
 const a=draftDeposit({...values,payoutChoice:'custom',customPayoutCount:'90',customPayoutUnit:'days',tenureChoice:'1year',start:'2026-10-27',rate:'8.25',first:'2027-01-01',maturity:'2027-01-01'});
 assert.equal(a.first,'2027-01-25');assert.equal(a.maturity,'2027-10-27');assert.equal(a.tenureUnit,'years');
 assert.deepEqual(FDR.schedule(a,'2028-04-30').map(p=>[p.date,p.net]),[['2027-01-25',525937],['2027-04-25',525937],['2027-07-24',525937],['2027-10-22',525937],['2027-10-27',29219],['2028-01-20',496719],['2028-04-19',525937]]);
 assert.deepEqual(depositFormChoices(a),{payoutChoice:'custom',customPayoutCount:90,customPayoutUnit:'days',tenureChoice:'1year',customTenureCount:1,customTenureUnit:'years'});
});

test('month fractions and clipped term previews use actual cash amounts',()=>{
 assert.equal(firstPayoutEstimate(draftDeposit(values)),510000);
 const clipped=draftDeposit({...values,payoutChoice:'1',...customTerm(10,'days'),autoRenew:undefined});assert.equal(firstPayoutEstimate(clipped),56667);
 for(const count of [1,3,6,12]){const a=draftDeposit({...values,payoutChoice:String(count)});assert.equal(firstPayoutEstimate(a),FDR.periodAmount(a,count,'months').net);}
});

test('compound drafts derive full-term maturity and validate custom inputs',()=>{
 const compound=draftDeposit({...values,interestType:'compound',tenureChoice:'1year'});assert.equal(compound.cycle,12);assert.equal(compound.cycleUnit,'months');assert.equal(compound.first,compound.maturity);assert(Transfer.validAsset({...compound,id:'compound'}));assert.deepEqual(FDR.schedule(compound,'2199-12-31'),[]);
 assert.throws(()=>draftDeposit({...values,interestType:'variable'}),/simple or compound/);
 for(const change of [{customTenureCount:'0'}, {customTenureCount:'1.5'}, {customTenureUnit:'weeks'}])assert.throws(()=>draftDeposit({...values,...customTerm(1,'days'),...change}),/positive whole number/);
 for(const change of [{customPayoutCount:'0'}, {customPayoutCount:'1.5'}, {customPayoutUnit:'weeks'}])assert.throws(()=>draftDeposit({...values,payoutChoice:'custom',customPayoutCount:'14',customPayoutUnit:'days',...change}),/positive whole number/);
});

test('edits retain explicit day contracts, legacy inference and renewal stops like Android',()=>{
 for(const [start,count,net] of [['2025-01-01',365,912500],['2024-01-01',366,915000]]){
  const old={...draftDeposit({...values,start,principal:'100000',rate:'10',tds:'10',...customTerm(count,'days'),autoRenew:undefined}),id:'day-term'};
  assert.deepEqual(inferredTenure(old),{count,unit:'days'});
  const input={...values,...depositFormChoices(old),start,principal:'100000',rate:'10',tds:'10',interestType:'compound',autoRenew:undefined};
  const a=draftDeposit(input,old);assert.equal(a.tenureCount,count);assert.equal(a.tenureUnit,'days');assert.equal(FDR.schedule(a,a.maturity)[0].net,net);
  const renamed=draftDeposit({...input,name:'Renamed'},a);assert.equal(FDR.schedule(renamed,renamed.maturity)[0].net,net);
 }
 for(const years of [1,3])assert.deepEqual(inferredTenure({start:'2024-01-01',maturity:FDR.months('2024-01-01',years*12)}),{count:years,unit:'years'});
 const old={...draftDeposit(values),renewalStop:'2032-10-01'};assert.equal(draftDeposit(values,old).renewalStop,old.renewalStop);
 assert(!Object.hasOwn(draftDeposit({...values,tenureChoice:'1year'},old),'renewalStop'));
 assert(!Object.hasOwn(draftDeposit({...values,autoRenew:undefined},old),'renewalStop'));
});

test('certificates never renew and bank selection leaves the investment name user supplied',()=>{
 for(const interestType of ['simple','compound']){const a=draftDeposit({...values,type:'NSC',interestType});assert.equal(a.autoRenew,false);assert(!Object.hasOwn(a,'renewalStop'));assert.equal(a.name,values.name);}
 assert.equal(draftDeposit({...values,name:'',bankName:'A Selected Bank'}).name,'');
});
