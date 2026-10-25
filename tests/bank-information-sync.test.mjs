import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudBackup,emptyState,normalizeBackup} from '../assets/data-engine.js';
import {createAccountWorkspaces} from '../assets/account-workspaces.js';
import {createAutoSync} from '../assets/auto-sync.js';
import {createRegistryDrive} from '../server/registry-drive.mjs';
import {createApiHandler} from '../server/api.mjs';
import {encryptCookie} from '../server/auth-session.mjs';
import {createCloudSync} from '../assets/cloud-sync.js';

const Sync=globalThis.DepositlySync,copy=value=>JSON.parse(JSON.stringify(value));
const account={id:'bank_one',bankId:'ab-bank-plc',bankName:'AB Bank PLC',accountTitle:'Sample Holder',accountNumber:'001234567890',branchName:'Main Branch',routingNumber:'000123456',accountType:'Savings'};
const snapshot=(bankAccounts=[account])=>createCloudBackup({...emptyState(),bankAccounts},{enabled:true,time:'10:30'});
const documentBackup=(accounts=[account])=>Sync.backup(Sync.create(snapshot(accounts),'phone',1));

test('bank details survive native-compatible registry edits, deletion and explicit dated restore',()=>{
 const base=snapshot(),seed=Sync.create(base,'phone',1),changed=snapshot([{...account,branchName:'Updated Branch'}]);
 const edited=Sync.change(seed,base,changed,'website',2),read=normalizeBackup(Sync.backup(edited));
 assert.equal(read.data.bankAccounts[0].accountNumber,'001234567890');
 assert.equal(read.data.bankAccounts[0].routingNumber,'000123456');
 assert.equal(read.data.bankAccounts[0].branchName,'Updated Branch');
 assert.deepEqual(read.notificationSettings,{enabled:true,time:'10:30'});
 const removed=Sync.change(edited,Sync.backup(edited),snapshot([]),'website',3);
 assert.deepEqual(normalizeBackup(Sync.backup(Sync.merge(seed,edited,removed))).data.bankAccounts,[]);
 const restored=Sync.change(removed,Sync.backup(removed),base,'restore',4);
 assert.deepEqual(normalizeBackup(Sync.backup(restored)).data.bankAccounts,[account]);
});

test('immutable Drive versions retain bank information and can restore earlier account details',async()=>{
 const records=new Map(),calls=[];let sequence=0;
 const drive=createRegistryDrive({validateBackup:normalizeBackup,now:()=>Date.UTC(2026,9,25,10),request:async(path,options)=>{
  calls.push(options?.method||'GET');
  if(options?.method==='POST'){
   const parts=[...options.body.matchAll(/Content-Type: application\/json; charset=UTF-8\r\n\r\n([\s\S]*?)\r\n--/g)];
   const metadata=JSON.parse(parts[0][1]),backup=JSON.parse(parts[1][1]),file={...metadata,id:'version_'+(++sequence),createdTime:'2026-10-25T10:00:00Z'};
   records.set(file.id,{file,backup});return file;
  }
  if(path.includes('spaces='))return {files:[...records.values()].map(value=>value.file)};
  const value=records.get(path.split('/').at(-1).split('?')[0]);
  return path.includes('fields=')?value.file:value.backup;
 }});
 const original=documentBackup(),first=await drive.save(original);
 const altered=snapshot([{...account,accountTitle:'Edited Holder',accountType:'Current'}]);
 const second=await drive.save(Sync.backup(Sync.change(original.sync,original,altered,'web',2)),[first.file.id]);
 const latest=await drive.read();
 assert.deepEqual(latest.heads,[second.file.id]);
 assert.equal(latest.backup.data.bankAccounts[0].accountTitle,'Edited Holder');
 const dated=await drive.version(first.file.id);
 assert.deepEqual(dated.backup.data.bankAccounts,[account]);
 const restored=Sync.change(latest.backup.sync,latest.backup,dated.backup,'restore',3);
 await drive.save(Sync.backup(restored),latest.heads);
 assert.deepEqual((await drive.read()).backup.data.bankAccounts,[account]);
 assert.equal((await drive.history()).files.length,3);
 assert(!calls.includes('DELETE'),'Restoring a bank list retains previous versions');
});

test('bank lists stay isolated across verified account workspaces and the signed-out guest',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const manager=createAccountWorkspaces({storage}),alpha={sub:'alpha'},beta={sub:'beta'};
 const save=(owner,bank)=>manager.save({data:normalizeBackup(snapshot([bank])).data,owner,dirty:true});
 manager.openGuest();save(null,{...account,id:'guest_bank',accountTitle:'Guest Holder'});
 manager.openAccount(alpha);save(alpha.sub,account);
 manager.openAccount(beta);assert.equal(manager.hasSavedWorkspace,false);
 save(beta.sub,{...account,id:'beta_bank',accountTitle:'Beta Holder'});
 assert.throws(()=>manager.save({data:snapshot().data,owner:alpha.sub}),error=>error.code==='ACCOUNT_WORKSPACE_MISMATCH');
 assert.equal(manager.openAccount(alpha).data.bankAccounts[0].accountTitle,'Sample Holder');
 assert.equal(manager.openAccount(beta).data.bankAccounts[0].accountTitle,'Beta Holder');
 assert.equal(manager.openGuest().data.bankAccounts[0].accountTitle,'Guest Holder');
 const reopened=createAccountWorkspaces({storage});
 assert.equal(reopened.openAccount(alpha).data.bankAccounts[0].accountNumber,'001234567890');
});

test('a pending sync cannot apply one account’s bank details after switching accounts',async()=>{
 let release,applied=0,uploads=0;
 const pending=new Promise(resolve=>release=resolve),alpha=documentBackup();
 let local={key:'alpha',ready:true,doc:alpha.sync,backup:alpha,heads:['alpha_version'],dirty:false};
 const sync=createAutoSync({cloud:{registry:()=>pending,saveVersion:async()=>{uploads++;}},get:()=>local,set:()=>{applied++;},timer:()=>0,cancel:()=>{}});
 const run=sync.sync();
 const beta=documentBackup([{...account,id:'beta_bank',accountTitle:'Beta Holder'}]);
 local={key:'beta',ready:true,doc:beta.sync,backup:beta,heads:[],dirty:false};
 release({heads:['alpha_remote'],backup:alpha});await run;
 assert.equal(applied,0);assert.equal(uploads,0);
 assert.equal(local.backup.data.bankAccounts[0].accountTitle,'Beta Holder');
});

function apiHarness(){
 const now=Date.UTC(2026,9,25,10),secret='test-only-bank-backup-session-secret-'.repeat(2),origin='http://localhost:4173';
 const cookie=[
  'depositly_session='+encryptCookie({user:{sub:'alpha',name:'Sample Holder',email:'alpha@example.test'},binding:'test-binding',csrfToken:'test-csrf',accessToken:'test-access',refreshToken:'test-refresh',accessExpiresAt:now+3_600_000,expiresAt:now+86_400_000},'session',secret),
  'depositly_binding='+encryptCookie({nonce:'test-binding',expiresAt:now+86_400_000},'binding',secret)
 ].join('; ');
 let writes=0;
 const handler=createApiHandler({now:()=>now,env:{APP_ORIGIN:origin,GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-client-secret',SESSION_SECRET:secret},fetchImpl:async(url,options)=>{
  assert.equal(new URL(url).pathname,'/upload/drive/v3/files');assert.equal(options.method,'POST');writes++;
  return new Response(JSON.stringify({id:'new_version'}),{headers:{'Content-Type':'application/json'}});
 }});
 return {get writes(){return writes;},async save(backup,sub='alpha'){
  const headers=new Map(),response={statusCode:0,writableEnded:false,setHeader(name,value){headers.set(name,value);},getHeader(name){return headers.get(name);},end(body){this.body=JSON.parse(Buffer.from(body).toString());this.writableEnded=true;}};
  await handler({url:'/api/drive/save-version',method:'POST',headers:{origin,cookie,'x-csrf-token':'test-csrf','x-depositly-account':sub},body:{backup,parents:[]}},response);
  return response;
 }};
}

test('authenticated server writes validate bank details before contacting Google Drive',async()=>{
 const api=apiHarness();
 for(const invalid of [123,'','one\ntwo']){
  const backup=documentBackup();backup.sync.entries['p/bankAccounts'].v[0].accountNumber=invalid;
  const response=await api.save(backup);
  assert.equal(response.statusCode,400);assert.equal(response.body.error.code,'INVALID_BACKUP');
 }
 const duplicate=documentBackup();duplicate.sync.entries['p/bankAccounts'].v.push(copy(account));
 assert.equal((await api.save(duplicate)).statusCode,400);
 assert.equal(api.writes,0,'Malformed bank data never reaches a Drive write');
 const wrongAccount=await api.save(documentBackup(),'beta');
 assert.equal(wrongAccount.statusCode,403);assert.equal(wrongAccount.body.error.code,'ACCOUNT_CHANGED');
 assert.equal(api.writes,0);
 const saved=await api.save(documentBackup());
 assert.equal(saved.statusCode,200);assert.equal(api.writes,1);
 assert.equal(saved.body.backup.data.bankAccounts[0].accountNumber,'001234567890');
 assert.equal(saved.body.backup.data.bankAccounts[0].routingNumber,'000123456');
});

test('bank information sign-in preserves its exact local route and rejects unsafe return targets',async()=>{
 for(const [returnTo,expected] of [['/#bank-information','/#bank-information'],['/#bank-information?next=https://other.example','/#dashboard'],['https://other.example/#bank-information','/#dashboard']]){
  let target;
  const cloud=createCloudSync({navigate:url=>target=new URL(url,'https://depositly.example'),fetchImpl:async()=>new Response(JSON.stringify({configured:true}))});
  await cloud.connect({returnTo});
  assert.equal(target.searchParams.get('returnTo'),expected);
 }
});

test('the server returns successful OAuth to bank information using only a whitelisted transaction route',async()=>{
 const now=Date.UTC(2026,9,25,10),origin='http://localhost:4173',secret='test-only-oauth-return-session-secret-'.repeat(2);
 const handler=createApiHandler({now:()=>now,env:{APP_ORIGIN:origin,GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-client-secret',SESSION_SECRET:secret},fetchImpl:async url=>{
  const value=new URL(url).hostname==='oauth2.googleapis.com'?{access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.appdata'}:{sub:'alpha',name:'Sample Holder',email:'alpha@example.test'};
  return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 }});
 const response=()=>({statusCode:0,headers:new Map(),setHeader(name,value){this.headers.set(name,value);},getHeader(name){return this.headers.get(name);},end(){this.writableEnded=true;}});
 for(const [returnTo,expected] of [['/#bank-information','/#bank-information'],['/#deposits','/#deposits'],['/#overview','/#dashboard'],['/#bank-information/../backup','/#dashboard'],['https://other.example/#bank-information','/#dashboard']]){
  const started=response();await handler({url:'/api/auth/start?'+new URLSearchParams({returnTo}),method:'GET',headers:{}},started);
  assert.equal(started.statusCode,302);
  const authorization=new URL(started.getHeader('Location'));
  assert.equal(authorization.searchParams.get('redirect_uri'),origin+'/api/auth/callback');
  assert.equal(authorization.searchParams.has('returnTo'),false,'Google receives only the fixed callback URI');
  const cookie=started.getHeader('Set-Cookie').map(value=>value.split(';')[0]).join('; '),callback=response();
  await handler({url:'/api/auth/callback?'+new URLSearchParams({code:'test-code',state:authorization.searchParams.get('state')}),method:'GET',headers:{cookie}},callback);
  assert.equal(callback.statusCode,302);assert.equal(callback.getHeader('Location'),origin+expected);
 }
});
