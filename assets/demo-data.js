import {FDR,emptyState,today,events,recordPayment} from './data-engine.js';

export function makeDemo(on=today()){
 const start=FDR.months(on,-5).slice(0,8)+'01';
 const sample=(id,name,type,principal,cycle,bankId,offset,extra={})=>{
  const opened=FDR.days(start,offset);
  return {id,name,type,principal:principal*100,rate:10,tds:10,cycle,start:opened,first:FDR.months(opened,cycle),maturity:FDR.months(opened,24),tenureCount:24,tenureUnit:'months',ownership:'self',ownerName:'You',bankId,reference:'DEMO-'+id.toUpperCase(),notes:'Sample data for exploring Depositly. This is not a real investment.',...extra};
 };
 // Self principal totals 10,00,000; the normal engine calculates every sample payout.
 let state={...emptyState(),assets:[
  sample('demo1','Everyday growth','FDR',400000,1,'brac-bank-plc',4),
  sample('demo2','A little more security','NSC',300000,3,'sonali-bank-plc',11),
  sample('demo3','The long game','FDR',200000,3,'eastern-bank-plc',18),
  sample('demo4','Rainy day fund','FDR',100000,1,'city-bank-plc',24),
  sample('demo5','Family savings','NSC',500000,3,'sonali-bank-plc',8,{ownership:'others',ownerName:'Family member'})
 ]};
 for(const payment of events(state,on,on).filter(payment=>payment.date<on)){
  state=recordPayment(state,payment.id,{amount:payment.net,date:payment.date,notes:'Sample receipt'});
 }
 return state;
}
