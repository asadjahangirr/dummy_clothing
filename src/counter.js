/**
 * Checkout room interactivity.
 *
 * Rigid bodies (cannon-es): every item in the bag becomes a gift box that drops onto the
 * counter; boxes and the paper bag can be grabbed, stacked and thrown. The room's walls,
 * counter, cabinet and the counter props are static colliders.
 * Pendants: three spherical pendulums that swing when touched.
 * POS: the tablet screen shows the live bag total.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LAYOUT } from './room.js';

const MAX_BOXES = 10;
const BOX = { w: 0.36, h: 0.085, d: 0.27 };
const BAG = { w: 0.32, h: 0.38, d: 0.13 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- canvas art */
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function paperGrain(g, w, h, amt, seed = 3) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amt;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
function tex(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** black gift-box faces with a cream grosgrain ribbon and a silver wordmark on the lid */
function giftBoxMaterials(renderer, brand) {
  const ribbon = '#e9e2d4';
  const base = '#141416';
  const face = (wM, hM, { lid = false, vertical = true, logo = false }) => {
    const px = 1024, w = px, h = Math.round((px * hM) / wM);
    const [c, g] = cv(w, h);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    paperGrain(g, w, h, 9);
    const rw = Math.round((0.024 / wM) * w);
    g.fillStyle = ribbon;
    if (vertical) g.fillRect(w / 2 - rw / 2, 0, rw, h);
    if (lid) g.fillRect(0, h / 2 - rw / 2, w, rw);
    // grosgrain ribs
    g.globalAlpha = 0.12;
    g.fillStyle = '#000';
    if (vertical) for (let y = 0; y < h; y += 4) g.fillRect(w / 2 - rw / 2, y, rw, 1);
    if (lid) for (let x = 0; x < w; x += 4) g.fillRect(x, h / 2 - rw / 2, 1, rw);
    g.globalAlpha = 1;
    if (!lid) {
      // lid edge
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, Math.round(h * 0.3), w, 3);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, Math.round(h * 0.3) + 3, w, 2);
    }
    if (logo) {
      g.save();
      g.translate(w * 0.27, h * 0.27);
      g.fillStyle = '#c9c9cc';
      g.font = `600 ${Math.round(h * 0.075)}px Geist, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(brand, 0, 0);
      g.restore();
    }
    return new THREE.MeshStandardMaterial({ map: tex(c, renderer), roughness: 0.62, metalness: 0.05 });
  };
  const side = face(BOX.d, BOX.h, { vertical: true });
  const front = face(BOX.w, BOX.h, { vertical: true });
  const top = face(BOX.w, BOX.d, { lid: true, logo: true });
  const bottom = new THREE.MeshStandardMaterial({ color: base, roughness: 0.7 });
  return [side, side, top, bottom, front, front];
}

function bagMaterials(renderer, brand) {
  const make = (wM, hM, logo) => {
    const px = 1024, w = px, h = Math.round((px * hM) / wM);
    const [c, g] = cv(w, h);
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, w, h);
    paperGrain(g, w, h, 12, 7);
    // folded top cuff + side gusset creases
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, h * 0.09, w, 3);
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(0, h * 0.86, w, 2);
    if (logo) {
      g.fillStyle = '#111113';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `600 ${Math.round(w * 0.11)}px Geist, Arial, sans-serif`;
      g.fillText(brand, w / 2, h * 0.48);
    }
    return new THREE.MeshStandardMaterial({ map: tex(c, renderer), roughness: 0.9 });
  };
  const front = make(BAG.w, BAG.h, true);
  const side = make(BAG.d, BAG.h, false);
  const inner = new THREE.MeshStandardMaterial({ color: 0x8c877e, roughness: 1, side: THREE.DoubleSide });
  const bottom = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.9 });
  return [side, side, inner, bottom, front, front];
}

function posScreen(renderer) {
  const [c, g] = cv(1024, 736);
  const t = tex(c, renderer);
  const draw = ({ count = 0, total = '' } = {}) => {
    const w = c.width, h = c.height;
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#fbfbfa');
    grd.addColorStop(1, '#efeeeb');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111113';
    g.textAlign = 'left';
    g.font = '500 34px "Geist Mono", monospace';
    g.globalAlpha = 0.5;
    g.fillText(`${count} ${count === 1 ? 'ITEM' : 'ITEMS'}`, 70, 120);
    g.globalAlpha = 1;
    g.font = '600 112px Geist, Arial, sans-serif';
    g.fillText(total, 66, 300);
    g.fillRect(70, 360, w - 140, 2);
    // contactless mark
    g.lineWidth = 8;
    g.strokeStyle = '#111113';
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(110, 520, 22 + i * 22, -0.75, 0.75);
      g.stroke();
    }
    g.font = '500 34px "Geist Mono", monospace';
    g.fillText(count ? 'TAP TO PAY' : '—', 220, 534);
    t.needsUpdate = true;
  };
  draw();
  return { texture: t, draw };
}

/* ================================================================ Checkout */
export class Checkout {
  constructor({ scene, renderer, colliders, pendants, brand = 'ÆTHER' }) {
    this.scene = scene;
    this.renderer = renderer;
    this.pendants = pendants.map((pivot) => ({ pivot, ax: 0, az: 0, vx: 0, vz: 0, L: 0.95 }));
    this.pendantMeshes = [];
    pendants.forEach((p) => p.traverse((o) => o.isMesh && this.pendantMeshes.push(o)));
    this.boxes = [];
    this.grab = null;
    this.time = 0;

    /* ---------- physics world */
    const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 14;
    w.solver.tolerance = 1e-4;
    this.world = w;
    this.matCard = new CANNON.Material('card');
    this.matStatic = new CANNON.Material('static');
    w.addContactMaterial(new CANNON.ContactMaterial(this.matCard, this.matStatic, { friction: 0.42, restitution: 0.12, contactEquationStiffness: 3e6, contactEquationRelaxation: 3 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.matCard, this.matCard, { friction: 0.5, restitution: 0.08, contactEquationStiffness: 3e6, contactEquationRelaxation: 3 }));

    const staticBox = (min, max) => {
      const he = new CANNON.Vec3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
      const b = new CANNON.Body({ mass: 0, material: this.matStatic, shape: new CANNON.Box(he) });
      b.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      w.addBody(b);
      return b;
    };
    const floor = new CANNON.Body({ mass: 0, material: this.matStatic, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    w.addBody(floor);
    colliders.forEach((c) => staticBox(c.min, c.max));
    const { main: M, shop: S, door: D } = LAYOUT;
    const T = 0.5;
    staticBox([M.x0 - T, 0, M.z0], [M.x0, 4, M.z1]);           // main left
    staticBox([M.x0, 0, M.z0 - T], [D.x0, 4, M.z0]);           // main back
    staticBox([M.x0, 0, M.z1], [D.x0, 4, M.z1 + T]);           // main front
    staticBox([D.x0, 0, S.z0 - T], [D.x1, 4, D.z0]);           // shared wall
    staticBox([D.x0, 0, D.z1], [D.x1, 4, M.z1]);
    staticBox([D.x0, D.h, D.z0], [D.x1, 4, D.z1]);
    staticBox([D.x1, 0, S.z0 - T], [S.x1 + T, 4, S.z0]);       // shop back
    staticBox([D.x1, 0, S.z1], [S.x1 + T, 4, S.z1 + T]);       // shop front
    staticBox([S.x1, 0, S.z0], [S.x1 + T, 4, S.z1]);           // shop far
    staticBox([D.x1, S.h, S.z0], [S.x1, S.h + T, S.z1]);       // shop ceiling
    staticBox([M.x0, M.h, M.z0], [D.x0, M.h + T, M.z1]);       // main ceiling

    /* ---------- counter props (static) */
    const C = LAYOUT.counter;
    const top = C.h;
    this.boxMats = giftBoxMaterials(renderer, brand);
    this.boxGeo = new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d);
    // used once at load so the gift-box shader is compiled before the first box ever appears
    this.warmMesh = new THREE.Mesh(this.boxGeo, this.boxMats);
    this.warmMesh.position.set(7.3, -5, -2.3);

    // POS tablet on a swivel stand, facing the customer (−x)
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e8e4, roughness: 0.3, metalness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.25, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 });
    this.screen = posScreen(renderer);
    const pos = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.012, 48), white);
    base.position.y = 0.006;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.16, 24), white);
    neck.position.set(0.012, 0.09, 0);
    neck.rotation.z = -0.12;
    const tablet = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.19, 0.26, 4, 0.006), black);
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.236, 0.168), new THREE.MeshStandardMaterial({ map: this.screen.texture, emissive: 0xffffff, emissiveMap: this.screen.texture, emissiveIntensity: 0.55, roughness: 0.2 }));
    screenMesh.rotation.y = -Math.PI / 2;
    screenMesh.position.x = -0.0065;
    const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.18), glass);
    glassMesh.rotation.y = -Math.PI / 2;
    glassMesh.position.x = -0.0068;
    glassMesh.material.transparent = true;
    glassMesh.material.opacity = 0.18;
    tablet.add(body, screenMesh, glassMesh);
    tablet.position.set(0.025, 0.2, 0);
    tablet.rotation.z = 0.28; // tilted back toward the cashier side
    pos.add(base, neck, tablet);
    pos.position.set(7.36, top, -2.62);
    pos.rotation.y = 0.18;
    pos.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(pos);
    staticBox([7.24, top, -2.78], [7.46, top + 0.31, -2.46]);

    // card reader in its cradle
    const reader = new THREE.Group();
    const cradle = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.03, 0.1, 3, 0.01), white);
    cradle.position.y = 0.015;
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.018, 0.15, 4, 0.008), black);
    pad.position.set(-0.004, 0.06, 0);
    pad.rotation.z = 0.5;
    const [rc, rg] = cv(256, 512);
    rg.fillStyle = '#0b0b0d'; rg.fillRect(0, 0, 256, 512);
    rg.fillStyle = '#f2f1ec'; rg.fillRect(24, 24, 208, 170);
    rg.strokeStyle = '#111'; rg.lineWidth = 7; rg.lineCap = 'round';
    for (let i = 0; i < 3; i++) { rg.beginPath(); rg.arc(100, 109, 18 + i * 18, -0.8, 0.8); rg.stroke(); }
    rg.fillStyle = '#2a2a2e';
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) rg.fillRect(40 + k * 62, 230 + r * 66, 50, 48);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.14), new THREE.MeshStandardMaterial({ map: tex(rc, renderer), roughness: 0.35 }));
    keys.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    keys.position.y = 0.0095;
    pad.add(keys);
    reader.add(cradle, pad);
    reader.position.set(7.1, top, -3.0);
    reader.rotation.y = 0.25;
    reader.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(reader);
    staticBox([7.03, top, -3.09], [7.17, top + 0.1, -2.91]);
    staticBox([7.33, top, -3.26], [7.55, top + 0.32, -2.84]); // plant + frame

    /* ---------- the paper bag (dynamic) */
    const bagGroup = new THREE.Group();
    const bagMesh = new THREE.Mesh(new THREE.BoxGeometry(BAG.w, BAG.h, BAG.d), bagMaterials(renderer, brand));
    bagMesh.castShadow = bagMesh.receiveShadow = true;
    bagGroup.add(bagMesh);
    const rope = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.8 });
    for (const sz of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * Math.PI;
        pts.push(new THREE.Vector3(Math.cos(t) * 0.065, BAG.h / 2 + Math.sin(t) * 0.085 - 0.02, sz * (BAG.d / 2 - 0.006)));
      }
      const h = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0035, 8), rope);
      h.castShadow = true;
      bagGroup.add(h);
    }
    scene.add(bagGroup);
    const bagBody = new CANNON.Body({
      mass: 0.28, material: this.matCard,
      shape: new CANNON.Box(new CANNON.Vec3(BAG.w / 2, BAG.h / 2, BAG.d / 2)),
      linearDamping: 0.06, angularDamping: 0.12, sleepSpeedLimit: 0.06, sleepTimeLimit: 0.6,
    });
    bagBody.position.set(7.3, top + BAG.h / 2 + 0.001, -1.58);
    bagBody.quaternion.setFromEuler(0, Math.PI / 2 - 0.12, 0);
    w.addBody(bagBody);
    bagMesh.userData.body = bagBody;
    this.bag = { mesh: bagGroup, body: bagBody, home: bagBody.position.clone(), homeQ: bagBody.quaternion.clone() };
    this.pickables = [bagMesh];

    /* ---------- the hand (for dragging) */
    this.hand = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    this.hand.collisionFilterGroup = 0;
    this.hand.collisionFilterMask = 0;
    w.addBody(this.hand);
  }

  /* ---------------------------------------------------------------- boxes */
  setCount(n) {
    const target = clamp(n, 0, MAX_BOXES);
    while (this.boxes.length < target) this._spawn(this.boxes.length);
    while (this.boxes.length > target) this._remove(this.boxes[this.boxes.length - 1]);
  }

  _spawn(i) {
    const mesh = new THREE.Mesh(this.boxGeo, this.boxMats);
    mesh.castShadow = mesh.receiveShadow = true;
    const body = new CANNON.Body({
      mass: 0.42, material: this.matCard,
      shape: new CANNON.Box(new CANNON.Vec3(BOX.w / 2, BOX.h / 2, BOX.d / 2)),
      linearDamping: 0.05, angularDamping: 0.1, sleepSpeedLimit: 0.05, sleepTimeLimit: 0.7,
    });
    // dropped from just above the counter, in the clear space between the POS and the bag
    const C = LAYOUT.counter;
    body.position.set(7.24 + (Math.random() - 0.5) * 0.12, C.h + 0.34 + i * 0.1, -2.08 + (Math.random() - 0.5) * 0.12);
    body.quaternion.setFromEuler((Math.random() - 0.5) * 0.5, Math.PI / 2 + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.5);
    body.angularVelocity.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    this.world.addBody(body);
    mesh.userData.body = body;
    this.scene.add(mesh);
    this.pickables.push(mesh);
    const b = { mesh, body };
    this.boxes.push(b);
    this._sync(b);
  }

  _remove(b) {
    if (this.grab && this.grab.body === b.body) this.grabEnd();
    this.world.removeBody(b.body);
    this.scene.remove(b.mesh);
    this.pickables = this.pickables.filter((m) => m !== b.mesh);
    this.boxes = this.boxes.filter((x) => x !== b);
    this.world.bodies.forEach((o) => o.wakeUp && o.wakeUp());
  }

  setTotal(count, total) { this.screen.draw({ count, total }); }

  /* ---------------------------------------------------------------- interaction */
  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.pickables, false)[0];
    const lamp = raycaster.intersectObjects(this.pendantMeshes, false)[0];
    if (lamp && (!hit || lamp.distance < hit.distance)) return { kind: 'pendant', hit: lamp, pendant: this.pendants.find((p) => p.pivot === lamp.object.userData.pendant) };
    if (hit) return { kind: 'box', hit, body: hit.object.userData.body };
    return null;
  }

  grabStart(hit, body, plane) {
    const local = body.pointToLocalFrame(new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z));
    this.hand.position.set(hit.point.x, hit.point.y, hit.point.z);
    const c = new CANNON.PointToPointConstraint(body, local, this.hand, new CANNON.Vec3(0, 0, 0), 30);
    this.world.addConstraint(c);
    body.wakeUp();
    body.angularDamping = 0.6;
    this.grab = { body, c, plane, target: hit.point.clone(), prev: hit.point.clone() };
  }

  grabMove(point) {
    if (!this.grab) return;
    // never pull through the counter top or the floor
    point.y = Math.max(point.y, 0.05);
    this.grab.target.copy(point);
  }

  grabEnd() {
    if (!this.grab) return;
    const { body, c } = this.grab;
    this.world.removeConstraint(c);
    this.hand.velocity.set(0, 0, 0);
    body.angularDamping = 0.1;
    // a throw: cap it so nothing leaves the room
    const v = body.velocity;
    const sp = v.length();
    if (sp > 5) v.scale(5 / sp, v);
    this.grab = null;
  }

  pushPendant(p, dir, strength = 1) {
    p.vx += -dir.z * 1.6 * strength;
    p.vz += dir.x * 1.6 * strength;
  }

  /** sweeping the cursor across a lamp pushes it with the air */
  brushPendants(ray, velWorld, dt) {
    const c = this._c || (this._c = new THREE.Vector3());
    for (const p of this.pendants) {
      c.set(0, -0.9, 0).applyQuaternion(p.pivot.quaternion).add(p.pivot.position);
      const d = ray.distanceToPoint(c);
      if (d < 0.25) {
        const k = (1 - d / 0.25) * dt * 2.2;
        p.vx += -velWorld.z * k;
        p.vz += velWorld.x * k;
      }
    }
  }

  /* ---------------------------------------------------------------- simulation */
  step(dt) {
    this.time += dt;
    if (this.grab) {
      // the hand moves smoothly toward the cursor; its velocity drives the constraint
      const h = this.hand.position;
      const t = this.grab.target;
      const nx = h.x + (t.x - h.x) * Math.min(1, dt * 30);
      const ny = h.y + (t.y - h.y) * Math.min(1, dt * 30);
      const nz = h.z + (t.z - h.z) * Math.min(1, dt * 30);
      // kinematic: the world integrates this velocity, which lands the hand on (nx, ny, nz)
      this.hand.velocity.set((nx - h.x) / dt, (ny - h.y) / dt, (nz - h.z) / dt);
      this.grab.body.wakeUp();
    }
    // when every box is asleep and nobody is holding one there is nothing to solve
    let awake = !!this.grab;
    for (let i = 0; i < this.world.bodies.length && !awake; i++) {
      const b = this.world.bodies[i];
      if (b.mass > 0 && b.sleepState !== CANNON.Body.SLEEPING) awake = true;
    }
    if (awake) this.world.step(dt);
    // anything that escaped (thrown out of bounds) returns to the counter
    for (let i = 0; i <= this.boxes.length; i++) {
      const b = i < this.boxes.length ? this.boxes[i].body : this.bag.body;
      if (b.position.y < -0.5 || !Number.isFinite(b.position.x)) {
        b.position.set(7.24, LAYOUT.counter.h + 0.4, -2.08);
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
      }
    }
    // pendants: spherical pendulums, small air drag
    for (const p of this.pendants) {
      const w2 = 9.81 / p.L;
      p.vx += (-w2 * Math.sin(p.ax) - 0.22 * p.vx) * dt;
      p.vz += (-w2 * Math.sin(p.az) - 0.22 * p.vz) * dt;
      p.ax = clamp(p.ax + p.vx * dt, -0.7, 0.7);
      p.az = clamp(p.az + p.vz * dt, -0.7, 0.7);
    }
  }

  _sync(b) {
    b.mesh.position.copy(b.body.position);
    b.mesh.quaternion.copy(b.body.quaternion);
  }

  update() {
    for (const b of this.boxes) this._sync(b);
    this._sync(this.bag);
    for (const p of this.pendants) p.pivot.rotation.set(p.ax, 0, p.az);
  }

  get energy() {
    let e = 0;
    for (const b of this.world.bodies) if (b.mass > 0 && b.sleepState !== CANNON.Body.SLEEPING) e += b.velocity.length() + b.angularVelocity.length() * 0.1;
    for (const p of this.pendants) e += Math.abs(p.vx) + Math.abs(p.vz);
    return e + (this.grab ? 1 : 0);
  }
}
