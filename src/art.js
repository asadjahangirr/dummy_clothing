/**
 * Original generative artworks for the gallery wall.
 * Everything is painted at runtime on <canvas>, so there are no image downloads.
 */
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

/** paper / linen grain over whatever is already painted */
function grain(g, w, h, amount = 10, seed = 1, weave = true) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  if (!weave) return;
  // faint woven texture
  g.globalAlpha = 0.035;
  g.strokeStyle = '#000';
  g.lineWidth = 1;
  for (let y = 0; y < h; y += 3) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
  for (let x = 0; x < w; x += 3) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
  g.globalAlpha = 1;
}

function toTexture(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/* ---------------------------------------------------------------- I. Ensō (sumi ink) */
export function paintEnso(seed = 7) {
  const w = 1024, h = 1312;
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  g.fillStyle = '#efebe2';
  g.fillRect(0, 0, w, h);
  // paper fibres
  g.strokeStyle = 'rgba(120,100,70,0.06)';
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, l = 10 + r() * 40, a = r() * Math.PI;
    g.lineWidth = 0.6 + r();
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }

  const cx = w * 0.5, cy = h * 0.44, R = w * 0.31;
  const a0 = -Math.PI * 0.62;
  const sweep = Math.PI * 1.84;
  const W = w * 0.085;
  const bristles = 90;
  g.lineCap = 'round';
  g.shadowColor = 'rgba(10,10,12,0.35)';
  g.shadowBlur = 2.5;
  for (let b = 0; b < bristles; b++) {
    const o = (b / (bristles - 1)) * 2 - 1;
    const life = 0.72 + r() * 0.28 - Math.abs(o) * 0.12;
    const ink = 0.55 + r() * 0.4;
    const phase = r() * 10;
    g.strokeStyle = `rgba(14,14,16,${ink})`;
    g.lineWidth = (W / bristles) * 2.6 * (0.6 + r() * 0.8);
    let drawing = false;
    const steps = 520;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (t > life) break;
      const width = W * (0.45 + 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.6)), 0.5)) * (1 - 0.5 * t);
      const ang = a0 + t * sweep;
      const rad = R * (1 + 0.018 * Math.sin(t * 7 + 1.3) + 0.01 * Math.sin(t * 19)) + o * width * 0.5;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      // dry-brush breaks get more frequent toward the end of the stroke
      const dry = Math.sin(t * 90 + phase + o * 4) > 1.35 - t * 1.9 * (0.6 + Math.abs(o));
      if (dry) { if (drawing) { g.stroke(); drawing = false; } continue; }
      if (!drawing) { g.beginPath(); g.moveTo(x, y); drawing = true; } else g.lineTo(x, y);
    }
    if (drawing) g.stroke();
  }
  g.shadowBlur = 0;
  // ink splatter
  for (let i = 0; i < 26; i++) {
    const ang = a0 + r() * 0.5 - 0.2, d = R + (r() - 0.5) * W * 2.2;
    g.fillStyle = `rgba(14,14,16,${0.4 + r() * 0.5})`;
    g.beginPath(); g.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 0.8 + r() * 3.2, 0, Math.PI * 2); g.fill();
  }
  // seal stamp
  const sx = w * 0.74, sy = h * 0.82, ss = w * 0.07;
  g.fillStyle = '#9c3b2b';
  g.globalAlpha = 0.86;
  g.fillRect(sx, sy, ss, ss);
  g.globalAlpha = 1;
  g.fillStyle = '#efebe2';
  g.font = `600 ${ss * 0.62}px Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('Æ', sx + ss / 2, sy + ss / 2 + 2);
  // calligraphic signature line
  g.fillStyle = 'rgba(14,14,16,0.75)';
  g.font = `400 ${w * 0.018}px Georgia, serif`;
  g.textAlign = 'right';
  g.fillText('nocturne · I', sx - 16, sy + ss * 0.62);
  grain(g, w, h, 9, seed);
  return c;
}

/* ---------------------------------------------------------------- II. Flow field (silver on black) */
export function paintFlow(seed = 3) {
  const w = 900, h = 1140;
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#151516');
  bg.addColorStop(1, '#0c0c0d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const field = (x, y) =>
    Math.sin(x * 0.0042 + Math.sin(y * 0.0031) * 2.1) * 1.7 +
    Math.cos(y * 0.0049 - x * 0.0012) * 1.25 +
    Math.sin((x + y) * 0.0018) * 0.6;
  g.lineCap = 'round';
  for (let i = 0; i < 1700; i++) {
    let x = r() * w, y = r() * h;
    const bright = Math.exp(-(((x - w * 0.58) ** 2) / (w * w * 0.08) + ((y - h * 0.42) ** 2) / (h * h * 0.1)));
    g.strokeStyle = `rgba(232,230,224,${0.05 + bright * 0.32 + r() * 0.05})`;
    g.lineWidth = 0.7 + r() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    const n = 40 + r() * 70;
    for (let k = 0; k < n; k++) {
      const a = field(x, y);
      x += Math.cos(a) * 3.2; y += Math.sin(a) * 3.2;
      if (x < 0 || y < 0 || x > w || y > h) break;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // one hairline horizon
  g.strokeStyle = 'rgba(232,230,224,0.55)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(w * 0.1, h * 0.86); g.lineTo(w * 0.9, h * 0.86); g.stroke();
  grain(g, w, h, 7, seed + 9);
  return c;
}

/* ---------------------------------------------------------------- III. Colour field */
export function paintField(seed = 11) {
  const w = 760, h = 960;
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  g.fillStyle = '#cfc6b6';
  g.fillRect(0, 0, w, h);
  const block = (x, y, bw, bh, col, soft) => {
    for (let i = soft; i >= 0; i--) {
      g.fillStyle = col;
      g.globalAlpha = 0.07;
      g.fillRect(x - i * 1.4, y - i * 1.1, bw + i * 2.8, bh + i * 2.2);
    }
    g.globalAlpha = 1;
    // brushwork inside the block
    for (let i = 0; i < 900; i++) {
      const px = x + r() * bw, py = y + r() * bh;
      g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)';
      g.lineWidth = 2 + r() * 8;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + 20 + r() * 60, py + (r() - 0.5) * 6); g.stroke();
    }
  };
  block(w * 0.1, h * 0.08, w * 0.8, h * 0.5, '#1e2535', 22);
  block(w * 0.12, h * 0.66, w * 0.76, h * 0.24, '#8f6c49', 18);
  grain(g, w, h, 8, seed);
  return c;
}

/* ---------------------------------------------------------------- IV. Geometric study */
export function paintGeo(seed = 5) {
  const w = 760, h = 760;
  const [c, g] = canvas(w, h);
  g.fillStyle = '#ebe6dc';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#121214';
  g.fillRect(w * 0.16, h * 0.12, w * 0.07, h * 0.76);
  g.fillStyle = '#1f2a4a';
  g.beginPath(); g.arc(w * 0.62, h * 0.88, w * 0.3, Math.PI, 0); g.fill();
  g.fillStyle = '#c7ae86';
  g.beginPath(); g.arc(w * 0.66, h * 0.33, w * 0.13, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#121214';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(w * 0.3, h * 0.58); g.lineTo(w * 0.92, h * 0.58); g.stroke();
  g.beginPath(); g.arc(w * 0.66, h * 0.33, w * 0.2, -Math.PI * 0.9, Math.PI * 0.1); g.stroke();
  grain(g, w, h, 10, seed);
  return c;
}

/* ---------------------------------------------------------------- framing */
const frameMats = {};
function frameMat(kind) {
  if (frameMats[kind]) return frameMats[kind];
  const m = kind === 'oak'
    ? new THREE.MeshStandardMaterial({ color: 0xb08a5e, roughness: 0.6 })
    : kind === 'white'
      ? new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.7 })
      : new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.45, metalness: 0.2 });
  frameMats[kind] = m;
  return m;
}

/**
 * Build a framed artwork. Origin = centre of the back face, facing +Z.
 * style: 'wrap' (gallery-wrapped canvas), 'black' | 'oak' (frame with mat)
 */
export function framedArt(renderer, artCanvas, w, h, style = 'black') {
  const grp = new THREE.Group();
  const tex = toTexture(artCanvas, renderer);
  const artMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82 });
  if (style === 'wrap') {
    const d = 0.045;
    const side = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.8 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, artMat, side]);
    box.position.z = d / 2;
    box.castShadow = true; box.receiveShadow = true;
    grp.add(box);
    return grp;
  }
  const ft = 0.022, fd = 0.04, mat = 0.07;
  const fm = frameMat(style);
  const W = w + mat * 2, H = h + mat * 2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.01), frameMat('white'));
  back.position.z = 0.012;
  back.receiveShadow = true;
  grp.add(back);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = 0.0185;
  art.receiveShadow = true;
  grp.add(art);
  const bars = [
    [W + ft * 2, ft, 0, H / 2 + ft / 2],
    [W + ft * 2, ft, 0, -H / 2 - ft / 2],
    [ft, H, -W / 2 - ft / 2, 0],
    [ft, H, W / 2 + ft / 2, 0],
  ];
  bars.forEach(([bw, bh, x, y]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, fd), fm);
    m.position.set(x, y, fd / 2);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  });
  return grp;
}

/** Small brass picture light that sits above a frame. */
export function pictureLight(width) {
  const grp = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 0.32, metalness: 1 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, width, 20), brass);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.03, 0.15);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.92, 0.004, 0.012),
    new THREE.MeshBasicMaterial({ color: 0xfff3dc })
  );
  glow.position.set(0, 0.014, 0.15);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 10), brass);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, 0.03, 0.075);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 20), brass);
  plate.rotation.x = Math.PI / 2;
  plate.position.set(0, 0.03, 0.004);
  grp.add(bar, glow, arm, plate);
  return grp;
}

/** Wood grain for the hanger. */
export function woodTexture(renderer) {
  const w = 1024, h = 128;
  const [c, g] = canvas(w, h);
  const r = rng(21);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#5e3c26');
  grd.addColorStop(0.5, '#6d4630');
  grd.addColorStop(1, '#55351f');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    const y0 = r() * h, amp = 2 + r() * 6, f = 0.004 + r() * 0.01, ph = r() * 10;
    g.strokeStyle = r() > 0.5 ? `rgba(40,22,12,${0.15 + r() * 0.3})` : `rgba(150,100,64,${0.08 + r() * 0.15})`;
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c, renderer);
}

/** Subtle plaster texture for wall / floor. */
export function plasterTexture(renderer, base, amount, seed) {
  const s = 512;
  const [c, g] = canvas(s, s);
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  const r = rng(seed);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${r() * amount})` : `rgba(0,0,0,${r() * amount * 0.6})`;
    const x = r() * s, y = r() * s, rad = 4 + r() * 26;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  grain(g, s, s, 3, seed, false);
  const t = toTexture(c, renderer);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Hang tag artwork (front face). */
export function tagTexture(renderer, kind, { price = '', currency = '' } = {}) {
  const w = 320, h = 600;
  const [c, g] = canvas(w, h);
  const dark = kind === 'brand';
  const rad = 26;
  // rounded tag with clipped corners
  g.beginPath();
  g.moveTo(rad, 0); g.lineTo(w - rad, 0); g.quadraticCurveTo(w, 0, w, rad);
  g.lineTo(w, h - rad); g.quadraticCurveTo(w, h, w - rad, h);
  g.lineTo(rad, h); g.quadraticCurveTo(0, h, 0, h - rad);
  g.lineTo(0, rad); g.quadraticCurveTo(0, 0, rad, 0);
  g.closePath();
  g.fillStyle = dark ? '#121214' : '#e6dcc8';
  g.fill();
  if (!dark) grain(g, w, h, 14, 4);
  // re-clip corners after grain
  g.globalCompositeOperation = 'destination-in';
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // eyelet
  g.fillStyle = dark ? '#b59a6a' : '#121214';
  g.beginPath(); g.arc(w / 2, 52, 22, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(w / 2, 52, 12, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';

  const ink = dark ? '#f2f1ec' : '#121214';
  g.fillStyle = ink;
  g.textAlign = 'center';
  if (dark) {
    g.font = '600 46px Geist, Arial, sans-serif';
    g.fillText('ÆTHER', w / 2, 150);
    g.font = '500 20px "Geist Mono", monospace';
    g.globalAlpha = 0.7;
    g.fillText('N°001 · DROP 01', w / 2, 192);
    g.globalAlpha = 1;
    g.fillRect(40, 236, w - 80, 1.5);
    g.font = '500 24px "Geist Mono", monospace';
    ['MIDNIGHT', 'NAVY', '', 'FLORAL', 'SHIRT'].forEach((t, i) => g.fillText(t, w / 2, 300 + i * 40));
    g.font = '500 18px "Geist Mono", monospace';
    g.globalAlpha = 0.55;
    g.fillText('TAP FOR DETAILS', w / 2, h - 46);
    g.globalAlpha = 1;
  } else {
    g.font = '500 22px "Geist Mono", monospace';
    g.fillText(currency, w / 2, 160);
    g.font = '500 88px Geist, Arial, sans-serif';
    g.fillText(price, w / 2, 250);
    g.fillRect(40, 290, w - 80, 1.5);
    // barcode
    const r = rng(9);
    let x = 52;
    while (x < w - 52) { const bw = 1 + Math.floor(r() * 4); g.fillRect(x, 320, bw, 110); x += bw + 1 + Math.floor(r() * 4); }
    g.font = '500 18px "Geist Mono", monospace';
    g.fillText('0 0 1 · 2 6 · N A V', w / 2, 462);
    g.font = '600 22px "Geist Mono", monospace';
    g.fillText('TAP TO BUY →', w / 2, h - 50);
  }
  const t = toTexture(c, renderer);
  return t;
}
