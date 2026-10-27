import test from 'node:test';
import assert from 'node:assert/strict';
import {Transfer,FDR,emptyState,receivingAccount,paymentAccount,linkedDeposits,paymentSnapshot,recordPayment,upsertAsset,upsertBankAccount,deleteBankAccount,createCloudBackup,normalizeBackup} from '../assets/data-engine.js';
import {draftDeposit} from '../assets/deposit-form.js';
import '../assets/sync-registry.js';

const asset={id:'deposit',type:'FDR',name:'Sample deposit',ownership:'self',ownerName:'Sample Holder',bankId:'ab-bank-plc',bankName:'AB Bank PLC',principal:10000000,rate:10,tds:10,cycle:1,cycleUnit:'months',start:'2026-01-01',first:'2026-02-01',maturity:'2027-01-01',tenureCount:1,tenureUnit:'years',autoRenew:false};
const account={id:'bankA',bankId:'brac-bank-plc',bankName:'BRAC Bank PLC',accountTitle:'Sample Holder',accountNumber:'000123456789',branchName:'Sample Branch',routingNumber:'000012345',accountType:'Savings'};
const other={...account,id:'bankB',bankName:'Another Bank',accountTitle:'Another Holder',accountNumber:'000987654321'};
const state=(assets=[{...asset,bankAccountId:account.id}],banks=[account,other])=>({...emptyState(),assets,bankAccounts:banks});
const id=asset.id+':'+asset.first;
const values={...asset,payoutChoice:'1',tenureChoice:'1year',principal:'100000',bankAccountId:account.id,autoRenew:false};

test('optional account links are independent of deposit institution and never change the supplied name',()=>{
 const legacy=Transfer.migrate(state([asset]));assert(!Object.hasOwn(legacy.assets[0],'bankAccountId'));
 for(const type of ['FDR','NSC']){
  const linked=draftDeposit({...values,type},asset);assert.equal(linked.bankAccountId,account.id);assert.equal(linked.bankName,asset.bankName);assert.equal(linked.name,asset.name);assert.equal(receivingAccount(state([linked]),linked).accountNumber,account.accountNumber);
  assert(!Object.hasOwn(draftDeposit({...values,type,bankAccountId:''},linked),'bankAccountId'));
  assert.equal(draftDeposit({...values,type,bankAccountId:undefined},linked).bankAccountId,undefined);
  const withoutInput={...values,type};delete withoutInput.bankAccountId;assert.equal(draftDeposit(withoutInput,linked).bankAccountId,account.id,'Older callers cannot silently remove a saved link');
 }
 assert(Transfer.validAsset({...asset,bankAccountId:'missingSavedAccount'}),'Partial imports can keep unresolved references');
 assert.equal(receivingAccount(state([],[]),{...asset,bankAccountId:'missingSavedAccount'}),null);
});

test('new receipts capture receiving identity while later bank or deposit changes never rewrite it',()=>{
 const initial=state(),received=recordPayment(initial,id,{amount:75000,notes:'Sample receipt'}),saved=received.paid[id];
 assert.equal(saved.date,asset.first,'New receipts use their scheduled date without a date input');
 assert.equal(saved.snapshot.bankAccountId,account.id);assert.deepEqual(saved.snapshot.bankAccountSnapshot,{bankName:account.bankName,accountTitle:account.accountTitle,accountNumber:account.accountNumber});
 let edited=upsertBankAccount(received,{...account,accountNumber:'000000000001',accountTitle:'Changed name'});
 edited=upsertAsset(edited,{...edited.assets[0],bankAccountId:other.id});
 const updated=recordPayment(edited,id,{amount:76000,date:'2099-01-01',notes:'Updated amount'});
 assert.equal(updated.paid[id].date,saved.date);assert.deepEqual(updated.paid[id].snapshot,saved.snapshot);
 assert.equal(paymentAccount(updated,updated.assets[0],updated.paid[id]).account.accountNumber,account.accountNumber);
 assert.equal(paymentAccount(updated,updated.assets[0]).account.accountNumber,other.accountNumber);
 assert.equal(initial.paid[id],undefined,'Recording a receipt does not mutate the previous state');
});

test('old receipts and unresolved account references are never assigned today’s bank identity',()=>{
 const event=FDR.schedule(asset,asset.first)[0],legacy={amount:75000,date:'2026-03-15',notes:'Imported receipt',snapshot:Transfer.snapshot(event)},initial={...state(),paid:{[id]:legacy}};
 const updated=recordPayment(initial,id,{amount:74000});assert.equal(updated.paid[id].date,'2026-03-15');assert.deepEqual(updated.paid[id].snapshot,legacy.snapshot);assert.equal(paymentAccount(updated,updated.assets[0],updated.paid[id]).id,null);
 const missing=state([{...asset,bankAccountId:'unavailable'}],[]),snapshot=paymentSnapshot(missing,FDR.schedule(missing.assets[0],asset.first)[0]);assert.equal(snapshot.bankAccountId,'unavailable');assert(!snapshot.bankAccountSnapshot);
});

test('full and Drive backups retain links/history; deposit-only exports omit saved bank identity details',()=>{
 const received=recordPayment(state(),id,{amount:75000});
 for(const backup of [Transfer.exportData(received),createCloudBackup(received).data]){assert.equal(backup.minReaderVersion,7);assert.equal(Transfer.migrate(backup).paid[id].snapshot.bankAccountSnapshot.accountNumber,account.accountNumber);}
 assert.equal(normalizeBackup(createCloudBackup(received)).data.assets[0].bankAccountId,account.id);
 const selected=Transfer.exportData(received,[asset.id]);assert.equal(selected.minReaderVersion,7);assert(!selected.bankAccounts);assert.equal(selected.paid[id].snapshot.bankAccountId,account.id);assert(!selected.paid[id].snapshot.bankAccountSnapshot);assert(!JSON.stringify(selected).includes(account.accountNumber));assert(Transfer.migrate(selected));
 const csv=Transfer.instrumentCSV(received);assert.match(csv,/Linked FDR/);assert(!csv.includes(account.accountNumber));const restored=Transfer.readInstrumentCSV(csv);assert.equal(restored.assets[0].bankAccountId,account.id);assert.equal(restored.bankAccounts.length,0);
 for(const interestType of ['simple','compound']){const linked={...received.assets[0],interestType};assert.equal(Transfer.readInstrumentCSV(Transfer.instrumentCSV({...received,assets:[linked]})).assets[0].bankAccountId,account.id);}
});

test('linked accounts cannot be deleted until deposits are unlinked, while old receipt identity survives deletion',()=>{
 const initial=recordPayment(state(),id,{amount:75000});assert.equal(linkedDeposits(initial,account.id).length,1);assert.throws(()=>deleteBankAccount(initial,account.id),/Unlink or reassign/);
 const unlinked=upsertAsset(initial,{...asset});assert.equal(linkedDeposits(unlinked,account.id).length,0);const removed=deleteBankAccount(unlinked,account.id);assert.equal(removed.bankAccounts.length,1);assert.equal(removed.paid[id].snapshot.bankAccountSnapshot.accountNumber,account.accountNumber);assert.equal(Transfer.exportData(removed).minReaderVersion,7);
});

test('reader7 remains required for live links or historical receiving identity during concurrent sync',()=>{
 const Sync=globalThis.DepositlySync,original=createCloudBackup(recordPayment(state(),id,{amount:75000})),doc=Sync.create(original,'phone',1);
 doc.entries['p/minReaderVersion']={s:[99,0,'stale'],v:5};assert.equal(Sync.backup(doc).data.minReaderVersion,7);
 const unlinked=structuredClone(original);delete unlinked.data.assets[0].bankAccountId;assert.equal(Sync.backup(Sync.change(doc,Sync.backup(doc),unlinked,'web',100)).data.minReaderVersion,7);
 for(const malformed of ['',null,12,'contains space'])assert(!Transfer.validAsset({...asset,bankAccountId:malformed}));
 assert.throws(()=>Transfer.migrate({...Transfer.exportData(state()),minReaderVersion:6}),/reader version 7/);
});
