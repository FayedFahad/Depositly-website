import {Transfer,normalizeBackup} from './data-engine.js';
import {readBankInformationCSV} from './bank-order-csv.js';
export {exportBankInformationCSV} from './bank-order-csv.js';

const kinds=new Set(['json','deposits','banks','backup-csv','csv']);
const bankView=state=>['card','grid'].includes(state.bankInformationView)?state.bankInformationView:'card';
const currency=state=>String(state.currency||'BDT').trim().toUpperCase();

function reminderSettings(value){
 if(value==null)return undefined;
 if(typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))throw Error('The backup’s reminder settings are invalid.');
 return {...value};
}

/** Detect backup contents so downloaded files remain readable after being renamed. */
export function readBackupFile(text){
 if(typeof text!=='string')throw Error('Choose a text backup file.');
 if(text.length>20_000_000)throw Error('Backup is too large.');
 const content=text.trimStart();
 if(!content)throw Error('Choose a JSON or CSV backup with records or saved settings.');
 let kind,backup,preservesBanks=false;
 if(/^[\[{]/.test(content)){
  let raw;try{raw=JSON.parse(content);}catch{throw Error('This file is not valid JSON.');}
  kind='json';backup=normalizeBackup(raw);preservesBanks=raw?.scope==='selected';
 }else{
  kind=Transfer.csvKind(content);
  const reader=kind==='deposits'?Transfer.readDepositsCSV:kind==='banks'?readBankInformationCSV:kind==='backup-csv'?Transfer.readBackupCSV:Transfer.readInstrumentCSV;
  backup=normalizeBackup(reader(content));preservesBanks=kind==='deposits'||kind==='csv';
 }
 backup.notificationSettings=reminderSettings(backup.notificationSettings??backup.data.notificationSettings);
 return {backup,kind,preservesBanks};
}

/** Restore only the categories and settings actually included in a backup file. */
export function applyBackupFile(current,backup,{kind='json',preservesBanks=false,mode='replace'}={}){
 if(!kinds.has(kind))throw Error('Unsupported backup file type.');
 if(!['replace','merge'].includes(mode))throw Error('Choose Merge records or Replace with backup.');
 const incoming=normalizeBackup(backup?.data).data;
 const notificationSettings=reminderSettings(backup.notificationSettings??incoming.notificationSettings);
 if(mode==='merge'){
  const merge=Transfer.merge(current,incoming);
  if(kind==='banks'&&Object.hasOwn(incoming,'bankInformationOrder'))merge.state.bankInformationOrder=incoming.bankInformationOrder;
  return {state:merge.state,notificationSettings:null,merge};
 }
 let state;
 if(kind==='banks'){
  const existing=new Set((current.bankAccounts||[]).map(account=>account.id)),restored=new Set(incoming.bankAccounts.map(account=>account.id));
  if(current.assets.some(asset=>asset.bankAccountId&&existing.has(asset.bankAccountId)&&!restored.has(asset.bankAccountId)))throw Error('A bank account being removed is linked to a deposit. Use merge, or restore your Deposits CSV first.');
  const hasBalances=incoming.bankAccounts.some(account=>account.balance!==undefined);
  if(hasBalances&&current.assets.length&&currency(current)!==currency(incoming))throw Error('Currencies differ. Saved deposits are kept and amounts are not converted. Choose a matching-currency Bank Information CSV.');
  state={...current,bankAccounts:incoming.bankAccounts,bankInformationView:bankView(incoming),currency:hasBalances&&!current.assets.length?currency(incoming):currency(current)};
  if(Object.hasOwn(incoming,'bankInformationOrder'))state.bankInformationOrder=incoming.bankInformationOrder;
 }else{
  const keepBanks=preservesBanks||kind==='deposits'||kind==='csv';
  if(keepBanks&&(current.bankAccounts||[]).some(account=>account.balance!==undefined)&&currency(current)!==currency(incoming))throw Error('This deposit-only backup uses a different currency from your saved bank balances. Amounts are not converted. Choose a matching-currency backup.');
  state=kind==='deposits'||kind==='csv'?{...current,...incoming}:{...incoming};
  if(keepBanks)state.bankAccounts=current.bankAccounts||[];
  if(keepBanks){if(Object.hasOwn(current,'bankInformationOrder'))state.bankInformationOrder=current.bankInformationOrder;else delete state.bankInformationOrder;}
  state.bankInformationView=keepBanks||!['card','grid'].includes(incoming.bankInformationView)?bankView(current):incoming.bankInformationView;
  if(kind==='csv')Object.assign(state,{dark:current.dark,defaultDepositView:current.defaultDepositView,numberFormat:current.numberFormat});
 }
 return {state,notificationSettings:kind==='banks'?null:notificationSettings||null,merge:null};
}
