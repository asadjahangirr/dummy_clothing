/**
 * Stage — a gallery wall with a long wall-mounted arm; the shirt hangs from it on a
 * walnut + chrome hanger. Everything is driven by the mouse:
 *
 *   • Grab the shirt anywhere and pull — a spring attached to the exact point you grabbed
 *     produces torque about the hook, so it swings, tilts and turns like a real hanging garment.
 *   • Flick and release — it keeps spinning on its swivel hook and settles with friction.
 *   • Hover — the fabric yields under the cursor; sweeping fast pushes air into it.
 *   • Click — a dent and a ripple run through the cloth.
 *   • Drag empty space — look around the room.
 *   • Hang tags on a brass peg are verlet ropes: bat them, drag them, click to buy.
 *
 * Cloth deformation (twist, hem lag, flare, ripples, pull) is computed in the vertex shader.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  paintEnso, paintFlow, paintField, paintGeo, framedArt, pictureLight,
  woodTexture, plasterTexture, tagTexture,
} from './art.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MAX_POKES = 4;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (t) => t * t * (3 - 2 * t);
const V3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/* ================================================================ cloth shader */
const CLOTH_HEAD = /* glsl */ `
uniform float uTime;
uniform float uTwist;
uniform vec2  uBend;
uniform float uWind;
uniform float uFlare;
uniform vec2  uAxis;
uniform float uShoulder;
uniform vec4  uPokes[${MAX_POKES}];
uniform float uPokeAmp[${MAX_POKES}];
uniform vec4  uHover;
uniform vec4  uGrab;     // xyz local grab point, w strength
uniform vec3  uGrabOff;  // local pull offset

float clothW(float y) { return clamp((uShoulder - y) / uShoulder, 0.0, 1.0); }

float clothField(vec3 p) {
  float w = clothW(p.y);
  float m = smoothstep(0.0, 0.10, w);
  float t = uTime;
  float f = 0.0;
  float wa = (0.0014 + 0.0055 * uWind) * w;
  f += wa        * sin(p.x * 13.0 + p.y * 7.0  - t * (1.3 + 2.4 * uWind));
  f += wa * 0.7  * sin(p.z * 17.0 - p.y * 11.0 + p.x * 5.0 + t * (1.0 + 2.0 * uWind));
  f += wa * 0.35 * sin(p.y * 29.0 + p.x * 19.0 - t * (2.2 + 3.2 * uWind));
  for (int i = 0; i < ${MAX_POKES}; i++) {
    float age = t - uPokes[i].w;
    float amp = uPokeAmp[i] * step(0.0, age) * (1.0 - step(3.2, age));
    if (amp <= 0.0) continue;
    vec3 dv = p - uPokes[i].xyz;
    float r2 = dot(dv, dv);
    float r = sqrt(r2);
    float a = age / 0.07;
    float dent = -0.026 * exp(-r2 * 220.0) * a * exp(1.0 - a);
    float front = 1.0 - smoothstep(age * 0.32 - 0.02, age * 0.32 + 0.03, r);
    float wave = 0.0065 * sin(r * 62.0 - age * 17.0) * exp(-age * 1.5) * exp(-r * 5.5) * front * smoothstep(0.0, 0.08, age);
    f += amp * m * (dent + wave);
  }
  vec3 dh = p - uHover.xyz;
  f += -0.009 * uHover.w * m * exp(-dot(dh, dh) * 170.0);
  return f;
}

void clothDeform(vec3 p, vec3 n, out vec3 op, out vec3 on) {
  float f0 = clothField(p);
#ifdef CLOTH_DEPTH
  vec3 nn = n;
#else
  const float e = 0.0035;
  vec3 g = vec3(
    clothField(p + vec3(e, 0.0, 0.0)) - f0,
    clothField(p + vec3(0.0, e, 0.0)) - f0,
    clothField(p + vec3(0.0, 0.0, e)) - f0
  ) / e;
  vec3 nn = normalize(n - (g - dot(g, n) * n));
#endif
  vec3 q = p + n * f0;
  float w = clothW(p.y);
  float w2 = w * w;

  vec2 rel = q.xz - uAxis;
  rel *= 1.0 + uFlare * w2;
  float a = uTwist * w;
  float cs = cos(a), sn = sin(a);
  rel = vec2(cs * rel.x + sn * rel.y, -sn * rel.x + cs * rel.y);
  q.xz = uAxis + rel;
  nn.xz = vec2(cs * nn.x + sn * nn.z, -sn * nn.x + cs * nn.z);

  q.xz += uBend * w2;
  q.y  += dot(uBend, uBend) * w2 * 0.6;
  nn.xz -= uBend * (2.0 * w / uShoulder) * nn.y * 0.5;

  // fabric stretching toward the hand that is pulling it
  vec3 dg = p - uGrab.xyz;
  float gm = uGrab.w * exp(-dot(dg, dg) * 32.0) * smoothstep(0.0, 0.08, w);
  q += uGrabOff * gm;

  op = q;
  on = normalize(nn);
}
`;

function patchCloth(material, uniforms, depth = false) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = (depth ? '#define CLOTH_DEPTH\n' : '') + CLOTH_HEAD + shader.vertexShader;
    if (depth) {
      vs = vs.replace('#include <begin_vertex>',
        'vec3 clothP; vec3 clothN; clothDeform(position, normal, clothP, clothN);\nvec3 transformed = clothP;');
    } else {
      vs = vs
        .replace('#include <beginnormal_vertex>',
          'vec3 clothP; vec3 clothN; clothDeform(position, normal, clothP, clothN);\nvec3 objectNormal = clothN;')
        .replace('#include <begin_vertex>', 'vec3 transformed = clothP;');
      // the scan's texture atlas has flat grey filler in a few seams; tint it navy
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float mx = max(c.r, max(c.g, c.b));
          float mn = min(c.r, min(c.g, c.b));
          float grey = (1.0 - smoothstep(0.025, 0.07, mx - mn)) * smoothstep(0.06, 0.16, mx);
          diffuseColor.rgb = mix(c, vec3(0.012, 0.018, 0.055), grey);
        }`
      );
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => (depth ? 'cloth-depth-v2' : 'cloth-v2');
}

/* ================================================================ geometry helpers */
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

/** Sweep an ellipse along a planar (XY) curve; halfH/halfT vary along the length. Ends are rounded. */
function sweepGeometry(curve, segs, radial, halfH, halfT) {
  const pos = [], nor = [], uv = [], idx = [];
  const Z = new THREE.Vector3(0, 0, 1);
  const N = V3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    N.crossVectors(Z, T).normalize();
    const e = Math.min(1, Math.min(t, 1 - t) / 0.03);
    const round = Math.sqrt(Math.max(0, 1 - (1 - e) * (1 - e)));
    const h = Math.max(1e-4, halfH(t) * round), th = Math.max(1e-4, halfT(t) * round);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + N.x * c * h, P.y + N.y * c * h, P.z + s * th);
      const n = V3().addScaledVector(N, c / h).addScaledVector(Z, s / th).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ================================================================ hang tags (verlet rope + card) */
class HangTag {
  constructor({ anchor, length, segs = 7, width, height, front, back, wallZ, id }) {
    this.id = id;
    this.anchor = anchor.clone();
    this.segs = segs;
    this.seg = length / segs;
    this.wallZ = wallZ;
    this.w = width; this.h = height;
    this.pts = [];
    for (let i = 0; i <= segs; i++) {
      const p = anchor.clone().add(new THREE.Vector3(0, -i * this.seg, 0.002 * i));
      this.pts.push({ p, q: p.clone() });
    }
    this.phi = 0; this.phiV = 0;
    this.grab = null;

    this.group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(width, height);
    geo.translate(0, -height / 2 + height * 0.06, 0);
    const mk = (map) => new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, roughness: 0.75 });
    this.front = new THREE.Mesh(geo, mk(front));
    this.back = new THREE.Mesh(geo, mk(back));
    this.back.rotation.y = Math.PI;
    this.front.position.z = 0.0006; this.back.position.z = -0.0006;
    [this.front, this.back].forEach((m) => { m.castShadow = true; m.userData.tag = this; });
    this.group.add(this.front, this.back);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x1b1b1d }));
    this.line.frustumCulled = false;
  }

  get end() { return this.pts[this.segs].p; }

  /** add velocity v (m/step) to the lower half of the rope */
  impulse(v) {
    for (let i = Math.floor(this.segs / 2); i <= this.segs; i++) {
      this.pts[i].q.addScaledVector(v, -i / this.segs);
    }
  }

  step(dt) {
    const g = -9.8 * dt * dt;
    const P = this.pts;
    P[0].p.copy(this.anchor); P[0].q.copy(this.anchor);
    for (let i = 1; i < P.length; i++) {
      const pt = P[i];
      const vx = (pt.p.x - pt.q.x) * 0.992, vy = (pt.p.y - pt.q.y) * 0.992, vz = (pt.p.z - pt.q.z) * 0.992;
      pt.q.copy(pt.p);
      pt.p.x += vx; pt.p.y += vy + g; pt.p.z += vz;
    }
    if (this.grab) P[P.length - 1].p.lerp(this.grab, 0.35);
    const d = V3();
    const extra = Math.abs(Math.sin(this.phi)) * this.w * 0.5;
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i].p, b = P[i + 1].p;
        d.subVectors(b, a);
        const len = d.length() || 1e-6;
        const diff = (len - this.seg) / len;
        if (i === 0) b.addScaledVector(d, -diff);
        else { a.addScaledVector(d, diff * 0.5); b.addScaledVector(d, -diff * 0.5); }
      }
      // the wall — the card sticks out by its half-width when it turns sideways
      for (let i = 1; i < P.length; i++) {
        const minZ = this.wallZ + 0.004 + (i === P.length - 1 ? extra : 0);
        const pt = P[i];
        if (pt.p.z < minZ) {
          const vz = pt.p.z - pt.q.z;
          pt.p.z = minZ;
          pt.q.z = minZ + vz * 0.3; // bounce back with 30% of the speed
        }
      }
    }
    // the card spins around its string and springs back to face the room
    this.phiV += (-14 * this.phi - 1.6 * this.phiV) * dt;
    this.phi = clamp(this.phi + this.phiV * dt, -2.6, 2.6);
  }

  sync() {
    const P = this.pts;
    const e = P[P.length - 1].p, pr = P[P.length - 2].p;
    const Y = V3().subVectors(pr, e).normalize();
    const Z0 = new THREE.Vector3(0, 0, 1);
    Z0.addScaledVector(Y, -Z0.dot(Y)).normalize();
    Z0.applyAxisAngle(Y, this.phi);
    const X = V3().crossVectors(Y, Z0).normalize();
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z0));
    this.group.position.copy(e);
    const arr = this.line.geometry.attributes.position.array;
    P.forEach((pt, i) => { arr[i * 3] = pt.p.x; arr[i * 3 + 1] = pt.p.y; arr[i * 3 + 2] = pt.p.z; });
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}

/* ================================================================ camera shots */
// az: orbit (rad, 0 = facing the wall), el, d: distance factor, ty: look-at height, sx: frame shift
const DESKTOP_SHOTS = [
  { az: -0.46, el: 0.07, d: 1.0, ty: 0.52, sx: 0.0 },
  { az: -0.22, el: 0.09, d: 1.0, ty: 0.52, sx: 0.2 },
  { az: -0.32, el: 0.04, d: 0.42, ty: 0.7, sx: -0.18 },
  { az: -0.12, el: 0.07, d: 0.98, ty: 0.52, sx: 0.2 },
  { az: -0.56, el: 0.08, d: 1.04, ty: 0.5, sx: 0.2 },
];
const MOBILE_SHOTS = [
  { az: -0.4, el: 0.07, d: 1.0, ty: 0.6, sx: 0 },
  { az: -0.22, el: 0.09, d: 1.02, ty: 0.36, sx: 0 },
  { az: -0.3, el: 0.04, d: 0.48, ty: 0.62, sx: 0 },
  { az: -0.12, el: 0.07, d: 1.0, ty: 0.36, sx: 0 },
  { az: -0.5, el: 0.07, d: 1.08, ty: 0.4, sx: 0 },
];
// which way the garment settles to face in each chapter (null = wherever the user leaves it)
const CHAPTER_YAW = [0, -1.15, 0.28, Math.PI, null];

/* ================================================================ Stage */
export class Stage {
  constructor(canvas, { onProgress, onHover, onTag } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress || (() => {});
    this.onHover = onHover || (() => {});
    this.onTag = onTag || (() => {});
    this.active = true;
    this.ready = false;
    this.story = 0;
    this.prevStory = 0;
    this.zoom = 1;
    this.lastInteraction = -10;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.tags = [];

    this.state = {
      yaw: -1.1, yawV: 1.6, prevYawV: 0,
      twist: 0, twistV: 0,
      swX: 0, swXV: 0, swZ: 0, swZV: 0,
      bend: new THREE.Vector2(), bendV: new THREE.Vector2(),
      prevHem: new THREE.Vector2(),
      flare: 0, wind: 0.2, hover: 0, grabW: 0,
      drop: 1,
    };

    this.uniforms = {
      uTime: { value: 0 },
      uTwist: { value: 0 },
      uBend: { value: new THREE.Vector2() },
      uWind: { value: 0.2 },
      uFlare: { value: 0 },
      uAxis: { value: new THREE.Vector2() },
      uShoulder: { value: 0.85 },
      uPokes: { value: Array.from({ length: MAX_POKES }, () => new THREE.Vector4(0, 0, 0, -99)) },
      uPokeAmp: { value: new Array(MAX_POKES).fill(0) },
      uHover: { value: new THREE.Vector4(0, -9, 0, 0) },
      uGrab: { value: new THREE.Vector4(0, -9, 0, 0) },
      uGrabOff: { value: new THREE.Vector3() },
    };
    this.pokeIndex = 0;

    this.pointer = {
      nx: 0, ny: 0, inside: false, down: false, moved: 0,
      downT: 0, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0, dirty: false,
      mode: null, hoverKind: null,
    };
    this.grab = null;
    this.tagGrab = null;
    this.grabOffLocal = new THREE.Vector3();
    this.orbit = { az: 0, el: 0, vaz: 0, vel: 0 };
    this.parallax = { x: 0, y: 0 };
    this.cam = { az: -0.46, el: 0.07, d: 1, ty: 0.52, sx: 0 };
    this.frames = 0;
    this.thumbRequest = null;

    this._initRenderer();
    this._initScene();
    this._bindEvents();
  }

  /* ---------------------------------------------------------------- setup */
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.setClearColor(0xf1f0ec, 1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
  }

  _initScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.Fog(0xf1f0ec, 7, 16);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.38;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);
    this.camera.filmGauge = 35;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
  }

  async load(url) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await new Promise((res, rej) =>
      loader.load(url, res, (e) => e.total && this.onProgress(e.loaded / e.total), rej)
    );
    // canvas-drawn tags need the web fonts
    await Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 1500))]);

    let src;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', toFloatAttribute(src.geometry.attributes.position));
    geo.setAttribute('normal', toFloatAttribute(src.geometry.attributes.normal));
    geo.setAttribute('uv', src.geometry.attributes.uv);
    geo.setIndex(src.geometry.index);
    geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y, 0); // hem at y = 0
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const bb = geo.boundingBox;
    this.bounds = bb.clone();

    const sm = src.material;
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    [sm.map, sm.normalMap].forEach((t) => t && (t.anisotropy = aniso));
    const mat = new THREE.MeshPhysicalMaterial({
      map: sm.map,
      normalMap: sm.normalMap,
      normalScale: sm.normalScale.clone().multiplyScalar(1.1),
      roughness: 0.6,
      metalness: 0,
      sheen: 0.7,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0.16, 0.2, 0.36),
      specularIntensity: 0.55,
    });
    patchCloth(mat, this.uniforms);
    const shirt = new THREE.Mesh(geo, mat);
    shirt.castShadow = true;
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchCloth(depthMat, this.uniforms, true);
    shirt.customDepthMaterial = depthMat;
    this.shirt = shirt;

    /* ---------- dimensions (metres, hem at y = 0) */
    const cx = (bb.min.x + bb.max.x) / 2;
    const top = bb.max.y;
    const height = bb.max.y - bb.min.y;
    const zc = -0.035;
    const shY = height * 0.855;
    this.uniforms.uAxis.value.set(cx, zc);
    this.uniforms.uShoulder.value = shY;
    this.garmentHeight = height;

    const hookR = 0.03, wireR = 0.0036, armR = 0.012;
    const neckTop = top - 0.045;
    const hcY = top + 0.075;
    const pivot = new THREE.Vector3(cx, hcY + hookR - wireR - armR, zc);
    this.pivotLocal = pivot.clone();
    const WALL_Z = zc - 0.86;
    const FLOOR_Y = -0.92;
    this.WALL_Z = WALL_Z;

    /* ---------- materials */
    const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.1, metalness: 1 });
    const blackSteel = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.34, metalness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 0.3, metalness: 1 });
    const wood = new THREE.MeshPhysicalMaterial({
      map: woodTexture(this.renderer), roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.22,
    });

    /* ---------- hanger: walnut bar + chrome swivel hook */
    const halfW = (bb.max.x - bb.min.x) * 0.385;
    const barCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx - halfW, shY - 0.035, zc),
      new THREE.Vector3(cx - halfW * 0.55, shY + 0.012, zc),
      new THREE.Vector3(cx, neckTop - 0.03, zc),
      new THREE.Vector3(cx + halfW * 0.55, shY + 0.012, zc),
      new THREE.Vector3(cx + halfW, shY - 0.035, zc),
    ], false, 'centripetal');
    const bar = new THREE.Mesh(
      sweepGeometry(barCurve, 120, 18,
        (t) => 0.011 + 0.011 * Math.pow(Math.sin(Math.PI * t), 2),
        (t) => 0.0075 + 0.004 * Math.sin(Math.PI * t)),
      wood
    );
    bar.castShadow = true;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0095, 0.018, 20), chrome);
    nut.position.set(cx, neckTop - 0.012, zc);
    nut.castShadow = true;

    // the hook loop lies in the XY plane so it wraps the arm, which runs along Z
    const hookPts = [];
    for (let i = 0; i <= 6; i++) hookPts.push(new THREE.Vector3(cx, lerp(neckTop - 0.004, hcY - hookR, i / 6), zc));
    for (let i = 1; i <= 40; i++) {
      const t = -Math.PI / 2 + (i / 40) * (Math.PI * 1.78);
      hookPts.push(new THREE.Vector3(cx + Math.cos(t) * hookR, hcY + Math.sin(t) * hookR, zc));
    }
    const hook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 120, wireR, 10), chrome);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(wireR * 1.15, 12, 8), chrome);
    tip.position.copy(hookPts[hookPts.length - 1]);
    hook.castShadow = true;

    /* ---------- hierarchy: pivot (swing) -> [hook] + yaw (swivel) -> garment */
    this.pivot = new THREE.Group();
    this.pivot.position.copy(pivot);
    const hookGroup = new THREE.Group();
    hookGroup.position.copy(pivot).multiplyScalar(-1);
    hookGroup.add(hook, tip);
    this.yawGroup = new THREE.Group();
    this.garment = new THREE.Group();
    this.garment.position.copy(pivot).multiplyScalar(-1);
    this.garment.add(shirt, bar, nut);
    this.yawGroup.add(this.garment);
    this.pivot.add(hookGroup, this.yawGroup);
    this.scene.add(this.pivot);

    /* ---------- the long wall-mounted arm */
    const armLen = pivot.z - WALL_Z + 0.08;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR, armLen, 24), blackSteel);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(pivot.x, pivot.y, WALL_Z + armLen / 2);
    const endBall = new THREE.Mesh(new THREE.SphereGeometry(armR * 1.7, 24, 16), blackSteel);
    endBall.position.set(pivot.x, pivot.y, WALL_Z + armLen);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.26, 0.014), blackSteel);
    plate.position.set(pivot.x, pivot.y - 0.08, WALL_Z + 0.007);
    const strutA = new THREE.Vector3(pivot.x, pivot.y - 0.19, WALL_Z + 0.01);
    const strutB = new THREE.Vector3(pivot.x, pivot.y - armR * 0.6, WALL_Z + armLen * 0.45);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, strutA.distanceTo(strutB), 14), blackSteel);
    strut.position.copy(strutA).add(strutB).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(UP, V3().subVectors(strutB, strutA).normalize());
    [arm, endBall, plate, strut].forEach((m) => { m.castShadow = true; this.scene.add(m); });

    /* ---------- room */
    const wallTex = plasterTexture(this.renderer, '#ecebe7', 0.012, 3);
    wallTex.repeat.set(8, 3);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
    wall.position.set(0, FLOOR_Y + 3, WALL_Z);
    wall.receiveShadow = true;
    const floorTex = plasterTexture(this.renderer, '#dedcd6', 0.02, 8);
    floorTex.repeat.set(6, 3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, WALL_Z + 4);
    floor.receiveShadow = true;
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(16, 0.09, 0.018), new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.8 }));
    skirting.position.set(0, FLOOR_Y + 0.045, WALL_Z + 0.009);
    skirting.receiveShadow = true;
    this.scene.add(wall, floor, skirting);

    /* ---------- paintings */
    const hang = (canvasArt, w, h, style, x, yCenter, light = true) => {
      const art = framedArt(this.renderer, canvasArt, w, h, style);
      art.position.set(x, yCenter, WALL_Z);
      this.scene.add(art);
      if (light) {
        const pl = pictureLight(Math.min(0.5, w * 0.55));
        pl.position.set(x, yCenter + h / 2 + (style === 'wrap' ? 0.03 : 0.1), WALL_Z);
        pl.traverse((o) => o.isMesh && (o.castShadow = true));
        this.scene.add(pl);
      }
    };
    hang(paintEnso(), 1.0, 1.28, 'wrap', 2.0, 0.66);
    hang(paintField(), 0.44, 0.56, 'black', 3.05, 0.86);
    hang(paintGeo(), 0.38, 0.38, 'oak', 3.05, 0.2, false);
    hang(paintFlow(), 0.7, 0.9, 'oak', -2.05, 0.68);
    hang(paintField(29), 0.5, 0.64, 'wrap', -3.05, 0.6);

    /* ---------- hang tags on a brass peg */
    const pegPos = new THREE.Vector3(pivot.x + 1.0, pivot.y - 0.12, WALL_Z);
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 16), brass);
    peg.rotation.x = Math.PI / 2;
    peg.position.copy(pegPos).add(new THREE.Vector3(0, 0, 0.025));
    const pegCap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 20), brass);
    pegCap.rotation.x = Math.PI / 2;
    pegCap.position.copy(pegPos).add(new THREE.Vector3(0, 0, 0.05));
    peg.castShadow = pegCap.castShadow = true;
    this.scene.add(peg, pegCap);

    const priceTex = tagTexture(this.renderer, 'price', { price: this.priceLabel || '', currency: this.currencyLabel || '' });
    const brandTex = tagTexture(this.renderer, 'brand');
    const addTag = (opts) => {
      const t = new HangTag({ ...opts, wallZ: WALL_Z });
      this.scene.add(t.group, t.line);
      this.tags.push(t);
    };
    addTag({ id: 'brand', anchor: pegPos.clone().add(new THREE.Vector3(-0.006, 0, 0.044)), length: 0.1, width: 0.1, height: 0.19, front: brandTex, back: brandTex });
    addTag({ id: 'price', anchor: pegPos.clone().add(new THREE.Vector3(0.006, 0, 0.046)), length: 0.22, width: 0.11, height: 0.205, front: priceTex, back: priceTex });
    this.tagMeshes = this.tags.flatMap((t) => [t.front, t.back]);

    /* ---------- lights: one gallery spot that throws the shirt's shadow on the wall */
    // front-left key: the camera also sits front-left, so the shadow peeks out just behind/below the shirt
    const hemi = new THREE.HemisphereLight(0xffffff, 0xdcd9d2, 0.42);
    const key = new THREE.SpotLight(0xffffff, 3.2, 0, 0.5, 0.75, 0);
    key.position.set(-0.7, 2.1, 3.1);
    key.target.position.set(cx, 0.4, WALL_Z);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1.5;
    key.shadow.camera.far = 7;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.01;
    key.shadow.autoUpdate = false;
    this.key = key;
    const fill = new THREE.DirectionalLight(0xf4f5ff, 0.4);
    fill.position.set(3, 1.2, 2.5);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(1.5, 2.5, -0.2);
    this.scene.add(hemi, key, key.target, fill, rim);

    this.center = new THREE.Vector3(cx, 0, zc);
    this._resize();
    this.renderer.compile(this.scene, this.camera);
    this.ready = true;
    const buildBVH = () => geo.computeBoundsTree({ maxLeafTris: 12 });
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(buildBVH, { timeout: 1500 });
  }

  /* ---------------------------------------------------------------- public API */
  setPriceLabel(price, currency) { this.priceLabel = price; this.currencyLabel = currency; }
  intro() { this.introStart = this.time; this.state.drop = 1; }
  setActive(v) { if (v !== this.active) { this.active = v; if (v) this.clock.getDelta(); } }
  setStory(v) { this.story = v; }
  spin(power = 7) { this.state.yawV += power; this.state.swZV += 0.15; this._touch(); }
  getFacingDeg() {
    const deg = ((this.state.yaw - this.cam.az) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
  captureThumb(w = 360, h = 440) { return new Promise((resolve) => { this.thumbRequest = { w, h, resolve }; }); }
  get hud() { return { facing: this.getFacingDeg(), swing: (this.state.swZ * 180) / Math.PI }; }

  /* ---------------------------------------------------------------- input */
  _touch() { this.lastInteraction = this.time; }

  _setRay() {
    this.raycaster.setFromCamera({ x: this.pointer.nx, y: this.pointer.ny }, this.camera);
    return this.raycaster.ray;
  }

  _pick() {
    if (!this.ready) return null;
    this._setRay();
    const tagHit = this.raycaster.intersectObjects(this.tagMeshes, false)[0];
    let shirtHit = null;
    if (this.shirt.geometry.boundsTree) shirtHit = this.raycaster.intersectObject(this.shirt, false)[0] || null;
    if (tagHit && (!shirtHit || tagHit.distance < shirtHit.distance)) return { kind: 'tag', hit: tagHit, tag: tagHit.object.userData.tag };
    if (shirtHit) return { kind: 'shirt', hit: shirtHit };
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
      if (pick?.kind === 'shirt') {
        this.grab = {
          local: this.shirt.worldToLocal(pick.hit.point.clone()),
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(facing, pick.hit.point),
          target: pick.hit.point.clone(),
          prevG: pick.hit.point.clone(),
        };
      } else if (pick?.kind === 'tag') {
        this.tagGrab = {
          tag: pick.tag,
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(facing, pick.hit.point),
          offset: V3().subVectors(pick.tag.end, pick.hit.point),
        };
        this.tagTarget = pick.tag.end.clone();
      }
      c.setPointerCapture(e.pointerId);
      this.onHover(p.hoverKind, p.mode);
      this._touch();
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
        this.orbit.az = clamp(this.orbit.az - dx * 0.0032, -0.55, 0.85);
        this.orbit.el = clamp(this.orbit.el + dy * 0.0022, -0.1, 0.32);
        this.orbit.vaz = -p.vx * 0.0032;
        this.orbit.vel = p.vy * 0.0022;
      }
      this._touch();
    });

    const end = (e) => {
      if (!p.down) return;
      p.down = false;
      document.body.classList.remove('is-dragging');
      const quick = performance.now() - p.downT < 320 && p.moved < 7;
      if (quick && e.type === 'pointerup') {
        if (p.mode === 'shirt') this._poke();
        if (p.mode === 'tag' && this.tagGrab) {
          const t = this.tagGrab.tag;
          t.impulse(new THREE.Vector3((Math.random() - 0.5) * 0.01, 0.004, 0.012));
          t.phiV += (Math.random() > 0.5 ? 1 : -1) * 9;
          this.onTag(t.id, e.clientX, e.clientY);
        }
      }
      this.grab = null;
      this.tagGrab = null;
      p.mode = null;
      p.dirty = true;
      this.onHover(p.hoverKind, null);
      this._touch();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    // touch: a finger that lands on the shirt or a tag grabs it; anywhere else still scrolls the page
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

    c.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return; // plain wheel scrolls the page; pinch / ctrl+wheel zooms
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.01), 0.4, 1.2);
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.zoom = this.zoom < 0.8 ? 1 : 0.5; });
    document.addEventListener('visibilitychange', () => this.clock.getDelta());
  }

  _poke() {
    this._setRay();
    if (!this.shirt.geometry.boundsTree) return;
    const hit = this.raycaster.intersectObject(this.shirt, false)[0];
    if (!hit) return;
    const local = this.shirt.worldToLocal(hit.point.clone());
    const i = this.pokeIndex++ % MAX_POKES;
    this.uniforms.uPokes.value[i].set(local.x, local.y, local.z, this.time);
    this.uniforms.uPokeAmp.value[i] = 1;
    const d = this.raycaster.ray.direction;
    const lever = clamp((this.pivot.position.y - hit.point.y) / this.garmentHeight, 0.1, 1.1);
    const s = this.state;
    s.swXV += -d.z * 0.7 * lever;
    s.swZV += d.x * 0.7 * lever;
    s.bendV.x += d.x * 0.25 * lever;
    s.bendV.y += d.z * 0.25 * lever;
    const rx = hit.point.x - this.pivot.position.x, rz = hit.point.z - this.pivot.position.z;
    s.yawV += (rz * d.x - rx * d.z) * 6;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.vw = w; this.vh = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.mobile = w < 820;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- physics */
  _rotation(out) {
    const s = this.state;
    const qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.swX, 0, s.swZ, 'XYZ'));
    const qy = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw);
    return out.copy(qs).multiply(qy);
  }

  _step(dt) {
    const s = this.state;
    const t = this.time;
    const idle = t - this.lastInteraction;
    s.prevYawV = s.yawV;

    // torque from the hand: a spring between the grabbed point and the cursor
    let tx = 0, ty = 0, tz = 0;
    if (this.grab) {
      const R = this._rotation(new THREE.Quaternion());
      const r = this.grab.local.clone().sub(this.pivotLocal).applyQuaternion(R);
      const G = r.clone().add(this.pivot.position);
      const v = V3().subVectors(G, this.grab.prevG).divideScalar(dt);
      this.grab.prevG.copy(G);
      const F = V3().subVectors(this.grab.target, G).multiplyScalar(95).addScaledVector(v, -7);
      if (F.length() > 45) F.setLength(45);
      const tau = V3().crossVectors(r, F);
      tx = tau.x; ty = tau.y; tz = tau.z;
      // the fabric itself stretches toward the cursor (expressed in mesh space)
      const off = V3().subVectors(this.grab.target, G);
      if (off.length() > 0.09) off.setLength(0.09);
      this.grabOffLocal.copy(off.multiplyScalar(0.7).applyQuaternion(R.invert()));
    }

    // yaw: free swivel with friction; when idle it settles to the chapter's angle
    s.yawV += (ty / 0.32) * dt;
    s.yawV *= Math.exp(-(this.grab ? 2.2 : 0.75) * dt);
    const home = CHAPTER_YAW[Math.round(clamp(this.story, 0, CHAPTER_YAW.length - 1))];
    if (home !== null && !this.grab && idle > 2.2) {
      const tgt = home + Math.round((s.yaw - home) / TAU) * TAU;
      s.yawV += (5.5 * (tgt - s.yaw) - 3.6 * s.yawV) * dt;
    }
    s.yaw += s.yawV * dt;
    const yawAcc = (s.yawV - s.prevYawV) / dt;

    // the cloth below the shoulders lags behind the spin
    s.twistV += (-95 * s.twist - 4.2 * s.twistV - clamp(yawAcc, -60, 60) * 0.85) * dt;
    s.twist = clamp(s.twist + s.twistV * dt, -0.55, 0.55);

    // pendulum on the arm: rocking around the arm (Z) is free, toward/away from the wall is stiffer
    const gL = 21;
    const gust = (Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.9 + 1.3) * 0.4) * s.wind;
    s.swZV += (-gL * Math.sin(s.swZ) - 0.5 * s.swZV + tz + gust * 0.5) * dt;
    s.swXV += (-gL * 1.5 * Math.sin(s.swX) - 1.1 * s.swXV + tx + gust * 0.3) * dt;
    s.swZ = clamp(s.swZ + s.swZV * dt, -0.75, 0.75);
    s.swX = clamp(s.swX + s.swXV * dt, -0.5, 0.5);

    // hem lag, driven by the acceleration of the hem
    const L = 0.9;
    const hemVx = L * s.swZV, hemVz = -L * s.swXV;
    const ax = (hemVx - s.prevHem.x) / dt, az = (hemVz - s.prevHem.y) / dt;
    s.prevHem.set(hemVx, hemVz);
    s.bendV.x += (-100 * s.bend.x - 3.4 * s.bendV.x - clamp(ax, -30, 30) * 0.55 + gust * 0.1) * dt;
    s.bendV.y += (-100 * s.bend.y - 3.4 * s.bendV.y - clamp(az, -30, 30) * 0.55 + gust * 0.2) * dt;
    s.bend.x = clamp(s.bend.x + s.bendV.x * dt, -0.14, 0.14);
    s.bend.y = clamp(s.bend.y + s.bendV.y * dt, -0.14, 0.14);

    for (const tag of this.tags) {
      tag.grab = this.tagGrab && this.tagGrab.tag === tag ? this.tagTarget : null;
      tag.step(dt);
    }
  }

  _pointerForces(dt) {
    const p = this.pointer;
    const s = this.state;
    if (p.down || !p.inside) return;
    const worldPerPx = (2 * this.camDist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.vh;
    const right = V3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const vx = clamp(p.vx * worldPerPx, -3, 3);
    const vy = clamp(-p.vy * worldPerPx, -3, 3);
    if (p.hoverKind === 'shirt') {
      // sweeping across the cloth pushes air into it
      s.bendV.x += right.x * vx * 3.2 * dt;
      s.bendV.y += right.z * vx * 3.2 * dt;
      s.yawV += vx * 0.08 * dt;
      s.swZV += right.x * vx * 0.6 * dt;
    }
    this._setRay();
    for (const tag of this.tags) {
      const d = this.raycaster.ray.distanceToPoint(tag.group.position);
      if (d < 0.09 && Math.abs(vx) + Math.abs(vy) > 0.05) {
        const k = (1 - d / 0.09) * dt * 0.22;
        tag.impulse(V3().copy(right).multiplyScalar(vx * k).add(new THREE.Vector3(0, vy * k * 0.4, Math.abs(vx) * k * 0.5)));
        tag.phiV += vx * 70 * (1 - d / 0.09) * dt;
      }
    }
    p.vx *= Math.exp(-10 * dt);
    p.vy *= Math.exp(-10 * dt);
  }

  /* ---------------------------------------------------------------- frame */
  update() {
    if (!this.ready || !this.active || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.time += dt;
    const s = this.state;

    if (this.introStart !== undefined) {
      const k = clamp((this.time - this.introStart) / 1.6, 0, 1);
      const prev = s.drop;
      s.drop = 1 - easeOutCubic(k);
      if (prev > 0 && s.drop === 0) { s.swZV += 0.9; s.bendV.x -= 0.3; }
    }

    // drag targets follow the pointer
    if (this.grab || this.tagGrab) {
      this._setRay();
      if (this.grab) this.raycaster.ray.intersectPlane(this.grab.plane, this.grab.target);
      if (this.tagGrab) {
        const hp = V3();
        if (this.raycaster.ray.intersectPlane(this.tagGrab.plane, hp)) {
          this.tagTarget = hp.add(this.tagGrab.offset);
          this.tagTarget.z = Math.max(this.tagTarget.z, this.WALL_Z + 0.01);
        }
      }
    }

    // physics @ 120 Hz
    this.acc = (this.acc || 0) + dt;
    const h = 1 / 120;
    let n = 0;
    while (this.acc >= h && n < 8) { this._step(h); this.acc -= h; n++; }

    s.wind = damp(s.wind, 0.2, 1.5, dt);
    s.flare = damp(s.flare, clamp(s.yawV * s.yawV * 0.006, 0, 0.07), 6, dt);
    s.grabW = damp(s.grabW, this.grab ? 1 : 0, this.grab ? 14 : 5, dt);

    // hover (one raycast per frame, only when the pointer moved)
    const p = this.pointer;
    if (p.dirty && p.inside && !p.down) {
      p.dirty = false;
      const pick = this._pick();
      const kind = pick ? (pick.kind === 'tag' ? `tag:${pick.tag.id}` : 'shirt') : null;
      if (pick?.kind === 'shirt') {
        const l = this.shirt.worldToLocal(pick.hit.point.clone());
        const hv = this.uniforms.uHover.value;
        hv.set(l.x, l.y, l.z, hv.w);
      }
      if (kind !== p.hoverKind) { p.hoverKind = kind; this.onHover(kind, null); }
    }
    s.hover = damp(s.hover, p.hoverKind === 'shirt' && !p.down ? 1 : 0, 8, dt);
    this._pointerForces(dt);

    // transforms
    this.pivot.rotation.set(s.swX, 0, s.swZ);
    this.pivot.position.set(this.pivotLocal.x, this.pivotLocal.y + s.drop * 1.1, this.pivotLocal.z);
    this.yawGroup.rotation.y = s.yaw;
    const bl = new THREE.Vector3(s.bend.x, 0, s.bend.y).applyAxisAngle(UP, -s.yaw);

    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uTwist.value = s.twist;
    u.uBend.value.set(bl.x, bl.z);
    u.uWind.value = s.wind;
    u.uFlare.value = s.flare;
    u.uHover.value.w = s.hover;
    if (this.grab) u.uGrab.value.set(this.grab.local.x, this.grab.local.y, this.grab.local.z, s.grabW);
    else u.uGrab.value.w = s.grabW;
    u.uGrabOff.value.lerp(this.grab ? this.grabOffLocal : V3(), 1 - Math.exp(-12 * dt));
    for (let i = 0; i < MAX_POKES; i++) if (this.time - u.uPokes.value[i].w > 3.2) u.uPokeAmp.value[i] = 0;

    for (const tag of this.tags) tag.sync();
    if ((this.frames & 1) === 0 || this.grab) this.key.shadow.needsUpdate = true;

    this._updateCamera(dt);
    if (this.thumbRequest) this._renderThumb();
    this.renderer.render(this.scene, this.camera);
    this._adaptQuality(dt);
  }

  _fitDistance() {
    const H = this.pivotLocal.y + 0.06;
    const halfFov = (this.camera.fov * Math.PI) / 360;
    const fill = this.mobile ? 0.58 : 0.66;
    const byH = (H / 2 / fill) / Math.tan(halfFov);
    const W = (this.bounds.max.x - this.bounds.min.x) + 0.2;
    const byW = (W / 2 / 0.86) / (Math.tan(halfFov) * this.camera.aspect);
    return Math.max(byH, byW);
  }

  _updateCamera(dt) {
    const shots = this.mobile ? MOBILE_SHOTS : DESKTOP_SHOTS;
    const v = clamp(this.story, 0, shots.length - 1);
    const i = Math.min(Math.floor(v), shots.length - 2);
    const f = smooth(clamp(v - i, 0, 1));
    const a = shots[i], b = shots[i + 1];

    // free look: inertia after release; scrolling eases it back to the composed shot
    const ds = Math.abs(this.story - this.prevStory);
    this.prevStory = this.story;
    const o = this.orbit;
    if (!this.pointer.down) {
      o.az += o.vaz * dt; o.el += o.vel * dt;
      o.vaz *= Math.exp(-4 * dt); o.vel *= Math.exp(-4 * dt);
      const relax = Math.exp(-ds * 4);
      o.az = clamp(o.az * relax, -0.55, 0.85);
      o.el = clamp(o.el * relax, -0.1, 0.32);
    }
    this.parallax.x = damp(this.parallax.x, this.pointer.inside ? this.pointer.nx : 0, 2.5, dt);
    this.parallax.y = damp(this.parallax.y, this.pointer.inside ? this.pointer.ny : 0, 2.5, dt);

    const c = this.cam;
    const k = 5.5;
    c.az = damp(c.az, lerp(a.az, b.az, f) + o.az + this.parallax.x * 0.035, k, dt);
    c.el = damp(c.el, lerp(a.el, b.el, f) + o.el - this.parallax.y * 0.02, k, dt);
    c.d = damp(c.d, lerp(a.d, b.d, f) * this.zoom, k, dt);
    c.ty = damp(c.ty, lerp(a.ty, b.ty, f), k, dt);
    c.sx = damp(c.sx, lerp(a.sx, b.sx, f), k, dt);

    const dist = this._fitDistance() * c.d;
    this.camDist = dist;
    const cam = this.camera;
    const target = new THREE.Vector3(this.center.x, c.ty, this.center.z);
    cam.position.set(
      target.x + Math.sin(c.az) * Math.cos(c.el) * dist,
      target.y + Math.sin(c.el) * dist,
      target.z + Math.cos(c.az) * Math.cos(c.el) * dist
    );
    cam.lookAt(target);
    const halfTan = Math.tan((cam.fov * Math.PI) / 360);
    const filmW = cam.filmGauge * Math.min(cam.aspect, 1);
    cam.filmOffset = -c.sx * 2 * halfTan * cam.aspect * filmW;
    cam.updateProjectionMatrix();
  }

  _renderThumb() {
    const { w, h, resolve } = this.thumbRequest;
    this.thumbRequest = null;
    const cam = this.camera.clone();
    cam.filmOffset = 0;
    const H = this.pivotLocal.y + 0.1;
    const halfFov = (cam.fov * Math.PI) / 360;
    const d = (H / 2 / 0.86) / Math.tan(halfFov);
    const tgt = new THREE.Vector3(this.center.x, H / 2 - 0.04, this.center.z);
    cam.position.set(tgt.x - Math.sin(0.3) * d, tgt.y + 0.08, tgt.z + Math.cos(0.3) * d);
    cam.lookAt(tgt);
    cam.updateProjectionMatrix();
    this.renderer.render(this.scene, cam);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    const src = this.renderer.domElement;
    const sh = src.height, sw = sh * (w / h);
    g.drawImage(src, (src.width - sw) / 2, 0, sw, sh, 0, 0, w, h);
    resolve(out.toDataURL('image/jpeg', 0.86));
  }

  _adaptQuality(dt) {
    this.frames++;
    this.ftAcc = (this.ftAcc || 0) + dt;
    if (this.frames % 90 !== 0) return;
    const avg = this.ftAcc / 90;
    this.ftAcc = 0;
    // only ever step down, so quality never oscillates
    if (avg > 1 / 45 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this._resize();
    } else if (avg > 1 / 45 && this.key.shadow.mapSize.x > 512) {
      this.key.shadow.mapSize.set(512, 512);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
  }
}
