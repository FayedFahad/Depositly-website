/**
 * Google Drive bridge shared with Depositly Android's immutable backup format.
 * OAuth access tokens live only in this module's memory, never in browser storage.
 * The web OAuth client must belong to Android's Google Cloud project, 688859064258.
 * References:
 * https://developers.google.com/identity/oauth2/web/guides/use-token-model
 * https://developers.google.com/workspace/drive/api/guides/appdata
 */
export const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DEFAULT_CLIENT_ID = '688859064258-h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com';
export const BACKUP_FILE_NAME = 'depositly-backup.json';
export const CLOUD_FORMAT = 'depositly-google-drive';
const GOOGLE_API = 'https://www.googleapis.com';
const MAX_BACKUP_BYTES = 20000000;
const SCOPES = `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile ${DRIVE_SCOPE}`;
let identityPromise;

export class CloudError extends Error {
  constructor(message, code = 'CLOUD_ERROR', details = {}) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    Object.assign(this, details);
  }
}

/** Preload at page startup so a later sign-in click can open Google's popup. */
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google.accounts.oauth2);
  if (identityPromise) return identityPromise;
  if (!globalThis.document) return Promise.reject(new CloudError('Google sign-in requires a browser.', 'BROWSER_REQUIRED'));
  identityPromise = new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${GOOGLE_SCRIPT_URL}"]`);
    const timer = setTimeout(() => finish(new CloudError('Google sign-in could not load. Check your connection and try again.', 'GOOGLE_LOAD_FAILED')), 20000);
    function finish(error) {
      clearTimeout(timer);
      script?.removeEventListener('load', loaded);
      script?.removeEventListener('error', failed);
      if (error) {
        identityPromise = undefined;
        script?.remove();
        reject(error);
      } else resolve(globalThis.google.accounts.oauth2);
    }
    function loaded() {
      if (globalThis.google?.accounts?.oauth2) finish();
      else finish(new CloudError('Google sign-in is unavailable in this browser.', 'GOOGLE_LOAD_FAILED'));
    }
    function failed() {
      finish(new CloudError('Google sign-in could not load. Check your connection or content blocker and try again.', 'GOOGLE_LOAD_FAILED'));
    }
    if (!script) {
      script = document.createElement('script');
      script.src = GOOGLE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.dataset.depositlyGoogle = 'true';
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
      document.head.append(script);
    } else {
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
    }
  });
  return identityPromise;
}

/** Validate the transport envelope before the financial engine validates its data. */
export function validateCloudBackup(input, validateData = value => value) {
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new CloudError('This Google Drive backup is not valid JSON.', 'INVALID_BACKUP'); }
  if (!value || value.format !== CLOUD_FORMAT || value.version !== 1 || !value.data || value.data.scope !== 'all' || !Array.isArray(value.data.assets) || !value.data.paid || typeof value.data.paid !== 'object' || Array.isArray(value.data.paid)) {
    throw new CloudError('This Google Drive backup needs a newer version of Depositly, or is invalid.', 'INVALID_BACKUP');
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) {
    throw new CloudError('This backup exceeds the 20 MB safety limit. Use a file backup.', 'BACKUP_TOO_LARGE');
  }
  // Isolate an in-progress upload from subsequent edits to the caller's state.
  value = JSON.parse(serialized);
  if (value.notificationSettings && (typeof value.notificationSettings.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.notificationSettings.time))) {
    throw new CloudError('The Google Drive backup contains invalid reminder settings.', 'INVALID_BACKUP');
  }
  let data;
  try { data = validateData(value.data); }
  catch (error) { throw new CloudError(`The Google Drive backup could not be read: ${error.message}`, 'INVALID_BACKUP'); }
  return { backup: value, data };
}

/**
 * createCloudSync({clientId, validateData: Transfer.migrate, onStatus})
 * connect() -> {user, latest: {file, backup, data}|null}
 * readLatest() -> {file, backup, data}|null (does not apply or upload data)
 * upload(fullBackupOrExport, {expectedFileId}) -> {file, backup, data, newerBackup}
 * expectedFileId is the last REVIEWED backup id, or null when none exists.
 * disconnect() clears the account and token without deleting vault data or backups.
 */
export function createCloudSync({ clientId = DEFAULT_CLIENT_ID, validateData = value => value, onStatus = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), googleProvider = () => globalThis.google?.accounts?.oauth2 || loadGoogleIdentity() } = {}) {
  let accessToken = '', expiresAt = 0, generation = 0, busy = false;
  let user = null, latestFile = null, phase = 'disconnected', message = 'Connect Google to open your Android backup.';
  let preparedGoogle = null, preparingGoogle = null;

  // Load ahead of the click, without requesting permission or opening a window.
  function prepare() {
    if (preparedGoogle) return Promise.resolve(preparedGoogle);
    if (preparingGoogle) return preparingGoogle;
    const accept = oauth => {
      if (typeof oauth?.initTokenClient !== 'function' || typeof oauth?.hasGrantedAllScopes !== 'function') throw new CloudError('Google sign-in did not finish loading. Please try again.', 'GOOGLE_LOAD_FAILED');
      preparedGoogle = oauth;
      return oauth;
    };
    try {
      const supplied = googleProvider();
      if (!supplied || typeof supplied.then !== 'function') return Promise.resolve(accept(supplied));
      preparingGoogle = Promise.resolve(supplied).then(accept).finally(() => { preparingGoogle = null; });
      return preparingGoogle;
    } catch (error) { return Promise.reject(error); }
  }

  function oauthError(result) {
    const googleErrorCode = /^[a-zA-Z0-9_-]{1,80}$/.test(result?.error || '') ? result.error : 'unknown';
    const text = googleErrorCode === 'access_denied'
      ? 'Google sign-in was canceled. You can try again whenever you are ready.'
      : ['origin_mismatch', 'invalid_client', 'unauthorized_client'].includes(googleErrorCode)
        ? 'Google rejected this website’s OAuth configuration. Check the Web client and its Authorized JavaScript origins.'
        : 'Google could not complete sign-in. Check the account’s access and try again.';
    return new CloudError(text, 'AUTH_FAILED', { googleErrorCode });
  }

  function popupError(error) {
    if (error?.type === 'popup_closed') return new CloudError('The Google sign-in window closed before sign-in finished. Your local records are unchanged.', 'POPUP_CLOSED', { googleErrorType: 'popup_closed' });
    if (error?.type === 'popup_failed_to_open') return new CloudError('This browser could not open the Google sign-in window. Try again from the button, or open Depositly directly in your browser.', 'POPUP_FAILED_TO_OPEN', { googleErrorType: 'popup_failed_to_open' });
    return new CloudError('Google could not start its sign-in window. Open Depositly directly in Chrome, Edge, Firefox or Safari and try again.', 'GOOGLE_POPUP_UNKNOWN', { googleErrorType: 'unknown' });
  }

  const getStatus = () => ({ connected: !!user && !!accessToken && Date.now() < expiresAt, busy, phase, message, user: user ? { ...user } : null, latestFile: latestFile ? { ...latestFile } : null, expiresAt: user ? expiresAt : 0 });
  function update(nextPhase, nextMessage) {
    phase = nextPhase;
    message = nextMessage;
    try { onStatus(getStatus()); } catch { /* A view callback must not interrupt a completed backup. */ }
  }
  function session() {
    if (!accessToken || !user || Date.now() >= expiresAt) {
      if (user) update('expired', 'Your Google session expired. Connect again to continue.');
      throw new CloudError('Connect your Google account again to continue. Your local data is saved.', 'AUTH_REQUIRED');
    }
    return generation;
  }
  function ensureGeneration(current) {
    if (current !== generation) throw new CloudError('The Google account changed. Please try again.', 'ACCOUNT_CHANGED');
  }
  async function request(path, { method = 'GET', body, contentType, current = generation, token = accessToken } = {}) {
    ensureGeneration(current);
    if (typeof fetchImpl !== 'function') throw new CloudError('This browser cannot connect to Google Drive.', 'FETCH_UNAVAILABLE');
    const endpoint = new URL(path, GOOGLE_API);
    if (endpoint.origin !== GOOGLE_API) throw new CloudError('Invalid Google endpoint.', 'INVALID_ENDPOINT');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetchImpl(endpoint.href, {
        method, body, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(contentType ? { 'Content-Type': contentType } : {}) },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
      });
      ensureGeneration(current);
      if (!response.ok) {
        if (response.status === 401) {
          accessToken = '';
          expiresAt = 0;
          update('expired', 'Your Google session expired. Connect again to continue.');
          throw new CloudError('Google access expired. Connect again to continue.', 'AUTH_REQUIRED');
        }
        if (response.status === 403) throw new CloudError('Google Drive access was denied. Allow backup access and check that the Drive API is enabled for Depositly.', 'ACCESS_DENIED');
        if (response.status === 429) throw new CloudError('Google Drive is busy. Wait a moment, then try again.', 'RATE_LIMITED');
        throw new CloudError('Google Drive could not complete the request. Your previous backups are safe.', 'DRIVE_ERROR', { status: response.status });
      }
      const contentLength = Number(response.headers?.get('content-length') || 0);
      if (contentLength > MAX_BACKUP_BYTES) throw new CloudError('This backup exceeds the 20 MB safety limit.', 'BACKUP_TOO_LARGE');
      const text = await response.text();
      ensureGeneration(current);
      if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new CloudError('This backup exceeds the 20 MB safety limit.', 'BACKUP_TOO_LARGE');
      try { return text ? JSON.parse(text) : null; }
      catch { throw new CloudError('Google Drive returned an unreadable backup. Your local records are unchanged.', 'INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof CloudError) throw error;
      throw new CloudError(error.name === 'AbortError' ? 'Google Drive took too long to respond. Please try again.' : 'Google Drive could not be reached. Check your connection and try again.', 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
  async function latestMetadata(current) {
    const query = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1', orderBy: 'createdTime desc', fields: 'files(id,name,createdTime,size)', q: `name = '${BACKUP_FILE_NAME}' and trashed = false` });
    const list = await request(`/drive/v3/files?${query}`, { current });
    if (!Array.isArray(list?.files)) throw new CloudError('Google Drive returned an invalid backup list.', 'INVALID_RESPONSE');
    const file = list.files[0] || null;
    if (file && (typeof file.id !== 'string' || !file.id)) throw new CloudError('Google Drive returned an invalid backup file.', 'INVALID_RESPONSE');
    return file;
  }
  async function latest(current) {
    const file = await latestMetadata(current);
    if (!file) { latestFile = null; return null; }
    if (Number(file.size || 0) > MAX_BACKUP_BYTES) throw new CloudError('This backup exceeds the 20 MB safety limit.', 'BACKUP_TOO_LARGE');
    const value = await request(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { current });
    const checked = validateCloudBackup(value, validateData);
    latestFile = file;
    return { file, ...checked };
  }
  function begin() {
    if (busy) throw new CloudError('A Google Drive operation is already in progress.', 'BUSY');
    busy = true;
  }
  function finish(current) { if (current !== generation) return; busy = false; try { onStatus(getStatus()); } catch {} }
  async function connect({ selectAccount = true } = {}) {
    begin();
    const current = ++generation;
    accessToken = '';
    expiresAt = 0;
    user = null;
    latestFile = null;
    update('connecting', 'Opening Google sign-in…');
    try {
      if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new CloudError('Configure the Google Web client ID before signing in.', 'CONFIG_REQUIRED');
      if (!preparedGoogle) {
        const preparation = prepare();
        if (!preparedGoogle) {
          await preparation;
          ensureGeneration(current);
          // Opening after a network wait can lose the browser's user activation.
          // A fresh click is required instead of trying to open a delayed popup.
          throw new CloudError('Google sign-in is ready. Click Continue with Google to open the sign-in window.', 'GOOGLE_READY');
        }
      }
      const oauth = preparedGoogle;
      ensureGeneration(current);
      const response = await new Promise((resolve, reject) => {
        const client = oauth.initTokenClient({
          client_id: clientId, scope: SCOPES, include_granted_scopes: true,
          callback: result => result?.error ? reject(oauthError(result)) : resolve(result),
          error_callback: error => reject(popupError(error))
        });
        // Keep this call synchronous with the original button click. No await
        // or asynchronous SDK loading may be inserted before this ready path.
        client.requestAccessToken({ prompt: selectAccount ? 'select_account' : '' });
      });
      ensureGeneration(current);
      if (!response.access_token || !oauth.hasGrantedAllScopes(response, DRIVE_SCOPE)) throw new CloudError('Allow Depositly to access its private Drive backup folder to continue.', 'MISSING_SCOPE');
      accessToken = response.access_token;
      expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 3600) * 1000 - 30000);
      const profile = await request('/oauth2/v3/userinfo', { current });
      if (!profile?.sub || typeof profile.email !== 'string') throw new CloudError('Google could not verify your account. Please connect again.', 'INVALID_ACCOUNT');
      user = { sub: profile.sub, email: profile.email, name: typeof profile.name === 'string' ? profile.name : profile.email.split('@')[0], picture: typeof profile.picture === 'string' && profile.picture.startsWith('https://') ? profile.picture : '' };
      update('checking', 'Checking your Android backup…');
      const backup = await latest(current);
      update('connected', backup ? 'Google connected. Your Android backup is ready to review.' : 'Google connected. No backup was found for this account.');
      return { user: { ...user }, latest: backup };
    } catch (error) {
      if (current === generation) {
        accessToken = '';
        expiresAt = 0;
        user = null;
        latestFile = null;
        update(error.code === 'GOOGLE_READY' ? 'ready' : 'error', error.message);
      }
      throw error;
    } finally { finish(current); }
  }
  async function readLatest() {
    const current = session();
    begin();
    update('checking', 'Checking for a newer Android backup…');
    try {
      const value = await latest(current);
      update('connected', value ? 'The latest Google Drive backup is ready.' : 'No Google Drive backup was found.');
      return value;
    } catch (error) {
      if (current === generation) update(error.code === 'AUTH_REQUIRED' ? 'expired' : 'error', error.message);
      throw error;
    } finally { finish(current); }
  }
  async function upload(payload, options = {}) {
    const current = session();
    if (!Object.prototype.hasOwnProperty.call(options, 'expectedFileId')) throw new CloudError('Review the latest Google Drive backup before saving.', 'REVIEW_REQUIRED');
    const wrapper = payload?.format === CLOUD_FORMAT ? payload : { format: CLOUD_FORMAT, version: 1, data: payload };
    const checked = validateCloudBackup(wrapper, validateData);
    begin();
    update('saving', 'Checking for changes before saving your backup…');
    try {
      const remote = await latestMetadata(current);
      if ((remote?.id || null) !== (options.expectedFileId || null)) {
        throw new CloudError('A newer backup was saved from another device. Review it before saving your website records.', 'CLOUD_CONFLICT', { remoteFile: remote });
      }
      const boundary = `depositly_${globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
      const metadata = { name: BACKUP_FILE_NAME, mimeType: 'application/json', parents: ['appDataFolder'] };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(checked.backup)}\r\n--${boundary}--\r\n`;
      update('saving', 'Saving a complete backup to Google Drive…');
      const file = await request('/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', { method: 'POST', contentType: `multipart/related; boundary=${boundary}`, body, current });
      if (!file?.id) throw new CloudError('Google Drive did not confirm the backup. Check the latest backup before retrying.', 'SAVE_UNCONFIRMED');
      latestFile = file;
      // Preserve all prior snapshots. Android performs its own ten-snapshot retention.
      // A second device can still upload between the preflight and this immutable create.
      let newerBackup = null;
      try { const newest = await latestMetadata(current); if (newest && newest.id !== file.id) newerBackup = newest; }
      catch { /* A successful upload remains successful when the follow-up check fails. */ }
      ensureGeneration(current);
      update('connected', newerBackup ? 'Backup saved. Another device also saved a backup; refresh before making more changes.' : 'Backup saved to Google Drive. Restore it in the Android app to see website changes.');
      return { file, ...checked, newerBackup };
    } catch (error) {
      if (current === generation) update(error.code === 'AUTH_REQUIRED' ? 'expired' : 'error', error.message);
      throw error;
    } finally { finish(current); }
  }
  function disconnect() {
    generation++;
    accessToken = '';
    expiresAt = 0;
    user = null;
    latestFile = null;
    busy = false;
    update('disconnected', 'Signed out. Your browser records and Google Drive backups are kept.');
  }
  return Object.freeze({ prepare, connect, readLatest, upload, disconnect, getStatus });
}
