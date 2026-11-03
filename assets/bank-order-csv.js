import {Transfer} from './data-engine.js';
import {groupedBankAccounts} from './bank-layout.js';

// Preserve the shared reader's formula escaping while adding/removing one column.
// Cells stay encoded as exported; the shared bank reader decodes them exactly once.
function csvRows(input){
 let rows=[],row=[],cell='',quoted=false,closed=false;
 input=input.replace(/^\uFEFF/,'');
 const endCell=()=>{row.push(cell);cell='';closed=false;if(row.length>128)throw Error('CSV has too many columns.');};
 const endRow=()=>{endCell();if(row.some(value=>value.trim()))rows.push(row);row=[];if(rows.length>501)throw Error('CSV exceeds the 500-bank-account limit.');};
 for(let index=0;index<input.length;index++){
  const character=input[index];
  if(quoted){if(character==='"'){if(input[index+1]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}else cell+=character;continue;}
  if(character===','){endCell();continue;}
  if(character==='\r'||character==='\n'){if(character==='\r'&&input[index+1]==='\n')index++;endRow();continue;}
  if(closed){if(character===' '||character==='\t')continue;throw Error('Invalid text after a quoted CSV field.');}
  if(character==='"'){if(cell.length)throw Error('Invalid quotation in CSV.');quoted=true;}else cell+=character;
 }
 if(quoted)throw Error('CSV has an unfinished quoted field.');
 if(cell.length||row.length||closed)endRow();
 if(!rows.length)throw Error('CSV is empty.');
 return rows;
}
const encodedCSV=rows=>'\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');

export function readBankInformationCSV(content){
 const rows=csvRows(content),header=rows[0],orderColumns=header.map((name,index)=>name.trim().toLowerCase()==='bank order'?index:-1).filter(index=>index>=0);
 if(!orderColumns.length)return Transfer.readBankAccountsCSV(content);
 if(orderColumns.length!==1)throw Error('CSV has duplicate Bank order columns.');
 if(rows.some(row=>row.length!==header.length))throw Error('CSV row has the wrong number of columns.');
 const column=orderColumns[0],data=Transfer.readBankAccountsCSV(encodedCSV(rows.map(row=>row.filter((_,index)=>index!==column))));
 const idColumn=header.findIndex(name=>name.trim().toLowerCase()==='bank account id');
 const groupByAccount=new Map(groupedBankAccounts(data.bankAccounts).flatMap(group=>group.accounts.map(account=>[account.id,group.key]))),ranks=new Map(),rankOwners=new Map();
 for(const row of rows.slice(1)){
  const value=row[column].trim();if(!value)continue;
  if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>500)throw Error('Bank order must be a whole number from 1 to 500, or blank.');
  const key=groupByAccount.get(Transfer.unescapeCSV(row[idColumn]));if(!key)throw Error('Bank order needs a saved bank account.');
  const rank=Number(value);
  if(ranks.has(key)&&ranks.get(key)!==rank)throw Error('Accounts from the same bank must use the same Bank order number.');
  if(rankOwners.has(rank)&&rankOwners.get(rank)!==key)throw Error('Each bank must use a different Bank order number.');
  ranks.set(key,rank);rankOwners.set(rank,key);
 }
 data.bankInformationOrder=[...ranks].sort((left,right)=>left[1]-right[1]).map(([key])=>key);
 return data;
}

export function exportBankInformationCSV(state){
 const groups=groupedBankAccounts(state.bankAccounts||[],state.bankInformationOrder),known=new Set(groups.map(group=>group.key)),order=[];
 if(Array.isArray(state.bankInformationOrder))for(const key of state.bankInformationOrder.slice(0,500))if(typeof key==='string'&&known.has(key)&&!order.includes(key))order.push(key);
 const rankByGroup=new Map(order.map((key,index)=>[key,index+1])),groupByAccount=new Map(groups.flatMap(group=>group.accounts.map(account=>[account.id,group.key])));
 const rows=csvRows(Transfer.bankAccountsCSV({...state,bankAccounts:groups.flatMap(group=>group.accounts)}));
 const idColumn=rows[0].findIndex(name=>name.toLowerCase()==='bank account id');
 return encodedCSV(rows.map((row,index)=>[...row,index===0?'Bank order':rankByGroup.get(groupByAccount.get(Transfer.unescapeCSV(row[idColumn])))??'']));
}
