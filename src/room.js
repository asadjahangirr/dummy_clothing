/**
 * The boutique: a gallery-white main room with the shirt rail, a lounge corner and plinths,
 * connected through a steel-framed doorway to the checkout room (counter, cabinet, pendants).
 *
 * Units are metres, +Y up. The main room spans x ∈ [-4.5, 4.5], z ∈ [-3.5, 3.8];
 * the checkout room spans x ∈ [4.7, 9.3], z ∈ [-4.6, 0].
 */
import * as THREE from 'three';
import { paintEnso, paintFlow, paintField, paintGeo, framedArt, pictureLight } from './art.js';

export const LAYOUT = {
  main: { x0: -4.5, x1: 4.5, z0: -3.5, z1: 3.8, h: 3.2 },
  shop: { x0: 4.7, x1: 9.3, z0: -4.6, z1: 0.0, h: 3.0 },
  door: { x0: 4.5, x1: 4.7, z0: -2.7, z1: -1.1, h: 2.5 },
  rail: { x0: -1.65, x1: 1.65, y: 1.8, z: -2.82, r: 0.0125, slots: [-0.88, 0, 0.88] },
  counter: { x0: 6.97, x1: 7.63, z0: -3.3, z1: -1.3, h: 1.0 },
  cabinet: { x: 9.03, z: -2.3 },
};

/* ---------------------------------------------------------------- helpers */
const V2 = (x, y) => new THREE.Vector2(x, y);

/** BoxGeometry whose UVs are in metres / tile, so a tiling texture keeps its real-world scale. */
function boxUV(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // px nx py ny pz nz
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

function shadowBlobTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------------------------------------------------------- build */
export function buildRoom({ scene, renderer, models, textures }) {
  const L = LAYOUT;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const out = { shadowLights: [], staticShadowLights: [], pendants: [], clock: null, colliders: [] };

  /* ---------- surface materials (real scanned textures, real-world scale) */
  const setup = (set, tint, { rough = 1, normal = 1 } = {}) => {
    [set.diff, set.nor, set.rough].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
    });
    set.diff.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: set.diff, normalMap: set.nor, roughnessMap: set.rough,
      color: tint, roughness: rough, normalScale: new THREE.Vector2(normal, normal),
    });
  };
  const floorMat = setup(textures.floor, new THREE.Color(1.0, 0.97, 0.94), { rough: 0.85, normal: 0.6 });
  const wallMat = setup(textures.wall, new THREE.Color(1.32, 1.3, 1.26), { rough: 1, normal: 0.5 });
  const plasterMat = setup(textures.plaster, new THREE.Color(1.18, 1.16, 1.12), { rough: 1, normal: 0.45 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.32, metalness: 0.85 });
  const satin = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.55, metalness: 0.4 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0xeceae5, roughness: 0.7 });
  const oak = setup({ diff: textures.floor.diff.clone(), nor: textures.floor.nor.clone(), rough: textures.floor.rough.clone() },
    new THREE.Color(1.05, 1.0, 0.95), { rough: 0.7, normal: 0.4 });
  out.materials = { steel, satin, oak, plasterMat };

  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };
  const box = (x0, x1, y0, y1, z0, z1, mat, tile = 2, opts) => {
    const m = new THREE.Mesh(boxUV(x1 - x0, y1 - y0, z1 - z0, tile), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return add(m, opts);
  };

  /* ---------- floor: one continuous oak floor through both rooms */
  {
    const w = L.shop.x1 - L.main.x0 + 0.4, d = L.main.z1 - L.shop.z0 + 0.4;
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 2.2, (uv.getY(i) * d) / 2.2);
    const floor = new THREE.Mesh(g, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((L.shop.x1 + L.main.x0) / 2, 0, (L.main.z1 + L.shop.z0) / 2);
    add(floor, { cast: false });
  }

  /* ---------- walls (0.2 m thick boxes, plaster) */
  const T = 0.2;
  const { main: M, shop: S, door: D } = L;
  box(M.x0 - T, M.x1 + T, 0, M.h, M.z0 - T, M.z0, wallMat);              // main back
  box(M.x0 - T, M.x1 + T, 0, M.h, M.z1, M.z1 + T, wallMat);              // main front
  box(M.x0 - T, M.x0, 0, M.h, M.z0, M.z1, wallMat);                      // main left
  box(D.x0, D.x1, 0, M.h, S.z0 - T, D.z0, wallMat);                      // shared wall, behind the door
  box(D.x0, D.x1, 0, M.h, D.z1, M.z1, wallMat);                          // shared wall, in front of the door
  box(D.x0, D.x1, D.h, M.h, D.z0, D.z1, wallMat);                        // lintel
  box(D.x1, S.x1 + T, 0, S.h, S.z0 - T, S.z0, wallMat);                  // shop back
  box(D.x1, S.x1 + T, 0, S.h, S.z1, S.z1 + T, wallMat);                  // shop front
  box(S.x1, S.x1 + T, 0, S.h, S.z0, S.z1, wallMat);                      // shop far wall

  /* ---------- ceilings */
  const ceil = (x0, x1, z0, z1, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), ceilingMat);
    m.rotation.x = Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    return add(m, { cast: false });
  };
  ceil(M.x0, M.x1, M.z0, M.z1, M.h);
  ceil(D.x0, S.x1, S.z0, S.z1, S.h);

  /* ---------- skirting */
  const sk = 0.075, st = 0.014;
  box(M.x0, M.x1, 0, sk, M.z0, M.z0 + st, skirtMat, 2, { cast: false });
  box(M.x0, M.x1, 0, sk, M.z1 - st, M.z1, skirtMat, 2, { cast: false });
  box(M.x0, M.x0 + st, 0, sk, M.z0, M.z1, skirtMat, 2, { cast: false });
  box(D.x0 - st, D.x0, 0, sk, M.z0, D.z0, skirtMat, 2, { cast: false });
  box(D.x0 - st, D.x0, 0, sk, D.z1, M.z1, skirtMat, 2, { cast: false });
  box(D.x1, S.x1, 0, sk, S.z0, S.z0 + st, skirtMat, 2, { cast: false });
  box(D.x1, S.x1, 0, sk, S.z1 - st, S.z1, skirtMat, 2, { cast: false });
  box(S.x1 - st, S.x1, 0, sk, S.z0, S.z1, skirtMat, 2, { cast: false });
  box(D.x1, D.x1 + st, 0, sk, S.z0, D.z0, skirtMat, 2, { cast: false });
  box(D.x1, D.x1 + st, 0, sk, D.z1, S.z1, skirtMat, 2, { cast: false });

  /* ---------- blackened-steel door lining */
  const lt = 0.022;
  box(D.x0 - 0.01, D.x1 + 0.01, 0, D.h, D.z0, D.z0 + lt, steel);
  box(D.x0 - 0.01, D.x1 + 0.01, 0, D.h, D.z1 - lt, D.z1, steel);
  box(D.x0 - 0.01, D.x1 + 0.01, D.h - lt, D.h, D.z0, D.z1, steel);
  box(D.x0 - 0.002, D.x1 + 0.002, 0, 0.006, D.z0, D.z1, steel, 2, { cast: false }); // threshold

  /* ---------- contact shadows (soft occlusion where things meet the floor) */
  const blobTex = shadowBlobTexture();
  const blob = (x, z, w, d, opacity = 0.5, y = 0.0015, rot = 0) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2 })
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, y, z);
    m.renderOrder = 1;
    scene.add(m);
    return m;
  };

  /* ---------- prop placement */
  const prep = (root) => {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach((k) => m[k] && (m[k].anisotropy = maxAniso));
      });
    });
    return root;
  };
  const place = (id, { x = 0, y = 0, z = 0, ry = 0, s = 1, shadow = 0.5, blobScale = 1.25 } = {}) => {
    const src = models[id];
    if (!src) return null;
    const o = prep(src.clone(true));
    o.scale.setScalar(s);
    o.rotation.y = ry;
    o.position.set(x, y, z);
    scene.add(o);
    if (shadow && y < 0.01) {
      const bb = new THREE.Box3().setFromObject(o);
      const sz = bb.getSize(new THREE.Vector3());
      blob((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2, sz.x * blobScale, sz.z * blobScale, shadow);
    }
    return o;
  };

  /* ---------- the shirt rail: ceiling-hung blackened steel */
  const R = L.rail;
  {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(R.r, R.r, R.x1 - R.x0, 32), steel);
    rail.rotation.z = Math.PI / 2;
    rail.position.set((R.x0 + R.x1) / 2, R.y, R.z);
    add(rail);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(R.r * 1.35, 24, 16), steel);
      cap.position.set(sx > 0 ? R.x1 : R.x0, R.y, R.z);
      add(cap);
      const ex = sx * 1.46;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, M.h - R.y, 16), steel);
      rod.position.set(ex, (M.h + R.y) / 2, R.z);
      add(rod);
      const tee = new THREE.Mesh(new THREE.CylinderGeometry(R.r * 1.4, R.r * 1.4, 0.05, 24), steel);
      tee.rotation.z = Math.PI / 2;
      tee.position.set(ex, R.y, R.z);
      add(tee);
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 32), steel);
      rose.position.set(ex, M.h - 0.006, R.z);
      add(rose);
    }
  }

  /* ---------- lounge corner (left) */
  place('mid_century_lounge_chair', { x: -3.55, z: 0.55, ry: 1.2, shadow: 0.55 });
  const tableS = 0.66;
  place('coffee_table_round_01', { x: -2.5, z: 1.0, s: tableS, shadow: 0.42 });
  const tableTop = 0.4897 * tableS;
  place('ceramic_vase_04', { x: -2.38, y: tableTop, z: 0.9, ry: 0.4 });
  place('potted_plant_04', { x: -2.68, y: tableTop, z: 1.16, ry: 2.1 });
  place('Ottoman_01', { x: -3.35, z: -0.75, ry: 0.35, s: 0.92, shadow: 0.55 });
  place('potted_plant_02', { x: -4.0, z: -0.05, ry: 0.8, s: 1.25, shadow: 0.45 });

  /* ---------- trees in the corners (pachira, planted in matte stoneware pots) */
  const potMat = new THREE.MeshStandardMaterial({ color: 0x2a2927, roughness: 0.82, map: textures.plaster.diff, normalMap: textures.plaster.nor, normalScale: new THREE.Vector2(0.6, 0.6) });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 1 });
  const planterTree = (x, z, ry, s) => {
    const potH = 0.46, potR = 0.27;
    const prof = [V2(0, 0), V2(potR * 0.78, 0), V2(potR * 0.86, 0.02), V2(potR, potH - 0.03), V2(potR * 1.02, potH), V2(potR * 0.94, potH), V2(potR * 0.92, potH - 0.035), V2(0, potH - 0.035)];
    const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), potMat);
    pot.position.set(x, 0, z);
    add(pot);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(potR * 0.92, 48), soilMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(x, potH - 0.04, z);
    add(soil, { cast: false });
    blob(x, z, potR * 3.4, potR * 3.4, 0.5);
    place('pachira', { x, y: potH - 0.05, z, ry, s, shadow: 0 });
  };
  planterTree(-3.85, -2.95, 0.4, 1.05);
  planterTree(3.95, 3.2, 2.4, 0.95);
  planterTree(8.85, -0.45, 1.3, 0.9);

  /* ---------- plinths with sculpture + vases (right side) */
  const plinth = (x, z, w, h, d) => {
    box(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, plasterMat, 1);
    blob(x, z, w * 1.6, d * 1.6, 0.42);
    return h;
  };
  const p1 = plinth(2.35, 0.05, 0.42, 1.06, 0.42);
  place('marble_bust_01', { x: 2.35, y: p1, z: 0.05, ry: -0.75 });
  const p2 = plinth(3.0, 0.62, 0.52, 0.56, 0.52);
  place('ceramic_vase_01', { x: 2.92, y: p2, z: 0.55, ry: 0.2 });
  place('ceramic_vase_03', { x: 3.12, y: p2, z: 0.72, ry: 1.0 });

  /* ---------- art */
  const hang = (art, w, h, style, pos, ry, light = true) => {
    const a = framedArt(renderer, art, w, h, style);
    a.position.copy(pos);
    a.rotation.y = ry;
    scene.add(a);
    if (light) {
      const pl = pictureLight(Math.min(0.5, w * 0.55));
      pl.position.copy(pos).add(new THREE.Vector3(0, h / 2 + (style === 'wrap' ? 0.03 : 0.1), 0));
      pl.rotation.y = ry;
      pl.traverse((o) => o.isMesh && (o.castShadow = true));
      scene.add(pl);
    }
  };
  hang(paintEnso(), 1.0, 1.28, 'wrap', new THREE.Vector3(M.x0, 1.72, 0.7), Math.PI / 2);
  hang(paintFlow(), 0.7, 0.9, 'black', new THREE.Vector3(M.x1, 1.6, 1.55), -Math.PI / 2);
  hang(paintField(), 0.62, 0.8, 'oak', new THREE.Vector3(5.75, 1.62, S.z0), 0);
  hang(paintGeo(), 0.42, 0.42, 'black', new THREE.Vector3(6.55, 1.5, S.z0), 0, false);

  /* ---------- checkout room: counter (plaster body, oak top, recessed black plinth) */
  const C = L.counter;
  box(C.x0 + 0.05, C.x1 - 0.05, 0, 0.08, C.z0 + 0.05, C.z1 - 0.05, satin, 2, { cast: false });
  box(C.x0, C.x1, 0.08, C.h - 0.04, C.z0, C.z1, plasterMat, 1.2);
  box(C.x0 - 0.03, C.x1 + 0.03, C.h - 0.04, C.h, C.z0 - 0.03, C.z1 + 0.03, oak, 1.6);
  blob((C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2, 1.2, 2.6, 0.5);
  out.colliders.push({ min: [C.x0 - 0.03, 0, C.z0 - 0.03], max: [C.x1 + 0.03, C.h, C.z1 + 0.03] });

  const cab = place('modern_wooden_cabinet', { x: L.cabinet.x, z: L.cabinet.z, ry: -Math.PI / 2, shadow: 0.5 });
  if (cab) out.colliders.push({ min: [L.cabinet.x - 0.27, 0, L.cabinet.z - 1.22], max: [L.cabinet.x + 0.27, 0.68, L.cabinet.z + 1.22] });
  place('ceramic_vase_03', { x: 9.05, y: 0.68, z: -1.35, ry: 0.3 });
  place('potted_plant_04', { x: 9.05, y: 0.68, z: -3.25, ry: 1.2 });
  place('modern_arm_chair_01', { x: 5.55, z: -3.75, ry: 0.55, shadow: 0.55 });
  place('potted_plant_02', { x: 5.0, z: -4.2, ry: 2.4, s: 1.2, shadow: 0.45 });
  place('standing_picture_frame_01', { x: 7.45, y: C.h, z: -3.12, ry: -Math.PI / 2 - 0.35 });
  place('potted_plant_04', { x: 7.42, y: C.h, z: -2.92, ry: 0.4 });

  // wall clock — hands follow the real time
  const clock = place('wall_clock', { x: S.x1 - 0.002, y: 2.05, z: L.cabinet.z, ry: -Math.PI / 2, s: 1.15 });
  if (clock) out.clock = rigClock(clock);

  // pendants over the counter — each one is a pendulum (see counter.js)
  const bulbGeo = new THREE.SphereGeometry(0.035, 24, 16);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe2b8 });
  for (const z of [-2.85, -2.3, -1.75]) {
    const src = models.modern_ceiling_lamp_01;
    if (!src) break;
    const pivot = new THREE.Group();
    pivot.position.set((C.x0 + C.x1) / 2, S.h, z);
    const lamp = prep(src.clone(true));
    lamp.position.y = -1.1726 + 0.0; // cord top at the ceiling
    lamp.traverse((o) => { if (o.isMesh) o.userData.pendant = pivot; });
    pivot.add(lamp);
    // a glowing bulb instead of a real point light: lights cost every pixel on screen
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.y = -1.1726 + 0.3;
    pivot.add(bulb);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 32), satin);
    rose.position.set(pivot.position.x, S.h - 0.01, z);
    add(rose);
    scene.add(pivot);
    out.pendants.push(pivot);
  }

  /* ---------- ceiling downlights (trims + glowing lenses) */
  const trimGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 32);
  const lensGeo = new THREE.CircleGeometry(0.045, 32);
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff6ea });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.6 });
  // all downlights are two instanced draw calls
  const spots = [];
  for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) for (const z of [-1.5, 0.8, 2.9]) spots.push([x, z, M.h]);
  for (const x of [5.6, 8.4]) for (const z of [-3.8, -2.3, -0.8]) spots.push([x, z, S.h]);
  const trims = new THREE.InstancedMesh(trimGeo, trimMat, spots.length);
  const lenses = new THREE.InstancedMesh(lensGeo, lensMat, spots.length);
  const mtx = new THREE.Matrix4();
  const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach(([x, z, y], i) => {
    trims.setMatrixAt(i, mtx.makeTranslation(x, y - 0.006, z));
    lenses.setMatrixAt(i, mtx.compose(new THREE.Vector3(x, y - 0.0125, z), down, one));
  });
  scene.add(trims, lenses);
  // linear light slot above the rail
  {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.01, 0.07), lensMat);
    slot.position.set(0, M.h - 0.004, R.z + 0.95);
    scene.add(slot);
  }

  /* ---------- lights */
  // kept deliberately few: hemisphere + 5 spots (3 with shadows), no point/area lights
  scene.add(new THREE.HemisphereLight(0xfffdf8, 0xd8d2c8, 0.5));

  const spot = (pos, tgt, intensity, angle, penumbra, shadow = 0, color = 0xfff4e6) => {
    const l = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 2);
    l.position.copy(pos);
    l.target.position.copy(tgt);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(shadow, shadow);
      l.shadow.bias = -0.0004;
      l.shadow.normalBias = 0.012;
      l.shadow.radius = 4;
      l.shadow.camera.near = 0.3;
      l.shadow.camera.far = 6;
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
    }
    scene.add(l, l.target);
    return l;
  };
  // the rail: a wide key from the slot in front of it, so shirts cast soft shadows on the wall
  out.railLight = spot(new THREE.Vector3(0.3, M.h - 0.05, R.z + 1.6), new THREE.Vector3(0, 1.1, R.z), 20, 0.85, 0.75, 1536);
  out.shadowLights.push(out.railLight);
  // lounge + sculpture: static shadows, rendered once
  out.staticShadowLights.push(spot(new THREE.Vector3(-2.6, M.h - 0.05, 1.3), new THREE.Vector3(-3.1, 0.4, 0.6), 16, 0.8, 0.8, 1024));
  spot(new THREE.Vector3(2.0, M.h - 0.05, 1.2), new THREE.Vector3(2.4, 0.9, 0.2), 12, 0.45, 0.7);
  spot(new THREE.Vector3(0, M.h - 0.05, 2.4), new THREE.Vector3(0, 0, 1.0), 10, 1.0, 1.0); // general fill toward the entrance
  // checkout: one shadowed key on the counter (the gift boxes), the pendants add warm accents
  out.counterLight = spot(new THREE.Vector3(6.3, S.h - 0.05, -2.3), new THREE.Vector3(7.3, 0.9, -2.3), 24, 0.95, 0.8, 1024);
  out.shadowLights.push(out.counterLight);
  return out;
}

/* ---------------------------------------------------------------- clock */
function rigClock(root) {
  root.updateMatrixWorld(true);
  const hands = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name.toLowerCase();
    if (n.includes('minute')) hands.minute = o;
    else if (n.includes('hour')) hands.hour = o;
  });
  const rig = {};
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const [k, mesh] of Object.entries(hands)) {
    // re-pivot each hand at the dial centre, and measure which way it points at rest
    const bb = new THREE.Box3().setFromObject(mesh).applyMatrix4(inv);
    const c = bb.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, c.z);
    root.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(mesh);
    rig[k] = { pivot, rest: Math.atan2(c.y, c.x) };
  }
  return {
    update(date = new Date()) {
      const h = (date.getHours() % 12) + date.getMinutes() / 60 + date.getSeconds() / 3600;
      const m = date.getMinutes() + date.getSeconds() / 60;
      // dial angle measured from +X, counter-clockwise; 12 o'clock is +Y
      if (rig.minute) rig.minute.pivot.rotation.z = Math.PI / 2 - (m / 60) * Math.PI * 2 - rig.minute.rest;
      if (rig.hour) rig.hour.pivot.rotation.z = Math.PI / 2 - (h / 12) * Math.PI * 2 - rig.hour.rest;
    },
  };
}
