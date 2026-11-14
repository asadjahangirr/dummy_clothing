/**
 * Make the shirt cheap to animate: the cloth is deformed per-vertex every frame (three times,
 * once per hanger, plus the shadow pass), so it gets a lighter mesh. The normal map keeps the
 * fabric detail. The unused metal/roughness map is dropped (the material sets roughness itself).
 *
 *   node scripts/optimize-shirt.mjs [in.glb] [out.glb] [ratio]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const [input = 'public/models/shirt.glb', output = 'public/models/shirt.glb', ratio = '0.2'] = process.argv.slice(2);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const count = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const before = count();
for (const m of doc.getRoot().listMaterials()) m.setMetallicRoughnessTexture(null);
await doc.transform(
  dedup(), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: 0.0015 }),
  prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);
console.log(`shirt: ${before} -> ${count()} triangles`);
