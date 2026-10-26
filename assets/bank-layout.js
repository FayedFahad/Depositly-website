import {BankCatalog,compareName} from './data-engine.js';

export const bankInformationView=state=>['card','grid'].includes(state.bankInformationView)?state.bankInformationView:'card';
const normalized=value=>String(value||'').toLocaleLowerCase('en').replace(/[.,'’]/g,'').replace(/&/g,' and ').replace(/\b(?:the|plc|ltd|limited)\b/g,'').replace(/[\s_-]+/g,' ').trim();
const banksById=new Map(BankCatalog.map(bank=>[bank.id,bank])),banksByName=new Map();
for(const bank of BankCatalog)for(const name of [bank.name,...(bank.aliases||[])])banksByName.set(normalized(name),bank);

export function groupedBankAccounts(accounts=[]){
 const groups=new Map();
 for(const account of accounts){
  const bank=banksById.get(account.bankId)||banksByName.get(normalized(account.bankName)),key=bank?'bank:'+bank.id:'name:'+normalized(account.bankName);
  if(!groups.has(key))groups.set(key,{key,name:bank?.name||account.bankName.trim(),bankId:bank?.id||'',accounts:[]});
  groups.get(key).accounts.push(account);
 }
 const compare=(a,b)=>['accountTitle','branchName','accountType','accountNumber','id'].reduce((order,field)=>order||String(a[field]||'').localeCompare(String(b[field]||''),'en',{sensitivity:'base'}),0);
 return [...groups.values()].sort(compareName).map(group=>({...group,accounts:group.accounts.slice().sort(compare)}));
}
