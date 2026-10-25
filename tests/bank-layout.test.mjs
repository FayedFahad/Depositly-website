import test from 'node:test';
import assert from 'node:assert/strict';
import {bankInformationView,groupedBankAccounts} from '../assets/bank-layout.js';
import {BankCatalog,Transfer,emptyState,createCloudBackup,normalizeBackup} from '../assets/data-engine.js';

const sample={id:'bank-a',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'Example Holder',accountNumber:'00123456789012345',routingNumber:'000123456',branchName:'North Branch',accountType:'Savings'};
test('bank groups use authoritative ids, legacy legal names and catalog aliases without losing accounts',()=>{
 const alias=BankCatalog.find(b=>b.aliases.length),accounts=[sample,{...sample,id:'bank-b',bankId:'',bankName:'AB BANK LIMITED',branchName:'Central Branch'},{...sample,id:'bank-c',bankId:'city-bank-plc',bankName:'Incorrect legacy name'},{...sample,id:'bank-d',bankId:'',bankName:alias.aliases[0]}];
 const before=JSON.stringify(accounts),groups=groupedBankAccounts(accounts);
 assert.equal(JSON.stringify(accounts),before);
 assert.equal(groups.length,3);assert.equal(groups.flatMap(g=>g.accounts).length,4);
 assert.deepEqual(groups.find(g=>g.bankId==='ab-bank-plc').accounts.map(a=>a.id),['bank-b','bank-a']);
 assert.equal(groups.find(g=>g.bankId==='city-bank-plc').name,'City Bank PLC');
 assert(groups.some(g=>g.bankId===alias.id));
});
test('unknown banks group by normalized names and sort alphabetically with stable account ordering',()=>{
 const rows=[{...sample,id:'z',bankId:'',bankName:'Zed Bank'},{...sample,id:'north',bankId:'',bankName:'Example Bank PLC'},{...sample,id:'central',bankId:'unrecognized-id',bankName:'EXAMPLE BANK LIMITED',branchName:'Central Branch'}];
 const groups=groupedBankAccounts(rows);assert.equal(groups.length,2);assert.match(groups[0].name,/Example/i);assert.deepEqual(groups[0].accounts.map(a=>a.id),['central','north']);assert.equal(groups[1].name,'Zed Bank');
});
test('bank view preferences have safe defaults and survive full and cloud backup round trips',()=>{
 for(const value of [undefined,null,'invalid',{},0])assert.equal(bankInformationView({bankInformationView:value}),'card');
 for(const view of ['card','list','grid']){
  const state={...emptyState(),bankAccounts:[sample],bankInformationView:view};
  assert.equal(bankInformationView(state),view);
  assert.equal(Transfer.migrate(JSON.parse(JSON.stringify(Transfer.exportData(state)))).bankInformationView,view);
  assert.equal(normalizeBackup(createCloudBackup(state)).data.bankInformationView,view);
  assert.equal(state.bankAccounts[0].accountNumber,'00123456789012345');
 }
});
