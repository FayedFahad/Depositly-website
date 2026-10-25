import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {accountWorkspaceKey, ACCOUNT_WORKSPACE_PREFIX} from '../assets/account-workspaces.js';
import {emptyState, Transfer} from '../assets/data-engine.js';
import {AUTH_EVENT_KEY} from '../assets/cloud-sync.js';

const alice={sub:'bank-ui-alice',name:'Alice Example',email:'alice@example.com'};
const bob={sub:'bank-ui-bob',name:'Bob Example',email:'bob@example.com'};
const deposit={id:'private-deposit',name:'ALICE_PRIVATE_DEPOSIT',type:'FDR',ownership:'self',principal:1000000,rate:10,tds:10,cycle:1,cycleUnit:'months',start:'2026-01-01',first:'2026-02-01',maturity:'2030-01-01'};
const account={id:'bank-shared-id',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'Alice Example',accountNumber:'00123456789012345',branchName:'Example branch',routingNumber:'000123456',accountType:'Savings'};
const fields={bankId:'ab-bank-plc',accountTitle:'Alice Example',accountNumber:'00123456789012345',branchName:'Example branch',routingNumber:'000123456',accountType:''};
const shareText='Account Title: Alice Example\nBank Name: AB Bank PLC\nBranch Name: Example branch\nAccount Number: 00123456789012345\nRouting Number: 000123456';
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(predicate,message){for(let i=0;i<80;i++){if(predicate())return;await nextTurn();}assert.fail(message);}
const dataAttributes=tag=>Object.fromEntries([...String(tag||'').matchAll(/\bdata-([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
const decodeHTML=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));

/** Exercise the real app entry point without a browser, account credentials or network. */
async function boot(context,{banks=[],guest=false}={}){
 const originals=new Map(),nodes=new Map(),documentListeners=new Map(),windowListeners=new Map(),renders=[];
 const replace=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});};
 const register=(map,type,callback)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(callback);};
 const classList=()=>({add(){},remove(){},toggle(){},contains:()=>false});
 const node=id=>{
  if(!nodes.has(id)){let html='';nodes.set(id,{id,open:false,hidden:false,value:'',textContent:'',dataset:{},classList:classList(),style:{},disabled:false,
   get innerHTML(){return html;},set innerHTML(value){html=value;if(id==='app')renders.push(value);if(id==='modal')for(const [,fieldId,text] of value.matchAll(/<textarea\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))node(fieldId).value=decodeHTML(text);},
   addEventListener(){},setAttribute(name,value){this[name]=value;},focus(){},click(){},select(){},querySelector:selector=>node(selector),
   close(){this.open=false;},showModal(){this.open=true;},getBoundingClientRect:()=>({left:0,right:100,top:0,bottom:100})});}
  return nodes.get(id);
 };
 const makeWorkspace=(user,name,accounts)=>({data:{...emptyState(),assets:[{...deposit,id:user.sub,name}],bankAccounts:accounts},owner:user.sub,dirty:true,reminders:{enabled:false,time:'09:00'},updatedAt:'2026-10-25T00:00:00Z'});
 const values=new Map([[accountWorkspaceKey(alice),JSON.stringify(makeWorkspace(alice,'ALICE_PRIVATE_DEPOSIT',banks))],[accountWorkspaceKey(bob),JSON.stringify(makeWorkspace(bob,'BOB_PRIVATE_DEPOSIT',[{...account,accountTitle:'Bob Example',accountNumber:'0000000000002'}]))]]);
 const server={user:guest?null:alice,saves:0,failWrites:false,shared:[],copied:[]};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(server.failWrites&&key===accountWorkspaceKey(server.user))throw Error('Quota exceeded');values.set(key,value);},removeItem:key=>values.delete(key)};
 const session=user=>user?{authenticated:true,configured:true,user,csrfToken:'synthetic-bank-test-token',expiresAt:Date.now()+100000}:{authenticated:false,configured:true};
 replace('document',{hidden:false,body:{classList:classList(),dataset:{}},getElementById:node,querySelector:node,addEventListener:(type,callback)=>register(documentListeners,type,callback)});
 replace('window',{addEventListener:(type,callback)=>register(windowListeners,type,callback),scrollTo(){}});
 replace('localStorage',storage);
 replace('location',{origin:'https://depositly.example',pathname:'/',hash:'#dashboard',search:'',assign(){}});
 replace('history',{replaceState(){}});
 replace('HTMLImageElement',class {});
 replace('FormData',class {constructor(form){this.values=new Map(Object.entries(form.values||{}));}get(key){return this.values.get(key)??null;}[Symbol.iterator](){return this.values[Symbol.iterator]();}});
 replace('navigator',{share:async value=>server.shared.push(value),canShare:()=>true,clipboard:{writeText:async value=>server.copied.push(value)}});
 replace('setInterval',()=>0);replace('setTimeout',(callback,duration)=>{if(duration===0)queueMicrotask(callback);return 0;});replace('clearTimeout',()=>{});
 replace('fetch',async url=>{
  const parsed=new URL(url,'https://depositly.example');
  if(parsed.pathname==='/api/auth/session')return response(session(server.user));
  if(parsed.pathname==='/api/drive/latest')return response({latest:null});
  if(parsed.pathname==='/api/drive/registry')return response({unchanged:true,heads:(parsed.searchParams.get('known')||'').split(',').filter(Boolean)});
  if(parsed.pathname==='/api/drive/save-version'){server.saves++;return response({file:{id:'test-sync-'+server.saves,createdTime:'2026-10-25T00:00:00Z'}});}
  if(parsed.pathname==='/api/auth/config')return response({configured:true,missing:[]});
  throw Error('Unexpected endpoint '+parsed.pathname);
 });
 context.after(()=>{for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 await import(`../assets/app.js?bank-information-test=${Math.random()}`);
 await until(()=>node('app').innerHTML.includes(guest?'Demo workspace':'ALICE_PRIVATE_DEPOSIT')&&node('app').innerHTML.includes('aria-busy="false"'),'verified workspace opens');
 await until(()=>guest||server.saves>0&&!node('connect-top').disabled,'initial session and synchronization finish');await nextTurn();
 const dispatch=async(type,event)=>{for(const callback of documentListeners.get(type)||[])await callback(event);};
 const windowEvent=(type,event={})=>{for(const callback of windowListeners.get(type)||[])callback(event);};
 const actionData=(action,id)=>{
  const sources=node('modal').open?[node('modal').innerHTML,node('app').innerHTML]:[node('app').innerHTML];
  for(const html of sources)for(const match of html.matchAll(/<button\b[^>]*>/g)){const data=dataAttributes(match[0]);if(data.action===action&&(!id||data.id===id))return data;}
  return {};
 };
 const click=async value=>{
  const data=typeof value==='string'?{action:value}:{...value};
  if(data.action)Object.assign(data,{...actionData(data.action,data.id),...data});
  const target={dataset:data,tagName:'BUTTON',disabled:false,closest(){return this;},setAttribute(){}};
  await dispatch('click',{target,preventDefault(){}});
 };
 const form=values=>({id:'bank-account-form',dataset:dataAttributes(node('modal').innerHTML.match(/<form\b[^>]*id="bank-account-form"[^>]*>/)?.[0]),values});
 const submit=values=>dispatch('submit',{target:form(values),preventDefault(){}});
 const saved=(user=server.user)=>JSON.parse(storage.getItem(user?accountWorkspaceKey(user):`${ACCOUNT_WORKSPACE_PREFIX}.guest`)).data;
 const importFile=(text,name='banks.json')=>dispatch('change',{target:{id:'file-import',value:name,files:[{name,size:text.length,text:async()=>text}]}});
 const switchToBob=async()=>{server.user=bob;windowEvent('storage',{key:AUTH_EVENT_KEY});await until(()=>node('app').innerHTML.includes('Bob Example')&&node('app').innerHTML.includes('aria-busy="false"'),'verified Bob workspace opens');await nextTurn();};
 return {node,server,storage,renders,click,dispatch,windowEvent,form,submit,saved,importFile,switchToBob,actionData};
}

test('bank navigation, required dropdown fields, optional type and leading-zero CRUD use the account workspace',async context=>{
 const app=await boot(context);
 assert.match(app.node('app').innerHTML,/data-nav="bank-information"/);
 await app.click({nav:'bank-information'});
 assert.match(app.node('app').innerHTML,/<h1>Bank information<\/h1>/);
 await app.click('add-bank-account');
 const html=app.node('modal').innerHTML;
 const bankSelect=html.match(/<select\b[^>]*name="bankId"[^>]*>/)?.[0];assert(bankSelect);assert.match(bankSelect,/\brequired\b/);assert.match(html,/AB Bank PLC/);
 for(const field of ['accountTitle','accountNumber','branchName','routingNumber']){const input=html.match(new RegExp('<input\\b[^>]*name="'+field+'"[^>]*>'))?.[0];assert(input);assert.match(input,/\brequired\b/);}
 const type=html.match(/<input\b[^>]*name="accountType"[^>]*>/)?.[0];assert(type);assert.match(type,/type="text"/);assert.doesNotMatch(type,/\brequired\b/);
 await app.submit({...fields,accountTitle:'  Alice Example  ',branchName:'  Example branch  '});
 let banks=app.saved().bankAccounts;assert.equal(banks.length,1);assert.equal(banks[0].accountTitle,'Alice Example');assert.equal(banks[0].branchName,'Example branch');assert.equal(banks[0].accountNumber,'00123456789012345');assert.equal(banks[0].routingNumber,'000123456');assert.equal(banks[0].accountType,'');
 assert.equal(app.node('modal').open,false);assert.match(app.node('app').innerHTML,/bank-logo/);assert.match(app.node('app').innerHTML,/00123456789012345/);assert.equal(app.saved().assets[0].name,'ALICE_PRIVATE_DEPOSIT');
 const id=banks[0].id;
 await app.click({action:'edit-bank-account',id});await app.submit({...fields,accountType:'Current',branchName:'Changed branch'});
 banks=app.saved().bankAccounts;assert.equal(banks.length,1);assert.equal(banks[0].id,id);assert.equal(banks[0].accountType,'Current');assert.match(app.node('app').innerHTML,/Changed branch/);
 await app.click({action:'delete-bank-account',id});assert.equal(app.saved().bankAccounts.length,1);await app.click('close-modal');assert.equal(app.saved().bankAccounts.length,1);
 await app.click({action:'delete-bank-account',id});await app.click({action:'confirm-delete-bank-account',id});assert.deepEqual(app.saved().bankAccounts,[]);assert.equal(app.saved().assets.length,1);
});

test('invalid fields and failed storage writes keep bank forms and durable records intact',async context=>{
 const app=await boot(context,{banks:[account]});await app.click({nav:'bank-information'});await app.click({action:'edit-bank-account',id:account.id});
 const before=app.saved();
 await app.submit({...fields,branchName:'   '});assert.deepEqual(app.saved(),before);assert.equal(app.node('modal').open,true);assert.equal(app.node('form-error').hidden,false);
 app.server.failWrites=true;await app.submit({...fields,branchName:'Unsaved branch'});assert.deepEqual(app.saved(),before);assert.equal(app.node('modal').open,true);assert.match(app.node('form-error').textContent,/save|browser|storage/i);
 app.server.failWrites=false;
});

test('saving a real bank account from the demo starts an empty guest workspace without fictional deposits',async context=>{
 const app=await boot(context,{guest:true});await app.click({nav:'bank-information'});await app.click('add-bank-account');await app.submit(fields);
 assert.equal(app.saved().bankAccounts.length,1);assert.equal(app.saved().bankAccounts[0].accountTitle,'Alice Example');assert.deepEqual(app.saved().assets,[]);assert.doesNotMatch(app.node('app').innerHTML,/Demo workspace/);
});

test('share and copy provide only the exact five-line Android account text',async context=>{
 const app=await boot(context,{banks:[account]});await app.click({nav:'bank-information'});
 await app.click({action:'share-bank-account',id:account.id});assert.equal(app.server.shared.length,1);assert.equal(app.server.shared[0].text,shareText);
 navigator.share=undefined;await app.click({action:'share-bank-account',id:account.id});
 // Platforms without Web Share either copy immediately or expose the explicit copy sheet.
 if(!app.server.copied.length){assert.equal(app.node('modal').open,true);assert.match(app.node('modal').innerHTML,/Account Title: Alice Example/);await app.click('copy-bank-account');}
 assert.deepEqual(app.server.copied,[shareText]);assert.equal(app.saved().bankAccounts[0].accountType,'Savings');
});

test('CSV and selected-deposit replacements preserve bank accounts while full JSON restores them',async context=>{
 const app=await boot(context,{banks:[account]});const originalBanks=app.saved().bankAccounts;
 await app.importFile(Transfer.instrumentCSV(app.saved()),'deposits.csv');await app.click({action:'apply-import',mode:'replace'});assert.deepEqual(app.saved().bankAccounts,originalBanks);
 const selected=Transfer.exportData(app.saved(),[app.saved().assets[0].id]);assert(!Object.hasOwn(selected,'bankAccounts'));
 await app.importFile(JSON.stringify(selected));await app.click({action:'apply-import',mode:'replace'});assert.deepEqual(app.saved().bankAccounts,originalBanks);
 const restored={...account,id:'restored-bank',accountTitle:'Restored Example',accountType:'Student'};
 await app.importFile(JSON.stringify(Transfer.exportData({...emptyState(),bankAccounts:[restored]})));assert.match(app.node('modal').innerHTML,/Bank accounts|bank accounts|bank account/i);await app.click({action:'apply-import',mode:'replace'});assert.deepEqual(app.saved().bankAccounts,[restored]);assert.deepEqual(app.saved().assets,[]);
});

test('merging a bank-only phone backup keeps deposits and a repeated import does not duplicate banks',async context=>{
 const app=await boot(context),text=JSON.stringify(Transfer.exportData({...emptyState(),bankAccounts:[account]}));
 await app.importFile(text);await app.click({action:'apply-import',mode:'merge'});assert.equal(app.saved().assets[0].name,'ALICE_PRIVATE_DEPOSIT');assert.deepEqual(app.saved().bankAccounts,[account]);
 await app.importFile(text);await app.click({action:'apply-import',mode:'merge'});assert.equal(app.saved().bankAccounts.length,1);
});

test('stale bank form and action tokens cannot mutate or disclose the next account',async context=>{
 const app=await boot(context,{banks:[account]});await app.click({nav:'bank-information'});await app.click({action:'edit-bank-account',id:account.id});
 const oldForm=app.form({...fields,accountTitle:'OLD ALICE FORM'}),oldActions=Object.fromEntries(['share-bank-account','edit-bank-account','delete-bank-account'].map(action=>[action,{...app.actionData(action,account.id),action,id:account.id}]));
 const aliceBefore=app.storage.getItem(accountWorkspaceKey(alice));await app.switchToBob();
 await app.dispatch('submit',{target:oldForm,preventDefault(){}});
 for(const data of Object.values(oldActions))await app.click(data);
 assert.equal(app.saved().bankAccounts[0].accountTitle,'Bob Example');assert.equal(app.saved().bankAccounts[0].accountNumber,'0000000000002');assert.equal(app.storage.getItem(accountWorkspaceKey(alice)),aliceBefore);assert.deepEqual(app.server.shared,[]);assert.equal(app.node('modal').open,false);assert.doesNotMatch(app.node('app').innerHTML,/Alice Example|00123456789012345/);
});

test('a delayed failed share cannot reopen the previous account details after a switch',async context=>{
 const app=await boot(context,{banks:[account]}),held=deferred();await app.click({nav:'bank-information'});navigator.share=()=>held.promise;
 const pending=app.click({action:'share-bank-account',id:account.id});await app.switchToBob();held.reject(Error('Share unavailable'));await pending;
 assert.equal(app.node('modal').open,false);assert.deepEqual(app.server.copied,[]);assert.doesNotMatch(app.node('app').innerHTML,/Alice Example|00123456789012345/);
});
