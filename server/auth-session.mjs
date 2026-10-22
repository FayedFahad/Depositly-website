import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const SESSION_SECONDS = 400 * 24 * 60 * 60;
export const TRANSACTION_SECONDS = 10 * 60;
const VERSION = 'v1';
const MAX_COOKIE_VALUE = 3800;

export function secretKey(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) throw Error('SESSION_SECRET must contain at least 32 random bytes.');
  return createHash('sha256').update(secret, 'utf8').digest();
}
export const randomToken = () => randomBytes(32).toString('base64url');
export const pkceChallenge = verifier => createHash('sha256').update(verifier, 'ascii').digest('base64url');
export function equalSecret(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const left = Buffer.from(first), right = Buffer.from(second);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
export function encryptCookie(payload, purpose, secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secretKey(secret), iv);
  cipher.setAAD(Buffer.from(`depositly:${VERSION}:${purpose}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const result = [VERSION, iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  if (result.length > MAX_COOKIE_VALUE) throw Error('The encrypted session exceeds the browser cookie limit.');
  return result;
}
export function decryptCookie(value, purpose, secret, now = Date.now()) {
  if (typeof value !== 'string' || value.length > MAX_COOKIE_VALUE || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const [, ivValue, encryptedValue, tagValue] = value.split('.');
    const iv = Buffer.from(ivValue, 'base64url'), tag = Buffer.from(tagValue, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', secretKey(secret), iv);
    decipher.setAAD(Buffer.from(`depositly:${VERSION}:${purpose}`));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8'));
    return payload && typeof payload === 'object' && Number.isFinite(payload.expiresAt) && payload.expiresAt > now ? payload : null;
  } catch { return null; }
}
export function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const pair of String(header).split(';')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index).trim(), value = pair.slice(index + 1).trim();
    // Ambiguous duplicate auth cookie names are rejected rather than guessed.
    cookies[name] = Object.hasOwn(cookies, name) ? null : value;
  }
  return cookies;
}
export function cookieNames(secure = true) {
  const prefix = secure ? '__Host-' : '';
  return {session: `${prefix}depositly_session`, binding: `${prefix}depositly_binding`, transaction: `${prefix}depositly_oauth`};
}
export function serializeCookie(name, value, {secure = true, maxAge = SESSION_SECONDS} = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || /[;\r\n]/.test(value)) throw Error('Invalid cookie.');
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}
export function appendCookies(response, values) {
  const current = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', [...(Array.isArray(current) ? current : current ? [current] : []), ...values]);
}
