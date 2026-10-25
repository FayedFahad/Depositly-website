/** Exact calculation and interchange contracts shared with the Depositly Android app. */
const engineRoot = {};
/* All money is stored in paisa; calendar dates never use UTC conversion. */
(function(root){
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12);};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function months(s,n){const d=parse(s),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return iso(d);}
function days(s,n){const d=parse(s);d.setDate(d.getDate()+n);return iso(d);}
const difference=(a,b)=>Math.round((Date.UTC(...a.split('-').map((v,i)=>i===1?+v-1:+v))-Date.UTC(...b.split('-').map((v,i)=>i===1?+v-1:+v)))/86400000);
function amount(a,period){let gross=Math.round(a.principal*a.rate/100*period/360);let tax=Math.round(gross*a.tds/100);return {gross,tax,net:gross-tax};}
const periodSpec=a=>({unit:a.cycleUnit||(Number(a.cycle)===100?'days':'months'),count:Number(a.cycle)});
const cycleLabel=a=>{let p=periodSpec(a);return p.unit==='days'?p.count+' days':({1:'Monthly',3:'Quarterly',6:'Half-yearly',12:'Yearly'}[p.count]||p.count+' months');};
const endDate=a=>a.autoRenew?(a.renewalStop||null):a.maturity;
const active=(a,on)=>a.start<=on&&(!endDate(a)||endDate(a)>=on);
function renewalDate(a,n){let count=a.tenureCount,unit=a.tenureUnit;if(!count||!unit){count=difference(a.maturity,a.start);unit='days';}return unit==='days'?days(a.start,count*n):months(a.start,count*n*(unit==='years'?12:1));}
function renewalTerm(a,on){let lo=1,hi=1;while(renewalDate(a,hi)<on&&hi<131072)hi*=2;while(lo<hi){let mid=Math.floor((lo+hi)/2);if(renewalDate(a,mid)<on)lo=mid+1;else hi=mid;}return lo;}
function nextMaturity(a,on){if(!a.autoRenew||a.renewalStop)return endDate(a);return renewalDate(a,renewalTerm(a,on));}
const legacyRenewal=a=>a.type==='FDR'&&periodSpec(a).unit==='days'&&a.cycle===100&&a.first===days(a.start,100)&&a.maturity===a.first;
function renewedSchedule(a,through){
 let out=[],start=a.start,p=periodSpec(a);
 for(let n=1;n<=110000&&start<through;n++){
  let maturity=renewalDate(a,n);if(a.renewalStop&&maturity>a.renewalStop)break;
  let first=n===1?a.first:(p.unit==='days'?days(start,p.count):months(start,p.count));if(first>maturity)first=maturity;
  let term={...a,start,first,maturity,autoRenew:false,renewalStop:undefined};
  for(const entry of schedule(term,through))if(!entry.principal||(a.renewalStop&&maturity===a.renewalStop))out.push({...entry,asset:a});
  if(maturity>=through||(a.renewalStop&&maturity===a.renewalStop))break;start=maturity;
 }
 return out;
}
function schedule(a,through){
 if(a.autoRenew&&!legacyRenewal(a))return renewedSchedule(a,through);
 let out=[],last=a.start,p=periodSpec(a),end=endDate(a),limit=end&&end<through?end:through;
 if(!Number.isInteger(p.count)||p.count<1||!['days','months'].includes(p.unit))throw Error('Invalid payout cycle.');
 const standard=p.unit==='days'?days(a.start,p.count):months(a.start,p.count),anchored=a.first===standard;
 for(let n=1;n<=110000;n++){
  let date=p.unit==='days'?days(a.first,(n-1)*p.count):months(anchored?a.start:a.first,anchored?n*p.count:(n-1)*p.count);
  if(date>limit)break;
  let period=n===1?(anchored?(p.unit==='days'?p.count:p.count*30):difference(date,a.start)):(p.unit==='days'?p.count:p.count*30);
  out.push({id:a.id+':'+date,date,asset:a,kind:'Interest',...amount(a,period),principal:0});last=date;
 }
 if(end&&end<=through){if(last<end)out.push({id:a.id+':'+end+':final',date:end,asset:a,kind:'Final interest',...amount(a,difference(end,last)),principal:0});out.push({id:a.id+':principal',date:end,asset:a,kind:'Principal return',gross:0,tax:0,net:a.principal,principal:a.principal});}
 return out;
}
root.FDR={parse,iso,months,days,difference,amount,schedule,periodSpec,cycleLabel,endDate,active,nextMaturity,renewalDate,renewalTerm,legacyRenewal};
})(engineRoot);
/* Stable interchange contract: new releases keep reading formatVersion 1.
 * Legacy fields stay readable by Depositly 1.0. Unknown fields survive round trips. */
(function(root){
const FORMAT='bd.fdr.vault.entries',VERSION=2,READER_VERSION=5,MAX_MONEY=1e13;
const compareInstrumentName=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'en',{numeric:true,sensitivity:'base'});
function normalizedCurrency(value){if(value===undefined)return 'BDT';if(typeof value!=='string'||! /^[A-Za-z]{3}$/.test(value.trim()))throw Error('Invalid currency code in the backup.');return value.trim().toUpperCase();}
const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&root.FDR.iso(root.FDR.parse(s))===s&&s>='1900-01-01'&&s<='2199-12-31';}
function text(v,max,optional=false){return (optional&&v===undefined)||(typeof v==='string'&&v.length<=max);}
function bankText(value,max,optional=false){return optional&&value===undefined||typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)&&(optional||value.trim().length>0);}
function validBankAccount(a){return isObject(a)&&typeof a.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(a.id)&&bankText(a.bankId,100,true)&&bankText(a.bankName,150)&&bankText(a.accountTitle,120)&&bankText(a.accountNumber,100)&&bankText(a.branchName,150)&&bankText(a.routingNumber,100)&&bankText(a.accountType,100,true);}
function validCycle(a){return a.cycleUnit===undefined?[1,3,6,12,100].includes(a.cycle):['days','months'].includes(a.cycleUnit)&&Number.isInteger(a.cycle)&&a.cycle>=1&&a.cycle<=(a.cycleUnit==='days'?36525:1200);}
function validRenewal(a){
 if(a.autoRenew!==undefined&&typeof a.autoRenew!=='boolean')return false;
 if(a.renewalStop!==undefined&&a.renewalStop!==''&&!validDate(a.renewalStop))return false;
 if(a.renewalStop){if(!a.autoRenew||!validDate(a.renewalStop)||a.renewalStop<a.maturity)return false;let n=root.FDR.renewalTerm(a,a.renewalStop);if(root.FDR.renewalDate(a,n)!==a.renewalStop)return false;}
 return true;
}
function validTenure(a){return a.tenureCount===undefined&&a.tenureUnit===undefined||Number.isInteger(a.tenureCount)&&a.tenureCount>0&&['days','months','years'].includes(a.tenureUnit)&&(a.tenureUnit==='days'?root.FDR.days(a.start,a.tenureCount):root.FDR.months(a.start,a.tenureCount*(a.tenureUnit==='years'?12:1)))===a.maturity;}
function validAsset(a){return isObject(a)&&typeof a.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(a.id)&&['FDR','NSC'].includes(a.type)&&text(a.name,120)&&a.name.trim().length>0&&text(a.reference,100,true)&&text(a.notes,500,true)&&text(a.bankId,100,true)&&text(a.bankName,150,true)&&[undefined,'self','others'].includes(a.ownership)&&text(a.ownerName,120,true)&&(a.ownership!=='others'||!!a.ownerName?.trim())&&Number.isSafeInteger(a.principal)&&a.principal>0&&a.principal<=MAX_MONEY&&Number.isFinite(a.rate)&&a.rate>=0&&a.rate<=100&&Number.isFinite(a.tds)&&a.tds>=0&&a.tds<=100&&validCycle(a)&&[a.start,a.first,a.maturity].every(validDate)&&a.start<a.first&&a.first<=a.maturity&&root.FDR.difference(a.maturity,a.start)<=36525&&validRenewal(a)&&validTenure(a);}
function snapshot(p){return {assetId:p.asset.id,name:p.asset.name,type:p.asset.type,scheduledDate:p.date,kind:p.kind,gross:p.gross,tax:p.tax,expected:p.net,principal:p.principal};}
function migrate(input){
 if(!isObject(input))throw Error('This file is not an investment export.');
 if(input.format&&input.format!==FORMAT)throw Error('This export belongs to a different app.');
 if(input.format&&(!Number.isInteger(input.formatVersion)||input.formatVersion<1||!Number.isInteger(input.minReaderVersion)||input.minReaderVersion<1))throw Error('Invalid export compatibility information.');
 if(input.format&&input.minReaderVersion>READER_VERSION)throw Error('This file needs a newer version of Depositly. Update the app before importing.');
 if(!input.format&&![1,2].includes(input.version))throw Error('Unsupported backup version. Update Depositly to import it.');
 if(!Array.isArray(input.assets)||input.assets.length>500||!isObject(input.paid))throw Error('Invalid or oversized investment list.');
 const bankAccounts=input.bankAccounts===undefined?[]:input.bankAccounts,bankIds=new Set();
 if(!Array.isArray(bankAccounts)||bankAccounts.length>500)throw Error('Invalid or oversized bank account list.');
 for(const a of bankAccounts){if(!validBankAccount(a)||bankIds.has(a.id))throw Error('A bank account has invalid details or a duplicate ID.');bankIds.add(a.id);}
 const assets=input.assets.map(a=>({...a,type:['Sanchaypatra','National Savings Certificate','NSC'].includes(a.type)?'NSC':a.type})),ids=new Set();
 for(const a of assets){if(!validAsset(a)||ids.has(a.id))throw Error('An investment has invalid amounts, dates or a duplicate ID.');ids.add(a.id);}
 const scheduled=new Map(assets.flatMap(a=>root.FDR.schedule(a,a.maturity)).map(p=>[p.id,p])),paid={};
 // Legacy 100-day FDRs with a standard first term now renew principal each term.
 // Build legacy snapshots first so received principal/interest records retain their original meaning.
 for(const a of assets)if(a.type==='FDR'&&a.cycleUnit===undefined&&a.cycle===100&&a.autoRenew===undefined&&a.first===root.FDR.days(a.start,100)){if(input.paid[a.id+':principal'])a.autoRenew=false;else{a.autoRenew=true;a.maturity=a.first;a.tenureCount=100;a.tenureUnit='days';}}
 if(Object.keys(input.paid).length>600000)throw Error('Too many payment records.');
 for(const [k,r] of Object.entries(input.paid)){
  if(!/^[a-zA-Z0-9_-]{1,100}:(?:\d{4}-\d{2}-\d{2}(?::final)?|principal)$/.test(k)||!isObject(r)||!Number.isSafeInteger(r.amount)||r.amount<0||r.amount>MAX_MONEY||!validDate(r.date)||!text(r.notes,500,true))throw Error('A payment record has invalid values.');
  let meta=r.snapshot|| (scheduled.has(k)?snapshot(scheduled.get(k)):null);
  if(!meta||!ids.has(meta.assetId)||!text(meta.name,120)||!validDate(meta.scheduledDate)||!['Interest','Final interest','Principal return'].includes(meta.kind)||!['gross','tax','expected','principal'].every(f=>Number.isSafeInteger(meta[f])&&meta[f]>=0)||meta.assetId!==k.split(':')[0])throw Error('A payment is missing its investment or history details.');
  paid[k]={...r,snapshot:{...meta,type:['Sanchaypatra','National Savings Certificate','NSC'].includes(meta.type)?'NSC':meta.type}};
 }
 const result={...input,version:VERSION,assets,paid,bankAccounts:bankAccounts.map(a=>({...a})),dark:!!input.dark,currency:normalizedCurrency(input.currency),numberFormat:typeof input.numberFormat==='string'?input.numberFormat:'south-asian',defaultDepositView:input.defaultDepositView==='grid'?'grid':'card'};
 delete result.format;delete result.formatVersion;delete result.minReaderVersion;delete result.exportedAt;delete result.scope;
 return result;
}
function exportData(state,selectedIds,now=new Date().toISOString()){
 const ids=new Set(selectedIds||state.assets.map(a=>a.id));
 const assets=state.assets.filter(a=>ids.has(a.id)).map(a=>({...a,type:a.type==='NSC'?'Sanchaypatra':a.type})).sort(compareInstrumentName);
 const paid=Object.fromEntries(Object.entries(state.paid).filter(([k])=>ids.has(k.split(':')[0])));
 const result={...state,format:FORMAT,formatVersion:1,minReaderVersion:assets.some(a=>a.autoRenew&&!root.FDR.legacyRenewal(a))?5:normalizedCurrency(state.currency)!=='BDT'?4:assets.some(a=>a.autoRenew||a.cycleUnit!==undefined)?3:assets.some(a=>a.ownership==='others')?2:1,version:1,exportedAt:now,scope:selectedIds?'selected':'all',assets,paid};
 if(selectedIds)delete result.bankAccounts;else result.bankAccounts=(state.bankAccounts||[]).map(a=>({...a}));
 return result;
}
const equivalent=(a,b)=>JSON.stringify([a.type,a.name,a.principal,a.rate,a.tds,root.FDR.periodSpec(a),a.start,a.first,a.maturity,a.reference||'',a.notes||'',a.bankId||'',a.bankName||'',a.ownership||'self',a.ownerName||'',!!a.autoRenew,a.renewalStop||'',a.autoRenew?a.tenureCount||null:null,a.autoRenew?a.tenureUnit||null:null])===JSON.stringify([b.type,b.name,b.principal,b.rate,b.tds,root.FDR.periodSpec(b),b.start,b.first,b.maturity,b.reference||'',b.notes||'',b.bankId||'',b.bankName||'',b.ownership||'self',b.ownerName||'',!!b.autoRenew,b.renewalStop||'',b.autoRenew?b.tenureCount||null:null,b.autoRenew?b.tenureUnit||null:null]);
function merge(current,incoming,preview=false){
 const currencyMismatch=!!current.assets.length&&!!incoming.assets.length&&normalizedCurrency(current.currency)!==normalizedCurrency(incoming.currency);
 if(currencyMismatch&&!preview)throw Error('Currencies differ. Select '+normalizedCurrency(incoming.currency)+' in Settings before merging, or replace using the file’s currency. Amounts are not converted.');
 const result=JSON.parse(JSON.stringify(current)),byId=new Map(result.assets.map(a=>[a.id,a]));let added=0,duplicates=0,conflicts=0,payments=0,paymentConflicts=0,bankAdded=0,bankDuplicates=0,bankConflicts=0;
 result.bankAccounts=result.bankAccounts||[];
 const banksById=new Map(result.bankAccounts.map(a=>[a.id,a])),bankFields=['bankId','bankName','accountTitle','accountNumber','branchName','routingNumber','accountType'];
 for(const a of incoming.bankAccounts||[]){const old=banksById.get(a.id);if(!old){const copy={...a};result.bankAccounts.push(copy);banksById.set(a.id,copy);bankAdded++;}else if(bankFields.every(field=>(old[field]||'')===(a[field]||'')))bankDuplicates++;else bankConflicts++;}
 if(result.bankAccounts.length>500)throw Error('Import would exceed the 500-bank-account limit.');
 result.currency=normalizedCurrency(current.assets.length||!incoming.assets.length?current.currency:incoming.currency);result.numberFormat=current.numberFormat||incoming.numberFormat||'south-asian';
 const accepted=new Set();
 for(const a of incoming.assets){let old=byId.get(a.id);if(!old){result.assets.push(a);byId.set(a.id,a);accepted.add(a.id);added++;}else if(equivalent(old,a)){accepted.add(a.id);duplicates++;}else conflicts++;}
 if(result.assets.length>500)throw Error('Import would exceed the 500-investment limit.');
 for(const [k,r] of Object.entries(incoming.paid)){if(!accepted.has(k.split(':')[0]))continue;if(!result.paid[k]){result.paid[k]=r;payments++;}else if(result.paid[k].amount!==r.amount||result.paid[k].date!==r.date|| (result.paid[k].notes||'')!==(r.notes||''))paymentConflicts++;}
 return {state:result,added,duplicates,conflicts,payments,paymentConflicts,currencyMismatch,bankAdded,bankDuplicates,bankConflicts};
}
function csv(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(typeof v==='string'&&(/^[\s]*[=+@-]/.test(s)||s.startsWith("'")))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
const INSTRUMENT_COLUMNS=['Investment ID','Instrument type','Investment name',"Owner's name",'Ownership','Bank ID','Bank / institution','Certificate reference','Principal','Annual interest rate %','TDS %','Payout cycle','Opening date','Maturity date','First period days','Notes','Payout unit','Tenure value','Tenure unit','Automatic renewal','Renewal term limit','Currency'];
const isPrincipalColumn=h=>/^principal(?: [a-z]{3})?$/i.test(h.trim());
const cycleNames={1:'Monthly',3:'Quarterly',6:'Half-yearly',12:'Yearly',100:'100 Days'};
const isPaymentColumn=h=>/^(?:scheduled date|payment date|received date|date received|first payout date|received amount.*|gross interest.*|net interest.*|expected net.*|tds bdt|interest amount.*|payment amount.*)$/i.test(h.trim());
function instrumentCSV(state,selectedIds){
 const ids=selectedIds?new Set(selectedIds):null,assets=state.assets.filter(a=>!ids||ids.has(a.id)).sort(compareInstrumentName),known=new Set(INSTRUMENT_COLUMNS.map(h=>h.toLowerCase())),extras=[];
 for(const a of assets)if(isObject(a.csvColumns))for(const h of Object.keys(a.csvColumns)){if(h.trim()&&!known.has(h.trim().toLowerCase())&&!isPaymentColumn(h)&&!isPrincipalColumn(h)){known.add(h.trim().toLowerCase());extras.push(h);}}
 const rows=[[...INSTRUMENT_COLUMNS,...extras]];
 for(const a of assets){let p=root.FDR.periodSpec(a),label=a.autoRenew&&root.FDR.legacyRenewal(a)?'Auto-renew 100 Days':a.cycleUnit!==undefined&&!((p.unit==='months'&&[1,3,6,12].includes(p.count))||(p.unit==='days'&&p.count===100))?'Custom '+p.count+' '+p.unit:cycleNames[a.cycle];rows.push([a.id,a.type==='NSC'?'National Savings Certificate':a.type,a.name,a.ownerName||'',a.ownership==='others'?'Others':'Self',a.bankId||'',a.bankName||'',a.reference||'',a.principal/100,a.rate,a.tds,label,a.start,a.maturity,root.FDR.difference(a.first,a.start),a.notes||'',a.cycleUnit||'',a.tenureCount||'',a.tenureUnit||'',a.autoRenew===undefined?'':a.autoRenew?'Yes':'No',a.renewalStop?root.FDR.renewalTerm(a,a.renewalStop):'',normalizedCurrency(state.currency),...extras.map(h=>{let columns=a.csvColumns||{},key=Object.keys(columns).find(k=>k.trim().toLowerCase()===h.trim().toLowerCase());return columns[key]??'';})]);}
 return csv(rows);
}
function parseCSV(input){
 if(typeof input!=='string'||input.length>20000000)throw Error('CSV file is too large.');
 let rows=[],row=[],cell='',quoted=false,closed=false;input=input.replace(/^\ufeff/,'');
 const endCell=()=>{row.push(cell);cell='';closed=false;if(row.length>128)throw Error('CSV has too many columns.');};
 const endRow=()=>{endCell();if(row.some(c=>c.trim()))rows.push(row);row=[];if(rows.length>501)throw Error('CSV exceeds the 500-investment limit.');};
 for(let i=0;i<input.length;i++){let c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===','){endCell();continue;}if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;endRow();continue;}
  if(closed){if(c===' '||c==='\t')continue;throw Error('Invalid text after a quoted CSV field.');}
  if(c==='"'){if(cell.length)throw Error('Invalid quotation in CSV.');quoted=true;}else cell+=c;
 }
 if(quoted)throw Error('CSV has an unfinished quoted field.');if(cell.length||row.length||closed)endRow();
 if(!rows.length)throw Error('CSV is empty.');return rows;
}
function readInstrumentCSV(input){
 const rows=parseCSV(input),unescape=s=>s.startsWith("''")||(s.startsWith("'")&&/^[\s]*[=+@-]/.test(s.slice(1)))?s.slice(1):s;
 const header=rows.shift().map(unescape),normalized=header.map(h=>h.trim().toLowerCase());
 if(new Set(normalized).size!==normalized.length)throw Error('CSV has duplicate column names.');
 const required=['Instrument type','Investment name','Annual interest rate %','TDS %','Payout cycle','Opening date','Maturity date'];
 for(const h of required)if(!normalized.includes(h.toLowerCase()))throw Error('Investment CSV is missing the '+h+' column. Export an investment CSV from the data manager.');
 const principalColumns=header.filter(isPrincipalColumn);if(principalColumns.length!==1)throw Error('CSV must contain one Principal column (older Principal BDT files are supported).');const principalColumn=principalColumns[0];let fileCurrency=null;
 if(header.some(isPaymentColumn))throw Error('Import an investment-only CSV without payment dates or payment amounts. Use JSON to restore receipt history.');
 const numeric=(value,label)=>{let v=value.trim().replace(/%$/,'');if(!/^\d+(?:\.\d+)?$/.test(v))throw Error('Invalid '+label+' in CSV.');return Number(v);};
 const stableId=a=>{let s=JSON.stringify(a),x=2166136261,y=5381;for(let i=0;i<s.length;i++){x=Math.imul(x^s.charCodeAt(i),16777619);y=Math.imul(y,33)^s.charCodeAt(i);}return 'csv'+(x>>>0).toString(36)+'_'+(y>>>0).toString(36);};
 const assets=rows.map((row,index)=>{
  if(row.length!==header.length)throw Error('CSV row '+(index+2)+' has the wrong number of columns.');
  const get=name=>{let i=normalized.indexOf(name.toLowerCase());return i<0?'':unescape(row[i]);};
  let rawCycle=get('Payout cycle').trim().toLowerCase(),custom=/^custom (\d+) (days|months)$/.exec(rawCycle),renewLabel=rawCycle==='auto-renew 100 days',cycleText=rawCycle.replace(/[\s-]/g,''),cycle=custom?Number(custom[1]):renewLabel?100:{monthly:1,'1month':1,quarterly:3,'3months':3,halfyearly:6,'6months':6,yearly:12,'12months':12,'100days':100}[cycleText]||Number(cycleText),unit=custom?.[2]||get('Payout unit').trim().toLowerCase();
  let start=get('Opening date').trim(),maturity=get('Maturity date').trim();if(!validDate(start)||!validDate(maturity))throw Error('CSV dates must use YYYY-MM-DD (row '+(index+2)+').');
  if(!validCycle({cycle,cycleUnit:unit||undefined}))throw Error('Invalid payout cycle in CSV row '+(index+2)+'.');
  let period=get('First period days').trim(),first;if(period){let n=numeric(period,'first period days');if(!Number.isInteger(n)||n<1||n>36525)throw Error('Invalid first period days in CSV.');first=root.FDR.days(start,n);}else first=(unit|| (cycle===100?'days':'months'))==='days'?root.FDR.days(start,cycle):root.FDR.months(start,cycle);
  let amount=get(principalColumn).trim();if(amount.includes(',')){if(!/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(amount))throw Error('Principal has invalid comma grouping.');amount=amount.replace(/,/g,'');}if(!/^\d+(?:\.\d{1,2})?$/.test(amount))throw Error('Principal must be positive with up to two decimal places.');
  let headingCurrency=/^principal ([a-z]{3})$/i.exec(principalColumn.trim())?.[1]?.toUpperCase(),rowCurrency=normalizedCurrency(get('Currency').trim()||headingCurrency||'BDT');if(headingCurrency&&rowCurrency!==headingCurrency)throw Error('Currency conflicts with the principal column.');if(fileCurrency&&fileCurrency!==rowCurrency)throw Error('Use one currency per investment CSV.');fileCurrency=rowCurrency;
  let type=get('Instrument type').trim(),ownership=(get('Ownership').trim()||'Self').toLowerCase();
  if(type.toUpperCase()==='FDR')type='FDR';else if(['nsc','national savings certificate','sanchaypatra'].includes(type.toLowerCase()))type='NSC';
  let a={type,name:get('Investment name'),ownerName:get("Owner's name"),ownership,bankId:get('Bank ID'),bankName:get('Bank / institution'),reference:get('Certificate reference'),principal:Math.round(Number(amount)*100),rate:numeric(get('Annual interest rate %'),'annual interest rate'),tds:numeric(get('TDS %'),'TDS'),cycle,start,maturity,first,notes:get('Notes')};
  if(unit)a.cycleUnit=unit;
  let renew=get('Automatic renewal').trim().toLowerCase();if(renew&&!['yes','no'].includes(renew))throw Error('Automatic renewal must be Yes or No.');if(renew||renewLabel)a.autoRenew=renewLabel||renew==='yes';
  if(get('Tenure value').trim()){a.tenureCount=numeric(get('Tenure value'),'tenure');a.tenureUnit=get('Tenure unit').trim().toLowerCase();}
  if(get('Renewal term limit').trim()){let n=numeric(get('Renewal term limit'),'renewal term limit');if(!a.autoRenew||!Number.isInteger(n)||n<1)throw Error('Invalid renewal term limit.');a.renewalStop=root.FDR.renewalDate(a,n);}
  a.id=get('Investment ID').trim()||stableId(a);let extra=Object.fromEntries(header.map((h,i)=>[h,unescape(row[i])]).filter(([h])=>!INSTRUMENT_COLUMNS.some(c=>c.toLowerCase()===h.trim().toLowerCase())&&!isPrincipalColumn(h)));if(Object.keys(extra).length)a.csvColumns=extra;
  if(!validAsset(a))throw Error('Invalid investment details in CSV row '+(index+2)+'. Check the owner, amounts, rates and dates.');return a;
 });
 return migrate({version:VERSION,assets,paid:{},dark:false,currency:fileCurrency||'BDT'});
}
root.Transfer={FORMAT,VERSION,validDate,validAsset,validBankAccount,snapshot,migrate,exportData,merge,csv,INSTRUMENT_COLUMNS,instrumentCSV,readInstrumentCSV};
})(engineRoot);

// These exports retain Android's integer-paisa arithmetic and interchange format.
export const FDR = engineRoot.FDR;
export const Transfer = engineRoot.Transfer;
export const MAX_MONEY = 1e13;
export const CurrencyOptions = [
  ['BDT', 'Bangladeshi Taka', '৳'], ['USD', 'US Dollar', '$'],
  ['INR', 'Indian Rupee', '₹'], ['PKR', 'Pakistani Rupee', 'Rs '],
  ['NPR', 'Nepalese Rupee', 'रू '], ['LKR', 'Sri Lankan Rupee', 'Rs '],
  ['GBP', 'British Pound', '£'], ['EUR', 'Euro', '€'],
  ['AUD', 'Australian Dollar', 'A$'], ['CAD', 'Canadian Dollar', 'CA$'],
  ['SGD', 'Singapore Dollar', 'S$'], ['SAR', 'Saudi Riyal', 'SAR '],
  ['AED', 'UAE Dirham', 'AED ']
];
export const today = () => FDR.iso(new Date());
export const isSelf = asset => asset.ownership !== 'others';
export const compareName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', {numeric: true, sensitivity: 'base'});
export const emptyState = () => ({version: 2, assets: [], paid: {}, bankAccounts: [], dark: false, currency: 'BDT', numberFormat: 'south-asian', defaultDepositView: 'card'});
export function formatMoney(paisa, state = emptyState()) {
  const code = state.currency || 'BDT';
  const symbol = CurrencyOptions.find(row => row[0] === code)?.[2] || code + ' ';
  const units = Math.ceil(Number(paisa) / 100), digits = String(Math.abs(units));
  const grouped = state.numberFormat === 'international'
    ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : digits.length <= 3 ? digits : digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + digits.slice(-3);
  return (units < 0 ? '-' : '') + symbol + grouped;
}
export function formatDate(value) {
  if (!Transfer.validDate(value)) return '—';
  const parsed = FDR.parse(value);
  return `${parsed.getDate()} ${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][parsed.getMonth()]}, ${parsed.getFullYear()}`;
}
export const eventHorizon = (on = today()) => {
  const value = FDR.months(on, 24);
  return value > '2199-12-31' ? '2199-12-31' : value;
};
// Skip directly to a visible window rather than building decades of daily payouts.
// FDR.schedule above remains the unmodified Android implementation.
export function scheduleRange(asset, {from = '1900-01-01', through = eventHorizon(), limit = Infinity} = {}) {
  if (!Transfer.validDate(from) || !Transfer.validDate(through) || from > through || limit <= 0) return [];
  if (asset.autoRenew && !FDR.legacyRenewal(asset)) {
    const result = [], period = FDR.periodSpec(asset);
    let termNumber = Math.max(1, FDR.renewalTerm(asset, from));
    let start = termNumber === 1 ? asset.start : FDR.renewalDate(asset, termNumber - 1);
    for (; termNumber <= 110000 && start < through && result.length < limit; termNumber++) {
      const maturity = FDR.renewalDate(asset, termNumber);
      if (asset.renewalStop && maturity > asset.renewalStop) break;
      let first = termNumber === 1 ? asset.first : period.unit === 'days' ? FDR.days(start, period.count) : FDR.months(start, period.count);
      if (first > maturity) first = maturity;
      const term = {...asset, start, first, maturity, autoRenew: false, renewalStop: undefined};
      for (const entry of scheduleRange(term, {from, through})) {
        if (!entry.principal || asset.renewalStop && maturity === asset.renewalStop) result.push({...entry, asset});
        if (result.length >= limit) break;
      }
      if (maturity >= through || asset.renewalStop && maturity === asset.renewalStop) break;
      start = maturity;
    }
    return result;
  }
  const period = FDR.periodSpec(asset), end = FDR.endDate(asset);
  const last = end && end < through ? end : through;
  const standard = period.unit === 'days' ? FDR.days(asset.start, period.count) : FDR.months(asset.start, period.count), anchored = asset.first === standard;
  const at = n => {
    const value = period.unit === 'days' ? FDR.days(asset.first, (n - 1) * period.count) : FDR.months(anchored ? asset.start : asset.first, anchored ? n * period.count : (n - 1) * period.count);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '9999-12-31';
  };
  const lower = (value, strict = false) => {
    let lo = 1, hi = 110001;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2), day = at(mid); if (strict ? day <= value : day < value) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const result = [];
  for (let n = lower(from); n <= 110000 && result.length < limit; n++) {
    const date = at(n);
    if (date > last) break;
    const days = n === 1 ? anchored ? period.unit === 'days' ? period.count : period.count * 30 : FDR.difference(date, asset.start) : period.unit === 'days' ? period.count : period.count * 30;
    result.push({id: asset.id + ':' + date, date, asset, kind: 'Interest', ...FDR.amount(asset, days), principal: 0});
  }
  if (end && end >= from && end <= through && result.length < limit) {
    const previousIndex = Math.min(lower(end, true) - 1, 110000), previous = previousIndex > 0 ? at(previousIndex) : asset.start;
    if (previous < end) result.push({id: asset.id + ':' + end + ':final', date: end, asset, kind: 'Final interest', ...FDR.amount(asset, FDR.difference(end, previous)), principal: 0});
    if (result.length < limit) result.push({id: asset.id + ':principal', date: end, asset, kind: 'Principal return', gross: 0, tax: 0, net: asset.principal, principal: asset.principal});
  }
  return result;
}
// Workspace mutations replace assets/paid. Cache only a few read-only date windows,
// sharing them across navigation and display-preference changes.
const eventWindowCache = new WeakMap();
function cachedWindow(state, key, build) {
  let byPayments = eventWindowCache.get(state.assets);
  if (!byPayments) { byPayments = new WeakMap(); eventWindowCache.set(state.assets, byPayments); }
  let windows = byPayments.get(state.paid);
  if (!windows) { windows = new Map(); byPayments.set(state.paid, windows); }
  if (!windows.has(key)) {
    if (windows.size >= 4) windows.delete(windows.keys().next().value);
    windows.set(key, Object.freeze(build()));
  }
  return windows.get(key);
}
export function eventsRange(state, {from = '1900-01-01', through = eventHorizon(), includeAllReceipts = false} = {}) {
  return cachedWindow(state, `range:${from}:${through}:${includeAllReceipts}`, () => {
  const list = state.assets.flatMap(asset => scheduleRange(asset, {from, through}));
  const ids = new Set(list.map(event => event.id));
  const byAsset = new Map(state.assets.map(asset => [asset.id, asset]));
  for (const [id, receipt] of Object.entries(state.paid)) {
    if (!ids.has(id) && receipt.snapshot && (includeAllReceipts || receipt.snapshot.scheduledDate >= from && receipt.snapshot.scheduledDate <= through)) {
      const saved = receipt.snapshot, asset = byAsset.get(saved.assetId);
      if (asset) list.push({id, date: saved.scheduledDate, asset: {...asset, name: saved.name}, kind: saved.kind, gross: saved.gross, tax: saved.tax, net: saved.expected, principal: saved.principal, historical: true});
    }
  }
  return list.sort((a, b) => a.date.localeCompare(b.date) || compareName(a.asset, b.asset) || a.id.localeCompare(b.id));
  });
}
export function events(state, through, on = today()) {
  const horizon = through || eventHorizon(on);
  return cachedWindow(state, `events:${horizon}:${!through}:${on}`, () => {
  const list = [...eventsRange(state, {through: horizon, includeAllReceipts: !through})];
  // Keep each deposit's next payment available even for very long payout cycles.
  if (!through && horizon < '2199-12-31') {
    const hasUpcoming = new Set(list.filter(event => event.date >= on && !state.paid[event.id]).map(event => event.asset.id));
    for (const asset of state.assets) if (!hasUpcoming.has(asset.id)) {
      const next = scheduleRange(asset, {from: FDR.days(horizon, 1), through: '2199-12-31', limit: 1})[0];
      if (next && !list.some(event => event.id === next.id)) list.push(next);
    }
    list.sort((a, b) => a.date.localeCompare(b.date) || compareName(a.asset, b.asset) || a.id.localeCompare(b.id));
  }
  return list;
  });
}
export function eventById(state, id) {
  const asset = state.assets.find(value => value.id === String(id).split(':')[0]);
  if (!asset) return undefined;
  const saved = state.paid[id]?.snapshot;
  if (saved) return {id, date: saved.scheduledDate, asset: {...asset, name: saved.name}, kind: saved.kind, gross: saved.gross, tax: saved.tax, net: saved.expected, principal: saved.principal, historical: true};
  const date = id.endsWith(':principal') ? FDR.endDate(asset) : id.split(':')[1];
  if (!date || !Transfer.validDate(date)) return undefined;
  return scheduleRange(asset, {from: date, through: date}).find(value => value.id === id);
}
export const selfEvents = (state, through, on) => events(state, through, on).filter(event => isSelf(event.asset));
export function forecast(state, horizon = 30, on = today()) {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 36525 || !Transfer.validDate(on)) throw Error('Choose a valid forecast period.');
  const assets = state.assets.filter(asset => isSelf(asset) && FDR.active(asset, on)).sort(compareName).map(asset => ({asset, ...FDR.amount(asset, horizon)}));
  return assets.reduce((sum, item) => ({...sum, gross: sum.gross + item.gross, tax: sum.tax + item.tax, net: sum.net + item.net}), {gross: 0, tax: 0, net: 0, horizon, assets});
}
export function summary(state, on = today()) {
  if (!Transfer.validDate(on)) throw Error('Choose a valid summary date.');
  const active = state.assets.filter(asset => isSelf(asset) && FDR.active(asset, on));
  const principal = active.reduce((sum, asset) => sum + asset.principal, 0);
  const fdr = active.filter(asset => asset.type === 'FDR').reduce((sum, asset) => sum + asset.principal, 0), nsc = principal - fdr;
  const all = selfEvents(state, undefined, on), upcoming = all.filter(event => !state.paid[event.id] && event.date >= on), overdue = all.filter(event => !state.paid[event.id] && event.date < on);
  const next30 = upcoming.filter(event => event.date <= FDR.days(on, 30));
  const paid = all.filter(event => state.paid[event.id]);
  const received = paid.reduce((sum, event) => sum + state.paid[event.id].amount, 0);
  const interestReceived = paid.filter(event => !event.principal).reduce((sum, event) => sum + state.paid[event.id].amount, 0);
  return {principal, fdr, nsc, activeCount: active.length, totalCount: state.assets.length, through: eventHorizon(on),
    monthlyIncome: forecast(state, 30, on).net, received, interestReceived, principalReceived: received - interestReceived,
    upcoming, overdue, next30, next30Interest: next30.filter(event => !event.principal).reduce((sum, event) => sum + event.net, 0), next30Total: next30.reduce((sum, event) => sum + event.net, 0),
    allocations: [{type: 'FDR', principal: fdr, percent: principal ? fdr / principal * 100 : 0}, {type: 'NSC', principal: nsc, percent: principal ? nsc / principal * 100 : 0}]};
}
export function normalizeBackup(input) {
  if (typeof input === 'string') {
    if (input.length > 20_000_000) throw Error('Backup is too large.');
    try { input = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { throw Error('This file is not valid JSON.'); }
  }
  let notificationSettings;
  if (input?.format === 'depositly-google-drive') {
    if (input.version !== 1 || input.data?.scope !== 'all') throw Error('Unsupported Google Drive backup.');
    notificationSettings = input.notificationSettings;
    if (notificationSettings && (typeof notificationSettings.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(notificationSettings.time))) throw Error('The backup’s reminder settings are invalid.');
    input = input.data;
  }
  const data = Transfer.migrate(input);
  if (!['south-asian', 'international'].includes(data.numberFormat)) throw Error('The backup’s number format is invalid.');
  return {data, notificationSettings};
}
export function createCloudBackup(state, notificationSettings = {enabled: false, time: '09:00'}) {
  const data = Transfer.exportData(state);
  delete data.exportedAt;
  const result = {format: 'depositly-google-drive', version: 1, data, notificationSettings: {...notificationSettings}};
  normalizeBackup(result);
  return result;
}
export function upsertAsset(state, asset) {
  const saved = {...asset};
  if (!saved.id) saved.id = 'a' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  if (!Transfer.validAsset(saved)) throw Error('Check the investment’s name, owner, amounts, dates, term and payout cycle.');
  const exists = state.assets.some(value => value.id === saved.id);
  if (!exists && state.assets.length >= 500) throw Error('The maximum is 500 investments. Export or remove an entry first.');
  const next = {...state, assets: exists ? state.assets.map(value => value.id === saved.id ? saved : value) : [...state.assets, saved], paid: {...state.paid}};
  // Preserve contractual receipt snapshots before an edited schedule changes.
  for (const [id, receipt] of Object.entries(next.paid)) if (!receipt.snapshot) {
    const oldEvent = eventById(state, id);
    if (oldEvent) next.paid[id] = {...receipt, snapshot: Transfer.snapshot(oldEvent)};
  }
  return next;
}
export function deleteAsset(state, id) {
  return {...state, assets: state.assets.filter(asset => asset.id !== id), paid: Object.fromEntries(Object.entries(state.paid).filter(([key]) => key.split(':')[0] !== id))};
}
export function upsertBankAccount(state, account) {
  const saved = {...account};
  if (!saved.id) saved.id = 'bank' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  if (!Transfer.validBankAccount(saved)) throw Error('Choose a bank and complete the account title, account number, branch name and routing number.');
  const accounts = state.bankAccounts || [], exists = accounts.some(value => value.id === saved.id);
  if (!exists && accounts.length >= 500) throw Error('The maximum is 500 bank accounts. Export or remove an account first.');
  return {...state, bankAccounts: exists ? accounts.map(value => value.id === saved.id ? saved : value) : [...accounts, saved]};
}
export function deleteBankAccount(state, id) {
  return {...state, bankAccounts: (state.bankAccounts || []).filter(account => account.id !== id)};
}
export function bankAccountText(account) {
  return `Account Title: ${account.accountTitle}\nBank Name: ${account.bankName}\nBranch Name: ${account.branchName}\nAccount Number: ${account.accountNumber}\nRouting Number: ${account.routingNumber}`;
}
export function recordPayment(state, id, receipt) {
  const event = eventById(state, id);
  if (!event) throw Error('This payment no longer exists.');
  if (!receipt || !Number.isSafeInteger(receipt.amount) || receipt.amount < 0 || receipt.amount > MAX_MONEY || !Transfer.validDate(receipt.date) || (receipt.notes !== undefined && (typeof receipt.notes !== 'string' || receipt.notes.length > 500))) throw Error('Enter a valid amount, receipt date and note.');
  return {...state, paid: {...state.paid, [id]: {...state.paid[id], ...receipt, snapshot: state.paid[id]?.snapshot || Transfer.snapshot(event)}}};
}
export function removePayment(state, id) {
  const paid = {...state.paid};
  delete paid[id];
  return {...state, paid};
}


export const BankCatalog = [{"id":"ab-bank-plc","aliases":[],"name":"AB Bank PLC"},{"id":"agrani-bank-plc","aliases":[],"name":"Agrani Bank PLC"},{"id":"al-arafah-islami-bank-plc","aliases":[],"name":"Al-Arafah Islami Bank PLC"},{"id":"ansar-vdp-unnayan-bank","aliases":[],"name":"Ansar VDP Unnayan Bank"},{"id":"bangladesh-bank","aliases":[],"name":"Bangladesh Bank"},{"id":"bangladesh-commerce-bank-limited","aliases":[],"name":"Bangladesh Commerce Bank Limited"},{"id":"bangladesh-development-bank-plc","aliases":["BDBL"],"name":"Bangladesh Development Bank PLC"},{"id":"bangladesh-krishi-bank","aliases":[],"name":"Bangladesh Krishi Bank"},{"id":"bank-al-falah-limited","aliases":[],"name":"Bank Al-Falah Limited"},{"id":"bank-asia-plc","aliases":[],"name":"Bank Asia PLC"},{"id":"basic-bank-plc","aliases":[],"name":"BASIC Bank PLC"},{"id":"bengal-commercial-bank-plc","aliases":[],"name":"Bengal Commercial Bank PLC"},{"id":"brac-bank-plc","aliases":[],"name":"BRAC Bank PLC"},{"id":"citibank-n-a","aliases":[],"name":"Citibank N.A"},{"id":"citizens-bank-plc","aliases":[],"name":"Citizens Bank PLC"},{"id":"city-bank-plc","aliases":[],"name":"City Bank PLC"},{"id":"commercial-bank-of-ceylon-limited","aliases":[],"name":"Commercial Bank of Ceylon Limited"},{"id":"community-bank-bangladesh-plc","aliases":[],"name":"Community Bank Bangladesh PLC"},{"id":"dhaka-bank-plc","aliases":[],"name":"Dhaka Bank PLC"},{"id":"dutch-bangla-bank-plc","aliases":["DBBL"],"name":"Dutch-Bangla Bank PLC"},{"id":"eastern-bank-plc","aliases":["EBL"],"name":"Eastern Bank PLC"},{"id":"export-import-bank-of-bangladesh-plc","aliases":["EXIM"],"name":"Export Import Bank of Bangladesh PLC"},{"id":"first-security-islami-bank-plc","aliases":["FSIB"],"name":"First Security Islami Bank PLC"},{"id":"global-islami-bank-plc","aliases":[],"name":"Global Islami Bank PLC"},{"id":"grameen-bank","aliases":[],"name":"Grameen Bank"},{"id":"habib-bank-ltd","aliases":[],"name":"Habib Bank Ltd."},{"id":"icb-islamic-bank-ltd","aliases":[],"name":"ICB Islamic Bank Ltd."},{"id":"ific-bank-plc","aliases":[],"name":"IFIC Bank PLC"},{"id":"islami-bank-bangladesh-plc","aliases":["IBBL"],"name":"Islami Bank Bangladesh PLC"},{"id":"jamuna-bank-plc","aliases":[],"name":"Jamuna Bank PLC"},{"id":"janata-bank-plc","aliases":[],"name":"Janata Bank PLC"},{"id":"jubilee-bank","aliases":[],"name":"Jubilee Bank"},{"id":"karmashangosthan-bank","aliases":[],"name":"Karmashangosthan Bank"},{"id":"meghna-bank-plc","aliases":[],"name":"Meghna Bank PLC"},{"id":"mercantile-bank-plc","aliases":[],"name":"Mercantile Bank PLC"},{"id":"midland-bank-limited","aliases":[],"name":"Midland Bank Limited"},{"id":"modhumoti-bank-plc","aliases":[],"name":"Modhumoti Bank PLC"},{"id":"mutual-trust-bank-plc","aliases":["MTB"],"name":"Mutual Trust Bank PLC"},{"id":"nagad-digital-bank-plc","aliases":[],"name":"Nagad Digital Bank PLC"},{"id":"national-bank-of-pakistan","aliases":[],"name":"National Bank of Pakistan"},{"id":"national-bank-plc","aliases":[],"name":"National Bank PLC"},{"id":"national-credit-commerce-bank-plc","aliases":["NCC"],"name":"National Credit & Commerce Bank PLC"},{"id":"nrb-bank-plc","aliases":[],"name":"NRB Bank PLC"},{"id":"nrbc-bank-plc","aliases":[],"name":"NRBC Bank PLC"},{"id":"one-bank-plc","aliases":[],"name":"One Bank PLC"},{"id":"padma-bank-plc","aliases":[],"name":"Padma Bank PLC"},{"id":"palli-sanchay-bank","aliases":[],"name":"Palli Sanchay Bank"},{"id":"prime-bank-plc","aliases":[],"name":"Prime Bank PLC"},{"id":"probashi-kollyan-bank","aliases":[],"name":"Probashi Kollyan Bank"},{"id":"pubali-bank-plc","aliases":[],"name":"Pubali Bank PLC"},{"id":"rajshahi-krishi-unnayan-bank","aliases":[],"name":"Rajshahi Krishi Unnayan Bank"},{"id":"rupali-bank-plc","aliases":[],"name":"Rupali Bank PLC"},{"id":"sammilito-islami-bank-plc","aliases":[],"name":"Sammilito Islami Bank PLC"},{"id":"sbac-bank-plc","aliases":[],"name":"SBAC Bank PLC"},{"id":"shahjalal-islami-bank-plc","aliases":[],"name":"Shahjalal Islami Bank PLC"},{"id":"shimanto-bank-plc","aliases":[],"name":"Shimanto Bank PLC"},{"id":"social-islami-bank-plc","aliases":[],"name":"Social Islami Bank PLC"},{"id":"sonali-bank-plc","aliases":[],"name":"Sonali Bank PLC"},{"id":"southeast-bank-plc","aliases":[],"name":"Southeast Bank PLC"},{"id":"standard-chartered-bank","aliases":["SCB"],"name":"Standard Chartered Bank"},{"id":"standard-islami-bank-plc","aliases":[],"name":"Standard Islami Bank PLC"},{"id":"state-bank-of-india","aliases":[],"name":"State Bank of India"},{"id":"the-hong-kong-and-shanghai-banking-corporation-ltd","aliases":["HSBC"],"name":"The Hong Kong and Shanghai Banking Corporation. Ltd."},{"id":"the-premier-bank-plc","aliases":["Premier"],"name":"The Premier Bank PLC"},{"id":"trust-bank-plc","aliases":[],"name":"Trust Bank PLC"},{"id":"union-bank-plc","aliases":[],"name":"Union Bank PLC"},{"id":"united-commercial-bank-plc","aliases":["UCB"],"name":"United Commercial Bank PLC"},{"id":"uttara-bank-plc","aliases":[],"name":"Uttara Bank PLC"},{"id":"woori-bank","aliases":[],"name":"Woori Bank"}];
export const bankLabel = asset => BankCatalog.find(bank => bank.id === asset.bankId)?.name || asset.bankName || '';
