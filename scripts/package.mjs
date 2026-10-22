import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A dependency-free ZIP writer. Only public site files enter the archive.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['index.html', 'config.js', 'vercel.json', 'README.md'];
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile()) files.push(name);
  }
}
for (const directory of ['assets', 'privacy', 'terms']) await collect(directory);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const entries = [];
const central = [];
let offset = 0;
for (const file of files.sort()) {
  const name = Buffer.from(`depositly-website/${file}`);
  const content = await readFile(path.join(root, file));
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0x0021, 12); // January 1, 1980: reproducible ZIP timestamp.
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  entries.push(local, name, content);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x0800, 8);
  record.writeUInt16LE(0x0021, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(content.length, 20);
  record.writeUInt32LE(content.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42);
  central.push(record, name);
  offset += local.length + name.length + content.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(path.join(root, 'dist'), { recursive: true });
const output = path.join(root, 'dist', 'depositly-website-vercel.zip');
await writeFile(output, Buffer.concat([...entries, directory, end]));
console.log(`Packaged ${files.length} public files: ${output}`);
