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
async function boot(context,{banks=[],guest=false,view,assets,paid={}}={}){
 const originals=new Map(),nodes=new Map(),documentListeners=new Map(),windowListeners=new Map(),renders=[];
 const replace=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});};
 const register=(map,type,callback)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(callback);};
 const classList=()=>({add(){},remove(){},toggle(){},contains:()=>false});
 const node=id=>{
  if(!nodes.has(id)){let html='';nodes.set(id,{id,open:false,hidden:false,value:'',textContent:'',dataset:{},classList:classList(),style:{},disabled:false,
   get innerHTML(){return html;},set innerHTML(value){html=value;if(id==='app')renders.push(value);if(id==='modal'){for(const [,fieldId,text] of value.matchAll(/<textarea\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))node(fieldId).value=decodeHTML(text);for(const [,fieldId,text] of value.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g))node(fieldId).value=decodeHTML(text);const form=value.match(/<form\b[^>]*id="bank-account-form"[^>]*>/)?.[0];if(form)node('bank-account-form').dataset=dataAttributes(form);}},
   addEventListener(){},setAttribute(name,value){this[name]=value;},focus(){},click(){},select(){},querySelector:selector=>node(selector),
   close(){this.open=false;},showModal(){this.open=true;},getBoundingClientRect:()=>({left:0,right:100,top:0,bottom:100})});}
  return nodes.get(id);
 };
 const makeWorkspace=(user,name,accounts)=>({data:{...emptyState(),assets:user.sub===alice.sub&&assets?assets:[{...deposit,id:user.sub,name}],paid:user.sub===alice.sub?paid:{},bankAccounts:accounts,...(user.sub===alice.sub&&view?{bankInformationView:view}:{})},owner:user.sub,dirty:true,reminders:{enabled:false,time:'09:00'},updatedAt:'2026-10-25T00:00:00Z'});
 const values=new Map([[accountWorkspaceKey(alice),JSON.stringify(makeWorkspace(alice,'ALICE_PRIVATE_DEPOSIT',banks))],[accountWorkspaceKey(bob),JSON.stringify(makeWorkspace(bob,'BOB_PRIVATE_DEPOSIT',[{...account,accountTitle:'Bob Example',accountNumber:'0000000000002'}]))]]);
 const server={user:guest?null:alice,saves:0,failWrites:false,shared:[],copied:[]};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(server.failWrites&&key===accountWorkspaceKey(server.user))throw Error('Quota exceeded');values.set(key,value);},removeItem:key=>values.delete(key)};
 const session=user=>user?{authenticated:true,configured:true,user,csrfToken:'synthetic-bank-test-token',expiresAt:Date.now()+100000}:{authenticated:false,configured:true};
 let copyInput;
 replace('document',{hidden:false,body:{classList:classList(),dataset:{},appendChild(){}},getElementById:node,querySelector:node,activeElement:node('active'),createElement:()=>copyInput={value:'',style:{},focus(){},select(){},remove(){}},execCommand:command=>{if(command!=='copy')return false;server.copied.push(copyInput.value);return true;},addEventListener:(type,callback)=>register(documentListeners,type,callback)});
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
 const makeForm=(id,values)=>({id,dataset:dataAttributes(node('modal').innerHTML.match(new RegExp('<form\\b[^>]*id="'+id+'"[^>]*>'))?.[0]),values});
 const submitForm=(id,values)=>dispatch('submit',{target:makeForm(id,values),preventDefault(){}});
 return {node,server,storage,renders,click,dispatch,windowEvent,form,submit,saved,importFile,switchToBob,actionData,makeForm,submitForm};
}

test('bank navigation, required dropdown fields, optional type and leading-zero CRUD use the account workspace',async context=>{
 const app=await boot(context);
 assert.match(app.node('app').innerHTML,/data-nav="bank-information"/);
 await app.click({nav:'bank-information'});
 assert.match(app.node('app').innerHTML,/<h1>Bank Information<\/h1>/);
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

test('bank grouping and card/grid selections persist without altering saved accounts',async context=>{
 const legacy={...account,id:'legacy-bank',bankId:'',bankName:'AB BANK LIMITED',branchName:'Central branch'},city={...account,id:'city-bank',bankId:'city-bank-plc',bankName:'City Bank PLC'};
 const app=await boot(context,{banks:[account,legacy,city]});await app.click({nav:'bank-information'});
 const before=app.saved().bankAccounts;assert.equal([...app.node('app').innerHTML.matchAll(/data-bank-group=/g)].length,2);
 for(const view of ['grid','card','grid']){
  await app.click({action:'bank-layout',value:view});assert.equal(app.saved().bankInformationView,view);assert.deepEqual(app.saved().bankAccounts,before);
  await app.click({nav:'backup'});await app.click({nav:'bank-information'});
  assert.match(app.node('app').innerHTML,new RegExp('id="bank-view-'+view+'"[^>]*aria-pressed="true"'));
  assert.equal(Transfer.migrate(JSON.parse(JSON.stringify(Transfer.exportData(app.saved())))).bankInformationView,view);
 }
 await app.click({action:'bank-layout',value:'invalid'});assert.equal(app.saved().bankInformationView,'grid');
 app.server.failWrites=true;await app.click({action:'bank-layout',value:'card'});assert.equal(app.saved().bankInformationView,'grid');assert.match(app.node('app').innerHTML,/id="bank-view-grid"[^>]*aria-pressed="true"/);app.server.failWrites=false;
});

test('copy icons preserve exact numbers in every view, forms and clipboard fallback',async context=>{
 const app=await boot(context,{banks:[account]});await app.click({nav:'bank-information'});
 for(const view of ['card','grid']){
  await app.click({action:'bank-layout',value:view});
  await app.click({action:'copy-bank-field',id:account.id,field:'accountNumber'});assert.equal(app.server.copied.at(-1),'00123456789012345');
  await app.click({action:'copy-bank-field',id:account.id,field:'routingNumber'});assert.equal(app.server.copied.at(-1),'000123456');
 }
 const count=app.server.copied.length;await app.click({action:'copy-bank-field',id:account.id,field:'accountTitle'});assert.equal(app.server.copied.length,count);
 navigator.clipboard.writeText=async()=>{throw Error('Clipboard unavailable');};
 await app.click({action:'copy-bank-field',id:account.id,field:'accountNumber'});assert.equal(app.server.copied.at(-1),'00123456789012345');
 await app.click({action:'bank-account-detail',id:account.id});await app.click({action:'edit-bank-account',id:account.id});
 assert.match(app.node('modal').innerHTML,/data-action="copy-bank-form-field"/);
 app.node('account-number').value='00000012345000';await app.click({action:'copy-bank-form-field',field:'accountNumber'});assert.equal(app.server.copied.at(-1),'00000012345000');
 app.node('account-routing').value='000000001';await app.click({action:'copy-bank-form-field',field:'routingNumber'});assert.equal(app.server.copied.at(-1),'000000001');
 assert.equal(app.saved().bankAccounts[0].accountNumber,account.accountNumber,'Copying unsaved input does not save it');
});

test('deposit-only imports preserve the bank layout and full backups restore a valid saved selection',async context=>{
 const app=await boot(context,{banks:[account],view:'grid'});
 await app.importFile(Transfer.instrumentCSV(app.saved()),'deposits.csv');await app.click({action:'apply-import',mode:'replace'});assert.equal(app.saved().bankInformationView,'grid');
 const selected=Transfer.exportData({...app.saved(),bankInformationView:'card'},[app.saved().assets[0].id]);await app.importFile(JSON.stringify(selected));await app.click({action:'apply-import',mode:'replace'});assert.equal(app.saved().bankInformationView,'grid');
 await app.importFile(JSON.stringify(Transfer.exportData({...app.saved(),bankInformationView:'card'})));await app.click({action:'apply-import',mode:'replace'});assert.equal(app.saved().bankInformationView,'card');
 for(const value of [undefined,'invalid','list']){const backup={...app.saved(),bankInformationView:value};await app.importFile(JSON.stringify(Transfer.exportData(backup)));await app.click({action:'apply-import',mode:'replace'});assert.equal(app.saved().bankInformationView,'card');}
});

test('old account copy and layout actions cannot affect a newly opened account',async context=>{
 const app=await boot(context,{banks:[account],view:'grid'});await app.click({nav:'bank-information'});
 const stale=['bank-layout','bank-account-detail','copy-bank-field'].map(action=>({...app.actionData(action,action==='bank-layout'?undefined:account.id),action,id:account.id,value:'list',field:'accountNumber'}));
 await app.click({action:'bank-account-detail',id:account.id});await app.click({action:'edit-bank-account',id:account.id});stale.push({...app.actionData('copy-bank-form-field'),action:'copy-bank-form-field',field:'accountNumber'});
 await app.switchToBob();for(const action of stale)await app.click(action);
 assert.deepEqual(app.server.copied,[]);assert.equal(app.saved().bankInformationView,undefined);assert.equal(app.saved().bankAccounts[0].accountTitle,'Bob Example');assert.equal(app.node('modal').open,false);
});

test('a delayed clipboard failure does not copy the previous account through the fallback',async context=>{
 const app=await boot(context,{banks:[account]}),held=deferred();await app.click({nav:'bank-information'});navigator.clipboard.writeText=()=>held.promise;
 const pending=app.click({action:'copy-bank-field',id:account.id,field:'routingNumber'});await app.switchToBob();held.reject(Error('Clipboard unavailable'));await pending;
 assert.deepEqual(app.server.copied,[]);assert.equal(app.node('modal').open,false);
});

const depositValues=extra=>({name:'ALICE_PRIVATE_DEPOSIT',type:'FDR',interestType:'simple',ownership:'self',ownerName:'Alice Example',bankName:'AB Bank PLC',reference:'00123',principal:'10000',rate:'10',tds:'10',cycle:'1',cycleUnit:'months',start:'2026-01-01',first:'2026-02-01',maturity:'2030-01-01',tenureCount:'4',tenureUnit:'years',notes:'',...extra});

test('deposit forms link any saved bank account without changing issuer or name and protected banks show linked deposits',async context=>{
 const second={...account,id:'second-bank',bankId:'brac-bank-plc',bankName:'BRAC Bank PLC',accountNumber:'00000987654321'},linked={...deposit,id:alice.sub,bankName:'AB Bank PLC',bankId:'ab-bank-plc',bankAccountId:account.id};
 const app=await boot(context,{banks:[account,second],assets:[linked]});await app.click({nav:'bank-information'});assert.match(app.node('app').innerHTML,/1 linked deposit/);
 await app.click({action:'bank-account-detail',id:account.id});assert.match(app.node('modal').innerHTML,/Linked deposits/);assert.match(app.node('modal').innerHTML,/ALICE_PRIVATE_DEPOSIT/);
 await app.click({action:'delete-bank-account',id:account.id});assert.match(app.node('modal').innerHTML,/Unlink or reassign/);assert.doesNotMatch(app.node('modal').innerHTML,/data-action="confirm-delete-bank-account"/);assert.equal(app.saved().bankAccounts.length,2);
 await app.click({action:'linked-deposit',id:linked.id});assert.match(app.node('modal').innerHTML,/Receiving bank account/);assert.match(app.node('modal').innerHTML,/00123456789012345/);
 app.node('asset-form').elements={namedItem:id=>app.node(id)};await app.click({action:'edit',id:linked.id});const form=app.node('modal').innerHTML;
 assert.match(form,/<label for="bankAccountId">Interest-receiving bank account \(optional\)<\/label>/);assert.match(form,/<option value=""[^>]*>Not linked<\/option>/);assert.match(form,/BRAC Bank PLC · Alice Example · 00000987654321/);assert.match(form,/value="bank-shared-id" selected/);
 await app.dispatch('change',{target:{id:'bankAccountId',value:second.id}});assert.match(app.node('receiving-account-selection').innerHTML,/00000987654321/);assert.match(app.node('receiving-account-selection').innerHTML,/BRAC Bank PLC/);assert.equal(app.node('name').value,'ALICE_PRIVATE_DEPOSIT');assert.equal(app.node('bankName').value,'AB Bank PLC');
 await app.submitForm('asset-form',depositValues({bankAccountId:second.id}));assert.equal(app.saved().assets[0].bankAccountId,second.id);assert.equal(app.saved().assets[0].bankName,'AB Bank PLC');assert.equal(app.saved().assets[0].name,'ALICE_PRIVATE_DEPOSIT');
 await app.click({action:'edit',id:linked.id});await app.submitForm('asset-form',depositValues({bankAccountId:''}));assert(!Object.hasOwn(app.saved().assets[0],'bankAccountId'));
 await app.click({action:'delete-bank-account',id:account.id});await app.click({action:'confirm-delete-bank-account',id:account.id});assert.equal(app.saved().bankAccounts.length,1);
});

test('unavailable links remain readable and can be kept or cleared without changing deposit terms',async context=>{
 const linked={...deposit,id:alice.sub,bankAccountId:'missing-bank'};const app=await boot(context,{assets:[linked]});await app.click({action:'detail',id:linked.id});assert.match(app.node('modal').innerHTML,/saved account is unavailable/);
 app.node('asset-form').elements={namedItem:id=>app.node(id)};await app.click({action:'edit',id:linked.id});assert.match(app.node('modal').innerHTML,/value="missing-bank" selected>Unavailable saved account/);
 await app.submitForm('asset-form',depositValues({bankAccountId:'missing-bank'}));assert.equal(app.saved().assets[0].bankAccountId,'missing-bank');assert.equal(app.saved().assets[0].principal,linked.principal);
 await app.click({action:'edit',id:linked.id});await app.submitForm('asset-form',depositValues({bankAccountId:'forged-new-reference'}));assert.match(app.node('form-error').textContent,/Choose a saved bank account/);assert.equal(app.saved().assets[0].bankAccountId,'missing-bank');
});

test('received payment forms have no received-date input and preserve bank identity and historical dates on edits',async context=>{
 const linked={...deposit,id:alice.sub,bankAccountId:account.id},receiptId=linked.id+':2026-02-01';const app=await boot(context,{banks:[account],assets:[linked]});
 await app.click({action:'receipt',id:receiptId});assert.doesNotMatch(app.node('modal').innerHTML,/receipt-date|Date received|name="date"/);assert.match(app.node('modal').innerHTML,/Receiving bank account/);assert.match(app.node('modal').innerHTML,/00123456789012345/);
 await app.submitForm('receipt-form',{amount:'75',notes:'Test receipt'});let receipt=app.saved().paid[receiptId];assert.equal(receipt.date,'2026-02-01');assert.equal(receipt.snapshot.bankAccountId,account.id);assert.equal(receipt.snapshot.bankAccountSnapshot.accountNumber,account.accountNumber);
 await app.click({action:'edit-bank-account',id:account.id});await app.submit({...fields,accountNumber:'0000000000001',accountTitle:'Changed Holder'});
 await app.click({action:'receipt',id:receiptId});assert.match(app.node('modal').innerHTML,/00123456789012345/);assert.doesNotMatch(app.node('modal').innerHTML,/Changed Holder/);await app.submitForm('receipt-form',{amount:'76',notes:'Edited receipt'});
 receipt=app.saved().paid[receiptId];assert.equal(receipt.date,'2026-02-01');assert.equal(receipt.snapshot.bankAccountSnapshot.accountTitle,account.accountTitle);assert.equal(receipt.snapshot.bankAccountSnapshot.accountNumber,account.accountNumber);
});

test('old received receipts stay unattributed and presentation filters by the scheduled payment date',async context=>{
 const linked={...deposit,id:alice.sub,bankAccountId:account.id},receiptId=linked.id+':2026-02-01',snapshot={assetId:linked.id,name:linked.name,type:'FDR',scheduledDate:'2026-02-01',kind:'Interest',gross:8333,tax:833,expected:7500,principal:0},legacy={amount:7500,date:'2026-03-15',snapshot};
 const app=await boot(context,{banks:[account],assets:[linked],paid:{[receiptId]:legacy}});await app.click({action:'receipt',id:receiptId});assert.match(app.node('modal').innerHTML,/Not recorded for this payment/);assert.doesNotMatch(app.node('modal').innerHTML,/00123456789012345/);await app.submitForm('receipt-form',{amount:'76',notes:'Legacy edit'});assert.equal(app.saved().paid[receiptId].date,legacy.date);assert.deepEqual(app.saved().paid[receiptId].snapshot,snapshot);
 await app.click({action:'received'});await app.dispatch('change',{target:{id:'payment-month',value:'2026-02'}});assert.match(app.node('app').innerHTML,/class="payment-item"/);assert.match(app.node('app').innerHTML,/<small>Feb<\/small><b>1<\/b>/);
 await app.dispatch('change',{target:{id:'payment-month',value:'2026-03'}});assert.doesNotMatch(app.node('app').innerHTML,/class="payment-item"/);
});

test('stale linked-deposit actions and account-selection forms cannot cross account scopes',async context=>{
 const linked={...deposit,id:alice.sub,bankAccountId:account.id},app=await boot(context,{banks:[account],assets:[linked]});await app.click({action:'bank-account-detail',id:account.id});const staleAction={...app.actionData('linked-deposit',linked.id)};
 app.node('asset-form').elements={namedItem:id=>app.node(id)};await app.click({action:'edit',id:linked.id});const staleForm=app.makeForm('asset-form',depositValues({bankAccountId:account.id}));await app.switchToBob();
 await app.click(staleAction);assert.equal(app.node('modal').open,false);await app.dispatch('submit',{target:staleForm,preventDefault(){}});assert.equal(app.saved().assets[0].name,'BOB_PRIVATE_DEPOSIT');assert(!Object.hasOwn(app.saved().assets[0],'bankAccountId'));assert.equal(app.saved().bankAccounts[0].accountTitle,'Bob Example');
});
