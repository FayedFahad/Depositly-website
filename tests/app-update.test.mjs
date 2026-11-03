import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAppUpdateHandler, validateAppUpdate} from '../server/app-update.mjs';
import {createDownloadPage} from '../assets/app-download.js';

const release = () => ({schemaVersion:1,package:'app.depositly.mobile',versionName:'1.3.1 Build 7',versionCode:215,apkUrl:'https://github.com/FayedFahad/Depositly/releases/download/v1.3.1-build-7/Depositly-1.3.1-build-7.apk',apkSha256:'a'.repeat(64),certificateSha256:'655445e0b1a199ef9ae90efa6e795d0800d36ef0ca725f5f87835d396796224d',apkSize:12345678,releaseNotes:'Updates from Settings.\nKeeps existing records.',publishedAt:'2026-11-03T10:00:00Z'});
const upstream = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function recorder(){const headers=new Map();return {statusCode:200,setHeader:(k,v)=>headers.set(k.toLowerCase(),v),getHeader:k=>headers.get(k.toLowerCase()),end(body){this.body=body;},json(){return JSON.parse(this.body);}};}
async function check(handler,method='GET'){const response=recorder();await handler({method},response);return response;}

test('public update API serves only validated release data and caches for one minute',async()=>{
 let calls=0,clock=0;
 const handler=createAppUpdateHandler({now:()=>clock,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://github.com/FayedFahad/Depositly/releases/download/latest/update.json');assert.equal(options.headers.Authorization,undefined);assert(options.signal);return upstream({...release(),ignored:'private implementation detail'});}});
 const first=await check(handler);
 assert.deepEqual(first.json(),release());assert.equal(first.json().ignored,undefined);
 assert.match(first.getHeader('cache-control'),/s-maxage=60/);
 const head=await check(handler,'HEAD');assert.equal(head.body,undefined);assert.equal(calls,1);
 clock=60001;await check(handler);assert.equal(calls,2);
});
test('concurrent checks share one upstream request',async()=>{
 let calls=0,finish;
 const handler=createAppUpdateHandler({fetchImpl:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 const first=check(handler),second=check(handler);finish(upstream(release()));
 assert.deepEqual((await first).json(),(await second).json());assert.equal(calls,1);
});
test('unavailable or malformed feeds cannot produce an installable update and can be retried',async()=>{
 let calls=0;
 const handler=createAppUpdateHandler({fetchImpl:async()=>++calls===1?new Response('not found',{status:404}):upstream(release())});
 const unavailable=await check(handler);assert.equal(unavailable.statusCode,503);assert.equal(unavailable.getHeader('cache-control'),'no-store');assert.equal(unavailable.json().apkUrl,undefined);
 assert.deepEqual((await check(handler)).json(),release());
 const invalid=createAppUpdateHandler({fetchImpl:async()=>upstream({...release(),apkUrl:'https://example.com/untrusted.apk'})});assert.equal((await check(invalid)).statusCode,503);
});
test('feed validation rejects wrong package, signer, checksum, version, size and mutable APK URLs',()=>{
 for(const overrides of [{package:'another.app'},{schemaVersion:2},{certificateSha256:'b'.repeat(64)},{apkSha256:'bad'},{versionCode:0},{versionCode:1.5},{versionName:'latest'},{apkSize:0},{apkSize:268435457},{releaseNotes:null},{publishedAt:'yesterday'},{apkUrl:release().apkUrl.replace('/v1.3.1-build-7/','/latest/')}])assert.throws(()=>validateAppUpdate({...release(),...overrides}));
});
test('oversized feeds and unsupported methods are rejected without leaking details',async()=>{
 const handler=createAppUpdateHandler({fetchImpl:async()=>new Response('a'.repeat(65537))});assert.equal((await check(handler)).statusCode,503);
 const method=await check(handler,'POST');assert.equal(method.statusCode,405);assert.equal(method.getHeader('allow'),'GET, HEAD');
});
function pageDocument(){const elements=new Map();return {getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',removeAttribute(name){delete this[name];},addEventListener(name,callback){this[name]=callback;}});return elements.get(id);}};}
test('download page exposes validated latest version and renders notes as plain text',async()=>{
 const document=pageDocument(),page=createDownloadPage({document,fetchImpl:async()=>upstream({...release(),releaseNotes:'<img src=x onerror=alert(1)>'})});await page.load();
 assert.equal(document.getElementById('download-apk').href,release().apkUrl);assert.equal(document.getElementById('download-apk').hidden,false);
 assert.equal(document.getElementById('release-version').textContent,release().versionName);assert.equal(document.getElementById('release-notes').textContent,'<img src=x onerror=alert(1)>');assert.match(document.getElementById('release-size').textContent,/Android 8.0/);
});
test('download errors remove old download links and retry recovers',async()=>{
 const document=pageDocument();let fail=false;const page=createDownloadPage({document,fetchImpl:async()=>fail?new Response('',{status:503}):upstream(release())});
 await page.load();fail=true;await page.load();assert.equal(document.getElementById('download-apk').hidden,true);assert.equal(document.getElementById('download-apk').href,undefined);assert.equal(document.getElementById('download-retry').hidden,false);
 fail=false;await document.getElementById('download-retry').click();assert.equal(document.getElementById('download-apk').hidden,false);
 const unsafe=createDownloadPage({document,fetchImpl:async()=>upstream({...release(),apkUrl:'javascript:alert(1)'})});await unsafe.load();assert.equal(document.getElementById('download-apk').href,undefined);
});
test('download page is linked from the workspace and included in static build and package inputs',async()=>{
 const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8'),page=await readFile(new URL('../download/index.html',import.meta.url),'utf8');
 assert.match(app,/android-download-link" href="\/download\/"/);assert.match(app,/function settingsPage\(\)[^\n]+href="\/download\/"/);assert.match(page,/Settings → App updates/);assert.match(page,/id="download-apk"[^>]*hidden/);
 for(const script of ['build','package'])assert.match(await readFile(new URL(`../scripts/${script}.mjs`,import.meta.url),'utf8'),/'download'/);
});
