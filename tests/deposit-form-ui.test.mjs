import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {FDR,Transfer,emptyState,formatMoney,formatDate} from '../assets/data-engine.js';
import {draftDeposit,firstPayoutEstimate,depositFormChoices} from '../assets/deposit-form.js';

const source=fs.readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function assetForm(id){'),source.indexOf('function receiptForm(id)'));
const decode=s=>String(s).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],decode(m[2]??'')]));
function formApp(asset){
 const nodes=new Map(),state={...emptyState(),assets:asset?[asset]:[]};let markup='';
 const get=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',dataset:{},textContent:'',innerHTML:'',hidden:false,disabled:false});return nodes.get(id);};
 function parse(html){
  const form=get('asset-form'),controls=[];form.dataset={id:asset?.id||'',scope:'1'};form.elements={namedItem:get};
  const setup=(a,tag)=>{if(!a.name)return;const node=get(a.id);Object.assign(node,{name:a.name,tagName:tag,type:a.type||'',value:a.value??(a.type==='checkbox'?'on':''),required:Object.hasOwn(a,'required'),disabled:Object.hasOwn(a,'disabled'),checked:Object.hasOwn(a,'checked')});controls.push(node);return node;};
  for(const m of html.matchAll(/<input\b([^>]*)>/g))setup(attrs(m[1]),'INPUT');
  for(const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
   const node=setup(attrs(m[1]),'SELECT');if(!node)continue;
   const options=[...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(o=>({a:attrs(o[1]),label:o[2]}));node.options=options;
   node.value=(options.find(o=>Object.hasOwn(o.a,'selected'))||options[0])?.a.value||'';
  }
  for(const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)){const node=setup(attrs(m[1]),'TEXTAREA');if(node)node.value=decode(m[2]);}
  form.controls=controls;
 }
 class FormData{constructor(form){this.entries=form.controls.filter(n=>!n.disabled&&(n.type!=='checkbox'||n.checked)).map(n=>[n.name,n.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 const context=vm.createContext({state,ownership:'self',scopeGeneration:1,FDR,Transfer,draftDeposit,firstPayoutEstimate,depositFormChoices,FormData,$:get,today:()=> '2026-10-27',money:n=>formatMoney(n,state),formatDate,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),icon:()=>'',bankLabel:a=>a.bankName||'',bankPreview:()=>'',BankCatalog:[],receivingAccountSelector:()=>'<select name="bankAccountId" id="bankAccountId"><option value="">Not linked</option></select>',modal:(title,html)=>{markup=html;parse(html);}});
 vm.runInContext(functions,context);vm.runInContext(`assetForm(${asset?JSON.stringify(asset.id):''})`,context);
 return {get,markup,values:()=>Object.fromEntries(new FormData(get('asset-form'))),fill(values){for(const [id,value]of Object.entries(values))get(id).value=String(value);},sync(source=''){context.source=source;vm.runInContext('syncAssetForm(source)',context);}};
}
const sample={id:'example',type:'FDR',interestType:'simple',ownership:'self',name:'Sample',ownerName:'Sample Holder',principal:30000000,rate:8.25,tds:15,start:'2026-10-27',first:'2027-01-25',maturity:'2027-10-27',cycle:90,cycleUnit:'days',tenureCount:1,tenureUnit:'years',autoRenew:true};

test('the real website form shows phone fields, choices and defaults with derived dates',()=>{
 const app=formApp();assert.equal(app.get('payoutChoice').value,'3');assert.equal(app.get('tenureChoice').value,'3years');assert.equal(app.get('rate').value,'');assert.equal(app.get('tds').value,'10');
 assert.deepEqual(app.get('payoutChoice').options.map(o=>o.label),['Monthly','Quarterly','Half yearly','Yearly','100 days','Custom']);
 assert.deepEqual(app.get('tenureChoice').options.map(o=>o.label),['3 years','1 year','100 days','Custom']);
 for(const name of ['first','maturity','cycle','cycleUnit','renewalStop','tenureCount','tenureUnit'])assert(!Object.hasOwn(app.values(),name));
 assert(app.get('ownerName').required);assert(app.get('bankName').required);
 assert.match(app.get('asset-preview-dates').innerHTML,/27 JAN, 2027/);assert.match(app.get('asset-preview-dates').innerHTML,/27 OCT, 2029/);
});

test('editing a custom 90-day contract preserves its days, annual tenure and estimate',()=>{
 const app=formApp(sample);assert.equal(app.get('payoutChoice').value,'custom');assert.equal(app.get('customPayoutCount').value,'90');assert.equal(app.get('customPayoutUnit').value,'days');assert.equal(app.get('tenureChoice').value,'1year');assert(!app.get('customPayout').hidden);assert.equal(app.get('asset-preview').textContent,'৳5,260');
 const saved=draftDeposit(app.values(),sample);for(const key of ['cycle','cycleUnit','start','first','maturity','tenureCount','tenureUnit','autoRenew'])assert.equal(saved[key],sample[key]);
});

test('100-day preset/custom synchronization and reversals match the phone interactions',()=>{
 const app=formApp();app.fill({tenureChoice:'100days'});app.sync('tenureChoice');assert.equal(app.get('payoutChoice').value,'100');assert(app.get('autoRenew').checked);
 app.fill({payoutChoice:'1'});app.sync('payoutChoice');assert.equal(app.get('tenureChoice').value,'1year');
 app.fill({payoutChoice:'custom',customPayoutCount:100,customPayoutUnit:'days'});app.sync('customPayoutCount');assert.equal(app.get('tenureChoice').value,'100days');
 app.fill({payoutChoice:'100'});app.sync('payoutChoice');app.fill({tenureChoice:'3years'});app.sync('tenureChoice');assert.equal(app.get('payoutChoice').value,'3');
 app.fill({tenureChoice:'custom',customTenureCount:100,customTenureUnit:'days'});app.sync('customTenureCount');assert.equal(app.get('payoutChoice').value,'100');assert.equal(draftDeposit(app.values()).maturity,'2027-02-04');
});

test('compound controls submit maturity terms only and certificates cannot renew',()=>{
 const app=formApp(sample);app.fill({interestType:'compound'});app.sync('interestType');assert(app.get('payoutChoice-field').hidden);assert(!app.get('compoundControl').hidden);assert(app.get('payoutChoice').disabled);assert(!Object.hasOwn(app.values(),'payoutChoice'));assert.match(app.get('asset-preview-dates').innerHTML,/At maturity/);
 let a=draftDeposit(app.values(),sample);assert.equal(a.first,a.maturity);assert.equal(a.cycle,12);assert.equal(a.cycleUnit,'months');
 app.fill({type:'NSC'});app.sync('type');assert(app.get('autoRenew-field').hidden);assert(app.get('autoRenew').disabled);assert(!app.get('autoRenew').checked);assert.equal(draftDeposit(app.values(),sample).autoRenew,false);
});
