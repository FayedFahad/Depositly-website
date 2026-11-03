import test from 'node:test';
import assert from 'node:assert/strict';
import {Transfer,emptyState} from '../assets/data-engine.js';
import {readBackupFile,exportBankInformationCSV} from '../assets/backup-files.js';

const bank={id:'123',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'Example Holder',accountNumber:'001234567890123456789',routingNumber:'000012345',branchName:'Example branch',accountType:'Savings',balance:12345};
const deposit={id:'deposit',type:'FDR',name:'Example deposit',ownerName:'Example Holder',ownership:'self',principal:1000000,rate:10,tds:10,cycle:1,cycleUnit:'months',start:'2026-01-01',first:'2026-02-01',maturity:'2027-01-01',reference:'00001234567890123456',bankAccountId:bank.id};
const receipt={amount:7500,date:'2026-02-01',snapshot:{assetId:deposit.id,name:deposit.name,type:'FDR',scheduledDate:'2026-02-01',kind:'Interest',gross:8333,tax:833,expected:7500,principal:0,bankAccountId:bank.id,bankAccountSnapshot:{bankName:'Example Bank',accountTitle:'Historic holder',accountNumber:'000012345678901234567'}}};
const state={...emptyState(),assets:[deposit],paid:{'deposit:2026-02-01':receipt},bankAccounts:[bank],bankInformationOrder:['bank:ab-bank-plc']};

test('digit strings export with spreadsheet text protection while monetary amounts stay numeric',()=>{
 const bankCSV=Transfer.bankAccountsCSV(state),depositCSV=Transfer.depositsCSV(state);
 for(const value of [bank.id,bank.accountNumber,bank.routingNumber])assert(bankCSV.includes('"\''+value+'"'));
 for(const value of [deposit.reference,receipt.snapshot.bankAccountSnapshot.accountNumber])assert(depositCSV.includes('"\''+value+'"'));
 assert(bankCSV.includes('"123.45"'),'Current balance remains a number, without a text prefix');
 assert(depositCSV.includes('"10000"'),'Principal remains a number, without a text prefix');
 assert.deepEqual(Transfer.readBankAccountsCSV(bankCSV).bankAccounts,state.bankAccounts);
 assert.deepEqual(Transfer.readDepositsCSV(depositCSV).assets,state.assets);
 assert.deepEqual(Transfer.readDepositsCSV(depositCSV).paid,state.paid);
 assert.equal(Transfer.readInstrumentCSV(Transfer.instrumentCSV(state)).assets[0].reference,deposit.reference);
});

test('text protection decodes once, preserving genuine apostrophes and nonnumeric identifiers',()=>{
 for(const value of ['00123','123456789012345678901234567890',"'00123","''00123",'AB-001 234','=A1','+123','-123','@account']){
  const input={...state,bankAccounts:[{...bank,accountNumber:value,routingNumber:value}]};
  const restored=readBackupFile(exportBankInformationCSV(input));
  assert.equal(restored.backup.data.bankAccounts[0].accountNumber,value);
  assert.equal(restored.backup.data.bankAccounts[0].routingNumber,value);
 }
 const rawDigits=Transfer.bankAccountsCSV(state).replace('"\''+bank.accountNumber+'"','"'+bank.accountNumber+'"');
 assert.equal(Transfer.readBankAccountsCSV(rawDigits).bankAccounts[0].accountNumber,bank.accountNumber,'Unedited older backups without text prefixes stay readable');
});

test('ordered bank CSV preserves ranks and exact account details for numeric-only IDs',()=>{
 const text=exportBankInformationCSV(state),restored=readBackupFile(text).backup.data;
 assert.deepEqual(restored.bankAccounts,state.bankAccounts);
 assert.deepEqual(restored.bankInformationOrder,state.bankInformationOrder);
 assert.match(text,/"Bank order"/);
});

test('scientific account, routing, certificate and historical account identifiers are rejected without guessing digits',()=>{
 const notation=['1.23457E+12','1e12','+1.5e+12','-2E2','.5e12','1.E+12',' 1.5E12 '];
 for(const value of notation){
  assert.throws(()=>Transfer.bankAccountsCSV({...state,bankAccounts:[{...bank,accountNumber:value}]}),/Account number is in scientific notation/,'Exports also refuse identifiers already stored in scientific notation');
  assert.throws(()=>Transfer.instrumentCSV({...state,assets:[{...deposit,reference:value}]}),/Certificate reference is in scientific notation/);
  const escaped=value.replace(/"/g,'""'),accountCSV=Transfer.bankAccountsCSV(state).replace('"\''+bank.accountNumber+'"','"'+escaped+'"');
  assert.throws(()=>readBackupFile(accountCSV),/Account number is in scientific notation.*original full digits.*cannot be recovered/);
  const routingCSV=Transfer.bankAccountsCSV(state).replace('"\''+bank.routingNumber+'"','"'+escaped+'"');
  assert.throws(()=>readBackupFile(routingCSV),/Routing number is in scientific notation/);
  const depositsCSV=Transfer.depositsCSV(state).replace('"\''+deposit.reference+'"','"'+escaped+'"');
  assert.throws(()=>readBackupFile(depositsCSV),/Deposit \/ certificate number is in scientific notation/);
  const legacyCSV=Transfer.instrumentCSV(state).replace('"\''+deposit.reference+'"','"'+escaped+'"');
  assert.throws(()=>Transfer.readInstrumentCSV(legacyCSV),/Certificate reference is in scientific notation/);
  const historyCSV=Transfer.depositsCSV(state).replace('"\''+receipt.snapshot.bankAccountSnapshot.accountNumber+'"','"'+escaped+'"');
  assert.throws(()=>readBackupFile(historyCSV),/Receipt receiving account number is in scientific notation/);
 }
});
