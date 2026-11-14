/**
 * Asset pipeline for the store's room props (CC0 assets from polyhaven.com).
 *
 *   node scripts/build-assets.mjs <download-dir>
 *
 * <download-dir> layout (as produced by the Poly Haven API downloads):
 *   models/<id>/<id>_<res>.gltf (+ .bin + textures/)
 *   textures/<id>/<id>_{diff,nor_gl,rough}_2k.jpg
 *   hdri/<name>.hdr
 *
 * Output: public/store/{models,textures,env}. Models get meshopt-compressed geometry and
 * WebP textures (2048 px for pieces the camera gets close to, 1024 px for small props).
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

// @gltf-transform/functions loads its own (newer) sharp, which cannot share a process with the
// top-level sharp on Windows. So the texture pass and the geometry pass run in separate processes.
const [SRC, STAGE = 'main', ONE] = process.argv.slice(2);
if (!SRC) throw new Error('usage: node scripts/build-assets.mjs <download-dir>');
const SELF = fileURLToPath(import.meta.url);
const OUT = path.resolve('public/store');
const HERO = new Set(['mid_century_lounge_chair', 'marble_bust_01', 'coffee_table_round_01', 'ceramic_vase_01']);
// dense foliage scans: keep this fraction of the triangles (the camera never gets close)
const SIMPLIFY = { potted_plant_02: 0.3, pachira_aquatica_01: 0.35 };

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'textures'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'env'), { recursive: true });

/* ---------------- models */
const TMP = path.join(OUT, 'models', '.tmp');
if (STAGE === 'tex') {
  // pass 1: textures -> WebP (this process may load sharp 0.33)
  const sharp = (await import('sharp')).default;
  const dir = path.join(SRC, 'models', ONE);
  const doc = await io.read(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.gltf'))));
  const size = HERO.has(ONE) ? 2048 : 1024;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const out = await sharp(Buffer.from(img))
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, effort: 5 })
      .toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp').setURI(tex.getURI().replace(/\.\w+$/, '.webp'));
  }
  doc.createExtension(EXTTextureWebP).setRequired(true);
  await io.write(path.join(TMP, `${ONE}.glb`), doc);
  process.exit(0);
}
if (STAGE === 'geo') {
  // pass 2: geometry cleanup + meshopt compression (no sharp in this process)
  const { dedup, prune, weld, simplify, meshopt } = await import('@gltf-transform/functions');
  const { MeshoptSimplifier } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  const doc = await io.read(path.join(TMP, `${ONE}.glb`));
  const steps = [dedup(), weld()];
  if (SIMPLIFY[ONE]) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY[ONE], error: 0.002 }));
  await doc.transform(...steps, prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(path.join(OUT, 'models', `${ONE}.glb`), doc);
  process.exit(0);
}

fs.mkdirSync(TMP, { recursive: true });
const bounds = {};
for (const id of fs.readdirSync(path.join(SRC, 'models'))) {
  execFileSync(process.execPath, [SELF, SRC, 'tex', id], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync(process.execPath, [SELF, SRC, 'geo', id], { stdio: ['ignore', 'ignore', 'inherit'] });
  const file = path.join(OUT, 'models', `${id}.glb`);
  const b = getBounds((await io.read(file)).getRoot().listScenes()[0]);
  bounds[id] = { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) };
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`model  ${id.padEnd(28)} ${kb.padStart(6)} KB  size ${b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x ')}`);
}
fs.rmSync(TMP, { recursive: true, force: true });

/* ---------------- surface textures */
const sharp = (await import('sharp')).default;
const texDir = path.join(SRC, 'textures');
for (const id of fs.readdirSync(texDir)) {
  for (const f of fs.readdirSync(path.join(texDir, id))) {
    const map = f.match(/_(diff|nor_gl|rough)_/)?.[1];
    if (!map) continue;
    const dest = path.join(OUT, 'textures', `${id}_${map}.webp`);
    const px = id === 'painted_plaster_wall' ? 1024 : 2048; // small surfaces: counter, plinths, pots
    await sharp(path.join(texDir, id, f)).resize(px, px, { fit: 'inside' }).webp({ quality: map === 'diff' ? 90 : 86, effort: 5 }).toFile(dest);
    console.log(`tex    ${path.basename(dest).padEnd(28)} ${(fs.statSync(dest).size / 1024).toFixed(0).padStart(6)} KB`);
  }
}

/* ---------------- environment */
for (const f of fs.readdirSync(path.join(SRC, 'hdri'))) {
  fs.copyFileSync(path.join(SRC, 'hdri', f), path.join(OUT, 'env', f));
  console.log(`env    ${f}`);
}
