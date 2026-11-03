import test from 'node:test';
import assert from 'node:assert/strict';
import {Transfer,emptyState,createCloudBackup} from '../assets/data-engine.js';
import {readBackupFile,applyBackupFile} from '../assets/backup-files.js';

const bank={id:'bank-a',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'=Private "Holder"',accountNumber:'000012345',branchName:'Main, North',routingNumber:'000000012',accountType:'Savings',note:'Private note, "verified"\nKeep both lines',balance:12345};
const deposit={id:'deposit-a',name:'Deposit, "One"',type:'FDR',ownership:'self',ownerName:'Holder',principal:1000000,rate:10,tds:10,cycle:1,cycleUnit:'months',start:'2026-01-01',first:'2026-02-01',maturity:'2027-01-01',bankAccountId:bank.id,reference:'000123',notes:'First line\nSecond line'};
const receipt={amount:7500,date:'2026-02-02',notes:'Paid, verified',snapshot:{assetId:deposit.id,name:deposit.name,type:deposit.type,scheduledDate:'2026-02-01',kind:'Interest',gross:8333,tax:833,expected:7500,principal:0,bankAccountId:bank.id,bankAccountSnapshot:{bankName:'Historical Bank',accountTitle:'Recorded holder',accountNumber:'000009876'}}};
const reminders={enabled:true,time:'07:45'};
const source=Transfer.migrate({...emptyState(),assets:[deposit],paid:{'deposit-a:2026-02-01':receipt},bankAccounts:[bank],currency:'USD',numberFormat:'international',dark:true,defaultDepositView:'grid',bankInformationView:'grid',customPreference:'Full backup field'});
const readDeposits=state=>readBackupFile(Transfer.depositsCSV(state,reminders));
const readBanks=state=>readBackupFile(Transfer.bankAccountsCSV(state));
const apply=(current,file,mode='replace')=>applyBackupFile(current,file.backup,{kind:file.kind,preservesBanks:file.preservesBanks,mode});

test('empty or whitespace-only files explain which backup to choose',()=>{
 for(const content of ['', '\uFEFF \r\n\t'])assert.throws(()=>readBackupFile(content),/Choose a JSON or CSV backup with records or saved settings/);
});

test('full JSON and raw JSON recover every record, unknown fields, preferences and reminder settings',()=>{
 const full=readBackupFile('\uFEFF \r\n'+JSON.stringify(createCloudBackup(source,reminders)));
 assert.equal(full.kind,'json');assert.equal(full.preservesBanks,false);assert.deepEqual(full.backup.data,source);assert.deepEqual(full.backup.notificationSettings,reminders);
 const restored=apply(emptyState(),full);assert.deepEqual(restored.state,source);assert.deepEqual(restored.notificationSettings,reminders);assert.equal(restored.merge,null);
 const raw=readBackupFile(JSON.stringify({...Transfer.exportData(source),notificationSettings:reminders}));
 assert.deepEqual(raw.backup.notificationSettings,reminders);assert.deepEqual(raw.backup.data.paid,source.paid);assert.deepEqual(raw.backup.data.bankAccounts,source.bankAccounts);
 assert.throws(()=>readBackupFile(JSON.stringify({...Transfer.exportData(source),notificationSettings:{enabled:true,time:'25:00'}})),/reminder settings/);
 assert.throws(()=>readBackupFile('{broken'),/valid JSON/);
});

test('named CSV backups detect contents and preserve complete deposits, receipts and bank identifiers',()=>{
 const deposits=readDeposits(source),banks=readBanks(source);
 assert.equal(deposits.kind,'deposits');assert.equal(deposits.preservesBanks,true);assert.deepEqual(deposits.backup.data.assets,source.assets);assert.deepEqual(deposits.backup.data.paid,source.paid);assert.deepEqual(deposits.backup.data.bankAccounts,[]);assert.deepEqual(deposits.backup.notificationSettings,reminders);
 assert.equal(banks.kind,'banks');assert.equal(banks.preservesBanks,false);assert.deepEqual(banks.backup.data.bankAccounts,source.bankAccounts);assert.deepEqual(banks.backup.data.assets,[]);assert.deepEqual(banks.backup.data.paid,{});assert.equal(banks.backup.notificationSettings,undefined);
 assert(!Transfer.depositsCSV(source,reminders).includes(bank.accountNumber));assert(!Transfer.bankAccountsCSV(source).includes(deposit.name));
 assert.deepEqual(readBackupFile(' \r\n'+Transfer.bankAccountsCSV(source)).backup.data.bankAccounts,source.bankAccounts);
 assert.throws(()=>readBackupFile(Transfer.bankAccountsCSV(source).replace('"Routing number"','"Missing header"')),/Routing number/);
});

test('bank CSV notes preserve multiline text and formula escaping while legacy files remain accepted',()=>{
 for(const note of ['First line\nSecond line, "quoted"', '=Private note\nSecond line', "'Literal apostrophe", 'a'.repeat(500)]){
  const state={...emptyState(),bankAccounts:[{...bank,note}]},text=Transfer.bankAccountsCSV(state);
  assert.match(text,/"Note"/);
  assert.deepEqual(readBackupFile(text).backup.data.bankAccounts,state.bankAccounts);
 }
 const {note,...legacy}=bank,state={...emptyState(),bankAccounts:[legacy]};
 const text=Transfer.bankAccountsCSV(state);
 assert.doesNotMatch(text,/"Note"/,'Exports without notes retain the existing phone-compatible columns');
 assert.deepEqual(readBackupFile(text).backup.data.bankAccounts,[legacy]);
 const blank=Transfer.csv([[...Transfer.BANK_COLUMNS], [legacy.id,legacy.bankId,legacy.bankName,legacy.accountTitle,legacy.accountNumber,legacy.branchName,legacy.routingNumber,legacy.accountType,'',legacy.balance/100,'card',1,'BDT',2]]);
 assert.deepEqual(readBackupFile(blank).backup.data.bankAccounts,[legacy],'An explicitly empty optional Note column is accepted');
 const invalid=Transfer.csv([[...Transfer.BANK_COLUMNS], [legacy.id,legacy.bankId,legacy.bankName,legacy.accountTitle,legacy.accountNumber,legacy.branchName,legacy.routingNumber,legacy.accountType,'a'.repeat(501),legacy.balance/100,'card',1,'BDT',2]]);
 assert.throws(()=>readBackupFile(invalid),/bank account/);
 assert.equal(Transfer.depositsCSV(source,reminders).includes(bank.note),false,'Bank notes remain outside deposit-only CSVs');
});

test('deposit CSV replacement keeps current banks and bank view while restoring its included settings',()=>{
 const current={...emptyState(),currency:'USD',assets:[{...deposit,id:'old-deposit',name:'Old deposit'}],bankAccounts:[{...bank,accountTitle:'Keep current account'}],bankInformationView:'card',customPreference:'Keep current preference'};
 const before=JSON.stringify(current),result=apply(current,readDeposits(source));
 assert.deepEqual(result.state.assets,source.assets);assert.deepEqual(result.state.paid,source.paid);assert.deepEqual(result.state.bankAccounts,current.bankAccounts);assert.equal(result.state.bankInformationView,'card');assert.equal(result.state.customPreference,current.customPreference);
 for(const key of ['currency','dark','numberFormat','defaultDepositView'])assert.equal(result.state[key],source[key]);
 assert.deepEqual(result.notificationSettings,reminders);assert.equal(JSON.stringify(current),before);
});

test('bank CSV replacement keeps deposits, receipts, other preferences and reminders',()=>{
 const current={...source,dark:false,defaultDepositView:'card',numberFormat:'south-asian',customPreference:'Current value',bankAccounts:[{...bank,accountTitle:'Previous holder'}]};
 const before=JSON.stringify(current),result=apply(current,readBanks(source));
 assert.deepEqual(result.state.bankAccounts,source.bankAccounts);assert.equal(result.state.bankInformationView,'grid');assert.equal(result.notificationSettings,null);
 for(const key of ['assets','paid','dark','defaultDepositView','numberFormat','customPreference','currency'])assert.deepEqual(result.state[key],current[key]);
 assert.equal(JSON.stringify(current),before);
});

test('both separate CSVs restore in either order on a fresh workspace',()=>{
 for(const files of [[readDeposits(source),readBanks(source)],[readBanks(source),readDeposits(source)]]){
  let current=emptyState(),settings=null;
  for(const file of files){const result=apply(current,file);current=result.state;settings=result.notificationSettings||settings;}
  for(const key of ['assets','paid','bankAccounts','currency','dark','defaultDepositView','bankInformationView','numberFormat'])assert.deepEqual(current[key],source[key],key);
  assert.deepEqual(settings,reminders);
 }
});

test('empty category files clear only that category and bank replacement protects existing deposit links',()=>{
 const empty={...emptyState(),currency:'USD'},bankFile=readBanks(empty);
 assert.throws(()=>apply(source,bankFile),/linked to a deposit/);
 const withoutDeposits=apply(source,readDeposits(empty)).state;assert.deepEqual(withoutDeposits.assets,[]);assert.deepEqual(withoutDeposits.paid,{});assert.deepEqual(withoutDeposits.bankAccounts,source.bankAccounts);
 assert.deepEqual(apply(withoutDeposits,bankFile).state.bankAccounts,[]);
 const unresolved={...source,bankAccounts:[],assets:[{...deposit,bankAccountId:'not-yet-restored'}]};
 assert.doesNotThrow(()=>apply(unresolved,bankFile),'A previously unresolved link is not treated as a removed saved bank');
});

test('partial-file currency checks protect deposits and even explicitly saved zero bank balances',()=>{
 const before=JSON.stringify(source),zeroBank={...bank,balance:0};
 assert.throws(()=>apply({...emptyState(),bankAccounts:[zeroBank]},readDeposits(source)),/different currency/);
 assert.throws(()=>apply({...emptyState(),assets:[deposit]},readBanks({...source,bankAccounts:[zeroBank]})),/Currencies differ/);
 assert.throws(()=>apply({...emptyState(),bankAccounts:[zeroBank]},readDeposits(source),'merge'),/Currencies differ/);
 assert.throws(()=>apply({...emptyState(),assets:[deposit]},readBanks({...source,bankAccounts:[zeroBank]}),'merge'),/Currencies differ/);
 assert.equal(apply(emptyState(),readBanks({...source,bankAccounts:[zeroBank]})).state.currency,'USD');
 assert.equal(JSON.stringify(source),before);
});

test('category merges retain local conflicts and preferences, add missing records, and remain duplicate-safe',()=>{
 const incoming={...source,assets:[...source.assets,{...deposit,id:'new-deposit',name:'New deposit'}],bankAccounts:[...source.bankAccounts,{...bank,id:'new-bank',accountTitle:'New account'}]};
 let current={...source,assets:[{...deposit,name:'Keep local name'}],bankAccounts:[{...bank,accountTitle:'Keep local account'}],dark:false,defaultDepositView:'card',bankInformationView:'card'};
 const deposits=apply(current,readDeposits(incoming),'merge');assert.equal(deposits.notificationSettings,null);assert.equal(deposits.merge.added,1);assert.equal(deposits.merge.conflicts,1);assert.equal(deposits.state.assets[0].name,'Keep local name');assert.deepEqual(deposits.state.bankAccounts,current.bankAccounts);current=deposits.state;
 const banks=apply(current,readBanks(incoming),'merge');assert.equal(banks.notificationSettings,null);assert.equal(banks.merge.bankAdded,1);assert.equal(banks.merge.bankConflicts,1);assert.equal(banks.state.bankAccounts[0].accountTitle,'Keep local account');assert.deepEqual(banks.state.paid,current.paid);assert.equal(banks.state.dark,false);assert.equal(banks.state.bankInformationView,'card');
 const repeated=apply(apply(banks.state,readDeposits(incoming),'merge').state,readBanks(incoming),'merge');assert.deepEqual(repeated.state,banks.state);
});

test('legacy deposit CSV and selected JSON preserve banks and omitted layout preferences',()=>{
 const current={...source,dark:false,defaultDepositView:'card',numberFormat:'south-asian',bankInformationView:'card'};
 const legacy=readBackupFile(Transfer.instrumentCSV(source));assert.equal(legacy.kind,'csv');assert.equal(legacy.preservesBanks,true);
 const result=apply(current,legacy);assert.deepEqual(result.state.bankAccounts,current.bankAccounts);assert.equal(result.notificationSettings,null);
 for(const key of ['dark','defaultDepositView','numberFormat','bankInformationView'])assert.equal(result.state[key],current[key]);
 const selected=readBackupFile(JSON.stringify(Transfer.exportData(source,[deposit.id])));assert.equal(selected.preservesBanks,true);assert.deepEqual(apply(current,selected).state.bankAccounts,current.bankAccounts);assert.equal(apply(current,selected).state.bankInformationView,'card');
 assert.throws(()=>applyBackupFile(current,selected.backup,{mode:'unknown'}),/Choose Merge/);
});

test('older combined CSV remains importable with its complete records and reminders',()=>{
 const rows=[Transfer.BACKUP_COLUMNS];
 function flatten(value,path=''){
  const type=value===null?'null':Array.isArray(value)?'array':typeof value,entries=['object','array'].includes(type)?Object.entries(value).filter(([,entry])=>entry!==undefined):[];
  rows.push([1,path,type,['object','array'].includes(type)?entries.length:type==='null'?'':value]);
  for(const [key,entry] of entries)flatten(entry,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
 }
 flatten({...Transfer.exportData(source),notificationSettings:reminders});
 const file=readBackupFile(Transfer.csv(rows));assert.equal(file.kind,'backup-csv');assert.deepEqual(file.backup.notificationSettings,reminders);
 const result=apply(emptyState(),file);for(const key of ['assets','paid','bankAccounts','bankInformationView','customPreference'])assert.deepEqual(result.state[key],source[key]);assert.deepEqual(result.notificationSettings,reminders);
});
