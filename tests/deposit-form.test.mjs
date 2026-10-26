import test from 'node:test';
import assert from 'node:assert/strict';
import {draftDeposit,firstPayoutEstimate,inferredTenure} from '../assets/deposit-form.js';
import {FDR,Transfer} from '../assets/data-engine.js';

const values={name:'Example deposit',type:'FDR',interestType:'simple',ownership:'self',ownerName:'Example Holder',principal:'300000',rate:'8',tds:'15',cycle:'3',cycleUnit:'months',start:'2026-10-01',first:'2027-01-01',maturity:'2029-10-01',tenureCount:'3',tenureUnit:'years',autoRenew:'on',notes:'Keep this note',reference:'00123'};
test('100-day payout and tenor inputs save the same exact-day FDR contract',()=>{
 for(const change of [{cycle:'100',cycleUnit:'days'},{tenureCount:'100',tenureUnit:'days'}]){
  const a=draftDeposit({...values,...change});assert.equal(a.cycle,100);assert.equal(a.cycleUnit,'days');assert.equal(a.tenureCount,100);assert.equal(a.tenureUnit,'days');assert.equal(a.first,'2027-01-09');assert.equal(a.maturity,'2027-01-09');assert.equal(a.reference,'00123');assert.equal(a.notes,values.notes);assert.equal(firstPayoutEstimate(a),566667);
  assert.deepEqual(FDR.schedule(a,'2027-07-28').map(p=>p.date),['2027-01-09','2027-04-19','2027-07-28']);
 }
});
test('calendar month fractions and clipped term previews use the cash schedule',()=>{
 const quarterly=draftDeposit(values);assert.equal(firstPayoutEstimate(quarterly),510000);
 const clipped=draftDeposit({...values,cycle:'1',first:'2026-10-11',maturity:'2026-10-11',tenureCount:'10',tenureUnit:'days',autoRenew:false});assert.equal(firstPayoutEstimate(clipped),56667);
 for(const count of [1,3,6,12]){const a=draftDeposit({...values,cycle:String(count),first:FDR.months(values.start,count)});assert.equal(firstPayoutEstimate(a),FDR.periodAmount(a,count,'months').net);}
});
test('compound drafts capitalize only at full tenure and require explicit matching terms',()=>{
 const compound=draftDeposit({...values,interestType:'compound',tenureCount:'1',tenureUnit:'years',maturity:'2027-10-01',autoRenew:'on'});assert.equal(compound.interestType,'compound');assert.equal(compound.cycle,12);assert.equal(compound.cycleUnit,'months');assert.equal(compound.first,compound.maturity);assert(Transfer.validAsset({...compound,id:'compound'}));assert.deepEqual(FDR.schedule(compound,'2199-12-31'),[]);
 assert.throws(()=>draftDeposit({...values,interestType:'variable'}),/simple or compound/);
 for(const [key,value] of [['tenureCount','0'],['tenureCount','1.5'],['tenureUnit','weeks']])assert.throws(()=>draftDeposit({...values,interestType:'compound',[key]:value}),/positive whole term/);
 assert.throws(()=>draftDeposit({...values,interestType:'compound',maturity:'2027-10-01'}),/matching its maturity/);
});
test('legacy calendar tenures remain calendar terms when changing interest type',()=>{
 const legacy={...values,start:'2024-01-01',first:'2024-02-01',maturity:'2025-01-01'};delete legacy.tenureCount;delete legacy.tenureUnit;
 const term=inferredTenure(legacy);assert.deepEqual(term,{count:1,unit:'years'});
 const a=draftDeposit({...legacy,tenureCount:term.count,tenureUnit:term.unit,principal:'100000',rate:'10',tds:'10',interestType:'compound',autoRenew:false});assert.equal(FDR.schedule(a,a.maturity)[0].net,900000);
 assert.deepEqual(inferredTenure({...legacy,maturity:'2024-04-10'}),{count:100,unit:'days'});
 assert.deepEqual(inferredTenure({...legacy,maturity:'2024-04-09'}),{count:99,unit:'days'});
 assert.deepEqual(inferredTenure({...legacy,maturity:'2027-01-01'}),{count:3,unit:'years'});
 for(const [start,count,net] of [['2025-01-01',365,912500],['2024-01-01',366,915000]]){
  const explicit={...legacy,start,first:start==='2024-01-01'?'2025-01-01':'2026-01-01',maturity:start==='2024-01-01'?'2025-01-01':'2026-01-01',tenureCount:count,tenureUnit:'days'};
  assert.deepEqual(inferredTenure(explicit),{count,unit:'days'},'Explicit day terms win over matching calendar dates');
  const day=draftDeposit({...explicit,principal:'100000',rate:'10',tds:'10',interestType:'compound',autoRenew:false});assert.equal(day.tenureCount,count);assert.equal(day.tenureUnit,'days');assert.equal(FDR.schedule(day,day.maturity)[0].net,net);
  const renamed=draftDeposit({...day,name:'Renamed explicit day term',principal:'100000',autoRenew:false},day);assert.equal(renamed.tenureCount,count);assert.equal(renamed.tenureUnit,'days');assert.equal(FDR.schedule(renamed,renamed.maturity)[0].net,net);
 }
});
test('savings certificates never renew and investment names stay user supplied',()=>{
 for(const interestType of ['simple','compound']){const a=draftDeposit({...values,type:'NSC',interestType,renewalStop:'2032-10-01'});assert.equal(a.autoRenew,false);assert(!Object.hasOwn(a,'renewalStop'));assert.equal(a.name,values.name);}
 const named=draftDeposit({...values,name:'',bankName:'A Selected Bank'});assert.equal(named.name,'','Choosing a bank cannot invent an investment name');
});
