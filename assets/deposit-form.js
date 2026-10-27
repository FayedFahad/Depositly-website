import {FDR,Transfer,today} from './data-engine.js';

export function inferredTenure(asset){
 if(!asset?.start)return {count:3,unit:'years'};
 if(Number.isInteger(asset.tenureCount)&&asset.tenureCount>0&&['days','months','years'].includes(asset.tenureUnit))return {count:asset.tenureCount,unit:asset.tenureUnit};
 if(asset.maturity===FDR.days(asset.start,100))return {count:100,unit:'days'};
 if(asset.maturity===FDR.months(asset.start,36))return {count:3,unit:'years'};
 if(asset.maturity===FDR.months(asset.start,12))return {count:1,unit:'years'};
 return {count:FDR.difference(asset.maturity,asset.start),unit:'days'};
}

/** The phone's presets retain explicit custom day/month terms on edit. */
export function depositFormChoices(asset){
 const term=inferredTenure(asset),p=asset?FDR.periodSpec(asset):{count:3,unit:'months'};
 return {payoutChoice:p.unit==='months'&&[1,3,6,12].includes(p.count)?String(p.count):p.unit==='days'&&p.count===100?'100':'custom',customPayoutCount:p.count,customPayoutUnit:p.unit,
  tenureChoice:term.unit==='days'&&term.count===100?'100days':term.unit==='years'&&term.count===1?'1year':term.unit==='years'&&term.count===3?'3years':'custom',customTenureCount:term.count,customTenureUnit:term.unit};
}

/** Mirror Android draftInvestment: dates are derived from cycle and tenure. */
export function draftDeposit(values,old){
 const get=key=>String(values[key]??''),type=get('type'),interestType=get('interestType')||old?.interestType||'simple';
 if(!['simple','compound'].includes(interestType))throw Error('Choose simple or compound interest.');
 let cycle=Number(values.payoutChoice||values.cycle||3),cycleUnit='months';
 if(values.payoutChoice==='custom'){cycle=Number(values.customPayoutCount);cycleUnit=values.customPayoutUnit;}
 else if(cycle===100)cycleUnit='days';
 else if(!values.payoutChoice&&old)cycleUnit=FDR.periodSpec(old).unit;
 const start=get('start'),choice=values.tenureChoice||depositFormChoices(old).tenureChoice;
 let tenureCount,tenureUnit;
 if(interestType==='simple'&&type==='FDR'&&cycleUnit==='days'&&cycle===100){tenureCount=100;tenureUnit='days';}
 else if(choice==='custom'){tenureCount=Number(values.customTenureCount);tenureUnit=values.customTenureUnit;}
 else [tenureCount,tenureUnit]=choice==='100days'?[100,'days']:choice==='1year'?[1,'years']:[3,'years'];
 if(interestType==='compound'){cycleUnit=tenureUnit==='days'?'days':'months';cycle=tenureCount*(tenureUnit==='years'?12:1);}
 else if(type==='FDR'&&tenureCount===100&&tenureUnit==='days'){cycleUnit='days';cycle=100;}
 if(!Number.isInteger(cycle)||cycle<1||!['days','months'].includes(cycleUnit)||!Number.isInteger(tenureCount)||tenureCount<1||!['days','months','years'].includes(tenureUnit))throw Error('Enter a positive whole number for the custom cycle and tenure.');
 if(!Transfer.validDate(start))throw Error('Enter a valid issue date.');
 const maturity=tenureUnit==='days'?FDR.days(start,tenureCount):FDR.months(start,tenureCount*(tenureUnit==='years'?12:1)),autoRenew=type==='FDR'&&values.autoRenew==='on';
 let first=cycleUnit==='days'?FDR.days(start,cycle):FDR.months(start,cycle);
 if(interestType==='simple'&&old&&!autoRenew&&old.start===start&&FDR.periodSpec(old).unit===cycleUnit&&old.cycle===cycle)first=old.first;
 if(first>maturity)first=maturity;
 const asset={...old,type,interestType,name:get('name').trim(),ownership:get('ownership')||'self',ownerName:get('ownerName').trim(),bankId:get('bankId'),bankName:get('bankName').trim(),reference:get('reference').trim(),principal:Math.round(Number(get('principal'))*100),start,first,maturity,rate:Number(get('rate')),tds:Number(get('tds')),cycle,cycleUnit,tenureCount,tenureUnit,autoRenew,notes:get('notes')};
 if(Object.hasOwn(values,'bankAccountId')){if(get('bankAccountId').trim())asset.bankAccountId=get('bankAccountId').trim();else delete asset.bankAccountId;}
 if(!autoRenew||old?.start!==start||old?.first!==first||old?.maturity!==maturity||old?.tenureCount!==tenureCount||old?.tenureUnit!==tenureUnit)delete asset.renewalStop;
 if(asset.ownership==='others'&&!asset.ownerName)throw Error('Enter the owner’s name for an Others deposit.');
 if(interestType==='compound')FDR.compoundBalance(asset,today());
 return asset;
}

export function firstPayoutEstimate(asset){
 if(!Transfer.validAsset({...asset,id:asset.id||'preview',name:asset.name||'Preview'}))return null;
 if(asset.interestType==='compound')return FDR.termInterest(asset,FDR.compoundBalance(asset,today()),asset.start,asset.maturity).net;
 return FDR.schedule({...asset,autoRenew:false,renewalStop:undefined},asset.maturity).find(event=>!event.principal)?.net??0;
}
