/** Server-managed Google accounts. Google tokens never enter browser JavaScript. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DEFAULT_CLIENT_ID = '688859064258-h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com';
export const BACKUP_FILE_NAME = 'depositly-backup.json';
export const CLOUD_FORMAT = 'depositly-google-drive';
export const AUTH_EVENT_KEY = 'depositly.account.event.v1';
const MAX_BACKUP_BYTES = 20_000_000;
const MAX_TRANSFER_BYTES = 4_000_000;

export class CloudError extends Error {
  constructor(message, code = 'CLOUD_ERROR', details = {}) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function validateCloudBackup(input, validateData = value => value) {
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new CloudError('This Google Drive backup is not valid JSON.', 'INVALID_BACKUP'); }
  if (!value || value.format !== CLOUD_FORMAT || value.version !== 1 || value.data?.scope !== 'all' || !Array.isArray(value.data?.assets) || !value.data.paid || typeof value.data.paid !== 'object' || Array.isArray(value.data.paid)) {
    throw new CloudError('This Google Drive backup needs a newer version of Depositly, or is invalid.', 'INVALID_BACKUP');
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) throw new CloudError('This backup exceeds the 20 MB limit. Use a file backup.', 'BACKUP_TOO_LARGE');
  value = JSON.parse(serialized);
  if (value.notificationSettings && (typeof value.notificationSettings.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.notificationSettings.time))) throw new CloudError('The Google Drive backup contains invalid reminder settings.', 'INVALID_BACKUP');
  let data;
  try { data = validateData(value.data); }
  catch (error) { throw new CloudError(`The Google Drive backup could not be read: ${error.message}`, 'INVALID_BACKUP'); }
  return {backup: value, data};
}

function verifiedProfile(value) {
  if (!value || typeof value.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(value.sub) || typeof value.email !== 'string') throw new CloudError('The account session could not be verified. Sign in again.', 'INVALID_ACCOUNT');
  const user = {sub: value.sub, email: value.email, name: typeof value.name === 'string' ? value.name : value.email};
  for (const key of ['given_name', 'family_name', 'picture']) if (typeof value[key] === 'string') user[key] = value[key];
  return user;
}

async function uploadBody(payload) {
  const json = JSON.stringify(payload), bytes = new TextEncoder().encode(json);
  if (bytes.byteLength <= MAX_TRANSFER_BYTES) return {body: json, headers: {'Content-Type': 'application/json'}};
  if (typeof CompressionStream !== 'function') throw new CloudError('This large backup needs browser compression. Export a file backup or use a current browser.', 'BACKUP_TOO_LARGE');
  const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  if (compressed.byteLength > MAX_TRANSFER_BYTES) throw new CloudError('This backup exceeds the website’s transfer limit. Export a file backup instead.', 'BACKUP_TOO_LARGE');
  return {body: compressed, headers: {'Content-Type': 'application/octet-stream', 'X-Depositly-Encoding': 'gzip'}};
}

export function createCloudSync({validateData = value => value, onStatus = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), navigate = url => globalThis.location.assign(url)} = {}) {
  let user = null, csrfToken = '', expiresAt = 0, busy = false, generation = 0, latestFile = null;
  let quiet=false;
  let phase = 'disconnected', message = 'Sign in with Google to open your account.', configuration = null;
  const active = new Set();
  const getStatus = () => ({connected: !!user, authenticated: !!user, persistent: true, busy, background:quiet, phase, message, user: user ? {...user} : null, latestFile: latestFile ? {...latestFile} : null, expiresAt, configured: configuration?.configured ?? null});
  function update(next, text) { phase = next; message = text; try { onStatus(getStatus()); } catch {} }
  function ensure(current) { if (current !== generation) throw new CloudError('The Google account changed. Your records were not changed.', 'ACCOUNT_CHANGED'); }
  function clear() { user = null; csrfToken = ''; expiresAt = 0; latestFile = null; }
  function begin() { if (busy) throw new CloudError('An account operation is already in progress.', 'BUSY'); busy = true; }
  function finish(current) { if (current === generation) { busy = false; try { onStatus(getStatus()); } catch {} } }
  function signal(type) { try { globalThis.localStorage?.setItem(AUTH_EVENT_KEY, JSON.stringify({type, nonce: globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random()})); } catch {} }
  async function request(path, {method = 'GET', body, headers = {}, current = generation, account = user?.sub, csrf = csrfToken} = {}) {
    if (typeof fetchImpl !== 'function') throw new CloudError('This browser cannot connect to your account.', 'FETCH_UNAVAILABLE');
    ensure(current);
    const controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchImpl(`/api/${path}`, {method, body, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: {Accept: 'application/json', ...(account ? {'X-Depositly-Account': account} : {}), ...(method !== 'GET' ? {'X-CSRF-Token': csrf} : {}), ...headers}});
      ensure(current);
      const text = await response.text();
      ensure(current);
      let result;
      try { result = text ? JSON.parse(text) : null; } catch { throw new CloudError('The account server returned an unreadable response. Please try again.', 'INVALID_RESPONSE'); }
      if (!response.ok) {
        const error = result?.error;
        const code = typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'ACCOUNT_SERVER_ERROR';
        if (code === 'AUTH_REQUIRED' || code === 'ACCOUNT_CHANGED') { clear(); update('disconnected', 'Sign in again to continue. Your account records are kept.'); }
        throw new CloudError(typeof error?.message === 'string' ? error.message : 'The account server could not complete the request.', code, {remoteFile: error?.remoteFile, missing: error?.missing});
      }
      return result;
    } catch (error) {
      ensure(current);
      if (error instanceof CloudError) throw error;
      throw new CloudError(error.name === 'AbortError' ? 'The account server took too long to respond. Please try again.' : 'Your account could not be reached. Check your connection and try again.', 'NETWORK_ERROR');
    } finally { clearTimeout(timer); active.delete(controller); }
  }
  async function prepare() {
    configuration = await request('auth/config', {account: null});
    return configuration;
  }
  async function restore() {
    begin();
    const current = generation;
    update('restoring', 'Restoring your signed-in account…');
    try {
      const session = await request('auth/session', {current, account: null});
      if (typeof session?.configured === 'boolean') configuration = {configured: session.configured, missing: session.missing || []};
      if (!session?.authenticated) { clear(); update('disconnected', 'Sign in with Google to open your account.'); return {authenticated: false, configured: session?.configured}; }
      user = verifiedProfile(session.user);
      if (typeof session.csrfToken !== 'string' || session.csrfToken.length < 16) { clear(); throw new CloudError('The account session is incomplete. Sign in again.', 'INVALID_ACCOUNT'); }
      csrfToken = session.csrfToken;
      expiresAt = Number(session.expiresAt) || 0;
      update('connected', 'You are signed in. Your account stays signed in across refreshes.');
      return {authenticated: true, user: {...user}};
    } catch (error) { if (current === generation) { if (error.code === 'INVALID_ACCOUNT') clear(); update('error', error.message); } throw error; }
    finally { finish(current); }
  }
  async function connect({returnTo = '/#dashboard'} = {}) {
    begin();
    const current = generation;
    update('connecting', 'Taking you to Google sign-in…');
    try {
      const config = configuration || await prepare();
      ensure(current);
      if (!config?.configured) throw new CloudError('Persistent Google accounts need to be configured by the website owner.', 'ACCOUNT_SETUP_REQUIRED', {missing: config?.missing || [], redirectUri: config?.redirectUri});
      const route = returnTo === '/#overview' ? '/#dashboard' : returnTo;
      const target = typeof route === 'string' && /^\/#(?:dashboard|deposits|calendar|payments|backup|settings)$/.test(route) ? route : '/#dashboard';
      const url = `/api/auth/start?returnTo=${encodeURIComponent(target)}`;
      signal('signing-in');
      navigate(url);
      return {redirecting: true};
    } catch (error) { if (current === generation) update('error', error.message); throw error; }
    finally { finish(current); }
  }
  function requireAccount() { if (!user) throw new CloudError('Sign in with Google to open this account.', 'AUTH_REQUIRED'); return generation; }
  async function readLatest() {
    const current = requireAccount();
    begin(); update('checking', 'Checking your Android backup…');
    try {
      const result = await request('drive/latest', {current});
      if (!result?.latest) { latestFile = null; update('connected', 'Signed in. No Drive backup was found for this account.'); return null; }
      const checked = validateCloudBackup(result.latest.backup, validateData);
      if (typeof result.latest.file?.id !== 'string' || !result.latest.file.id) throw new CloudError('The Drive backup information is invalid.', 'INVALID_RESPONSE');
      latestFile = result.latest.file;
      update('connected', 'Your Google account and latest Drive backup are ready.');
      return {file: latestFile, ...checked};
    } catch (error) { if (current === generation) update(user ? 'error' : 'disconnected', error.message); throw error; }
    finally { finish(current); }
  }
  async function upload(payload, options = {}) {
    const current = requireAccount();
    if (!Object.hasOwn(options, 'expectedFileId')) throw new CloudError('Review the latest Google Drive backup before saving.', 'REVIEW_REQUIRED');
    const checked = validateCloudBackup(payload, validateData);
    begin(); update('saving', 'Saving your complete backup to Google Drive…');
    try {
      const encoded = await uploadBody({backup: checked.backup, expectedFileId: options.expectedFileId});
      ensure(current);
      const result = await request('drive/backup', {method: 'POST', ...encoded, current});
      if (typeof result?.file?.id !== 'string') throw new CloudError('Google Drive did not confirm the backup. Check again before retrying.', 'SAVE_UNCONFIRMED');
      latestFile = result.file;
      update('connected', 'Your backup is saved to Google Drive.');
      return {file: result.file, ...checked, newerBackup: result.newerBackup || null};
    } catch (error) { if (current === generation) update(user ? 'error' : 'disconnected', error.message); throw error; }
    finally { finish(current); }
  }
  async function disconnect() {
    const account = user?.sub, csrf = csrfToken;
    generation++;
    for (const controller of active) controller.abort();
    active.clear(); busy = true;
    const current = generation;
    update('signing-out', 'Signing out of your account…');
    try {
      if (account) await request('auth/logout', {method: 'POST', body: '{}', headers: {'Content-Type': 'application/json'}, account, csrf, current});
      clear(); signal('signed-out'); update('disconnected', 'You are signed out. Your account records are kept separately.');
    } catch (error) { if (current === generation) update(user ? 'error' : 'disconnected', error.message); throw error; }
    finally { finish(current); }
  }

  function beginQuiet(){begin();quiet=true;try{onStatus(getStatus());}catch{}}
  function finishQuiet(current){quiet=false;finish(current);}
  async function registry(known='') {const current=requireAccount();beginQuiet();try{return await request('drive/registry?'+new URLSearchParams({known}),{current});}finally{finishQuiet(current);}}
  async function saveVersion(backup,parents=[]) {const current=requireAccount();validateCloudBackup(backup,validateData);beginQuiet();try{return await request('drive/save-version',{method:'POST',...await uploadBody({backup,parents}),current});}finally{finishQuiet(current);}}
  async function versions(pageToken='') {const current=requireAccount();beginQuiet();try{return await request('drive/versions?'+new URLSearchParams({pageToken}),{current});}finally{finishQuiet(current);}}
  async function version(id) {const current=requireAccount();beginQuiet();try{const value=await request('drive/version?'+new URLSearchParams({id}),{current});validateCloudBackup(value.backup,validateData);return value;}finally{finishQuiet(current);}}
  return Object.freeze({prepare, restore, connect, readLatest, upload, registry, saveVersion, versions, version, disconnect, getStatus});
}
