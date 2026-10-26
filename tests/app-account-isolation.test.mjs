import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {accountWorkspaceKey} from '../assets/account-workspaces.js';
import {emptyState, Transfer} from '../assets/data-engine.js';
import {AUTH_EVENT_KEY} from '../assets/cloud-sync.js';
import '../assets/sync-registry.js';

const alice = {sub: 'account-a', email: 'a@example.com', name: 'Alice'};
const bob = {sub: 'account-b', email: 'b@example.com', name: 'Bob'};
const asset = (id, name) => ({id, name, type: 'FDR', principal: 1000000, rate: 10, tds: 10, cycle: 1, cycleUnit: 'months', start: '2026-01-01', first: '2026-02-01', maturity: '2030-01-01', ownership: 'self'});
const workspace = (user, name) => ({data: {...emptyState(), assets: [asset(user.sub, name)]}, owner: user.sub, dirty: true, reminders: {enabled: true, time: '22:45'}, updatedAt: '2026-10-22T12:00:00Z'});
const response = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
const deferred = () => { let resolve; const promise = new Promise(value => {resolve = value;}); return {promise, resolve}; };

async function until(predicate, message) {
  for (let index = 0; index < 50; index++) { if (predicate()) return; await nextTurn(); }
  assert.fail(message);
}

/** Runs the actual browser entry point with a minimal DOM and controlled API. */
async function boot(context, options = {}) {
  const originals = new Map(), nodes = new Map(), documentListeners = new Map(), windowListeners = new Map(), renders = [];
  function replace(name, value) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, {configurable: true, writable: true, value}); }
  const register = (map, type, callback) => { if (!map.has(type)) map.set(type, []); map.get(type).push(callback); };
  const classList = () => ({add() {}, remove() {}, toggle() {}, contains: () => false});
  const node = id => {
    if (!nodes.has(id)) {
      let html = '';
      nodes.set(id, {id, open: false, value: '', dataset: {}, classList: classList(), style: {}, disabled: false,
        get innerHTML() { return html; }, set innerHTML(value) { html = value; if (id === 'app') renders.push(value); },
        addEventListener() {}, setAttribute(name, value) { this[name] = value; }, focus() {}, click() {},
        close() { this.open = false; }, showModal() { this.open = true; }, getBoundingClientRect: () => ({left: 0, right: 100, top: 0, bottom: 100})});
    }
    return nodes.get(id);
  };
  const savedAlice=workspace(alice,'ALICE_PRIVATE_DEPOSIT');
  if(options.defaultDepositView)savedAlice.data.defaultDepositView=options.defaultDepositView;
  if(options.asset)savedAlice.data.assets=[{...options.asset,id:alice.sub,name:'ALICE_PRIVATE_DEPOSIT'}];
  if(options.paid)savedAlice.data.paid=options.paid;
  if(options.rawRegistry)savedAlice.syncDocument=globalThis.DepositlySync.create({format:'depositly-google-drive',version:1,data:{...savedAlice.data,scope:'all'},notificationSettings:savedAlice.reminders},'legacy-test',1);
  const values = new Map([[accountWorkspaceKey(alice), JSON.stringify(savedAlice)], [accountWorkspaceKey(bob), JSON.stringify(workspace(bob, 'BOB_PRIVATE_DEPOSIT'))]]);
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => {if(server.failWrites)throw Error('Storage unavailable');values.set(key, value);}, removeItem: key => values.delete(key)};
  const server = {user: alice, failWrites:!!options.failWrites, failSession: !!options.failSession, pendingSession: options.pendingSession || null, sessionCalls: 0, syncSaves:0,posted:[]};
  const session = user => user ? {authenticated: true, configured: true, user, csrfToken: 'private-test-csrf-token', expiresAt: Date.now() + 100000} : {authenticated: false, configured: true};
  replace('document', {hidden: false, body: {classList: classList()}, getElementById: node, querySelector: node,
    addEventListener: (type, callback) => register(documentListeners, type, callback)});
  replace('window', {addEventListener: (type, callback) => register(windowListeners, type, callback), scrollTo() {}});
  replace('localStorage', storage);
  replace('location', {origin: 'https://depositly.example', pathname: '/', hash: '#overview', search: '', assign() {}});
  replace('history', {replaceState() {}});
  replace('HTMLImageElement', class {});
  replace('setInterval', () => 0);
  replace('setTimeout', (callback, duration) => { if (duration === 0) queueMicrotask(callback); return 0; });
  replace('clearTimeout', () => {});
  replace('fetch', async (url,init={}) => {
    const path = new URL(url, 'https://depositly.example').pathname;
    if (path === '/api/auth/session') {
      server.sessionCalls++;
      if (server.pendingSession) { const pending = server.pendingSession; server.pendingSession = null; return pending.promise; }
      if (server.failSession) throw Error('Offline');
      return response(session(server.user));
    }
    if (path === '/api/drive/latest') return response({latest: null});
    if (path === '/api/drive/registry') return response({unchanged:true,heads:(new URL(url,'https://depositly.example').searchParams.get('known')||'').split(',').filter(Boolean)});
    if (path === '/api/drive/save-version') {server.syncSaves++;server.posted.push(JSON.parse(init.body));return response({file:{id:'sync-'+server.user.sub,createdTime:'2026-10-24T00:00:00Z'}});}
    if (path === '/api/auth/config') return response({configured: true, missing: []});
    throw Error(`Unexpected endpoint ${path}`);
  });
  context.after(() => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await import(`../assets/app.js?isolation-test=${Math.random()}`);
  if(options.beforeReady)await options.beforeReady({server, node, renders, session, retry: async()=>{for(const callback of documentListeners.get('click')||[])await callback({target:{dataset:{action:'retry-account'},tagName:'BUTTON',disabled:false,closest(){return this;}},preventDefault(){}});}});
  await until(() => node('app').innerHTML.includes('ALICE_PRIVATE_DEPOSIT') && node('app').innerHTML.includes('aria-busy="false"'), 'initial verified Alice workspace should open');
  await until(()=>node('connect-top').disabled===false,'initial account backup check should finish');
  if(!options.allowNoSync)await until(()=>server.syncSaves>0,'initial quiet sync should save the existing local edits');await nextTurn();
  const dispatchWindow = (type, event = {}) => { for (const callback of windowListeners.get(type) || []) callback(event); };
  const dispatchDocument = async (type, event) => { for (const callback of documentListeners.get(type) || []) await callback(event); };
  const click = action => dispatchDocument('click', {target: {dataset: typeof action==='string'?{action}:action, tagName: 'BUTTON', disabled: false, closest() { return this; }}, preventDefault() {}});
  return {server, storage, node, renders, session, dispatchWindow, dispatchDocument, click};
}

test('saved Android table preferences open as cards without modifying the backup preference', async context => {
 const app=await boot(context,{defaultDepositView:'grid'}),saved=app.storage.getItem(accountWorkspaceKey(alice));
 await app.click({nav:'deposits'});
 assert.match(app.node('app').innerHTML,/class="holdings-grid"/);
 assert.match(app.node('app').innerHTML,/aria-label="Switch to table view"/);
 await app.click('holding-view');
 assert.doesNotMatch(app.node('app').innerHTML,/class="holdings-grid"/);
 assert.match(app.node('app').innerHTML,/aria-label="Switch to card view"/);
 await app.click('holding-view');
 assert.match(app.node('app').innerHTML,/class="holdings-grid"/);
 assert.equal(app.storage.getItem(accountWorkspaceKey(alice)),saved,'layout changes must not rewrite Android settings or deposits');
});

const wrongHundred={type:'FDR',principal:30000000,rate:8,tds:15,cycle:3,cycleUnit:'months',start:'2026-10-01',first:'2027-01-01',maturity:'2027-01-09',tenureCount:100,tenureUnit:'days',autoRenew:true,ownership:'self'};
test('opening an old quarterly/100-day workspace persists corrected registry fields using the raw baseline',async context=>{
 const app=await boot(context,{asset:wrongHundred,rawRegistry:true}),saved=JSON.parse(app.storage.getItem(accountWorkspaceKey(alice))),entries=saved.syncDocument.entries;
 assert.equal(saved.data.assets[0].cycle,100);assert.equal(saved.data.assets[0].first,'2027-01-09');assert.equal(entries['a/account-a/cycle'].v,100);assert.equal(entries['a/account-a/cycleUnit'].v,'days');assert.equal(entries['a/account-a/first'].v,'2027-01-09');
 assert.equal(app.server.posted[0].backup.data.assets[0].cycle,100,'Drive receives the corrected schedule, not only the normalized screen');
 const stamp=entries['a/account-a/cycle'].s;await app.click('theme');const changed=JSON.parse(app.storage.getItem(accountWorkspaceKey(alice)));assert.deepEqual(changed.syncDocument.entries['a/account-a/cycle'].s,stamp,'A later preference edit does not repeat the finance migration');
 assert.doesNotMatch(app.node('app').innerHTML,/data-nav="forecast"/);await app.click({nav:'forecast'});assert.doesNotMatch(app.node('app').innerHTML,/Net interest over time|Open forecast/);
});
test('failed finance migration preserves durable data and retries from the original registry baseline',async context=>{
 const app=await boot(context,{asset:wrongHundred,rawRegistry:true,failWrites:true,allowNoSync:true});
 let saved=JSON.parse(app.storage.getItem(accountWorkspaceKey(alice)));assert.equal(saved.data.assets[0].cycle,3);assert.equal(saved.syncDocument.entries['a/account-a/cycle'].v,3);assert.equal(app.server.syncSaves,0,'Unsaved corrected state is not uploaded');
 app.server.failWrites=false;await app.click('theme');saved=JSON.parse(app.storage.getItem(accountWorkspaceKey(alice)));assert.equal(saved.data.assets[0].cycle,100);assert.equal(saved.syncDocument.entries['a/account-a/cycle'].v,100,'Retry cannot treat the already-normalized screen as the original registry baseline');
});

test('allocation links open only the chosen deposit type in the current workspace',async context=>{
 const app=await boot(context);
 await app.click({action:'allocation',value:'FDR'});
 assert.match(app.node('app').innerHTML,/<h1>My deposits<\/h1>/);
 assert.match(app.node('app').innerHTML,/aria-pressed="true" data-action="deposit-type" data-value="FDR"/);
 assert.match(app.node('app').innerHTML,/class="card holding-card"/);
 await app.click({action:'allocation',value:'NSC'});
 assert.match(app.node('app').innerHTML,/aria-pressed="true" data-action="deposit-type" data-value="NSC"/);
 assert.doesNotMatch(app.node('app').innerHTML,/class="card holding-card"/);
 assert.doesNotMatch(app.node('app').innerHTML,/BOB_PRIVATE_DEPOSIT/);
});

test('opening an imported backup returns a table session to cards', async context => {
 const app=await boot(context);
 await app.click({nav:'deposits'});
 await app.click('holding-view');
 const incoming={...emptyState(),defaultDepositView:'grid',assets:[asset('imported','Imported deposit')]};
 await app.dispatchDocument('change',{target:{id:'file-import',value:'backup.json',files:[{name:'backup.json',size:500,text:async()=>JSON.stringify(Transfer.exportData(incoming))}]}});
 assert.equal(app.node('modal').open,true);
 await app.click({action:'apply-import',mode:'replace'});
 assert.equal(app.node('modal').open,false);
 assert.match(app.node('app').innerHTML,/class="holdings-grid"/);
 assert.match(app.node('app').innerHTML,/Imported deposit/);
 assert.equal(JSON.parse(app.storage.getItem(accountWorkspaceKey(alice))).data.defaultDepositView,'grid');
});

test('actual app keeps hidden account records protected after a cross-tab verification failure', async context => {
  const app = await boot(context), original = app.storage.getItem(accountWorkspaceKey(alice));
  app.server.failSession = true;
  app.dispatchWindow('storage', {key: AUTH_EVENT_KEY});
  await until(() => app.node('app').innerHTML.includes('could not be reached'), 'network error should be displayed');
  assert.doesNotMatch(app.node('app').innerHTML, /ALICE_PRIVATE_DEPOSIT|22:45/);
  await app.click('theme');
  assert.equal(app.storage.getItem(accountWorkspaceKey(alice)), original, 'empty hidden state cannot replace the durable Alice vault');
  app.server.failSession = false;
  app.server.user = bob;
  await app.click('retry-account');
  await until(() => app.node('app').innerHTML.includes('BOB_PRIVATE_DEPOSIT'), 'verified Bob workspace should open after retry');
  assert.doesNotMatch(app.node('app').innerHTML, /ALICE_PRIVATE_DEPOSIT/);
  assert.equal(app.storage.getItem(accountWorkspaceKey(alice)), original);
});

test('actual app discards an old quiet-restore result after a newer cross-tab auth event', async context => {
  const app = await boot(context), held = deferred();
  const originalNow = Date.now;
  context.after(() => { Date.now = originalNow; });
  Date.now = () => originalNow() + 31000;
  app.server.pendingSession = held;
  const beforeCalls = app.server.sessionCalls;
  app.dispatchWindow('focus');
  await until(() => app.server.sessionCalls > beforeCalls, 'quiet verification should start');
  app.server.user = bob;
  app.dispatchWindow('storage', {key: AUTH_EVENT_KEY});
  const afterHide = app.renders.length;
  held.resolve(response(app.session(alice)));
  await until(() => app.node('app').innerHTML.includes('BOB_PRIVATE_DEPOSIT'), 'a fresh session must select Bob after stale Alice response');
  assert(app.renders.slice(afterHide).every(html => !html.includes('ALICE_PRIVATE_DEPOSIT')), 'no stale Alice render may reappear after the auth event');
});

test('actual app hides a BFCache account before a failed verification and blocks edits', async context => {
  const app = await boot(context), original = app.storage.getItem(accountWorkspaceKey(alice));
  app.server.failSession = true;
  app.dispatchWindow('pageshow', {persisted: true});
  assert.doesNotMatch(app.node('app').innerHTML, /ALICE_PRIVATE_DEPOSIT/);
  await until(() => app.node('app').innerHTML.includes('could not be reached'), 'BFCache account check should show its network failure');
  await app.click('empty-workspace');
  assert.equal(app.storage.getItem(accountWorkspaceKey(alice)), original);
});

test('actual app drops a delayed file import when its account scope changes', async context => {
  const app = await boot(context), held = deferred();
  const input = {id: 'file-import', value: 'selected.json', files: [{name: 'selected.json', size: 500, text: () => held.promise}]};
  const pending = app.dispatchDocument('change', {target: input});
  app.server.user = bob;
  app.dispatchWindow('storage', {key: AUTH_EVENT_KEY});
  await until(() => app.node('app').innerHTML.includes('BOB_PRIVATE_DEPOSIT'), 'account should switch before file read completes');
  held.resolve(JSON.stringify(Transfer.exportData(workspace(alice, 'ALICE_PRIVATE_DEPOSIT').data)));
  await pending;
  assert.equal(app.node('modal').open, false, 'old account file must not reopen an import preview');
  assert.doesNotMatch(app.node('app').innerHTML, /ALICE_PRIVATE_DEPOSIT/);
});

test('startup never renders a demo or signed-out account while the saved session is pending', async context => {
 const held=deferred();
 const app=await boot(context,{pendingSession:held,beforeReady:async({node,renders,session})=>{
  assert.match(node('app').innerHTML,/Opening your workspace/);
  assert.doesNotMatch(renders.join(' '),/Demo workspace|These are sample investments|Everyday growth|ALICE_PRIVATE_DEPOSIT|Sign in with Google/);
  held.resolve(response(session(alice)));
 }});
 assert.match(app.node('app').innerHTML,/ALICE_PRIVATE_DEPOSIT/);
 assert.doesNotMatch(app.renders.join(' '),/Demo workspace|These are sample investments|Everyday growth/);
});

test('a failed startup session check stays on the recovery screen until a verified retry', async context => {
 const app=await boot(context,{failSession:true,beforeReady:async({server,node,retry})=>{
  await until(()=>node('app').innerHTML.includes('could not be reached'),'startup should offer retry');
  assert.doesNotMatch(node('app').innerHTML,/Demo workspace|These are sample investments|ALICE_PRIVATE_DEPOSIT/);
  assert.match(node('app').innerHTML,/data-action="retry-account"/);
  server.failSession=false;await retry();
 }});
 assert.match(app.node('app').innerHTML,/ALICE_PRIVATE_DEPOSIT/);
 assert.doesNotMatch(app.renders.join(' '),/Demo workspace|These are sample investments/);
});
