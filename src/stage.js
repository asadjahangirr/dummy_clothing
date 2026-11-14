/**
 * Stage — owns the renderer, the scene, the camera, the input and the frame loop.
 *
 *   Store:    scrolling walks the camera through the boutique (entrance → each shirt on the
 *             rail → lounge → a look through the door). Drag empty space to look around.
 *   Shirts:   grab anywhere and pull (they slide along the rail, swing, swivel and knock into
 *             each other), flick to spin, tap to dent the fabric, bat the price tags.
 *   Checkout: the camera walks through the doorway to the counter; gift boxes and the bag can be
 *             grabbed and thrown, the pendants swing.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { woodTexture, tagTexture } from './art.js';
import { buildRoom, LAYOUT } from './room.js';
import { ShirtRig, Rail, clamp } from './shirt.js';
import { Checkout } from './counter.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const smooth = (t) => t * t * (3 - 2 * t);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SHIRT_SCALE = 0.8; // the scan is normalised to 1 m; a real shirt is ~0.8 m long
const PHYS_HZ = 120;

const PROPS = [
  'mid_century_lounge_chair', 'coffee_table_round_01', 'ceramic_vase_01', 'ceramic_vase_03', 'ceramic_vase_04',
  'marble_bust_01', 'potted_plant_02', 'potted_plant_04', 'Ottoman_01', 'pachira_aquatica_01',
  'modern_wooden_cabinet', 'modern_arm_chair_01', 'modern_ceiling_lamp_01', 'wall_clock', 'standing_picture_frame_01',
];

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function crVec(pts, u, out) {
  const n = pts.length;
  const i = clamp(Math.floor(u), 0, n - 2);
  const t = clamp(u - i, 0, 1);
  const P = (k) => pts[clamp(k, 0, n - 1)];
  for (const c of ['x', 'y', 'z']) out[c] = cr(P(i - 1)[c], P(i)[c], P(i + 1)[c], P(i + 2)[c], t);
  return out;
}
function bezier(a, b, c, d, t, out) {
  const u = 1 - t;
  for (const k of ['x', 'y', 'z']) out[k] = u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k];
  return out;
}

/** The pachira file holds several trees side by side; keep the tallest one, centred on its base. */
function extractTallest(root) {
  root.updateMatrixWorld(true);
  let level = root;
  while (level.children.length === 1 && !level.children[0].isMesh) level = level.children[0];
  const items = level.children.map((o) => {
    const bb = new THREE.Box3().setFromObject(o);
    return { o, bb, cx: (bb.min.x + bb.max.x) / 2 };
  }).filter((i) => !i.bb.isEmpty());
  if (!items.length) return root;
  const tallest = items.reduce((a, b) => (b.bb.max.y - b.bb.min.y > a.bb.max.y - a.bb.min.y ? b : a));
  const cluster = items.filter((i) => Math.abs(i.cx - tallest.cx) < 0.6);
  const g = new THREE.Group();
  const bb = new THREE.Box3();
  cluster.forEach((i) => bb.union(i.bb));
  const c = bb.getCenter(V3());
  cluster.forEach((i) => {
    const o = i.o.clone(true);
    o.applyMatrix4(i.o.parent.matrixWorld);
    o.position.x -= c.x; o.position.z -= c.z; o.position.y -= bb.min.y;
    g.add(o);
  });
  return g;
}

/* ================================================================ Stage */
export class Stage {
  constructor(canvas, { onProgress, onHover, onSelect } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress || (() => {});
    this.onHover = onHover || (() => {});
    this.onSelect = onSelect || (() => {});
    this.ready = false;
    this.story = 0;
    this.prevStory = 0;
    this.lastNow = null;
    this.time = 0;
    this.cardOpen = false;
    this.mode = 'store';
    this.co = 0;          // 0 = store, 1 = checkout (camera transition)
    this.coDir = 0;
    this.rigs = [];
    this.pointer = { nx: 0, ny: 0, inside: false, down: false, moved: 0, downT: 0, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0, dirty: false, mode: null, hoverKind: null, hoverRig: null };
    this.look = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
    this.parallax = { x: 0, y: 0 };
    this.camPos = V3(0.35, 1.62, 3.35);
    this.camTgt = V3(-0.15, 1.2, -2.0);
    this.fov = 42;
    this.sx = 0;
    this.thumbRequest = null;
    this.tagTarget = V3();
    this._initCameraKeys();
    this._initRenderer();
    this._bindEvents();
  }

  /* ---------------------------------------------------------------- setup */
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    // sharp on every screen, but never more than 1.5x pixels (retina at 2x costs 78% more for no visible gain)
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.setClearColor(0xeeede9, 1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeeede9);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.camera.filmGauge = 35;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this._resize();
  }

  async load({ shirt, products, brand }) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_, loaded, total) => this.onProgress(loaded / total);
    const gltfLoader = new GLTFLoader(manager);
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    const texLoader = new THREE.TextureLoader(manager);
    const gl = (url) => gltfLoader.loadAsync(url);
    const tx = (url) => texLoader.loadAsync(url);
    const set = (name) => Promise.all([
      tx(`/store/textures/${name}_diff.webp`), tx(`/store/textures/${name}_nor_gl.webp`), tx(`/store/textures/${name}_rough.webp`),
    ]).then(([diff, nor, rough]) => ({ diff, nor, rough }));

    const [shirtGltf, propList, floor, wall, plaster, hdr] = await Promise.all([
      gl(shirt),
      Promise.all(PROPS.map((id) => gl(`/store/models/${id}.glb`).then((g) => [id, g.scene]).catch((e) => { console.warn('prop failed', id, e); return [id, null]; }))),
      set('laminate_floor_02'), set('plastered_wall_04'), set('painted_plaster_wall'),
      new RGBELoader(manager).loadAsync('/store/env/white_home_studio_1k.hdr'),
    ]);
    // canvas-drawn labels need the web fonts
    await Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 1500))]);

    /* ---------- environment light: a real white studio, used only for lighting/reflections */
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
    this.scene.environmentIntensity = 0.5;
    hdr.dispose();
    pmrem.dispose();

    /* ---------- room */
    const models = Object.fromEntries(propList);
    if (models.pachira_aquatica_01) models.pachira = extractTallest(models.pachira_aquatica_01);
    this.room = buildRoom({ scene: this.scene, renderer: this.renderer, models, textures: { floor, wall, plaster } });

    /* ---------- shirt geometry (shared by all three hangers) */
    let src;
    shirtGltf.scene.updateMatrixWorld(true);
    shirtGltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', toFloatAttribute(src.geometry.attributes.position));
    geo.setAttribute('normal', toFloatAttribute(src.geometry.attributes.normal));
    geo.setAttribute('uv', src.geometry.attributes.uv);
    geo.setIndex(src.geometry.index);
    geo.applyMatrix4(src.matrixWorld);
    geo.scale(SHIRT_SCALE, SHIRT_SCALE, SHIRT_SCALE);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y, 0);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    [src.material.map, src.material.normalMap].forEach((t) => t && (t.anisotropy = aniso));

    const parts = {
      railR: LAYOUT.rail.r,
      chrome: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.08, metalness: 1 }),
      wood: new THREE.MeshPhysicalMaterial({ map: woodTexture(this.renderer), roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    };
    const R = LAYOUT.rail;
    this.rail = new Rail({ x0: R.x0, x1: R.x1, y: R.y, z: R.z, wallZ: LAYOUT.main.z0 });
    products.forEach((p, i) => {
      const priceTex = tagTexture(this.renderer, 'price', { price: p.priceLabel, currency: p.currency });
      const rig = new ShirtRig({ index: i, geo, source: src.material, parts, railX: R.slots[i] ?? 0, railY: R.y, railZ: R.z, wallZ: LAYOUT.main.z0, priceTex });
      this.scene.add(rig.root, rig.tag.group, rig.tag.line);
      this.rail.add(rig);
      this.rigs.push(rig);
    });
    this.shirtMeshes = this.rigs.map((r) => r.shirt);
    this.tagMeshes = this.rigs.map((r) => r.tag.card);

    /* ---------- checkout room */
    this.checkout = new Checkout({ scene: this.scene, renderer: this.renderer, colliders: this.room.colliders, pendants: this.room.pendants, brand });
    if (this.pendingBag) this.setBag(...this.pendingBag);

    geo.computeBoundsTree({ maxLeafTris: 12 });
    this._resize();
    await this._warmUp();
    this.ready = true;
  }

  /** Everything the GPU will ever need is prepared before the store is revealed, so nothing
   *  hitches later: textures are uploaded, every shader is compiled (in parallel where the
   *  browser supports it) and both rooms are drawn once, shadow maps included. */
  async _warmUp() {
    const r = this.renderer;
    const warm = this.checkout.warmMesh;
    this.scene.add(warm);
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) r.initTexture(m[k]);
      }
    });
    if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
    else r.compile(this.scene, this.camera);
    const shadowsDirty = () => [this.room.railLight, this.room.counterLight, ...this.room.staticShadowLights].forEach((l) => (l.shadow.needsUpdate = true));
    const view = (pose) => {
      this.camera.position.copy(pose.pos);
      this.camera.lookAt(pose.tgt);
      this.camera.updateMatrixWorld();
      shadowsDirty();
      r.render(this.scene, this.camera);
    };
    view(this._checkoutPose(this.poseShop));
    this.story = 0;
    view(this._storePose(this.poseStore));
    this.scene.remove(warm);
    // let the GPU finish before the reveal
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  }

  /* ---------------------------------------------------------------- public API */
  get stationCount() { return 6; }
  setStory(v) { this.story = v; }
  /** the product card is open: frame the shirt so the card doesn't cover it */
  setCardOpen(v) { this.cardOpen = v; }
  intro() {
    this.introStart = this.time;
    this.introCam = this.time;
    this.rigs.forEach((r) => { r.s.drop = 0.9; });
    // the camera starts at the door and glides into the room as the intro doors open
    this.camPos.set(0.55, 1.78, 3.72);
    this.camTgt.set(-0.1, 1.45, -2.0);
  }
  enterCheckout() { if (this.mode !== 'checkout') { this.mode = 'checkout'; this.coDir = 1; this.coT0 = this.time; this.co0 = this.co; } }
  exitCheckout() { if (this.mode !== 'store') { this.mode = 'store'; this.coDir = -1; this.coT0 = this.time; this.co0 = this.co; } }
  setBag(count, totalLabel) {
    if (!this.checkout) { this.pendingBag = [count, totalLabel]; return; }
    this.checkout.setCount(count);
    this.checkout.setTotal(count, totalLabel);
    if (this.room) this.room.counterLight.shadow.needsUpdate = true;
  }
  /** a small picture of shirt i for the bag */
  captureThumb(i, w = 360, h = 440) { return new Promise((resolve) => { this.thumbRequest = { i, w, h, resolve }; }); }

  /* ---------------------------------------------------------------- input */
  _setRay() {
    this.raycaster.setFromCamera({ x: this.pointer.nx, y: this.pointer.ny }, this.camera);
    return this.raycaster.ray;
  }

  _pick() {
    if (!this.ready) return null;
    this._setRay();
    if (this.mode === 'checkout' || this.co > 0.5) return this.checkout.pick(this.raycaster);
    const tagHit = this.raycaster.intersectObjects(this.tagMeshes, false)[0];
    let shirtHit = null;
    if (this.shirtMeshes[0].geometry.boundsTree) shirtHit = this.raycaster.intersectObjects(this.shirtMeshes, false)[0] || null;
    if (tagHit && (!shirtHit || tagHit.distance < shirtHit.distance)) return { kind: 'tag', hit: tagHit, tag: tagHit.object.userData.tag };
    if (shirtHit) return { kind: 'shirt', hit: shirtHit, rig: shirtHit.object.userData.rig };
    return null;
  }

  _bindEvents() {
    const c = this.canvas;
    const p = this.pointer;
    new ResizeObserver(() => this._resize()).observe(document.documentElement);
    const setPos = (e) => {
      p.nx = (e.clientX / window.innerWidth) * 2 - 1;
      p.ny = -(e.clientY / window.innerHeight) * 2 + 1;
      p.dirty = true;
    };

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setPos(e);
      document.body.classList.add('is-dragging');
      p.down = true; p.moved = 0;
      p.lastX = e.clientX; p.lastY = e.clientY;
      p.downT = p.lastT = performance.now();
      p.vx = p.vy = 0;
      const pick = this._pick();
      p.mode = pick ? pick.kind : 'look';
      const facing = this.camera.getWorldDirection(V3()).negate();
      const plane = pick ? new THREE.Plane().setFromNormalAndCoplanarPoint(facing, pick.hit.point) : null;
      this.picked = pick;
      if (pick?.kind === 'shirt') {
        pick.rig.grab = {
          local: pick.rig.shirt.worldToLocal(pick.hit.point.clone()),
          plane, target: pick.hit.point.clone(), prevG: pick.hit.point.clone(),
        };
      } else if (pick?.kind === 'tag') {
        this.tagGrab = { tag: pick.tag, plane, offset: V3().subVectors(pick.tag.end, pick.hit.point) };
        this.tagTarget.copy(pick.tag.end);
      } else if (pick?.kind === 'box') {
        this.checkout.grabStart(pick.hit, pick.body, plane);
      } else if (pick?.kind === 'pendant') {
        this.checkout.pushPendant(pick.pendant, this.raycaster.ray.direction, 1);
      }
      c.setPointerCapture(e.pointerId);
      this.onHover(p.hoverKind, p.mode);
    });

    c.addEventListener('pointermove', (e) => {
      setPos(e);
      p.inside = true;
      const now = performance.now();
      const dt = Math.max(1, now - p.lastT) / 1000;
      const dx = e.clientX - p.lastX, dy = e.clientY - p.lastY;
      p.vx = lerp(p.vx, dx / dt, 0.5);
      p.vy = lerp(p.vy, dy / dt, 0.5);
      p.lastX = e.clientX; p.lastY = e.clientY; p.lastT = now;
      if (!p.down) return;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (p.mode === 'look') {
        const L = this.look;
        L.yaw = clamp(L.yaw - dx * 0.0028, -0.75, 0.75);
        L.pitch = clamp(L.pitch - dy * 0.0022, -0.35, 0.3);
        L.vy = -p.vx * 0.0028;
        L.vp = -p.vy * 0.0022;
      }
    });

    const end = (e) => {
      if (!p.down) return;
      p.down = false;
      document.body.classList.remove('is-dragging');
      const quick = performance.now() - p.downT < 320 && p.moved < 7;
      const pick = this.picked;
      if (quick && e.type === 'pointerup' && pick) {
        if (pick.kind === 'shirt') {
          this._setRay();
          const hit = this.raycaster.intersectObject(pick.rig.shirt, false)[0];
          if (hit) pick.rig.poke(hit.point, this.raycaster.ray.direction, this.time);
          this.onSelect(pick.rig.index, 'shirt');
        }
        if (pick.kind === 'tag') {
          const t = pick.tag;
          t.impulse(V3((Math.random() - 0.5) * 0.008, 0.003, 0.01));
          t.phiV += (Math.random() > 0.5 ? 1 : -1) * 9;
          this.onSelect(t.rig.index, 'tag');
        }
      }
      this.rigs.forEach((r) => { r.grab = null; });
      this.tagGrab = null;
      if (pick?.kind === 'box') this.checkout.grabEnd();
      this.picked = null;
      p.mode = null;
      p.dirty = true;
      this.onHover(p.hoverKind, null);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    // touch: a finger on something interactive grabs it; anywhere else still scrolls the page
    c.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      setPos(t);
      if (this._pick()) e.preventDefault();
    }, { passive: false });
    c.addEventListener('pointerleave', () => {
      p.inside = false;
      p.hoverKind = null;
      this.onHover(null, null);
    });
    document.addEventListener('visibilitychange', () => { this.lastNow = null; });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.vw = w; this.vh = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.mobile = w < 820;
    this.portrait = w < h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- camera */
  // all camera maths reuses these objects, so a frame allocates nothing (no GC pauses)
  _initCameraKeys() {
    const key = () => ({ pos: V3(), tgt: V3(), sx: 0 });
    this.keys = Array.from({ length: 6 }, key);
    this.keyPos = this.keys.map((k) => k.pos);
    this.keyTgt = this.keys.map((k) => k.tgt);
    this.poseStore = key();
    this.poseShop = key();
    this.tmp = { pos: V3(), tgt: V3(), right: V3(), dir: V3(), axis: V3(), look: V3(), up: new THREE.Vector3(0, 1, 0), d1: V3(), d2: V3() };
  }

  _storeKeys() {
    const R = LAYOUT.rail;
    const m = this.mobile || this.portrait;
    const card = this.cardOpen;
    const k = this.keys;
    k[0].pos.set(0.35, 1.62, 3.35); k[0].tgt.set(-0.15, 1.18, -2.0); k[0].sx = 0;
    this.rigs.forEach((rig, i) => {
      const x = rig.s.x, K = k[i + 1];
      if (m) { K.pos.set(x + 0.22, 1.42, R.z + 2.25); K.tgt.set(x, card ? 0.98 : 1.3, R.z); K.sx = 0; }
      else { K.pos.set(x + 0.3, 1.47, R.z + 1.8); K.tgt.set(x, 1.33, R.z); K.sx = card ? -0.17 : 0; }
    });
    k[4].pos.set(-0.8, 1.6, 2.7); k[4].tgt.set(-3.3, 0.85, 0.4); k[4].sx = 0;
    k[5].pos.set(2.3, 1.6, 1.0); k[5].tgt.set(6.2, 1.15, -2.3); k[5].sx = 0;
    return k;
  }

  _storePose(out) {
    const keys = this._storeKeys();
    const v = clamp(this.story, 0, keys.length - 1);
    const i = Math.min(Math.floor(v), keys.length - 2);
    const f = smooth(clamp(v - i, 0, 1));
    crVec(this.keyPos, i + f, out.pos);
    crVec(this.keyTgt, i + f, out.tgt);
    out.sx = lerp(keys[i].sx, keys[i + 1].sx, f);
    return out;
  }

  _checkoutPose(out) {
    const m = this.mobile || this.portrait;
    out.pos.set(m ? 5.15 : 5.35, m ? 1.75 : 1.62, m ? -0.5 : -0.78);
    out.tgt.set(7.3, m ? 0.78 : 1.02, -2.3);
    out.sx = m ? 0 : -0.14;
    return out;
  }

  _updateCamera(dt) {
    const T = this.tmp;
    if (this.coDir) {
      const k = clamp((this.time - this.coT0) / 1.9, 0, 1);
      this.co = this.coDir > 0 ? lerp(this.co0, 1, ease(k)) : lerp(this.co0, 0, ease(k));
      if (k >= 1) this.coDir = 0;
    }
    const store = this._storePose(this.poseStore);
    const shop = this._checkoutPose(this.poseShop);
    const pos = T.pos, tgt = T.tgt;
    let sx;
    if (this.co <= 0.0001) { pos.copy(store.pos); tgt.copy(store.tgt); sx = store.sx; }
    else if (this.co >= 0.9999) { pos.copy(shop.pos); tgt.copy(shop.tgt); sx = shop.sx; }
    else {
      // walk through the doorway: a Bezier whose middle handles sit either side of the door
      const D = LAYOUT.door;
      const dz = (D.z0 + D.z1) / 2 - 0.1;
      bezier(store.pos, T.d1.set(3.35, 1.62, dz), T.d2.set(4.75, 1.62, dz), shop.pos, this.co, pos);
      const lt = smooth(clamp((this.co - 0.05) / 0.65, 0, 1));
      tgt.lerpVectors(store.tgt, shop.tgt, lt);
      sx = lerp(store.sx, shop.sx, lt);
    }

    // free look: inertia after release; scrolling eases it back to the composed shot
    const ds = Math.abs(this.story - this.prevStory);
    this.prevStory = this.story;
    const L = this.look;
    if (!this.pointer.down) {
      L.yaw += L.vy * dt; L.pitch += L.vp * dt;
      L.vy *= Math.exp(-4 * dt); L.vp *= Math.exp(-4 * dt);
      const relax = Math.exp(-ds * 5) * (this.coDir ? Math.exp(-dt * 4) : 1);
      L.yaw = clamp(L.yaw * relax, -0.75, 0.75);
      L.pitch = clamp(L.pitch * relax, -0.35, 0.3);
    }
    this.parallax.x = damp(this.parallax.x, this.pointer.inside ? this.pointer.nx : 0, 2.5, dt);
    this.parallax.y = damp(this.parallax.y, this.pointer.inside ? this.pointer.ny : 0, 2.5, dt);

    // exponential follow: frame-rate independent, so it is equally smooth at 60 or 144 Hz
    const introK = this.introCam !== undefined ? lerp(1.6, 7, clamp((this.time - this.introCam) / 3, 0, 1)) : 7;
    const k = this.coDir ? 60 : introK;
    const a = 1 - Math.exp(-k * dt);
    this.camPos.lerp(pos, a);
    this.camTgt.lerp(tgt, a);
    this.sx = damp(this.sx, sx, 5, dt);

    const cam = this.camera;
    const right = T.right.subVectors(this.camTgt, this.camPos).cross(T.up).normalize();
    cam.position.copy(this.camPos).addScaledVector(right, this.parallax.x * 0.035);
    cam.position.y += this.parallax.y * 0.02;
    const dir = T.dir.subVectors(this.camTgt, this.camPos);
    dir.applyAxisAngle(T.up, L.yaw);
    dir.applyAxisAngle(T.axis.crossVectors(dir, T.up).normalize(), L.pitch);
    cam.lookAt(T.look.addVectors(cam.position, dir));

    // lens: wider in portrait so the room still reads
    const asp = cam.aspect;
    const target = asp >= 1 ? 42 : clamp((2 * Math.atan(Math.tan((34 * Math.PI) / 360) / asp) * 180) / Math.PI, 42, 72);
    cam.fov = damp(cam.fov, target, 6, dt);
    const halfTan = Math.tan((cam.fov * Math.PI) / 360);
    const filmW = cam.filmGauge * Math.min(asp, 1);
    cam.filmOffset = -this.sx * 2 * halfTan * asp * filmW * (this.mobile ? 0 : 1);
    cam.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- frame */
  _step(h) {
    for (const r of this.rigs) r.tag.grab = this.tagGrab && this.tagGrab.tag === r.tag ? this.tagTarget : null;
    this.rail.step(h, this.time, () => 0); // hangers settle facing the room when left alone
    this.checkout.step(h);
  }

  _pointerForces(dt) {
    const p = this.pointer;
    if (p.down || !p.inside) return;
    const camDist = this.camPos.distanceTo(this.camTgt);
    const worldPerPx = (2 * camDist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.vh;
    const right = this.tmp.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = this.tmp.axis.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const vx = clamp(p.vx * worldPerPx, -3, 3);
    const vy = clamp(-p.vy * worldPerPx, -3, 3);
    this._setRay();
    if (this.mode === 'store') {
      const rig = p.hoverRig;
      if (rig) {
        // sweeping across the cloth pushes air into it
        rig.s.bendV.x += right.x * vx * 2.6 * dt;
        rig.s.bendV.y += right.z * vx * 2.6 * dt;
        rig.s.yawV += vx * 0.06 * dt;
        rig.s.swZV += right.x * vx * 0.45 * dt;
      }
      for (const r of this.rigs) {
        const tag = r.tag;
        const d = this.raycaster.ray.distanceToPoint(tag.group.position);
        if (d < 0.07 && Math.abs(vx) + Math.abs(vy) > 0.05) {
          const k = (1 - d / 0.07) * dt * 0.2;
          tag.impulse(V3().copy(right).multiplyScalar(vx * k).add(V3(0, vy * k * 0.4, Math.abs(vx) * k * 0.4)));
          tag.phiV += vx * 60 * (1 - d / 0.07) * dt;
        }
      }
    } else {
      const vw = this.tmp.dir.set(0, 0, 0).addScaledVector(right, vx).addScaledVector(up, vy);
      this.checkout.brushPendants(this.raycaster.ray, vw, dt);
    }
    p.vx *= Math.exp(-10 * dt);
    p.vy *= Math.exp(-10 * dt);
  }

  update(now = performance.now()) {
    if (!this.ready || document.hidden) { this.lastNow = null; return; }
    // frame time from the display's own clock (rAF timestamp): no jitter from when JS happened to run
    const dt = this.lastNow == null ? 1 / 60 : Math.min(Math.max((now - this.lastNow) / 1000, 0), 1 / 20);
    this.lastNow = now;
    if (dt === 0) return;
    this.time += dt;

    // intro: the three hangers drop onto the rail one after another
    if (this.introStart !== undefined) {
      for (let i = 0; i < this.rigs.length; i++) {
        const r = this.rigs[i];
        const k = clamp((this.time - this.introStart - i * 0.18) / 1.1, 0, 1);
        const prev = r.s.drop;
        r.s.drop = 0.9 * Math.pow(1 - k, 3);
        if (prev > 0 && r.s.drop === 0) { r.s.swXV += 0.8; r.s.bendV.y -= 0.5; r.idleSince = this.time; }
      }
      if (this.time - this.introStart > 2) this.introStart = undefined;
    }

    // drag targets follow the pointer
    if (this.pointer.down && this.picked) {
      this._setRay();
      const pk = this.picked;
      const hp = this.tmp.d1;
      if (pk.kind === 'shirt' && pk.rig.grab) this.raycaster.ray.intersectPlane(pk.rig.grab.plane, pk.rig.grab.target);
      if (pk.kind === 'tag' && this.tagGrab && this.raycaster.ray.intersectPlane(this.tagGrab.plane, hp)) this.tagTarget.copy(hp).add(this.tagGrab.offset);
      if (pk.kind === 'box' && this.checkout.grab && this.raycaster.ray.intersectPlane(this.checkout.grab.plane, hp)) this.checkout.grabMove(hp);
    }

    // physics: the frame is split into equal sub-steps of at most 1/120 s, so motion advances
    // by exactly the frame time on any display (60, 90, 120, 144 Hz) - no judder
    const n = Math.max(1, Math.ceil(dt * PHYS_HZ - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._step(h);

    // hover (one BVH raycast, only when the pointer moved)
    const p = this.pointer;
    if (p.dirty && p.inside && !p.down) {
      p.dirty = false;
      const pick = this._pick();
      const kind = pick ? pick.kind : null;
      p.hoverRig = pick?.kind === 'shirt' ? pick.rig : null;
      if (p.hoverRig) {
        const l = p.hoverRig.shirt.worldToLocal(this.tmp.d2.copy(pick.hit.point));
        const hv = p.hoverRig.uniforms.uHover.value;
        hv.set(l.x, l.y, l.z, hv.w);
      }
      if (kind !== p.hoverKind) { p.hoverKind = kind; this.onHover(kind, null); }
    }
    this._pointerForces(dt);

    for (const r of this.rigs) r.update(dt, this.time, p.hoverRig === r && !p.down);
    this.checkout.update();
    this.frames = (this.frames || 0) + 1;
    if (this.room.clock && this.frames % 60 === 0) this.room.clock.update();

    // shadows re-render only while something that casts them is moving, and only for the
    // room the camera can see
    const inStore = this.co < 0.98, inShop = this.co > 0.02;
    if (inStore && (this.tagGrab || this.rigs.some((r) => r.energy > 0.015 || r.s.drop > 0))) this.room.railLight.shadow.needsUpdate = true;
    if (inShop && this.checkout.energy > 0.004) this.room.counterLight.shadow.needsUpdate = true;

    this._updateCamera(dt);
    if (this.thumbRequest) this._renderThumb();
    this.renderer.render(this.scene, this.camera);
    this._adaptQuality(dt);
  }

  _renderThumb() {
    const { i, w, h, resolve } = this.thumbRequest;
    this.thumbRequest = null;
    const rig = this.rigs[i] || this.rigs[0];
    const cam = this.thumbCam || (this.thumbCam = new THREE.PerspectiveCamera(30, 1, 0.05, 20));
    const x = rig.s.x, R = LAYOUT.rail;
    const H = rig.pivotLocal.y + 0.08;
    const cy = R.y - H / 2 + 0.03;
    const d = (H / 2 / 0.9) / Math.tan((cam.fov * Math.PI) / 360);
    cam.position.set(x + Math.sin(0.25) * d, cy + 0.05, R.z + Math.cos(0.25) * d);
    cam.lookAt(x, cy, R.z);
    const vw = this.renderer.domElement.width, vh = this.renderer.domElement.height;
    const sh = vh, sw = sh * (w / h);
    cam.aspect = vw / vh;
    cam.updateProjectionMatrix();
    this.renderer.render(this.scene, cam);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(this.renderer.domElement, (vw - sw) / 2, 0, sw, sh, 0, 0, w, h);
    // encode off the frame: toBlob is asynchronous, so adding to the bag never stalls a frame
    out.toBlob((blob) => {
      if (!blob) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    }, 'image/jpeg', 0.84);
  }

  /** Keeps the frame rate up: watches real frame times and lowers render resolution (never
   *  below the screen's native pixels), then shadow resolution, if the GPU can't keep up. */
  _adaptQuality(dt) {
    this.ftAcc = (this.ftAcc || 0) + dt;
    this.ftN = (this.ftN || 0) + 1;
    if (this.ftN < 90) return;
    const avg = this.ftAcc / this.ftN;
    this.ftAcc = 0; this.ftN = 0;
    if (this.time < 3 || this.coDir) return; // ignore the intro and camera flights
    if (avg <= 1 / 50) return;
    if (this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this._resize();
    } else if (!this.lowShadows) {
      this.lowShadows = true;
      for (const l of [this.room.railLight, this.room.counterLight]) {
        l.shadow.mapSize.set(1024, 1024);
        if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
        l.shadow.needsUpdate = true;
      }
    }
  }
}

function toFloatAttribute(attr) {
  const n = attr.count, s = attr.itemSize;
  const out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) {
    out[i * s] = attr.getX(i);
    if (s > 1) out[i * s + 1] = attr.getY(i);
    if (s > 2) out[i * s + 2] = attr.getZ(i);
    if (s > 3) out[i * s + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, s);
}
