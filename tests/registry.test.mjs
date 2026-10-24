import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoSync} from '../assets/auto-sync.js';
import {createRegistryDrive} from '../server/registry-drive.mjs';
const S=globalThis.DepositlySync;
const snapshot=(assets=[{id:'one',name:'Savings',principal:1000000}],paid={})=>({format:'depositly-google-drive',version:1,data:{scope:'all',version:1,assets,paid,currency:'BDT'},notificationSettings:{enabled:false,time:'09:00'}});
const copy=x=>JSON.parse(JSON.stringify(x));
test('independent offline edits converge, deletion wins over an ordinary edit, and explicit restore revives records',()=>{
 const base=snapshot(),doc=S.create(base,'seed',1),web=copy(base),phone=copy(base);
 web.data.assets[0].name='Website';phone.data.assets[0].principal=2000000;
 const a=S.change(doc,base,web,'web',2),b=S.change(doc,base,phone,'phone',2),merged=S.merge(a,b);
 assert.deepEqual(S.merge(a,b),S.merge(b,a));assert.equal(S.backup(merged).data.assets[0].name,'Website');assert.equal(S.backup(merged).data.assets[0].principal,2000000);
 const removed=S.change(doc,base,snapshot([]),'web',3),late=S.change(b,phone,{...phone,data:{...phone.data,assets:[{...phone.data.assets[0],name:'Late edit'}]}},'phone',9);
 const deleted=S.merge(removed,late);assert.equal(S.backup(deleted).data.assets.length,0);
 const restored=S.change(deleted,S.backup(deleted),base,'restore',10);assert.equal(S.backup(restored).data.assets.length,1);
 assert.deepEqual(S.merge(merged,merged),merged);
});
test('receipt tombstones and asset deletion never resurrect paid history',()=>{
 const base=snapshot(undefined,{'one:2026-01-01':{amount:10000,date:'2026-01-01',notes:'Paid'}}),doc=S.create(base,'seed',1);
 const deleted=S.change(doc,base,snapshot([]),'web',2);assert.deepEqual(S.backup(S.merge(doc,deleted)).data.paid,{});
 const noReceipt=S.change(doc,base,snapshot(),'web',2);assert.deepEqual(S.backup(S.merge(doc,noReceipt)).data.paid,{});
});
test('concurrent date and renewal edits retain one valid complete schedule',()=>{
 const base=snapshot([{id:'one',name:'Savings',principal:1000000,type:'FDR',cycle:1,cycleUnit:'months',start:'2026-01-01',first:'2026-02-01',maturity:'2026-12-01'}]),doc=S.create(base,'seed',1),a=copy(base),b=copy(base);
 a.data.assets[0].first='2026-09-01';b.data.assets[0].maturity='2026-06-01';
 const merged=S.backup(S.merge(S.change(doc,base,a,'web',2),S.change(doc,base,b,'phone',3))).data.assets[0];assert.equal(merged.first,'2026-02-01');assert.equal(merged.maturity,'2026-06-01');
 assert(merged.first<=merged.maturity);
});
test('observed future clocks still allow the next local edit and invalid clocks are rejected',()=>{
 const base=snapshot(),doc=S.create(base,'future',9000000000000),after=copy(base);after.data.assets[0].name='Latest';
 const next=S.change(doc,base,after,'phone',2);assert.equal(next.entries['a/one/name'].s[1],1);assert.equal(S.backup(next).data.assets[0].name,'Latest');
 for(const n of [-1,1.5,Infinity])assert.throws(()=>S.validate({version:1,entries:{'a/one':{s:[n,0,'a'],v:true}}}));
});
function harness(cloud,initial={}){
 let local={key:'alice',ready:true,doc:S.create(snapshot(),'seed',1),heads:['base'],dirty:false,backup:snapshot(),...initial};const errors=[],scheduled=[];
 const control=createAutoSync({cloud,get:()=>local,set:value=>{local={...local,...value};},onError:e=>errors.push(e),actor:'web',timer:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},cancel:()=>{}});
 return {control,errors,scheduled,get local(){return local},set local(value){local=value}};
}
test('quiet auto sync keeps edits made during upload queued for the next version',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);let uploaded;
 const h=harness({registry:async()=>({unchanged:true,heads:['base']}),saveVersion:async backup=>{uploaded=backup;await pending;return {file:{id:'v2'}};}},{dirty:true});
 const run=h.control.sync();await new Promise(setImmediate);const before=h.local.backup,after=copy(before);after.data.assets[0].name='During upload';h.local={...h.local,doc:S.change(h.local.doc,before,after,'web',20),backup:after,dirty:true};release();await run;
 assert.equal(uploaded.data.assets[0].name,'Savings');assert.equal(h.local.backup.data.assets[0].name,'During upload');assert.equal(h.local.dirty,true);assert(h.scheduled.length);
});
test('a stale account response cannot change or upload another account',async()=>{
 let release;const remote=new Promise(resolve=>release=resolve);let uploads=0;
 const h=harness({registry:()=>remote,saveVersion:async()=>{uploads++;}});const run=h.control.sync();h.local={...h.local,key:'bob',doc:S.create(snapshot([]),'bob',3),backup:snapshot([])};release({heads:['remote'],backup:snapshot()});await run;
 assert.equal(uploads,0);assert.equal(h.local.key,'bob');assert.equal(h.local.backup.data.assets.length,0);
});
test('offline failures preserve dirty records and schedule a quiet retry',async()=>{
 const h=harness({registry:async()=>{throw Error('Offline');}},{dirty:true});await h.control.sync();assert.equal(h.local.dirty,true);assert.equal(h.errors[0].message,'Offline');assert.equal(h.scheduled[0].ms,1000);
});
test('pending legacy edits without a base retain deletions and become a new dated version',async()=>{
 let saved;const remote=snapshot(),h=harness({registry:async()=>({heads:['legacy'],backup:remote}),saveVersion:async backup=>{saved=backup;return {file:{id:'new'}};}},{doc:null,dirty:true,backup:snapshot([]),baseFile:null});
 await h.control.sync();assert.equal(saved.data.assets.length,0);assert.equal(h.local.dirty,false);assert.equal(saved.sync.entries['a/one'].v,false);
});
test('immutable Drive heads merge concurrent uploads and retain dated versions without deletions',async()=>{
 const base=snapshot(),doc=S.create(base,'seed',1),edited=copy(base);edited.data.assets[0].name='Phone';
 const versions={a:S.backup(doc),b:S.backup(S.change(doc,base,edited,'phone',2))};const files=[{id:'a',name:'a',createdTime:'2026-10-24T00:00:00Z',appProperties:{depositlyKind:'registry'}},{id:'b',name:'b',createdTime:'2026-10-24T00:01:00Z',appProperties:{depositlyKind:'registry'}}];let multipart;
 const drive=createRegistryDrive({validateBackup:()=>{},now:()=>Date.parse('2026-10-24T00:02:00Z'),request:async(path,options)=>{
  if(options?.method==='POST'){multipart=options.body;return {id:'c'};}
  if(path.includes('spaces='))return {files};
  return versions[path.split('/').at(-1).split('?')[0]];
 }});
 const result=await drive.read();assert.deepEqual(result.heads,['a','b']);assert.equal(result.backup.data.assets[0].name,'Phone');
 await drive.save(result.backup,result.heads);assert.match(multipart,/Depositly-2026-10-24T00-02-00-000Z/);assert.match(multipart,/"p0":"a"/);assert.match(multipart,/"p1":"b"/);
 assert.equal((await drive.read('a,b')).unchanged,true);
});
