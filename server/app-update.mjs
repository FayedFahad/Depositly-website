import {lstat, readFile} from 'node:fs/promises';

const MANIFEST_PATH = new URL('../releases/latest.json', import.meta.url);
const CERTIFICATE = '655445e0b1a199ef9ae90efa6e795d0800d36ef0ca725f5f87835d396796224d';
const MAX_MANIFEST_BYTES = 64 * 1024;

export function validateAppUpdate(value) {
  if (!value || value.schemaVersion !== 1 || value.package !== 'app.depositly.mobile') throw Error('Invalid update manifest.');
  const version = typeof value.versionName === 'string' && /^(\d+\.\d+(?:\.\d+)?) Build ([1-9]\d*)$/.exec(value.versionName);
  if (!version || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || value.versionCode > 2100000000) throw Error('Invalid update version.');
  const slug = `${version[1]}-build-${version[2]}`;
  if (value.apkUrl !== `https://depositly.vercel.app/releases/${slug}/Depositly-${slug}.apk`) throw Error('Invalid APK location.');
  if (!/^[a-f0-9]{64}$/.test(value.apkSha256) || value.certificateSha256 !== CERTIFICATE) throw Error('Invalid update verification.');
  if (!Number.isSafeInteger(value.apkSize) || value.apkSize < 1 || value.apkSize > 256 * 1024 * 1024) throw Error('Invalid APK size.');
  if (typeof value.releaseNotes !== 'string' || value.releaseNotes.length > 32000 || typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) throw Error('Invalid update details.');
  return {schemaVersion: 1, package: value.package, versionName: value.versionName, versionCode: value.versionCode, apkUrl: value.apkUrl, apkSha256: value.apkSha256, certificateSha256: value.certificateSha256, apkSize: value.apkSize, releaseNotes: value.releaseNotes, publishedAt: value.publishedAt};
}

export async function readAppUpdate(manifestPath = MANIFEST_PATH) {
  const entry = await lstat(manifestPath);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_MANIFEST_BYTES) throw Error('Invalid release metadata file.');
  const bytes = await readFile(manifestPath);
  if (bytes.length > MAX_MANIFEST_BYTES) throw Error('Update feed is too large.');
  return validateAppUpdate(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}

export function createAppUpdateHandler({manifestPath = MANIFEST_PATH, now = Date.now} = {}) {
  let cached, expiresAt = 0, pending;
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({error: 'Use GET to check for an app update.'}));
      return;
    }
    try {
      if (!cached || now() >= expiresAt) {
        if (!pending) pending = (async () => {
          const manifest = await readAppUpdate(manifestPath);
          cached = manifest;
          expiresAt = now() + 60000;
          return manifest;
        })().finally(() => {pending = null;});
        await pending;
      }
      response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, must-revalidate');
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(cached));
    } catch {
      response.statusCode = 503;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Retry-After', '30');
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({error: 'The latest Android download is temporarily unavailable. Please try again shortly.'}));
    }
  };
}

export default createAppUpdateHandler();
