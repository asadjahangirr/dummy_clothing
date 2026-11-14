// Headless check of the rail physics: node scripts/physics-test.mjs
import * as THREE from 'three';
import { ShirtRig, Rail } from '../src/shirt.js';

const geo = new THREE.BoxGeometry(0.648, 0.8, 0.316).translate(0, 0.4, 0);
geo.computeBoundingBox();
const src = { map: null, normalMap: null, normalScale: new THREE.Vector2(1, 1) };
const parts = { railR: 0.0125, chrome: new THREE.MeshStandardMaterial(), wood: new THREE.MeshStandardMaterial() };
const rail = new Rail({ x0: -1.65, x1: 1.65, y: 1.8, z: -2.82, wallZ: -3.5 });
const rigs = [-0.88, 0, 0.88].map((x, i) => {
  const r = new ShirtRig({ index: i, geo, source: src, parts, railX: x, railY: 1.8, railZ: -2.82, wallZ: -3.5, priceTex: null });
  rail.add(r);
  return r;
});
let knocks = 0;
rail.onKnock = () => knocks++;
const h = 1 / 120;
let t = 0, minGap = Infinity, nan = false, maxSw = 0;
const run = (secs, each) => { for (let i = 0; i < secs * 120; i++) { t += h; each?.(); rail.step(h, t, () => 0); check(); } };
function check() {
  const s = [...rigs].sort((a, b) => a.s.x - b.s.x);
  for (let k = 0; k < 2; k++) minGap = Math.min(minGap, (s[k + 1].s.x - s[k].s.x) - (s[k].barHalfX() + s[k + 1].barHalfX()));
  for (const r of rigs) { for (const v of Object.values(r.s)) if (typeof v === 'number' && !Number.isFinite(v)) nan = true; maxSw = Math.max(maxSw, Math.abs(r.s.swZ), Math.abs(r.s.swX)); }
}
const fmt = (r) => `x=${r.s.x.toFixed(3)} swZ=${r.s.swZ.toFixed(3)} swX=${r.s.swX.toFixed(3)} yaw=${r.s.yaw.toFixed(2)}`;

// 1) at rest nothing should move (static friction holds, no drift)
run(3);
console.log('rest       ', rigs.map(fmt).join(' | '));
// 2) grab the middle shirt's hem and drag it hard to the right for 1.2 s
const B = rigs[1];
const local = new THREE.Vector3(0.1, 0.15, 0.15);
B.grab = { local, target: B.worldPoint(local), prevG: B.worldPoint(local) };
run(1.2, () => { B.grab.target.x += 1.4 * h; });
console.log('dragging   ', rigs.map(fmt).join(' | '));
B.grab = null;
// 3) let go and wait for everything to settle
run(12);
console.log('settled    ', rigs.map(fmt).join(' | '));
const settled = rigs.every((r) => r.s.xv === 0 && Math.abs(r.s.swZ) < 0.02 && Math.abs(r.s.swX) < 0.02);
const pushed = rigs[2].s.x > 0.95; // the dragged shirt shoved its neighbour along the rail
console.log({ knocks, minGap: +minGap.toFixed(4), maxSwing: +maxSw.toFixed(3), nan, settled, pushed });
// 4) a tap on the front of a shirt
rigs[0].poke(rigs[0].worldPoint(new THREE.Vector3(0, 0.3, 0.16)), new THREE.Vector3(0, 0, -1), t);
run(0.4);
console.log('after poke ', fmt(rigs[0]), 'maxBack', rigs[0].maxBack.toFixed(3));
const ok = !nan && minGap > -0.01 && settled && pushed && knocks > 0 && rigs[0].s.swX > 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
