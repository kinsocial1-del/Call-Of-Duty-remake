import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractFile } from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release', 'win-unpacked');
const archive = path.join(release, 'resources', 'app.asar');
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
async function files(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(file)); else if (entry.isFile()) out.push(file);
  }
  return out;
}

await fs.access(path.join(release, 'IRONFRONT Zero Hour.exe'));
const expected = [...await files(path.join(root, 'dist')), ...await files(path.join(root, 'electron'))];
const sourcePackage = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const packagedManifest = JSON.parse(extractFile(archive,'package.json').toString());
for (const field of ['name','version','main']) if (packagedManifest[field] !== sourcePackage[field]) throw new Error(`Release manifest mismatch: ${field}`);
for (const file of expected) {
  const relative = path.relative(root, file);
  const source = await fs.readFile(file), packaged = extractFile(archive, relative);
  if (hash(source) !== hash(packaged)) throw new Error(`Release contains missing or stale content: ${relative}`);
}
for (const file of await files(path.join(root,'public'))) {
  const relative = path.relative(path.join(root,'public'),file);
  if (hash(await fs.readFile(file)) !== hash(extractFile(archive,path.join('dist',relative)))) throw new Error(`Missing runtime asset: ${relative}`);
}
console.log(`Release verified: ${expected.length} packaged files match the source; all public assets are included.`);
console.log('This verifies package contents. Hardware, gameplay and console certification require separate testing.');
