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

test('custom bank ranks order groups while aliases and unranked banks retain their normal account sorting',()=>{
 const rows=[sample,{...sample,id:'ab-legacy',bankId:'',bankName:'AB BANK LIMITED',accountTitle:'Amina'},{...sample,id:'city',bankId:'city-bank-plc',bankName:'City Bank PLC'},{...sample,id:'river',bankId:'',bankName:'River Bank'},{...sample,id:'zed',bankId:'',bankName:'Zed Bank'}];
 const before=JSON.stringify(rows),order=['name:zed bank','bank:city-bank-plc'];
 const groups=groupedBankAccounts(rows,order);
 assert.deepEqual(groups.map(group=>group.key),['name:zed bank','bank:city-bank-plc','bank:ab-bank-plc','name:river bank']);
 assert.deepEqual(groups.find(group=>group.bankId==='ab-bank-plc').accounts.map(account=>account.id),['ab-legacy','bank-a']);
 assert.equal(JSON.stringify(rows),before,'Applying display order does not rearrange or edit saved accounts');
 assert.deepEqual(order,['name:zed bank','bank:city-bank-plc'],'Rendering does not edit the saved preference');
});

test('custom bank order ignores missing and duplicate group keys',()=>{
 const rows=[sample,{...sample,id:'city',bankId:'city-bank-plc',bankName:'City Bank PLC'},{...sample,id:'river',bankId:'',bankName:'River Bank'}];
 const order=['bank:missing','bank:city-bank-plc','bank:city-bank-plc','name:unknown bank'];
 assert.deepEqual(groupedBankAccounts(rows,order).map(group=>group.key),['bank:city-bank-plc','bank:ab-bank-plc','name:river bank']);
 for(const invalid of [null,'bank:city-bank-plc',{},42])assert.deepEqual(groupedBankAccounts(rows,invalid).map(group=>group.key),['bank:ab-bank-plc','bank:city-bank-plc','name:river bank'],'Unsupported stored preferences fall back to alphabetical order');
});

test('custom bank order survives JSON and Google backup round trips',()=>{
 const city={...sample,id:'city',bankId:'city-bank-plc',bankName:'City Bank PLC'},order=['bank:city-bank-plc','bank:ab-bank-plc'];
 const state={...emptyState(),bankAccounts:[sample,city],bankInformationOrder:order};
 for(const restored of [Transfer.migrate(JSON.parse(JSON.stringify(Transfer.exportData(state)))),normalizeBackup(createCloudBackup(state)).data]){
  assert.deepEqual(restored.bankInformationOrder,order);
  assert.deepEqual(groupedBankAccounts(restored.bankAccounts,restored.bankInformationOrder).map(group=>group.key),order);
 }
});
test('bank view preferences have safe defaults and survive full and cloud backup round trips',()=>{
 for(const value of [undefined,null,'invalid','list',{},0])assert.equal(bankInformationView({bankInformationView:value}),'card');
 for(const view of ['card','grid']){
  const state={...emptyState(),bankAccounts:[sample],bankInformationView:view};
  assert.equal(bankInformationView(state),view);
  assert.equal(Transfer.migrate(JSON.parse(JSON.stringify(Transfer.exportData(state)))).bankInformationView,view);
  assert.equal(normalizeBackup(createCloudBackup(state)).data.bankInformationView,view);
  assert.equal(state.bankAccounts[0].accountNumber,'00123456789012345');
 }
});
