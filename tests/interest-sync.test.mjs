import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCloudBackup,emptyState,normalizeBackup} from '../assets/data-engine.js';
import '../assets/sync-registry.js';
import {createRegistryDrive} from '../server/registry-drive.mjs';
import {createApiHandler} from '../server/api.mjs';
import {encryptCookie} from '../server/auth-session.mjs';
import {createCloudSync} from '../assets/cloud-sync.js';

const Sync=globalThis.DepositlySync,copy=value=>JSON.parse(JSON.stringify(value));
const simple={id:'interest',type:'FDR',name:'Sample annual deposit',ownership:'self',ownerName:'Sample Holder',principal:10000000,rate:10,tds:10,cycle:12,cycleUnit:'months',start:'2024-01-01',first:'2025-01-01',maturity:'2025-01-01',tenureCount:1,tenureUnit:'years',autoRenew:true};
const compound={...simple,interestType:'compound'};
const backup=(assets=[simple])=>createCloudBackup({...emptyState(),assets});
const registry=(assets=[compound])=>Sync.backup(Sync.create(backup(assets),'phone',1));

test('website protocol matches native deterministic merge, delete and restore fixtures',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/registry-native.json',import.meta.url),'utf8'));
 assert.deepEqual(copy(Sync.create(fixture.base,'seed',1)),fixture.initial);
 assert.deepEqual(Sync.change(fixture.initial,fixture.base,fixture.one,'web',20),fixture.web);
 assert.deepEqual(Sync.change(fixture.initial,fixture.base,fixture.two,'phone',20),fixture.phone);
 assert.deepEqual(copy(Sync.merge(fixture.web,fixture.phone)),fixture.merged);
 assert.equal(Sync.backup(Sync.merge(fixture.deleted,fixture.phone)).data.assets.length,0);
 assert.deepEqual(Sync.change(fixture.deleted,Sync.backup(fixture.deleted),fixture.base,'restore',22),fixture.restored);
});

test('interest type and financial terms remain atomic during concurrent phone and website edits',()=>{
 const before=backup(),initial=Sync.create(before,'seed',1),converted=backup([compound]);
 const phone=Sync.change(initial,before,converted,'phone',10);
 const financialFields=['type','interestType','cycle','cycleUnit','start','first','maturity','autoRenew','renewalStop','tenureCount','tenureUnit'];
 for(const field of financialFields)assert.deepEqual(phone.entries['a/interest/'+field].s,[10,0,'phone']);
 const renamed=backup([{...simple,name:'Website name'}]),web=Sync.change(initial,before,renamed,'web',11);
 const merged=Sync.backup(Sync.merge(phone,web)),saved=normalizeBackup(merged).data.assets[0];
 assert.equal(saved.interestType,'compound');assert.equal(saved.name,'Website name');assert.equal(saved.tenureCount,1);assert.equal(saved.tenureUnit,'years');assert.equal(merged.data.minReaderVersion,6);
 const monthly={...simple,cycle:1,first:'2024-02-01'},later=Sync.change(initial,before,backup([monthly]),'web',12);
 const financialWinner=normalizeBackup(Sync.backup(Sync.merge(phone,later))).data.assets[0];
 assert.equal(financialWinner.interestType,undefined);assert.equal(financialWinner.cycle,1);assert.equal(financialWinner.first,'2024-02-01');
});

test('a stale preference cannot downgrade live compound records, while removing the final compound restores simple compatibility',()=>{
 const doc=registry().sync;
 doc.entries['p/minReaderVersion']={s:[50,0,'old-client'],v:5};
 const live=Sync.backup(doc);assert.equal(live.data.minReaderVersion,6);assert.equal(normalizeBackup(live).data.assets[0].interestType,'compound');
 const simpleOnly=backup([{...simple,id:'simple'}]),removed=Sync.change(doc,live,simpleOnly,'web',51),result=Sync.backup(removed);
 assert.equal(result.data.assets.length,1);assert.equal(result.data.assets[0].id,'simple');assert(result.data.minReaderVersion<=5);assert.equal(normalizeBackup(result).data.assets[0].interestType,undefined);
});

test('immutable Drive heads preserve compound terms alongside concurrent ordinary preferences and dated simple backups',async()=>{
 const old=backup(),initial=Sync.create(old,'seed',1),phone=Sync.change(initial,old,backup([compound]),'phone',10),web=Sync.change(initial,old,{...old,data:{...old.data,dark:true}},'web',11);
 const versions={old:Sync.backup(initial),phone:Sync.backup(phone),web:Sync.backup(web)};
 const file=(id,time,parents={})=>({id,name:id+'.json',createdTime:time,appProperties:{depositlyKind:'registry',...parents}});
 const files=[file('old','2026-10-26T00:00:00Z'),file('phone','2026-10-26T00:01:00Z',{p0:'old'}),file('web','2026-10-26T00:02:00Z',{p0:'old'})];
 let written;
 const drive=createRegistryDrive({validateBackup:normalizeBackup,request:async(path,options)=>{
  if(options?.method==='POST'){
   const parts=[...options.body.matchAll(/Content-Type: application\/json; charset=UTF-8\r\n\r\n([\s\S]*?)\r\n--/g)];
   written=JSON.parse(parts[1][1]);return {id:'merged'};
  }
  if(path.includes('spaces='))return {files};
  const id=path.split('/').at(-1).split('?')[0];return path.includes('fields=')?files.find(file=>file.id===id):versions[id];
 }});
 const read=await drive.read();assert.deepEqual(read.heads,['phone','web']);assert.equal(read.backup.data.minReaderVersion,6);assert.equal(read.backup.data.dark,true);assert.equal(read.backup.data.assets[0].interestType,'compound');
 await drive.save(read.backup,read.heads);assert.equal(written.data.minReaderVersion,6);assert.equal(written.data.assets[0].tenureUnit,'years');
 const dated=await drive.version('old');assert(dated.backup.data.minReaderVersion<=5);assert.equal(dated.backup.data.assets[0].interestType,undefined);
});

function responseRecorder(){const headers=new Map();return {statusCode:0,writableEnded:false,setHeader(name,value){headers.set(name,value);},getHeader(name){return headers.get(name);},end(body){this.body=body;this.writableEnded=true;},json(){return JSON.parse(Buffer.from(this.body).toString());}};}
function apiHarness(){
 const now=Date.UTC(2026,9,26,10),origin='http://localhost:4173',secret='interest-sync-test-session-secret-'.repeat(2);
 const cookie=[
  'depositly_session='+encryptCookie({user:{sub:'alpha',name:'Sample Holder',email:'alpha@example.test'},binding:'test-binding',csrfToken:'test-csrf',accessToken:'test-access',refreshToken:'test-refresh',accessExpiresAt:now+3_600_000,expiresAt:now+86_400_000},'session',secret),
  'depositly_binding='+encryptCookie({nonce:'test-binding',expiresAt:now+86_400_000},'binding',secret)
 ].join('; ');
 let writes=0,written;
 const handler=createApiHandler({now:()=>now,env:{APP_ORIGIN:origin,GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-secret',SESSION_SECRET:secret},fetchImpl:async(url,options)=>{
  const target=new URL(url);
  if(target.hostname==='oauth2.googleapis.com')return new Response(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.appdata'}));
  if(target.pathname==='/oauth2/v3/userinfo')return new Response(JSON.stringify({sub:'alpha',name:'Sample Holder',email:'alpha@example.test'}));
  assert.equal(target.pathname,'/upload/drive/v3/files');assert.equal(options.method,'POST');writes++;
  const parts=[...options.body.matchAll(/Content-Type: application\/json; charset=UTF-8\r\n\r\n([\s\S]*?)\r\n--/g)];written=JSON.parse(parts[1][1]);
  return new Response(JSON.stringify({id:'new_version'}),{headers:{'Content-Type':'application/json'}});
 }});
 return {handler,origin,get writes(){return writes;},get written(){return written;},async save(value,sub='alpha'){
  const response=responseRecorder();await handler({url:'/api/drive/save-version',method:'POST',headers:{origin,cookie,'x-csrf-token':'test-csrf','x-depositly-account':sub},body:{backup:value,parents:[]}},response);return response;
 }};
}

test('authenticated server writes reject invalid compound types and incomplete tenures before contacting Drive',async()=>{
 const api=apiHarness();
 for(const [field,value] of [['interestType','daily'],['interestType',null],['tenureCount',0],['tenureCount',1.5],['tenureUnit','weeks'],['maturity','2025-01-02']]){
  const malformed=registry();malformed.sync.entries['a/interest/'+field].v=value;
  const response=await api.save(malformed);assert.equal(response.statusCode,400);assert.equal(response.json().error.code,'INVALID_BACKUP');
 }
 for(const field of ['tenureCount','tenureUnit']){
  const malformed=registry();malformed.sync.entries['a/interest/'+field]={s:[2,0,'bad'],d:true};
  assert.equal((await api.save(malformed)).statusCode,400);
 }
 const future=registry();future.sync.entries['p/minReaderVersion'].v=8;assert.equal((await api.save(future)).statusCode,400);
 assert.equal(api.writes,0,'Invalid financial records never reach Google Drive');
 assert.equal((await api.save(registry(),'beta')).statusCode,403);assert.equal(api.writes,0);
 const live=registry();live.sync.entries['p/minReaderVersion'].v=5;
 const saved=await api.save(live);assert.equal(saved.statusCode,200);assert.equal(api.writes,1);assert.equal(api.written.data.minReaderVersion,6);assert.equal(api.written.data.assets[0].interestType,'compound');
 const simpleLegacy=copy(simple);delete simpleLegacy.tenureCount;delete simpleLegacy.tenureUnit;
 assert.equal((await api.save(registry([simpleLegacy]))).statusCode,200,'Legacy simple deposits do not require compound tenure metadata');
});

test('authenticated reader7 writes retain bank links and reject malformed routing metadata before Drive',async()=>{
 const api=apiHarness(),linked={...simple,bankAccountId:'receiving-account'};
 const valid=registry([linked]);assert.equal(valid.data.minReaderVersion,7);
 const stale=copy(valid);stale.sync.entries['p/minReaderVersion'].v=5;
 assert.equal((await api.save(stale)).statusCode,200);assert.equal(api.written.data.minReaderVersion,7);assert.equal(api.written.data.assets[0].bankAccountId,'receiving-account');
 for(const id of ['',null,42,'invalid account']){const bad=copy(valid);bad.sync.entries['a/interest/bankAccountId'].v=id;assert.equal((await api.save(bad)).statusCode,400);}
 const historical=copy(valid),receiptId='interest:2025-01-01';
 const receipt={amount:900000,date:'2025-01-01',snapshot:{assetId:'interest',name:simple.name,type:'FDR',scheduledDate:'2025-01-01',kind:'Interest',gross:1000000,tax:100000,expected:900000,principal:0,bankAccountId:'receiving-account',bankAccountSnapshot:{bankName:'Example Bank',accountTitle:'Example Holder',accountNumber:'00012345'}}};
 historical.data.paid={[receiptId]:receipt};historical.sync=Sync.create(historical,'phone',2);assert.equal((await api.save(historical)).statusCode,200);assert.equal(api.written.data.paid[receiptId].snapshot.bankAccountSnapshot.accountNumber,'00012345');
 const badHistory=copy(historical);badHistory.sync.entries['r/'+receiptId+'/snapshot'].v.bankAccountSnapshot.accountNumber='bad\nnumber';assert.equal((await api.save(badHistory)).statusCode,400);
});

test('retired forecast sign-in routes fall back to Dashboard',async()=>{
 const api=apiHarness();
 for(const [returnTo,expected] of [['/#forecast','/#dashboard'],['/#forecast?next=https://other.example','/#dashboard'],['https://other.example/#forecast','/#dashboard']]){
  let target;const cloud=createCloudSync({navigate:url=>target=new URL(url,api.origin),fetchImpl:async()=>new Response(JSON.stringify({configured:true}))});await cloud.connect({returnTo});assert.equal(target.searchParams.get('returnTo'),expected);
  const started=responseRecorder();await api.handler({url:'/api/auth/start?'+new URLSearchParams({returnTo}),method:'GET',headers:{}},started);assert.equal(started.statusCode,302);
  const authorization=new URL(started.getHeader('Location')),cookie=started.getHeader('Set-Cookie').map(value=>value.split(';')[0]).join('; '),callback=responseRecorder();
  await api.handler({url:'/api/auth/callback?'+new URLSearchParams({code:'test-code',state:authorization.searchParams.get('state')}),method:'GET',headers:{cookie}},callback);assert.equal(callback.statusCode,302);assert.equal(callback.getHeader('Location'),api.origin+expected);
 }
});
