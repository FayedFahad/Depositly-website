import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAppUpdateHandler, validateAppUpdate} from '../server/app-update.mjs';
import {validateReleaseDirectory} from '../scripts/validate-releases.mjs';
import {createDownloadPage} from '../assets/app-download.js';

const apk = Buffer.from('signed-APK-test-bytes');
const release = () => ({schemaVersion:1,package:'app.depositly.mobile',versionName:'1.3.1 Build 8',versionCode:238,apkUrl:'https://depositly.vercel.app/releases/1.3.1-build-8/Depositly-1.3.1-build-8.apk',apkSha256:createHash('sha256').update(apk).digest('hex'),certificateSha256:'655445e0b1a199ef9ae90efa6e795d0800d36ef0ca725f5f87835d396796224d',apkSize:apk.length,releaseNotes:'Updates from Settings.\nKeeps existing records.',publishedAt:'2026-11-11T10:00:00Z'});
const upstream = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function recorder(){const headers=new Map();return {statusCode:200,setHeader:(k,v)=>headers.set(k.toLowerCase(),v),getHeader:k=>headers.get(k.toLowerCase()),end(body){this.body=body;},json(){return JSON.parse(this.body);}};}
async function check(handler,method='GET'){const response=recorder();await handler({method},response);return response;}
async function fixture(context) {
 const parent=path.resolve(process.platform==='win32'&&existsSync('Z:\\WORK DIRECTORY')?'Z:\\WORK DIRECTORY':tmpdir(),'Depositly','website-tests');
 await mkdir(parent,{recursive:true});
 const root=await mkdtemp(path.join(parent,'release-'));
 context.after(async()=>{if(path.dirname(root)!==parent)throw Error('Invalid fixture cleanup path.');await rm(root,{recursive:true,force:true});});
 const manifest=release(),versionRoot=path.join(root,'1.3.1-build-8');
 await mkdir(versionRoot);
 const manifestPath=path.join(root,'latest.json'),apkPath=path.join(versionRoot,'Depositly-1.3.1-build-8.apk'),infoPath=path.join(versionRoot,'build-info.json'),updatePath=path.join(versionRoot,'update.json');
 await Promise.all([writeFile(manifestPath,JSON.stringify(manifest)),writeFile(apkPath,apk),writeFile(infoPath,JSON.stringify(manifest)),writeFile(updatePath,JSON.stringify(manifest))]);
 return {root,manifest,manifestPath,apkPath,infoPath,updatePath,versionRoot};
}

test('public update API reads bundled metadata without upstream credentials and caches for one minute',async context=>{
 const {manifestPath}=await fixture(context);let clock=0;
 const handler=createAppUpdateHandler({manifestPath,now:()=>clock});
 const first=await check(handler);assert.deepEqual(first.json(),release());assert.match(first.getHeader('cache-control'),/s-maxage=60/);
 await writeFile(manifestPath,'invalid-json');
 const head=await check(handler,'HEAD');assert.equal(head.body,undefined);assert.equal(head.statusCode,200);
 clock=60001;assert.equal((await check(handler)).statusCode,503);
});
test('concurrent checks return the same locally bundled release',async context=>{
 const {manifestPath}=await fixture(context),handler=createAppUpdateHandler({manifestPath});
 const [first,second]=await Promise.all([check(handler),check(handler)]);assert.deepEqual(first.json(),second.json());assert.equal(first.statusCode,200);
});
test('missing or malformed metadata is unavailable, hides local details and can be retried',async context=>{
 const {manifestPath}=await fixture(context);await rm(manifestPath);
 const handler=createAppUpdateHandler({manifestPath});
 const unavailable=await check(handler);assert.equal(unavailable.statusCode,503);assert.equal(unavailable.getHeader('cache-control'),'no-store');assert.equal(unavailable.json().apkUrl,undefined);assert(!unavailable.body.includes(manifestPath));
 await writeFile(manifestPath,JSON.stringify(release()));assert.deepEqual((await check(handler)).json(),release());
 const invalid=createAppUpdateHandler({manifestPath});await writeFile(manifestPath,JSON.stringify({...release(),apkUrl:'https://example.com/untrusted.apk'}));assert.equal((await check(invalid)).statusCode,503);
});
test('feed validation rejects wrong package, signer, checksum, version, size and noncanonical APK URLs',()=>{
 for(const overrides of [{package:'another.app'},{schemaVersion:2},{certificateSha256:'b'.repeat(64)},{apkSha256:'bad'},{versionCode:0},{versionCode:1.5},{versionName:'latest'},{apkSize:0},{apkSize:268435457},{releaseNotes:null},{publishedAt:'yesterday'},{apkUrl:release().apkUrl.replace('1.3.1-build-8/','latest/')},{apkUrl:release().apkUrl.replace('https:','http:')},{apkUrl:'https://github.com/FayedFahad/Depositly/releases/download/v1.3.1-build-8/Depositly-1.3.1-build-8.apk'}])assert.throws(()=>validateAppUpdate({...release(),...overrides}));
});
test('oversized metadata and unsupported methods are rejected',async context=>{
 const {manifestPath}=await fixture(context);await writeFile(manifestPath,'a'.repeat(65537));
 const handler=createAppUpdateHandler({manifestPath});assert.equal((await check(handler)).statusCode,503);
 const method=await check(handler,'POST');assert.equal(method.statusCode,405);assert.equal(method.getHeader('allow'),'GET, HEAD');
});
test('release build gate accepts a complete matching release and returns only its public files',async context=>{
 const {root}=await fixture(context),checked=await validateReleaseDirectory(root);assert.deepEqual(checked.manifest,release());
 assert.deepEqual(checked.files.sort(),['releases/latest.json','releases/1.3.1-build-8/Depositly-1.3.1-build-8.apk','releases/1.3.1-build-8/build-info.json','releases/1.3.1-build-8/update.json'].sort());
});
test('release build gate blocks missing APKs and mismatching byte length or checksum',async context=>{
 const {root,apkPath}=await fixture(context);
 await writeFile(apkPath,Buffer.alloc(apk.length));await assert.rejects(validateReleaseDirectory(root),/checksum/);
 await writeFile(apkPath,'short');await assert.rejects(validateReleaseDirectory(root),/size/);
 await rm(apkPath);await assert.rejects(validateReleaseDirectory(root),/Unexpected files/);
});
test('release build gate blocks mismatched metadata and accidental nonrelease files',async context=>{
 const {root,infoPath,manifestPath,versionRoot}=await fixture(context);
 await writeFile(infoPath,JSON.stringify({...release(),certificateSha256:'b'.repeat(64)}));await assert.rejects(validateReleaseDirectory(root),/certificateSha256/);
 await writeFile(infoPath,JSON.stringify(release()));await writeFile(manifestPath,JSON.stringify({...release(),releaseNotes:'Different notes'}));await assert.rejects(validateReleaseDirectory(root),/Latest metadata/);
 await writeFile(manifestPath,JSON.stringify(release()));await writeFile(path.join(versionRoot,'password.txt'),'must-not-ship');await assert.rejects(validateReleaseDirectory(root),/Unexpected files/);
});
function pageDocument(){const elements=new Map();return {getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',removeAttribute(name){delete this[name];},addEventListener(name,callback){this[name]=callback;}});return elements.get(id);}};}
test('download page exposes the Vercel APK URL and renders notes as plain text',async()=>{
 const document=pageDocument(),page=createDownloadPage({document,fetchImpl:async()=>upstream({...release(),releaseNotes:'<img src=x onerror=alert(1)>'})});await page.load();
 assert.equal(document.getElementById('download-apk').href,release().apkUrl);assert.equal(document.getElementById('download-apk').hidden,false);
 assert.equal(document.getElementById('release-version').textContent,release().versionName);assert.equal(document.getElementById('release-notes').textContent,'<img src=x onerror=alert(1)>');assert.match(document.getElementById('release-size').textContent,/Android 8.0/);
});
test('download errors remove old links, unsafe hosts stay blocked and retry recovers',async()=>{
 const document=pageDocument();let fail=false;const page=createDownloadPage({document,fetchImpl:async()=>fail?new Response('',{status:503}):upstream(release())});
 await page.load();fail=true;await page.load();assert.equal(document.getElementById('download-apk').hidden,true);assert.equal(document.getElementById('download-apk').href,undefined);assert.equal(document.getElementById('download-retry').hidden,false);
 fail=false;await document.getElementById('download-retry').click();assert.equal(document.getElementById('download-apk').hidden,false);
 for(const apkUrl of ['javascript:alert(1)','https://github.com/FayedFahad/Depositly/releases/latest','https://depositly.vercel.app.evil.example/releases/1.3.1-build-8/Depositly-1.3.1-build-8.apk']){
 const unsafe=createDownloadPage({document,fetchImpl:async()=>upstream({...release(),apkUrl})});await unsafe.load();assert.equal(document.getElementById('download-apk').href,undefined);
 }
});
test('website packages release files and Vercel explicitly bundles metadata and sets APK headers',async()=>{
 const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8'),page=await readFile(new URL('../download/index.html',import.meta.url),'utf8'),config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.match(app,/android-download-link" href="\/download\/"/);assert.match(app,/function settingsPage\(\)[^\n]+href="\/download\/"/);assert.match(page,/Settings → App updates/);assert.doesNotMatch(page,/github.com/);assert.match(page,/id="download-apk"[^>]*hidden/);
 assert.equal(config.functions['api/app-update.js'].includeFiles,'releases/latest.json');
 assert(config.headers.some(rule=>rule.source==='/releases/latest.json'&&rule.headers.some(header=>header.key==='Cache-Control'&&header.value.includes('no-cache'))));
 assert(config.headers.some(rule=>rule.headers.some(header=>header.key==='Content-Type'&&header.value==='application/vnd.android.package-archive')));
 for(const script of ['build','package'])assert.match(await readFile(new URL(`../scripts/${script}.mjs`,import.meta.url),'utf8'),/validateReleaseDirectory/);
});
