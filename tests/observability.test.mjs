import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {cleanTelemetry,telemetryRoute,startObservability} from '../assets/observability.js';
import {observabilityBuildOptions} from '../scripts/observability.mjs';

const origin='https://depositly.example';
test('telemetry uses fixed page names and strips queries, tokens and arbitrary fragments',()=>{
 for(const section of ['dashboard','deposits','calendar','payments','backup','settings'])assert.equal(telemetryRoute(new URL(origin+'/?code=private#'+section)),'/'+section);
 for(const path of ['/privacy','/privacy/','/privacy/index.html'])assert.equal(telemetryRoute(new URL(origin+path)),'/privacy/');
 assert.equal(telemetryRoute(new URL(origin+'/#person@example.com')),'/dashboard');
 assert.deepEqual(cleanTelemetry({type:'pageview',url:origin+'/?code=private&email=private#deposits'},origin),{type:'pageview',url:origin+'/deposits'});
 assert.deepEqual(cleanTelemetry({type:'vital',url:origin+'/?state=private',route:'/calendar'},origin),{type:'vital',url:origin+'/calendar',route:'/calendar'});
 for(const event of [{type:'pageview',url:origin+'/api/auth/callback?code=private'},{type:'pageview',url:'https://other.example/deposits'},{type:'event',url:origin+'/dashboard'},{type:'pageview',url:origin+'/private-record'},{type:'pageview',url:42}])assert.equal(cleanTelemetry(event,origin),null);
});

test('dashboard navigation records a page once and updates Speed Insights without sending app data',()=>{
 const handlers=new Map(),pages=[],routes=[],calls=[],win={addEventListener:(name,fn)=>handlers.set(name,fn)},location=new URL(origin+'/#dashboard');
 const options={win,location,analytics:{inject:value=>calls.push(value),pageview:value=>pages.push(value)},speed:{injectSpeedInsights:()=>({setRoute:value=>routes.push(value)})}};
 startObservability(options);startObservability(options);assert.equal(calls.length,1);assert.equal(calls[0].disableAutoTrack,true);
 location.hash='#calendar';handlers.get('hashchange')();handlers.get('hashchange')();
 location.hash='#settings';handlers.get('hashchange')();
 assert.deepEqual(pages,[{path:'/dashboard',route:'/dashboard'},{path:'/calendar',route:'/calendar'},{path:'/settings',route:'/settings'}]);assert.deepEqual(routes,['/dashboard','/calendar','/settings']);
});

test('local previews never initialize telemetry',()=>{
 for(const url of ['http://localhost:4173/','http://127.0.0.1:4173/','https://localhost/'])startObservability({win:{},location:new URL(url),analytics:{inject:()=>assert.fail('Local telemetry must stay off')}});
});

test('the browser bundle loads both real Vercel SDKs without unresolved imports',async()=>{
 const result=await build({...observabilityBuildOptions,format:'iife',write:false}),source=new TextDecoder().decode(result.outputFiles[0].contents),scripts=[],handlers=new Map();
 const location=new URL(origin+'/#dashboard'),win={location,addEventListener:(name,fn)=>handlers.set(name,fn)};
 const context=vm.createContext({window:win,location,URL,document:{head:{querySelector:()=>null,appendChild:node=>scripts.push(node)},createElement:()=>({dataset:{}})}});
 vm.runInContext(source,context);
 assert.equal(scripts.length,2);assert(scripts.some(script=>script.src==='/_vercel/insights/script.js'));assert(scripts.some(script=>script.src==='/_vercel/speed-insights/script.js'));
 assert(scripts.every(script=>script.defer));assert.equal(scripts.find(script=>script.src.includes('/insights/')).dataset.disableAutoTrack,'1');
 assert.equal(win.vaq.filter(args=>args[0]==='pageview').length,1);
 location.hash='#deposits';handlers.get('hashchange')();assert.equal(win.vaq.at(-1)[1].path,'/deposits');assert.equal(scripts.find(script=>script.src.includes('speed-insights')).dataset.route,'/deposits');
});

test('all public documents load the bundled integration',async()=>{
 for(const path of ['index.html','privacy/index.html','terms/index.html'])assert.match(await readFile(new URL('../'+path,import.meta.url),'utf8'),/<script type="module" src="\/assets\/observability\.js"><\/script>/);
});
