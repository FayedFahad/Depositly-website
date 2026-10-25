import {createRegistryDrive} from './registry-drive.mjs';
import {gzipSync, gunzipSync} from 'node:zlib';
import {normalizeBackup} from '../assets/data-engine.js';
import {SESSION_SECONDS, TRANSACTION_SECONDS, randomToken, pkceChallenge, equalSecret, encryptCookie, decryptCookie, parseCookies, cookieNames, serializeCookie, appendCookies} from './auth-session.mjs';

const DEFAULT_CLIENT_ID = '688859064258-h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPES = `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile ${DRIVE_SCOPE}`;
const FILE_NAME = 'depositly-backup.json';
const GOOGLE = 'https://www.googleapis.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_BACKUP = 20_000_000, MAX_BODY = 4_000_000, MAX_DECOMPRESSED = MAX_BACKUP + 100_000;
const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;

export class ApiError extends Error {
  constructor(status, code, message, details = {}) { super(message); this.status = status; this.code = code; this.details = details; }
}
export function authConfiguration(env = process.env) {
  const missing = [], clientId = env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) missing.push('GOOGLE_CLIENT_ID');
  if (typeof env.GOOGLE_CLIENT_SECRET !== 'string' || !env.GOOGLE_CLIENT_SECRET.trim()) missing.push('GOOGLE_CLIENT_SECRET');
  if (typeof env.SESSION_SECRET !== 'string' || Buffer.byteLength(env.SESSION_SECRET, 'utf8') < 32) missing.push('SESSION_SECRET');
  let origin = 'https://depositly.vercel.app', secure = true;
  try {
    const candidate = new URL(env.APP_ORIGIN || origin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname);
    if ((candidate.protocol !== 'https:' && !(local && candidate.protocol === 'http:')) || candidate.username || candidate.password || candidate.pathname !== '/' || candidate.search || candidate.hash) throw Error();
    origin = candidate.origin;
    secure = candidate.protocol === 'https:';
  } catch { missing.push('APP_ORIGIN'); }
  return {configured: missing.length === 0, missing, clientId, clientSecret: env.GOOGLE_CLIENT_SECRET, sessionSecret: env.SESSION_SECRET, origin, secure, redirectUri: `${origin}/api/auth/callback`, loginUrl: '/api/auth/start'};
}
const publicConfiguration = config => ({configured: config.configured, missing: config.missing, redirectUri: config.redirectUri, loginUrl: config.loginUrl});
function noStore(response) {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('Vary', 'Cookie, Accept-Encoding');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}
function json(response, status, value, {allowGzip = true} = {}) {
  const raw = Buffer.from(JSON.stringify(value));
  const compressed = raw.length > 512_000 && allowGzip ? gzipSync(raw) : null;
  const body = compressed || raw;
  if (body.length > MAX_BODY) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This backup is too large for the website transfer. Use a full JSON file backup to move these records.');
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (compressed) response.setHeader('Content-Encoding', 'gzip');
  response.setHeader('Content-Length', body.length);
  response.end(body);
}
function redirect(response, target) { response.statusCode = 302; response.setHeader('Location', target); response.end(); }
function configured(config) { if (!config.configured) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Persistent Google sign-in needs the server environment configured. See the deployment setup.'); }
function requestMethod(request, expected) { if (request.method !== expected) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This request method is not allowed.'); }
function safeGoogleCode(value) { return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : ''; }
function safeString(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function safeReturnTo(value) {
  const route=value==='/#overview'?'/#dashboard':value;
  return typeof route==='string'&&/^\/#(?:dashboard|deposits|bank-information|calendar|payments|backup|settings)$/.test(route)?route:'/#dashboard';
}
function publicUser(user) { return {sub: user.sub, email: user.email, name: user.name, given_name: user.given_name || '', picture: user.picture || ''}; }
function scopeGranted(scope) { return typeof scope === 'string' && scope.split(/\s+/).includes(DRIVE_SCOPE); }
function requireOrigin(request, config) {
  if (request.headers.origin !== config.origin || request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'CSRF_FAILED', 'This request must come from your Depositly website. Reload the page and try again.');
}
function safeReadOrigin(request, config) {
  if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== config.origin)) throw new ApiError(403, 'CSRF_FAILED', 'Open Depositly directly to use this account.');
}
async function requestBody(request) {
  let body;
  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) body = request.body;
    else if (typeof request.body === 'string') body = Buffer.from(request.body);
    else if (request.body instanceof Uint8Array) body = Buffer.from(request.body);
    else body = Buffer.from(JSON.stringify(request.body));
  } else {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This transfer is too large. Export a full JSON backup instead.');
      chunks.push(bytes);
    }
    body = Buffer.concat(chunks);
  }
  if (body.length > MAX_BODY) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This transfer is too large. Export a full JSON backup instead.');
  const encoding = request.headers['x-depositly-encoding'];
  if (encoding && encoding !== 'gzip') throw new ApiError(400, 'INVALID_REQUEST', 'The backup transfer encoding is unsupported.');
  if (encoding === 'gzip') {
    try { body = gunzipSync(body, {maxOutputLength: MAX_DECOMPRESSED}); }
    catch (error) { throw new ApiError(error.code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400, error.code === 'ERR_BUFFER_TOO_LARGE' ? 'BACKUP_TOO_LARGE' : 'INVALID_REQUEST', 'The compressed backup could not be read within the website size limit. Use a full JSON file backup.'); }
  }
  if (body.length > MAX_DECOMPRESSED) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'The uncompressed backup exceeds the website size limit.');
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_REQUEST', 'The backup request is not valid JSON.'); }
}
function validateBackup(backup) {
  if (!backup || backup.format !== 'depositly-google-drive' || backup.version !== 1 || backup.data?.scope !== 'all') throw new ApiError(400, 'INVALID_BACKUP', 'Choose a complete Depositly Google Drive backup.');
  if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This backup exceeds the 20 MB safety limit. Use a full JSON file backup.');
  try { return normalizeBackup(backup).data; }
  catch { throw new ApiError(400, 'INVALID_BACKUP', 'The backup contains unsupported or invalid records. Update Depositly or use a valid file backup.'); }
}

export function createApiHandler({env = process.env, fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  async function googleJson(url, {method = 'GET', body, token, type, maxBytes = MAX_BACKUP} = {}) {
    let response;
    try { response = await fetchImpl(url, {method, body, headers: {Accept: 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(type ? {'Content-Type': type} : {})}, redirect: 'error', signal: AbortSignal.timeout(30_000)}); }
    catch { throw new ApiError(502, 'GOOGLE_UNAVAILABLE', 'Google could not be reached. Your browser records and existing Drive backups are safe. Try again.'); }
    if (Number(response.headers?.get('content-length') || 0) > maxBytes) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This Google Drive backup exceeds the website safety limit.');
    let text;
    try { text = await response.text(); } catch { throw new ApiError(502, 'GOOGLE_UNAVAILABLE', 'Google’s response could not be read. Please try again.'); }
    if (Buffer.byteLength(text) > maxBytes) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This Google Drive backup exceeds the website safety limit.');
    let value;
    try { value = text ? JSON.parse(text) : {}; } catch { throw new ApiError(502, 'GOOGLE_INVALID_RESPONSE', 'Google returned an unreadable response. Your local records are unchanged.'); }
    return {ok: response.ok, status: response.status, value};
  }
  function clearSession(response, config) { const names = cookieNames(config.secure); appendCookies(response, [serializeCookie(names.session, '', {secure: config.secure, maxAge: 0})]); }
  function writeBinding(response, config, binding) {
    appendCookies(response, [serializeCookie(cookieNames(config.secure).binding, encryptCookie({nonce: binding, expiresAt: now() + SESSION_SECONDS * 1000}, 'binding', config.sessionSecret), {secure: config.secure})]);
  }
  function writeSession(response, config, session) {
    session.expiresAt = now() + SESSION_SECONDS * 1000;
    appendCookies(response, [serializeCookie(cookieNames(config.secure).session, encryptCookie(session, 'session', config.sessionSecret), {secure: config.secure})]);
  }
  function loadSession(request, config) {
    const cookies = parseCookies(request.headers.cookie), names = cookieNames(config.secure);
    const session = decryptCookie(cookies[names.session], 'session', config.sessionSecret, now());
    const binding = decryptCookie(cookies[names.binding], 'binding', config.sessionSecret, now());
    if (!session || !binding || !equalSecret(session.binding, binding.nonce) || !session.user?.sub || !session.refreshToken || !session.accessToken || !session.csrfToken) return null;
    return session;
  }
  async function refreshSession(session, response, config, force = false) {
    if (session.refreshExpiresAt && session.refreshExpiresAt <= now()) { clearSession(response, config); throw new ApiError(401, 'AUTH_REQUIRED', 'Google’s account permission expired. Sign in again to continue.'); }
    if (!force && session.accessExpiresAt > now() + 60_000) return session;
    const form = new URLSearchParams({client_id: config.clientId, client_secret: config.clientSecret, refresh_token: session.refreshToken, grant_type: 'refresh_token'});
    const result = await googleJson(TOKEN_ENDPOINT, {method: 'POST', body: form.toString(), type: 'application/x-www-form-urlencoded', maxBytes: 100_000});
    if (!result.ok) {
      if (['invalid_grant', 'invalid_token'].includes(result.value?.error)) { clearSession(response, config); throw new ApiError(401, 'AUTH_REQUIRED', 'Google permission expired or was removed. Sign in again to continue.'); }
      throw new ApiError(502, 'GOOGLE_UNAVAILABLE', 'Google could not renew your account session. Try again shortly.');
    }
    if (!result.value.access_token || !Number.isFinite(Number(result.value.expires_in)) || Number(result.value.expires_in) <= 0 || (result.value.scope && !scopeGranted(result.value.scope))) { clearSession(response, config); throw new ApiError(401, 'AUTH_REQUIRED', 'Google Drive permission changed. Sign in again to continue.'); }
    session.accessToken = result.value.access_token;
    session.accessExpiresAt = now() + Number(result.value.expires_in) * 1000;
    if (result.value.refresh_token) session.refreshToken = result.value.refresh_token;
    if (Number(result.value.refresh_token_expires_in) > 0) session.refreshExpiresAt = now() + Number(result.value.refresh_token_expires_in) * 1000;
    return session;
  }
  async function authenticated(request, response, config, {write = false} = {}) {
    configured(config);
    safeReadOrigin(request, config);
    const session = loadSession(request, config);
    if (!session) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in with your Google account to continue.');
    const expectedAccount = request.headers['x-depositly-account'];
    if (expectedAccount && !equalSecret(expectedAccount, session.user.sub)) throw new ApiError(403, 'ACCOUNT_CHANGED', 'The Google account changed in another tab. Reload before using these records.');
    // Reject unsafe writes before using a possibly rotating Google refresh token.
    if (write) validateCsrf(request, session, config);
    return refreshSession(session, response, config);
  }
  function validateCsrf(request, session, config) { requireOrigin(request, config); if (!equalSecret(request.headers['x-csrf-token'], session.csrfToken)) throw new ApiError(403, 'CSRF_FAILED', 'Your secure request could not be verified. Reload Depositly and try again.'); }
  async function driveRequest(path, session, response, config, options = {}) {
    if (typeof path !== 'string' || !path.startsWith('/drive/v3/') && !path.startsWith('/upload/drive/v3/')) throw new ApiError(400, 'INVALID_REQUEST', 'Unsupported Drive request.');
    let result = await googleJson(`${GOOGLE}${path}`, {...options, token: session.accessToken});
    if (result.status === 401) {
      await refreshSession(session, response, config, true);
      result = await googleJson(`${GOOGLE}${path}`, {...options, token: session.accessToken});
    }
    if (!result.ok) {
      if (result.status === 401) { clearSession(response, config); throw new ApiError(401, 'AUTH_REQUIRED', 'Google could not verify this session. Sign in again.'); }
      if (result.status === 403) throw new ApiError(403, 'ACCESS_DENIED', 'Google Drive backup access was denied. Allow Depositly backup access and try again.');
      if (result.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Google Drive is busy. Wait a moment, then try again.');
      throw new ApiError(502, 'DRIVE_ERROR', 'Google Drive could not complete the request. Your previous backups are safe.');
    }
    return result.value;
  }
  async function latestFile(session, response, config) {
    const query = new URLSearchParams({spaces: 'appDataFolder', pageSize: '1', orderBy: 'createdTime desc', fields: 'files(id,name,createdTime,size)', q: `name = '${FILE_NAME}' and trashed = false`});
    const result = await driveRequest(`/drive/v3/files?${query}`, session, response, config);
    if (!Array.isArray(result.files)) throw new ApiError(502, 'GOOGLE_INVALID_RESPONSE', 'Google Drive returned an invalid backup list.');
    const file = result.files[0] || null;
    if (file && (!FILE_ID.test(file.id) || file.name && file.name !== FILE_NAME)) throw new ApiError(502, 'GOOGLE_INVALID_RESPONSE', 'Google Drive returned an invalid backup file.');
    if (Number(file?.size || 0) > MAX_BACKUP) throw new ApiError(413, 'BACKUP_TOO_LARGE', 'This Google Drive backup exceeds the 20 MB safety limit.');
    return file;
  }

  return async function handler(request, response) {
    noStore(response);
    const config = authConfiguration(env);
    let pathname;
    try { pathname = new URL(request.url, config.origin).pathname.replace(/\/+$/, ''); } catch { pathname = ''; }
    const route = /^\/api\/(auth|drive)\/([a-z-]+)$/.exec(pathname);
    try {
      if (!route) throw new ApiError(404, 'NOT_FOUND', 'This Depositly endpoint does not exist.');
      const [, group, action] = route;
      if (group === 'auth' && action === 'config') { requestMethod(request, 'GET'); return json(response, 200, publicConfiguration(config)); }
      if (group === 'auth' && action === 'start') {
        requestMethod(request, 'GET'); configured(config);
        const state = randomToken(), verifier = randomToken(), binding = randomToken();
        const returnTo=safeReturnTo(new URL(request.url,config.origin).searchParams.get('returnTo'));
        const transaction = {state, verifier, binding, returnTo, expiresAt: now() + TRANSACTION_SECONDS * 1000};
        writeBinding(response, config, binding);
        appendCookies(response, [serializeCookie(cookieNames(config.secure).transaction, encryptCookie(transaction, 'transaction', config.sessionSecret), {secure: config.secure, maxAge: TRANSACTION_SECONDS})]);
        const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        target.search = new URLSearchParams({client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES, state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent select_account'}).toString();
        return redirect(response, target.href);
      }
      if (group === 'auth' && action === 'callback') {
        requestMethod(request, 'GET'); configured(config);
        const names = cookieNames(config.secure), cookies = parseCookies(request.headers.cookie), parameters = new URL(request.url, config.origin).searchParams;
        const transaction = decryptCookie(cookies[names.transaction], 'transaction', config.sessionSecret, now()), binding = decryptCookie(cookies[names.binding], 'binding', config.sessionSecret, now());
        let validTransaction = false;
        try {
          if (!transaction || !binding || !equalSecret(parameters.get('state'), transaction.state) || !equalSecret(transaction.binding, binding.nonce)) throw new ApiError(400, 'AUTH_STATE_INVALID', 'The sign-in request expired. Please start again.');
          validTransaction = true;
          appendCookies(response, [serializeCookie(names.transaction, '', {secure: config.secure, maxAge: 0})]);
          if (parameters.has('error')) throw new ApiError(400, safeGoogleCode(parameters.get('error')) === 'access_denied' ? 'ACCESS_DENIED' : 'AUTH_FAILED', 'Google sign-in did not finish.');
          const code = parameters.get('code');
          if (!code || code.length > 4096) throw new ApiError(400, 'AUTH_FAILED', 'Google did not return an authorization code.');
          const form = new URLSearchParams({client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code, code_verifier: transaction.verifier});
          const tokens = await googleJson(TOKEN_ENDPOINT, {method: 'POST', body: form.toString(), type: 'application/x-www-form-urlencoded', maxBytes: 100_000});
          if (!tokens.ok || !tokens.value.access_token || !Number.isFinite(Number(tokens.value.expires_in)) || Number(tokens.value.expires_in) <= 0 || !scopeGranted(tokens.value.scope)) throw new ApiError(400, 'AUTH_FAILED', 'Google Drive authorization did not finish.');
          if (!tokens.value.refresh_token) throw new ApiError(400, 'OFFLINE_ACCESS_REQUIRED', 'Allow persistent Google access and sign in again.');
          const profileResponse = await googleJson(`${GOOGLE}/oauth2/v3/userinfo`, {token: tokens.value.access_token, maxBytes: 100_000}), profile = profileResponse.value;
          if (!profileResponse.ok || typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255 || typeof profile.email !== 'string' || !profile.email || profile.email.length > 320) throw new ApiError(400, 'AUTH_FAILED', 'Google could not verify this account.');
          const user = {sub: profile.sub, email: profile.email, name: safeString(profile.name, 200) || profile.email, given_name: safeString(profile.given_name, 100), picture: typeof profile.picture === 'string' && profile.picture.startsWith('https://') ? profile.picture.slice(0, 500) : ''};
          const session = {version: 1, user, binding: transaction.binding, csrfToken: randomToken(), accessToken: tokens.value.access_token, refreshToken: tokens.value.refresh_token, accessExpiresAt: now() + Number(tokens.value.expires_in) * 1000, createdAt: now(), expiresAt: now() + SESSION_SECONDS * 1000};
          if (Number(tokens.value.refresh_token_expires_in) > 0) session.refreshExpiresAt = now() + Number(tokens.value.refresh_token_expires_in) * 1000;
          writeSession(response, config, session);
          return redirect(response, `${config.origin}${safeReturnTo(transaction.returnTo)}`);
        } catch (error) {
          // An unsolicited callback must not become a cross-site sign-out action.
          if (validTransaction) clearSession(response, config);
          const code = ['AUTH_STATE_INVALID', 'ACCESS_DENIED', 'OFFLINE_ACCESS_REQUIRED'].includes(error.code) ? error.code : 'AUTH_FAILED';
          return redirect(response, `${config.origin}/?auth_error=${code}#dashboard`);
        }
      }
      if (group === 'auth' && action === 'session') {
        requestMethod(request, 'GET');
        if (!config.configured) return json(response, 200, {authenticated: false, ...publicConfiguration(config)});
        safeReadOrigin(request, config);
        const session = loadSession(request, config);
        if (!session) { clearSession(response, config); return json(response, 200, {authenticated: false, configured: true}); }
        await refreshSession(session, response, config);
        writeSession(response, config, session);
        return json(response, 200, {authenticated: true, configured: true, user: publicUser(session.user), csrfToken: session.csrfToken, expiresAt: session.expiresAt});
      }
      if (group === 'auth' && action === 'logout') {
        requestMethod(request, 'POST'); configured(config); requireOrigin(request, config);
        const session = loadSession(request, config);
        if (session) {
          const expectedAccount = request.headers['x-depositly-account'];
          if (expectedAccount && !equalSecret(expectedAccount, session.user.sub)) throw new ApiError(403, 'ACCOUNT_CHANGED', 'The Google account changed in another tab. Reload before signing out.');
          validateCsrf(request, session, config);
        }
        clearSession(response, config);
        writeBinding(response, config, randomToken());
        appendCookies(response, [serializeCookie(cookieNames(config.secure).transaction, '', {secure: config.secure, maxAge: 0})]);
        return json(response, 200, {authenticated: false});
      }
      if(group==='drive'&&['registry','versions','version','save-version'].includes(action)){
        const write=action==='save-version';requestMethod(request,write?'POST':'GET');
        const session=await authenticated(request,response,config,{write});
        const drive=createRegistryDrive({request:(path,options)=>driveRequest(path,session,response,config,options),validateBackup,now});
        const params=new URL(request.url,config.origin).searchParams;
        let result;
        if(write){const input=await requestBody(request);result=await drive.save(input.backup,input.parents);}
        else if(action==='versions')result=await drive.history(params.get('pageToken')||undefined);
        else if(action==='version')result=await drive.version(params.get('id'));
        else result=await drive.read(params.get('known')||'');
        writeSession(response,config,session);return json(response,200,result);
      }
      if (group === 'drive' && action === 'latest') {
        requestMethod(request, 'GET');
        const session = await authenticated(request, response, config), file = await latestFile(session, response, config);
        let latest = null;
        if (file) {
          const backup = await driveRequest(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, session, response, config);
          const data = validateBackup(backup);
          latest = {file, backup, data};
        }
        writeSession(response, config, session);
        return json(response, 200, {latest});
      }
      if (group === 'drive' && action === 'backup') {
        requestMethod(request, 'POST');
        const session = await authenticated(request, response, config, {write: true});
        const input = await requestBody(request);
        if (!input || !Object.hasOwn(input, 'expectedFileId') || input.expectedFileId !== null && (typeof input.expectedFileId !== 'string' || !FILE_ID.test(input.expectedFileId))) throw new ApiError(400, 'REVIEW_REQUIRED', 'Review the latest Google Drive backup before saving.');
        validateBackup(input.backup);
        const current = await latestFile(session, response, config);
        if ((current?.id || null) !== input.expectedFileId) throw new ApiError(409, 'CLOUD_CONFLICT', 'Another device saved a newer backup. Review it before saving website records.', {remoteFile: current});
        const boundary = `depositly_${randomToken()}`, metadata = {name: FILE_NAME, mimeType: 'application/json', parents: ['appDataFolder']};
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(input.backup)}\r\n--${boundary}--\r\n`;
        const file = await driveRequest('/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', session, response, config, {method: 'POST', type: `multipart/related; boundary=${boundary}`, body});
        if (!file?.id || !FILE_ID.test(file.id)) throw new ApiError(502, 'SAVE_UNCONFIRMED', 'Google did not confirm the new backup. Check the latest backup before retrying.');
        let newerBackup = null;
        try { const newest = await latestFile(session, response, config); if (newest && newest.id !== file.id) newerBackup = newest; } catch { /* Preserve a confirmed upload when a follow-up check fails. */ }
        writeSession(response, config, session);
        return json(response, 200, {file, backup: input.backup, newerBackup});
      }
      throw new ApiError(404, 'NOT_FOUND', 'This Depositly endpoint does not exist.');
    } catch (error) {
      if (response.writableEnded) return;
      if (error instanceof ApiError) return json(response, error.status, {error: {code: error.code, message: error.message, ...error.details}}, {allowGzip: false});
      return json(response, 500, {error: {code: 'SERVER_ERROR', message: 'Depositly could not complete this request. Your existing records and backups are safe.'}}, {allowGzip: false});
    }
  };
}

export default createApiHandler();
