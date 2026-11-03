import test from 'node:test';
import assert from 'node:assert/strict';
import {Transfer,emptyState,createCloudBackup,normalizeBackup} from '../assets/data-engine.js';
import {groupedBankAccounts} from '../assets/bank-layout.js';
import {readBackupFile,applyBackupFile,exportBankInformationCSV} from '../assets/backup-files.js';

const account={id:'ab-a',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'=Holder, "One"',accountNumber:'000012345',branchName:'North, "Main"',routingNumber:'000000012',accountType:"'=literal",balance:12345};
const accounts=[account,{...account,id:'ab-legacy',bankId:'',bankName:'AB BANK LIMITED',accountTitle:"'Leading apostrophe"},{...account,id:'city',bankId:'city-bank-plc',bankName:'City Bank PLC',accountTitle:'Second Holder'},{...account,id:'custom',bankId:'',bankName:'A, "Custom" Bank',accountTitle:'Custom holder'}].map(bank=>{if(bank.bankId!=='')return bank;const {bankId,...value}=bank;return value;});
const source={...emptyState(),bankAccounts:accounts,bankInformationView:'grid'};
const order=['bank:city-bank-plc','bank:ab-bank-plc'];
function orderedCSV(ranks,{column=true}={}){
 return Transfer.csv([[...Transfer.BANK_COLUMNS,...(column?['Bank order']:[])],...accounts.map((bank,index)=>[bank.id,bank.bankId,bank.bankName,bank.accountTitle,bank.accountNumber,bank.branchName,bank.routingNumber,bank.accountType,bank.note??'',bank.balance/100,'grid',accounts.length,'BDT',2,...(column?[ranks[index]??'']:[])])]);
}
const apply=(current,file,mode='replace')=>applyBackupFile(current,file.backup,{kind:file.kind,preservesBanks:file.preservesBanks,mode});

test('Bank order ranks group aliases, inherit blank rows and preserve exact CSV account fields',()=>{
 const file=readBackupFile(orderedCSV([2,'',1,'']));
 assert.equal(file.kind,'banks');assert.deepEqual(file.backup.data.bankInformationOrder,order);assert.deepEqual(file.backup.data.bankAccounts,accounts);
 const restored=apply(emptyState(),file).state;
 assert.deepEqual(groupedBankAccounts(restored.bankAccounts,restored.bankInformationOrder).map(group=>group.key),[...order,'name:a "custom" bank']);
 assert.equal(restored.bankAccounts[0].accountNumber,'000012345');assert.equal(restored.bankAccounts[0].routingNumber,'000000012');
});

test('ordered CSV export follows display groups and has blank ranks for unranked banks',()=>{
 const exported=exportBankInformationCSV({...source,bankInformationOrder:order}),file=readBackupFile(exported);
 assert.match(exported,/"Bank order"/);assert.deepEqual(file.backup.data.bankInformationOrder,order);
 const expected=groupedBankAccounts(accounts,order).flatMap(group=>group.accounts);
 assert.deepEqual(file.backup.data.bankAccounts,expected);
 assert.deepEqual(file.backup.data.bankAccounts.map(bank=>bank.accountType),expected.map(bank=>bank.accountType),'Formula prefixes and apostrophes decode once');
 const reset=readBackupFile(exportBankInformationCSV(source));assert.deepEqual(reset.backup.data.bankInformationOrder,[]);
 const invalidPreference=readBackupFile(exportBankInformationCSV({...source,bankInformationOrder:['unknown','bank:city-bank-plc','bank:city-bank-plc',null]}));
 assert.deepEqual(invalidPreference.backup.data.bankInformationOrder,['bank:city-bank-plc']);
});

test('ordered bank CSV keeps notes and their existing escaping intact',()=>{
 const noted={...source,bankAccounts:accounts.map((bank,index)=>({...bank,note:index?'Second account\nPrivate note':'=Private, "quoted" note\nSecond line'})),bankInformationOrder:order};
 const restored=readBackupFile(exportBankInformationCSV(noted));
 assert.deepEqual(restored.backup.data.bankAccounts,groupedBankAccounts(noted.bankAccounts,order).flatMap(group=>group.accounts));
 assert.deepEqual(restored.backup.data.bankInformationOrder,order);
});

test('bank CSV merge changes order without replacing conflicting records or unrelated settings',()=>{
 const current={...source,dark:true,bankInformationOrder:['name:a "custom" bank'],bankAccounts:accounts.map(bank=>({...bank,accountTitle:'Keep local holder'}))};
 const before=JSON.stringify(current),file=readBackupFile(orderedCSV([2,2,1,''])),result=apply(current,file,'merge');
 assert.deepEqual(result.state.bankInformationOrder,order);assert.deepEqual(result.state.bankAccounts,current.bankAccounts);assert.equal(result.state.dark,true);assert.equal(result.notificationSettings,null);assert.equal(result.merge.bankConflicts,accounts.length);assert.equal(JSON.stringify(current),before);
 assert.deepEqual(apply(current,file).state.bankInformationOrder,order);
});

test('old bank CSV preserves custom order and explicit blank column clears it for replace and merge',()=>{
 const current={...source,bankInformationOrder:order},legacy=readBackupFile(Transfer.bankAccountsCSV(source)),blank=readBackupFile(orderedCSV([]));
 assert.equal(Object.hasOwn(legacy.backup.data,'bankInformationOrder'),false);assert.deepEqual(blank.backup.data.bankInformationOrder,[]);
 for(const mode of ['replace','merge']){
  assert.deepEqual(apply(current,legacy,mode).state.bankInformationOrder,order);
  assert.deepEqual(apply(current,blank,mode).state.bankInformationOrder,[]);
 }
});

test('deposits and selected JSON keep current bank order while full JSON restores or clears it',()=>{
 const current={...source,bankInformationOrder:order},deposits=readBackupFile(Transfer.depositsCSV({...emptyState(),bankInformationOrder:['bank:ab-bank-plc']}));
 assert.deepEqual(apply(current,deposits).state.bankInformationOrder,order);
 const selected=readBackupFile(JSON.stringify({...Transfer.exportData(source,[]),bankInformationOrder:['bank:ab-bank-plc']}));
 assert.deepEqual(apply(current,selected).state.bankInformationOrder,order);
 const emptyCurrent=apply(source,selected).state;assert.equal(Object.hasOwn(emptyCurrent,'bankInformationOrder'),false);
 const full=readBackupFile(JSON.stringify(createCloudBackup({...source,bankInformationOrder:order})));
 assert.deepEqual(apply(emptyState(),full).state.bankInformationOrder,order);
 assert.equal(Object.hasOwn(apply(current,readBackupFile(JSON.stringify(createCloudBackup(source)))).state,'bankInformationOrder'),false);
 assert.deepEqual(normalizeBackup(createCloudBackup({...source,bankInformationOrder:order})).data.bankInformationOrder,order);
});

test('invalid rank values and conflicting bank ranks fail before changes can be applied',()=>{
 for(const rank of [-1,0,501,1.5,'1e2','+2','001','NaN','Infinity','9007199254740992','=1+1'])assert.throws(()=>readBackupFile(orderedCSV([rank,'',2,''])),/Bank order/);
 assert.throws(()=>readBackupFile(orderedCSV([1,2,3,''])),/same bank/);
 assert.throws(()=>readBackupFile(orderedCSV([1,1,1,''])),/different Bank order/);
 const duplicateColumn=orderedCSV([2,2,1,'']).replace('"Bank order"','"Bank order","bank order"');assert.throws(()=>readBackupFile(duplicateColumn),/duplicate Bank order/);
 const noAccounts=exportBankInformationCSV(emptyState());assert.deepEqual(readBackupFile(noAccounts).backup.data.bankInformationOrder,[]);
 assert.throws(()=>readBackupFile(noAccounts.replace(/,""$/,',"1"')),/needs a saved bank account/);
});

test('optional order column remains strict about malformed quoting, rows and unsupported columns',()=>{
 const valid=orderedCSV([2,2,1,'']);
 assert.throws(()=>readBackupFile(valid+'\r\n"unfinished'),/unfinished quoted/);
 assert.throws(()=>readBackupFile(valid.replace('"Bank order"','"Bank order"oops')),/Invalid text/);
 assert.throws(()=>readBackupFile(valid.replace('"North, ""Main"""','bad"field')),/Invalid quotation/);
 assert.throws(()=>readBackupFile(valid.replace('"Bank order"','"Unexpected column"')),/unrecognized column|Unexpected bank CSV columns/);
 assert.deepEqual(readBackupFile(valid.replace(/\r\n/g,'\n')).backup.data.bankInformationOrder,order);
});
