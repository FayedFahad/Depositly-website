import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Transfer,emptyState,summary,forecast,parseBankBalance,bankAccountBalance,createCloudBackup,normalizeBackup,recordPayment} from '../assets/data-engine.js';
import '../assets/sync-registry.js';

const bank={id:'bank-balance',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'Balance Holder',accountNumber:'000012345',routingNumber:'000000012',branchName:'Main',accountType:'Savings'};
const deposit={id:'active-fdr',name:'Current deposit',type:'FDR',ownership:'self',principal:1000000,rate:10,tds:10,cycle:12,cycleUnit:'months',start:'2026-01-01',first:'2027-01-01',maturity:'2027-01-01'};
const on='2026-11-01';

test('bank balances use bounded integer minor units and legacy missing balances mean zero',()=>{
 assert.equal(bankAccountBalance(bank),0);assert.equal(parseBankBalance('12.34'),1234);assert.equal(parseBankBalance('0'),0);assert.equal(parseBankBalance('100000000000'),1e13);
 for(const value of ['', ' ', null, undefined, '-1','0.001','NaN','Infinity','1e3','12,345','100000000000.01'])assert.throws(()=>parseBankBalance(value));
 for(const value of [null,-1,0.01,'1200',Infinity,NaN,1e13+1,Number.MAX_SAFE_INTEGER])assert.equal(Transfer.validBankAccount({...bank,balance:value}),false);
 for(const balance of [undefined,0,1,123456,1e13])assert.equal(Transfer.validBankAccount({...bank,balance}),true);
 const old=Transfer.migrate({...emptyState(),bankAccounts:[bank]});assert.equal(Object.hasOwn(old.bankAccounts[0],'balance'),false,'Reading old data does not invent a stored amount');
});

test('current total adds bank balances to active Self deposits without changing interest or receipt behavior',()=>{
 const state={...emptyState(),assets:[deposit,{...deposit,id:'nsc',type:'NSC',principal:250000},{...deposit,id:'other',ownership:'others',ownerName:'Someone else',principal:9e12},{...deposit,id:'future',start:'2027-01-01',first:'2028-01-01',maturity:'2028-01-01'},{...deposit,id:'finished',start:'2024-01-01',first:'2025-01-01',maturity:'2025-01-01'}],bankAccounts:[{...bank,balance:123456},{...bank,id:'legacy-bank'},{...bank,id:'zero-bank',balance:0}]};
 const totals=summary(state,on);assert.equal(totals.fdr,1000000);assert.equal(totals.nsc,250000);assert.equal(totals.bank,123456);assert.equal(totals.total,1373456);assert.equal(totals.principal,1250000);
 assert.equal(forecast(state,30,on).net,forecast({...state,bankAccounts:[]},30,on).net,'Banks do not accrue forecast interest');
 const linked={...state,assets:[{...deposit,bankAccountId:bank.id}]};const received=recordPayment(linked,deposit.id+':2027-01-01',{amount:75000});assert.equal(received.bankAccounts[0].balance,123456,'Recording a payout does not double-credit manual bank balances');
 assert.equal(summary({...emptyState(),bankAccounts:state.bankAccounts},on).total,123456,'Bank-only workspaces have a current total');
 const compound={...deposit,principal:10000000,start:'2024-01-01',first:'2025-01-01',maturity:'2025-01-01',autoRenew:true,interestType:'compound',tenureCount:1,tenureUnit:'years'};assert.equal(summary({...emptyState(),assets:[compound],bankAccounts:[{...bank,balance:100}]},'2026-01-02').total,11881100);
 const full=Array.from({length:500},(_,i)=>({...deposit,id:'d'+i,principal:1e13})),banks=Array.from({length:500},(_,i)=>({...bank,id:'b'+i,balance:1e13}));assert.equal(summary({...emptyState(),assets:full,bankAccounts:banks},on).total,null,'Combined totals beyond safe integer precision stay unavailable');
});

test('JSON, Google registry, and both-direction phone Bank CSV preserve exact balances and currencies',()=>{
 const state={...emptyState(),currency:'USD',bankAccounts:[{...bank,balance:123456},{...bank,id:'old-bank'}]};
 assert.deepEqual(Transfer.migrate(Transfer.exportData(state)).bankAccounts,state.bankAccounts);assert.deepEqual(normalizeBackup(createCloudBackup(state)).data,state);
 const Sync=globalThis.DepositlySync,doc=Sync.create(createCloudBackup(state),'test',1);assert.deepEqual(normalizeBackup(Sync.backup(doc)).data.bankAccounts,state.bankAccounts);
 assert.deepEqual(Transfer.readBankAccountsCSV(Transfer.bankAccountsCSV(state)).bankAccounts,state.bankAccounts);assert.equal(Transfer.readBankAccountsCSV(Transfer.bankAccountsCSV(state)).currency,'USD');
 assert.equal(Object.hasOwn(Transfer.exportData(state,[]),'bankAccounts'),false);
 const androidPath=process.env.DEPOSITLY_ANDROID_SOURCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../Depositly/app/assets/index.html');
 if(fs.existsSync(androidPath)){const context=vm.createContext({console,Date,Math,JSON,Number,String,Set,Map,Array,Object,Error});for(const script of [...fs.readFileSync(androidPath,'utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].slice(0,2))vm.runInContext(script[1],context);const phone=context.Transfer;assert.deepEqual(JSON.parse(JSON.stringify(phone.readBankAccountsCSV(Transfer.bankAccountsCSV(state)).bankAccounts)),state.bankAccounts);assert.deepEqual(Transfer.readBankAccountsCSV(phone.bankAccountsCSV(state)).bankAccounts,state.bankAccounts);assert.equal(phone.validBankAccount({...bank,balance:-1}),false);}
});

test('bank monetary data participates in currency mismatch, adoption and conflict detection',()=>{
 const usd={...emptyState(),currency:'USD',bankAccounts:[{...bank,balance:0}]},bdt={...emptyState(),bankAccounts:[{...bank,id:'other-bank',balance:1234}]};
 assert.throws(()=>Transfer.merge(usd,bdt),/Currencies differ/);assert.equal(Transfer.merge(usd,bdt,true).currencyMismatch,true);assert.equal(Transfer.merge(emptyState(),usd).state.currency,'USD');
 const current={...emptyState(),bankAccounts:[{...bank,balance:1234}]},changed={...emptyState(),bankAccounts:[{...bank,balance:5678}]};const merged=Transfer.merge(current,changed);assert.equal(merged.bankConflicts,1);assert.equal(merged.state.bankAccounts[0].balance,1234);
 const invalid=createCloudBackup({...emptyState(),bankAccounts:[bank]});invalid.data.bankAccounts[0].balance=-1;assert.throws(()=>normalizeBackup(invalid),/bank account/,'Server and browser share the same malformed-balance rejection');
});
