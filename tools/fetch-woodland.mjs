import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve('tools/source_assets/woodland');
async function get(info, file) {
  try { const b = await fs.readFile(file); if (createHash('md5').update(b).digest('hex') === info.md5) return; } catch {}
  const response = await fetch(info.url);
  if (!response.ok) throw new Error(`${response.status}: ${info.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (info.md5 && createHash('md5').update(data).digest('hex') !== info.md5) throw new Error(`Checksum failed: ${file}`);
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data);
  console.log(`Downloaded ${path.basename(file)} (${Math.round(data.length / 1024)} KB)`);
}
for (const id of ['fir_tree_01', 'fir_sapling', 'fern_02', 'dead_tree_trunk', 'forest_ground_04']) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`Missing ${id}`);
  const files = await response.json();
  if (id === 'forest_ground_04') {
    for (const [key, filename] of [['Diffuse', 'diff'], ['nor_gl', 'normal'], ['Rough', 'rough']])
      await get(files[key]['1k'].jpg, path.resolve(`public/assets/textures/woodland/${filename}.jpg`));
  } else {
    const model = files.gltf['1k'].gltf;
    await get(model, path.join(root, id, `${id}.gltf`));
    for (const [rel, info] of Object.entries(model.include)) await get(info, path.join(root, id, rel));
    const doc = JSON.parse(await fs.readFile(path.join(root, id, `${id}.gltf`)));
    console.log(id, doc.nodes.map(n => n.name).filter(Boolean));
  }
}
