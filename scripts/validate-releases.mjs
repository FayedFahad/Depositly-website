import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readAppUpdate} from '../server/app-update.mjs';

const RELEASE_DIRECTORY = fileURLToPath(new URL('../releases/', import.meta.url));
const VERSION_SLUG = /^\d+\.\d+(?:\.\d+)?-build-[1-9]\d*$/;

async function regularFile(filename, maximumSize) {
  const entry = await lstat(filename);
  if (!entry.isFile() || entry.isSymbolicLink() || (maximumSize && entry.size > maximumSize)) throw Error(`Invalid release file: ${path.basename(filename)}`);
  return entry;
}

export async function validateReleaseDirectory(directory = RELEASE_DIRECTORY) {
  const root = path.resolve(directory), rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw Error('Invalid release directory.');
  const latest = await readAppUpdate(path.join(root, 'latest.json'));
  let latestFound = false;
  const publicFiles = ['releases/latest.json'];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    if (entry.name === 'latest.json') continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() || !VERSION_SLUG.test(entry.name)) throw Error(`Unexpected release entry: ${entry.name}`);
    const versionRoot = path.join(root, entry.name), manifest = await readAppUpdate(path.join(versionRoot, 'update.json'));
    const slug = manifest.versionName.replace(' Build ', '-build-');
    if (slug !== entry.name) throw Error('Release directory and version do not match.');
    const apkName = `Depositly-${slug}.apk`, expectedFiles = [apkName, 'build-info.json', 'update.json'];
    const names = (await readdir(versionRoot)).sort();
    if (!isDeepStrictEqual(names, expectedFiles.slice().sort())) throw Error(`Unexpected files in release ${slug}.`);
    const apkPath = path.join(versionRoot, apkName), apk = await regularFile(apkPath);
    if (apk.size !== manifest.apkSize) throw Error(`APK size does not match release ${slug}.`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(apkPath)) hash.update(chunk);
    if (hash.digest('hex') !== manifest.apkSha256) throw Error(`APK checksum does not match release ${slug}.`);
    const infoPath = path.join(versionRoot, 'build-info.json');
    await regularFile(infoPath, 65536);
    const info = JSON.parse((await readFile(infoPath, 'utf8')).replace(/^\uFEFF/, ''));
    for (const key of ['package', 'versionName', 'versionCode', 'apkSha256', 'certificateSha256']) {
      if (info[key] !== manifest[key]) throw Error(`Build metadata ${key} does not match release ${slug}.`);
    }
    if (manifest.versionCode === latest.versionCode) {
      if (!isDeepStrictEqual(manifest, latest)) throw Error('Latest metadata and versioned release do not match.');
      latestFound = true;
    } else if (manifest.versionCode > latest.versionCode) throw Error('Latest metadata points to an older release.');
    publicFiles.push(...expectedFiles.map(name => `releases/${slug}/${name}`));
  }
  if (!latestFound) throw Error('The latest APK release is missing.');
  return {manifest: latest, files: publicFiles};
}
