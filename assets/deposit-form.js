import {FDR,Transfer,today} from './data-engine.js';

export function inferredTenure(asset){
 if(Number.isInteger(asset.tenureCount)&&asset.tenureCount>0&&['days','months','years'].includes(asset.tenureUnit))return {count:asset.tenureCount,unit:asset.tenureUnit};
 if(asset.maturity===FDR.days(asset.start,100))return {count:100,unit:'days'};
 if(asset.maturity===FDR.months(asset.start,36))return {count:3,unit:'years'};
 if(asset.maturity===FDR.months(asset.start,12))return {count:1,unit:'years'};
 return {count:FDR.difference(asset.maturity,asset.start),unit:'days'};
}

/** Keep the contract explicit: compounding happens only at whole-term maturity. */
export function draftDeposit(values,old){
 const get=key=>String(values[key]??''),type=get('type'),interestType=get('interestType')||old?.interestType||'simple';
 if(!['simple','compound'].includes(interestType))throw Error('Choose simple or compound interest.');
 let cycle=Number(get('cycle')),cycleUnit=get('cycleUnit'),tenureCount=Number(get('tenureCount')),tenureUnit=get('tenureUnit'),start=get('start'),maturity=get('maturity'),first=get('first');
 if(!Number.isInteger(tenureCount)||tenureCount<1||!['days','months','years'].includes(tenureUnit))throw Error('Enter a positive whole term length and choose its unit.');
 const calculated=tenureUnit==='days'?FDR.days(start,tenureCount):FDR.months(start,tenureCount*(tenureUnit==='years'?12:1));
 if(interestType==='compound'){
  if(calculated!==maturity)throw Error('Compound interest needs a term length and unit matching its maturity date.');
  cycleUnit=tenureUnit==='days'?'days':'months';cycle=tenureCount*(tenureUnit==='years'?12:1);first=maturity;
 }else if(type==='FDR'&&(cycleUnit==='days'&&cycle===100||tenureUnit==='days'&&tenureCount===100)){
  cycle=100;cycleUnit='days';tenureCount=100;tenureUnit='days';maturity=first=FDR.days(start,100);
 }
 const asset={...old,type,interestType,name:get('name').trim(),ownership:get('ownership'),ownerName:get('ownerName').trim(),reference:get('reference'),principal:Math.round(Number(get('principal'))*100),start,first,maturity,rate:Number(get('rate')),tds:Number(get('tds')),cycle,cycleUnit,autoRenew:type==='FDR'&&(values.autoRenew==='on'||values.autoRenew===true),notes:get('notes')};
 if(Object.hasOwn(values,'bankAccountId')){if(get('bankAccountId').trim())asset.bankAccountId=get('bankAccountId').trim();else delete asset.bankAccountId;}
 if(calculated===maturity||interestType==='compound'||tenureCount===100&&tenureUnit==='days'){asset.tenureCount=tenureCount;asset.tenureUnit=tenureUnit;}else{delete asset.tenureCount;delete asset.tenureUnit;}
 if(asset.autoRenew&&get('renewalStop')&&(!old||old.start===start&&old.maturity===maturity&&old.tenureCount===asset.tenureCount&&old.tenureUnit===asset.tenureUnit))asset.renewalStop=get('renewalStop');else delete asset.renewalStop;
 if(asset.ownership==='others'&&!asset.ownerName)throw Error('Enter the owner’s name for an Others deposit.');
 if(interestType==='compound')FDR.compoundBalance(asset,today());
 return asset;
}

export function firstPayoutEstimate(asset){
 if(!Transfer.validAsset({...asset,id:asset.id||'preview',name:asset.name||'Preview'}))return null;
 if(asset.interestType==='compound')return FDR.termInterest(asset,FDR.compoundBalance(asset,today()),asset.start,asset.maturity).net;
 return FDR.schedule({...asset,autoRenew:false,renewalStop:undefined},asset.maturity).find(event=>!event.principal)?.net??0;
}
