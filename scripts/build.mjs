import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {observabilityBuildOptions} from './observability.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'public');
// This generated directory is the only recursive-delete target in this script.
if (path.relative(root, output) !== 'public' || !path.isAbsolute(output)) throw new Error('Invalid static output directory.');
const previous = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (previous?.isSymbolicLink()) throw new Error('The generated public directory must not be a symbolic link.');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

let count = 0;
async function copyPublic(relative) {
  const source = path.join(root, relative), target = path.join(output, relative);
  const entry = await lstat(source);
  if (entry.isSymbolicLink()) throw new Error('Public assets must not contain symbolic links.');
  if (entry.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const child of await readdir(source)) {
      if (child.startsWith('.') || /(?:\.log|\.tmp|\.bak|~)$/.test(child)) continue;
      await copyPublic(path.join(relative, child));
    }
  } else if (entry.isFile()) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    count++;
  } else throw new Error('Unsupported public asset type.');
}
// Never copy the repository root: server code and environment files stay private.
for (const relative of ['index.html', 'config.js', 'assets', 'privacy', 'terms']) await copyPublic(relative);
await build({...observabilityBuildOptions,outfile:path.join(output,'assets','observability.js')});
await mkdir(path.join(output,'assets','licenses'),{recursive:true});
for(const name of ['analytics','speed-insights']){
  await copyFile(path.join(root,'node_modules','@vercel',name,'LICENSE'),path.join(output,'assets','licenses',`vercel-${name}.txt`));
  count++;
}
console.log(`Built ${count} public files in ${output}`);
