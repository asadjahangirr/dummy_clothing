/**
 * Shirts on a ceiling-hung rail.
 *
 * Every hanger is simulated as a rigid body on the rail:
 *   • the hook is a slider on the rail with static + kinetic (Coulomb) friction,
 *   • the garment is a physical pendulum hanging from that slider (cart–pendulum, solved as a
 *     coupled 2×2 system every step, so sliding the hook makes the shirt lag and swing, and a
 *     swinging shirt tugs the hook),
 *   • it also rocks around the rail axis (and bounces off the back wall), and swivels on its hook.
 * Hangers collide with each other (wooden bars: hard contact with restitution) and the fabric
 * bodies push each other softly. Rail end-stops are rubber.
 *
 * The cloth itself (twist lag, hem lag, flare, ripples, the dent where you grab it) is a
 * vertex-shader deformation driven by those rigid-body states.
 */
import * as THREE from 'three';

const MAX_POKES = 4;
const TAU = Math.PI * 2;
const G = 9.81;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// scratch objects for the hot paths (physics runs ~120×/s per hanger: no allocations there)
const _qs = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'XYZ');
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _zero = new THREE.Vector3();

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
uniform vec4  uGrab;
uniform vec3  uGrabOff;
uniform float uPhase;

float clothW(float y) { return clamp((uShoulder - y) / uShoulder, 0.0, 1.0); }

float clothField(vec3 p) {
  float w = clothW(p.y);
  float m = smoothstep(0.0, 0.10, w);
  float t = uTime + uPhase;
  float f = 0.0;
  float wa = (0.0011 + 0.0045 * uWind) * w;
  f += wa        * sin(p.x * 16.0 + p.y * 9.0  - t * (1.3 + 2.4 * uWind));
  f += wa * 0.7  * sin(p.z * 21.0 - p.y * 14.0 + p.x * 6.0 + t * (1.0 + 2.0 * uWind));
  f += wa * 0.35 * sin(p.y * 36.0 + p.x * 23.0 - t * (2.2 + 3.2 * uWind));
  for (int i = 0; i < ${MAX_POKES}; i++) {
    float age = uTime - uPokes[i].w;
    float amp = uPokeAmp[i] * step(0.0, age) * (1.0 - step(3.2, age));
    if (amp <= 0.0) continue;
    vec3 dv = p - uPokes[i].xyz;
    float r2 = dot(dv, dv);
    float r = sqrt(r2);
    float a = age / 0.07;
    float dent = -0.021 * exp(-r2 * 340.0) * a * exp(1.0 - a);
    float front = 1.0 - smoothstep(age * 0.26 - 0.02, age * 0.26 + 0.03, r);
    float wave = 0.0052 * sin(r * 78.0 - age * 17.0) * exp(-age * 1.5) * exp(-r * 6.8) * front * smoothstep(0.0, 0.08, age);
    f += amp * m * (dent + wave);
  }
  vec3 dh = p - uHover.xyz;
  f += -0.0075 * uHover.w * m * exp(-dot(dh, dh) * 260.0);
  return f;
}

void clothDeform(vec3 p, vec3 n, out vec3 op, out vec3 on) {
  float f0 = clothField(p);
#ifdef CLOTH_DEPTH
  vec3 nn = n;
#else
  const float e = 0.003;
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

  vec3 dg = p - uGrab.xyz;
  float gm = uGrab.w * exp(-dot(dg, dg) * 50.0) * smoothstep(0.0, 0.08, w);
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
  material.customProgramCacheKey = () => (depth ? 'cloth-depth-v3' : 'cloth-v3');
}

/* ================================================================ geometry helpers */
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

/* ================================================================ hang tag (verlet string + card) */
export class HangTag {
  constructor({ length, segs = 6, width, height, texture }) {
    this.segs = segs;
    this.seg = length / segs;
    this.w = width; this.h = height;
    this.anchor = V3();
    this.pts = [];
    for (let i = 0; i <= segs; i++) this.pts.push({ p: V3(), q: V3() });
    this.phi = 0; this.phiV = 0;
    this.grab = null;
    this.facing = new THREE.Vector3(0, 0, 1);
    // collision plane (the shirt front): points must stay on the +normal side within the shirt's span
    this.plane = { o: V3(), n: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), halfW: 0, minD: 0, top: 0, bottom: 0, active: false };

    this.group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(width, height);
    geo.translate(0, -height / 2 + height * 0.06, 0);
    const mat = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.5, roughness: 0.78, side: THREE.DoubleSide });
    this.card = new THREE.Mesh(geo, mat);
    this.card.castShadow = true;
    this.card.userData.tag = this;
    this.group.add(this.card);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x18181a }));
    this.line.frustumCulled = false;
  }

  get end() { return this.pts[this.segs].p; }

  reset(anchor) {
    this.anchor.copy(anchor);
    this.pts.forEach((pt, i) => { pt.p.copy(anchor).add(new THREE.Vector3(0, -i * this.seg, 0.002 * i)); pt.q.copy(pt.p); });
  }

  impulse(v) {
    for (let i = Math.floor(this.segs / 2); i <= this.segs; i++) this.pts[i].q.addScaledVector(v, -i / this.segs);
  }

  step(dt) {
    const g = -G * dt * dt;
    const P = this.pts;
    P[0].p.copy(this.anchor); P[0].q.copy(this.anchor);
    // verlet with air drag
    for (let i = 1; i < P.length; i++) {
      const pt = P[i];
      const vx = (pt.p.x - pt.q.x) * 0.993, vy = (pt.p.y - pt.q.y) * 0.993, vz = (pt.p.z - pt.q.z) * 0.993;
      pt.q.copy(pt.p);
      pt.p.x += vx; pt.p.y += vy + g; pt.p.z += vz;
    }
    if (this.grab) P[P.length - 1].p.lerp(this.grab, 0.35);
    const d = _a;
    const pl = this.plane;
    const rel = _b;
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i].p, b = P[i + 1].p;
        d.subVectors(b, a);
        const len = d.length() || 1e-6;
        const diff = (len - this.seg) / len;
        if (i === 0) b.addScaledVector(d, -diff);
        else { a.addScaledVector(d, diff * 0.5); b.addScaledVector(d, -diff * 0.5); }
      }
      // the shirt front: the string and card rest on the fabric instead of sinking into it
      if (pl.active) {
        for (let i = 1; i < P.length; i++) {
          const pt = P[i];
          rel.subVectors(pt.p, pl.o);
          if (Math.abs(rel.dot(pl.side)) > pl.halfW || rel.y > pl.top || rel.y < pl.bottom) continue;
          const minD = pl.minD + (i === P.length - 1 ? Math.abs(Math.sin(this.phi)) * this.w * 0.5 : 0);
          const dist = rel.dot(pl.n);
          if (dist < minD) {
            pt.p.addScaledVector(pl.n, minD - dist);
            // fabric friction: kill most of the normal and some tangential velocity
            const v = _c.subVectors(pt.p, pt.q);
            const vn = v.dot(pl.n);
            if (vn < 0) v.addScaledVector(pl.n, -vn * 1.3);
            v.multiplyScalar(0.92);
            pt.q.subVectors(pt.p, v);
          }
        }
      }
    }
    // the card twists on its string and springs back to face the room
    this.phiV += (-14 * this.phi - 1.6 * this.phiV) * dt;
    this.phi = clamp(this.phi + this.phiV * dt, -2.6, 2.6);
  }

  sync() {
    const P = this.pts;
    const e = P[P.length - 1].p, pr = P[P.length - 2].p;
    const Y = _a.subVectors(pr, e).normalize();
    const Z0 = _b.copy(this.facing);
    Z0.addScaledVector(Y, -Z0.dot(Y)).normalize();
    Z0.applyAxisAngle(Y, this.phi);
    const X = _c.crossVectors(Y, Z0).normalize();
    this.group.quaternion.setFromRotationMatrix(_m4.makeBasis(X, Y, Z0));
    this.group.position.copy(e);
    const arr = this.line.geometry.attributes.position.array;
    P.forEach((pt, i) => { arr[i * 3] = pt.p.x; arr[i * 3 + 1] = pt.p.y; arr[i * 3 + 2] = pt.p.z; });
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}

/* ================================================================ one hanger + shirt */
const M_HOOK = 0.035;     // kg, the swivel hook / slider
const M_GARMENT = 0.32;   // kg, shirt + wooden hanger
const MU_S = 0.4, MU_K = 0.3; // chrome hook on a powder-coated rail

export class ShirtRig {
  /**
   * @param {object} o
   * @param {THREE.BufferGeometry} o.geo   shared shirt geometry (hem at y = 0, metres)
   * @param {THREE.Material} o.source      source material (maps)
   * @param {object} o.parts               shared hanger geometries/materials
   */
  constructor({ index, geo, source, parts, railX, railY, railZ, wallZ, priceTex }) {
    this.index = index;
    this.idleSince = 0;
    this.phase = index * 2.3;
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const height = bb.max.y - bb.min.y;
    const zc = (bb.min.z + bb.max.z) / 2 - 0.02;
    this.height = height;
    this.halfWidth = (bb.max.x - bb.min.x) / 2;

    this.uniforms = {
      uTime: { value: 0 },
      uPhase: { value: this.phase },
      uTwist: { value: 0 },
      uBend: { value: new THREE.Vector2() },
      uWind: { value: 0.15 },
      uFlare: { value: 0 },
      uAxis: { value: new THREE.Vector2(cx, zc) },
      uShoulder: { value: height * 0.855 },
      uPokes: { value: Array.from({ length: MAX_POKES }, () => new THREE.Vector4(0, 0, 0, -99)) },
      uPokeAmp: { value: new Array(MAX_POKES).fill(0) },
      uHover: { value: new THREE.Vector4(0, -9, 0, 0) },
      uGrab: { value: new THREE.Vector4(0, -9, 0, 0) },
      uGrabOff: { value: new THREE.Vector3() },
    };
    this.pokeIndex = 0;

    const mat = new THREE.MeshPhysicalMaterial({
      map: source.map,
      normalMap: source.normalMap,
      normalScale: source.normalScale.clone().multiplyScalar(1.15),
      roughness: 0.62,
      metalness: 0,
      sheen: 0.75,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0.16, 0.2, 0.36),
      specularIntensity: 0.5,
    });
    patchCloth(mat, this.uniforms);
    const shirt = new THREE.Mesh(geo, mat);
    shirt.castShadow = true;
    shirt.receiveShadow = true;
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchCloth(depthMat, this.uniforms, true);
    shirt.customDepthMaterial = depthMat;
    shirt.userData.rig = this;
    this.shirt = shirt;

    /* ---------- dimensions */
    const shY = height * 0.855;
    const top = bb.max.y;
    const neckTop = top - 0.036;
    const hookR = 0.026, wireR = 0.0032, railR = parts.railR;
    const hcY = top + 0.06;
    const pivot = new THREE.Vector3(cx, hcY + hookR - wireR - railR, zc);
    this.pivotLocal = pivot;
    this.halfBar = this.halfWidth * 0.77;
    // physical pendulum: centre of mass and moment of inertia about the hook
    this.L = pivot.y - height * 0.48;
    const k2 = (height * height) / 12;
    this.I = M_GARMENT * (this.L * this.L + k2);
    this.Iyaw = (M_GARMENT * ((2 * this.halfWidth) ** 2 + 0.1 ** 2)) / 12;
    this.Lhem = pivot.y;
    // the back wall stops a shirt that is swung too far toward it
    this.maxBack = Math.asin(clamp((railZ - wallZ - 0.09) / this.Lhem, 0.05, 0.99));

    /* ---------- hanger */
    const halfW = this.halfBar;
    const barCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx - halfW, shY - 0.028, zc),
      new THREE.Vector3(cx - halfW * 0.55, shY + 0.01, zc),
      new THREE.Vector3(cx, neckTop - 0.024, zc),
      new THREE.Vector3(cx + halfW * 0.55, shY + 0.01, zc),
      new THREE.Vector3(cx + halfW, shY - 0.028, zc),
    ], false, 'centripetal');
    const bar = new THREE.Mesh(
      sweepGeometry(barCurve, 120, 18,
        (t) => 0.009 + 0.009 * Math.pow(Math.sin(Math.PI * t), 2),
        (t) => 0.006 + 0.0032 * Math.sin(Math.PI * t)),
      parts.wood
    );
    bar.castShadow = true;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.0078, 0.015, 20), parts.chrome);
    nut.position.set(cx, neckTop - 0.01, zc);
    nut.castShadow = true;

    // hook loop in the YZ plane: it wraps the rail, which runs along X
    const hookPts = [];
    for (let i = 0; i <= 6; i++) hookPts.push(new THREE.Vector3(cx, lerp(neckTop - 0.004, hcY - hookR, i / 6), zc));
    for (let i = 1; i <= 40; i++) {
      const t = -Math.PI / 2 + (i / 40) * (Math.PI * 1.78);
      hookPts.push(new THREE.Vector3(cx, hcY + Math.sin(t) * hookR, zc + Math.cos(t) * hookR));
    }
    const hook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 120, wireR, 10), parts.chrome);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(wireR * 1.15, 12, 8), parts.chrome);
    tip.position.copy(hookPts[hookPts.length - 1]);
    hook.castShadow = true;

    /* ---------- hierarchy: root (on the rail) -> swing -> [hook] + yaw -> garment */
    this.root = new THREE.Group();
    this.swing = new THREE.Group();
    const hookGroup = new THREE.Group();
    hookGroup.position.copy(pivot).multiplyScalar(-1);
    hookGroup.add(hook, tip);
    this.yawGroup = new THREE.Group();
    this.garment = new THREE.Group();
    this.garment.position.copy(pivot).multiplyScalar(-1);
    this.garment.add(shirt, bar, nut);
    this.yawGroup.add(this.garment);
    this.swing.add(hookGroup, this.yawGroup);
    this.root.add(this.swing);
    this.rail = { y: railY, z: railZ };

    /* ---------- price tag hanging from the right end of the hanger */
    this.tagLocal = new THREE.Vector3(cx + halfW * 0.86, shY - 0.03, zc + 0.03);
    this.tag = new HangTag({ length: 0.13, width: 0.068, height: 0.125, texture: priceTex });
    this.tag.rig = this;
    this.frontLocal = { o: new THREE.Vector3(cx, 0, zc), depth: (bb.max.z - zc) };

    /* ---------- state */
    this.s = {
      x: railX, xv: 0,
      swZ: 0, swZV: 0,      // swing along the rail (about Z) — coupled with x
      swX: 0, swXV: 0,      // rocking about the rail axis (X)
      yaw: 0, yawV: 0, prevYawV: 0,
      twist: 0, twistV: 0,
      bend: new THREE.Vector2(), bendV: new THREE.Vector2(),
      prevHem: new THREE.Vector2(),
      flare: 0, wind: 0.15, hover: 0, grabW: 0,
      drop: 0,
    };
    this.ext = { qx: 0, qZ: 0, qX: 0, qY: 0, bendX: 0 }; // generalized forces from contacts
    this.grab = null;
    this.grabOffLocal = V3();
    this._q = new THREE.Quaternion();
    this._pw = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._F = new THREE.Vector3();
    this._bl = new THREE.Vector3();
    this._syncTransforms();
    this.tag.reset(this.worldPoint(this.tagLocal));
  }

  /* rotation of the garment relative to the rail */
  rotation(out) {
    const s = this.s;
    _qs.setFromEuler(_e.set(s.swX, 0, s.swZ));
    _qy.setFromAxisAngle(UP, s.yaw);
    return out.copy(_qs).multiply(_qy);
  }

  /** world position of the hook on the rail (a shared vector: read it, don't keep it) */
  get pivotWorld() { return this._pw.set(this.s.x, this.rail.y + this.s.drop, this.rail.z); }

  /** a point in shirt-mesh space -> world, from the rigid-body state (no matrix update needed) */
  worldPoint(local, out = V3()) {
    out.copy(local).sub(this.pivotLocal).applyQuaternion(this.rotation(this._q));
    return out.add(this.pivotWorld);
  }

  /** half extent of the hanger bar / fabric body along the rail at the current yaw */
  barHalfX() { const c = Math.abs(Math.cos(this.s.yaw)), s = Math.abs(Math.sin(this.s.yaw)); return this.halfBar * c + 0.012 * s + 0.012; }
  bodyHalfX() { const c = Math.abs(Math.cos(this.s.yaw)), s = Math.abs(Math.sin(this.s.yaw)); return this.halfWidth * 0.86 * c + 0.07 * s; }

  poke(hitPoint, dir, time) {
    const local = this.shirt.worldToLocal(hitPoint.clone());
    const i = this.pokeIndex++ % MAX_POKES;
    this.uniforms.uPokes.value[i].set(local.x, local.y, local.z, time);
    this.uniforms.uPokeAmp.value[i] = 1;
    // a tap is an impulse J at the hit point: Δω = (r × J) / I
    const J = dir.clone().multiplyScalar(0.07); // N·s
    const r = V3().subVectors(hitPoint, this.pivotWorld);
    const tau = V3().crossVectors(r, J);
    const s = this.s;
    s.swXV += tau.x / this.I;
    s.swZV += tau.z / this.I;
    s.yawV += clamp(tau.y / this.Iyaw, -6, 6);
    s.bendV.x += J.x * 3.2;
    s.bendV.y += J.z * 3.2;
    this.idleSince = time;
  }

  /* ---------------------------------------------------------------- one physics step */
  step(dt, time, homeYaw) {
    const s = this.s;
    s.prevYawV = s.yawV;
    const idle = time - this.idleSince;

    // the hand: a damped spring between the grabbed point and the cursor
    let Fx = 0, tX = 0, tY = 0, tZ = 0;
    if (this.grab) {
      const R = this.rotation(this._q);
      const r = this._r.copy(this.grab.local).sub(this.pivotLocal).applyQuaternion(R);
      const Gp = _a.copy(r).add(this.pivotWorld);
      const v = _b.subVectors(Gp, this.grab.prevG).divideScalar(dt);
      this.grab.prevG.copy(Gp);
      const F = this._F.subVectors(this.grab.target, Gp).multiplyScalar(11).addScaledVector(v, -0.9);
      if (F.length() > 4.5) F.setLength(4.5);
      const tau = _c.crossVectors(r, F);
      Fx = F.x; tX = tau.x; tY = tau.y; tZ = tau.z;
      const off = _d.subVectors(this.grab.target, Gp);
      if (off.length() > 0.07) off.setLength(0.07);
      this.grabOffLocal.copy(off.multiplyScalar(0.65).applyQuaternion(R.invert()));
      this.idleSince = time;
    }
    Fx += this.ext.qx; tZ += this.ext.qZ; tX += this.ext.qX; tY += this.ext.qY;

    const gust = (Math.sin(time * 0.7 + this.phase) * 0.6 + Math.sin(time * 1.9 + 1.3 + this.phase) * 0.4) * s.wind * 0.004;

    /* --- cart–pendulum along the rail (x, swZ) with Coulomb friction on the hook */
    const m = M_GARMENT, M = M_HOOK, L = this.L, I = this.I;
    const th = s.swZ, c = Math.cos(th), sn = Math.sin(th);
    // air drag on a broad piece of cloth: linear + quadratic in the angular speed
    const drag = (w) => 0.045 * w + 0.03 * w * Math.abs(w);
    const Qth = tZ + gust - drag(s.swZV) - m * G * L * sn;
    // the rail carries the hook's weight plus the vertical part of the garment's pull
    const N = M * G + m * (G * c + L * s.swZV * s.swZV) * c;
    const centri = m * L * sn * s.swZV * s.swZV;
    let a = 0, b;
    if (Math.abs(s.xv) < 1e-3) {
      // stuck? static friction must supply what the rest of the system demands
      b = Qth / I;
      const need = Fx + centri - m * L * c * b;
      if (Math.abs(need) <= MU_S * N) {
        s.xv = 0;
      } else {
        const f = MU_K * N * Math.sign(need);
        ({ a, b } = solve2(M + m, m * L * c, I, Fx + centri - f, Qth));
      }
    } else {
      const f = MU_K * N * Math.sign(s.xv) + 0.4 * s.xv;
      ({ a, b } = solve2(M + m, m * L * c, I, Fx + centri - f, Qth));
    }
    const xvPrev = s.xv;
    s.xv += a * dt;
    if (xvPrev !== 0 && Math.sign(s.xv) !== Math.sign(xvPrev) && Math.abs(Fx) < MU_S * N) s.xv = 0; // friction can't reverse motion
    s.x += s.xv * dt;
    s.swZV += b * dt;
    s.swZ += s.swZV * dt;
    if (Math.abs(s.swZ) > 1.2) { s.swZ = Math.sign(s.swZ) * 1.2; s.swZV *= -0.3; }

    /* --- rocking around the rail */
    s.swXV += ((tX + gust * 0.6 - drag(s.swXV) * 1.2 - m * G * L * Math.sin(s.swX)) / I) * dt;
    s.swX += s.swXV * dt;
    if (s.swX > this.maxBack) { // the hem hits the wall
      s.swX = this.maxBack;
      if (s.swXV > 0) { s.swXV *= -0.25; s.bendV.y += 0.6; }
    }
    if (s.swX < -1.1) { s.swX = -1.1; s.swXV *= -0.3; }

    /* --- swivel: friction in the hook + air drag on a broad, flat body */
    s.yawV += (tY / this.Iyaw) * dt;
    s.yawV -= (0.55 * s.yawV + 0.09 * s.yawV * Math.abs(s.yawV)) * dt;
    if (homeYaw !== null && !this.grab && idle > 3.2) {
      const tgt = homeYaw + Math.round((s.yaw - homeYaw) / TAU) * TAU;
      s.yawV += (3.2 * (tgt - s.yaw) - 2.6 * s.yawV) * dt;
    }
    s.yaw += s.yawV * dt;
    const yawAcc = (s.yawV - s.prevYawV) / dt;

    // the cloth below the shoulders lags behind the spin
    s.twistV += (-95 * s.twist - 4.2 * s.twistV - clamp(yawAcc, -60, 60) * 0.85) * dt;
    s.twist = clamp(s.twist + s.twistV * dt, -0.55, 0.55);

    // hem lag, driven by the acceleration of the hem (rail slide + swing)
    const hemVx = s.xv + this.Lhem * c * s.swZV;
    const hemVz = -this.Lhem * Math.cos(s.swX) * s.swXV;
    const ax = (hemVx - s.prevHem.x) / dt, az = (hemVz - s.prevHem.y) / dt;
    s.prevHem.set(hemVx, hemVz);
    s.bendV.x += (-100 * s.bend.x - 3.4 * s.bendV.x - clamp(ax, -30, 30) * 0.5 + this.ext.bendX) * dt;
    s.bendV.y += (-100 * s.bend.y - 3.4 * s.bendV.y - clamp(az, -30, 30) * 0.5 + gust * 25) * dt;
    s.bend.x = clamp(s.bend.x + s.bendV.x * dt, -0.12, 0.12);
    s.bend.y = clamp(s.bend.y + s.bendV.y * dt, -0.12, 0.12);

    this.ext.qx = this.ext.qZ = this.ext.qX = this.ext.qY = this.ext.bendX = 0;

    // tag
    this.worldPoint(this.tagLocal, this.tag.anchor);
    const R = this.rotation(this._q);
    this.tag.facing.set(0, 0, 1).applyQuaternion(R);
    const pl = this.tag.plane;
    pl.active = true;
    this.worldPoint(this.frontLocal.o, pl.o);
    pl.n.copy(this.tag.facing);
    pl.side.set(1, 0, 0).applyQuaternion(R);
    pl.halfW = this.halfWidth;
    pl.minD = this.frontLocal.depth * 0.75;
    pl.top = this.pivotLocal.y - 0.08;
    pl.bottom = -0.1;
    this.tag.step(dt);
  }

  /* ---------------------------------------------------------------- per frame */
  update(dt, time, hovered) {
    const s = this.s;
    s.wind = lerp(s.wind, 0.15, 1 - Math.exp(-1.5 * dt));
    s.flare = lerp(s.flare, clamp(s.yawV * s.yawV * 0.006, 0, 0.07), 1 - Math.exp(-6 * dt));
    s.grabW = lerp(s.grabW, this.grab ? 1 : 0, 1 - Math.exp(-(this.grab ? 14 : 5) * dt));
    s.hover = lerp(s.hover, hovered ? 1 : 0, 1 - Math.exp(-8 * dt));
    this._syncTransforms();
    const bl = this._bl.set(s.bend.x, 0, s.bend.y).applyAxisAngle(UP, -s.yaw);
    const u = this.uniforms;
    u.uTime.value = time;
    u.uTwist.value = s.twist;
    u.uBend.value.set(bl.x, bl.z);
    u.uWind.value = s.wind;
    u.uFlare.value = s.flare;
    u.uHover.value.w = s.hover;
    if (this.grab) u.uGrab.value.set(this.grab.local.x, this.grab.local.y, this.grab.local.z, s.grabW);
    else u.uGrab.value.w = s.grabW;
    u.uGrabOff.value.lerp(this.grab ? this.grabOffLocal : _zero, 1 - Math.exp(-12 * dt));
    for (let i = 0; i < MAX_POKES; i++) if (time - u.uPokes.value[i].w > 3.2) u.uPokeAmp.value[i] = 0;
    this.tag.sync();
  }

  _syncTransforms() {
    const s = this.s;
    this.root.position.copy(this.pivotWorld);
    this.swing.rotation.set(s.swX, 0, s.swZ);
    this.yawGroup.rotation.y = s.yaw;
  }

  /** speed of anything moving, used to decide whether shadows need re-rendering */
  get energy() {
    const s = this.s;
    return Math.abs(s.xv) + Math.abs(s.swZV) + Math.abs(s.swXV) + Math.abs(s.yawV) * 0.3 + Math.abs(s.bendV.x) + Math.abs(s.bendV.y) + (this.grab ? 1 : 0);
  }
}

const byX = (a, b) => a.s.x - b.s.x;

function solve2(a11, a12, a22, r1, r2) {
  const det = a11 * a22 - a12 * a12;
  return { a: (r1 * a22 - a12 * r2) / det, b: (a11 * r2 - a12 * r1) / det };
}

/* ================================================================ the rail */
export class Rail {
  constructor({ x0, x1, y, z, wallZ }) {
    Object.assign(this, { x0, x1, y, z, wallZ });
    this.rigs = [];
    this.onKnock = null;
  }

  add(rig) { this.rigs.push(rig); this.sorted = [...this.rigs]; }

  /** contacts between neighbouring hangers and with the end stops, then integrate */
  step(dt, time, homeYaw) {
    const rigs = this.sorted.sort(byX);
    for (let k = 0; k < rigs.length - 1; k++) {
      const A = rigs[k], B = rigs[k + 1];
      // 1) the fabric bodies (soft, at roughly half the garment height)
      const xa = A.s.x + A.L * Math.sin(A.s.swZ), xb = B.s.x + B.L * Math.sin(B.s.swZ);
      const pen = A.bodyHalfX() + B.bodyHalfX() - (xb - xa);
      if (pen > 0) {
        const va = A.s.xv + A.L * Math.cos(A.s.swZ) * A.s.swZV;
        const vb = B.s.xv + B.L * Math.cos(B.s.swZ) * B.s.swZV;
        const F = Math.max(0, 38 * pen + 1.6 * (va - vb)); // cloth is soft and lossy
        A.ext.qx -= F; A.ext.qZ -= F * A.L * Math.cos(A.s.swZ); A.ext.bendX -= F * 2.2;
        B.ext.qx += F; B.ext.qZ += F * B.L * Math.cos(B.s.swZ); B.ext.bendX += F * 2.2;
        // a glancing contact also turns them a little
        A.ext.qY += F * 0.02 * Math.sign(Math.sin(A.s.yaw) || 1);
        B.ext.qY -= F * 0.02 * Math.sign(Math.sin(B.s.yaw) || 1);
        A.idleSince = B.idleSince = Math.max(A.idleSince, B.idleSince, time - 2);
      }
    }
    for (const r of this.rigs) r.step(dt, time, homeYaw(r));

    // 2) the wooden hangers (hard contact, resolved on the hooks with restitution)
    for (let pass = 0; pass < 2; pass++) {
      const sorted = this.sorted.sort(byX);
      for (let k = 0; k < sorted.length - 1; k++) {
        const A = sorted[k], B = sorted[k + 1];
        const gap = (B.s.x - A.s.x) - (A.barHalfX() + B.barHalfX());
        if (gap < 0) {
          A.s.x += gap * 0.5; B.s.x -= gap * 0.5;
          const rel = B.s.xv - A.s.xv;
          if (rel < 0) {
            const e = 0.32;
            const j = -(1 + e) * rel / 2; // equal masses
            A.s.xv -= j; B.s.xv += j;
            if (this.onKnock && -rel > 0.12) this.onKnock(-rel);
          }
        }
      }
      // rubber end stops
      for (const r of this.rigs) {
        const lo = this.x0 + 0.05 + r.barHalfX(), hi = this.x1 - 0.05 - r.barHalfX();
        if (r.s.x < lo) { r.s.x = lo; if (r.s.xv < 0) r.s.xv *= -0.4; }
        if (r.s.x > hi) { r.s.x = hi; if (r.s.xv > 0) r.s.xv *= -0.4; }
      }
    }
  }
}
