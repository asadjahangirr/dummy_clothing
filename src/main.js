import { Stage } from './stage.js';
import { Cart } from './cart.js';

/* ============================================================
   Products — one entry per hanger on the rail.
   All three use the same shirt model for now (prototype); give each its own
   `model`, name and price when the other products are ready.
   ============================================================ */
const BRAND = 'ÆTHER';
const CURRENCY = 'PKR';
const LOCALE = 'en-PK';
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const PRODUCTS = [
  { id: 'nocturne-01', name: 'Nocturne Floral Shirt', price: 6450, model: '/models/shirt.glb' },
  { id: 'nocturne-02', name: 'Nocturne Floral Shirt', price: 6450, model: '/models/shirt.glb' },
  { id: 'nocturne-03', name: 'Nocturne Floral Shirt', price: 6450, model: '/models/shirt.glb' },
];
const SHIRT_STATIONS = [1, 2, 3]; // scroll stops 1..3 frame hangers 0..2

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat(LOCALE);
const format = (n) => money.format(n);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- toast */
const toastEl = $('#toast');
let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2400);
}

/* ---------------- 3D stage */
const canvas = $('#stage');
canvas.tabIndex = 0;
let loadTarget = 0;
const stage = new Stage(canvas, {
  onProgress: (p) => (loadTarget = p * 0.92),
  onHover: (kind, mode) => {
    document.body.classList.toggle('hover-grab', !mode && (kind === 'shirt' || kind === 'box'));
    document.body.classList.toggle('hover-press', !mode && (kind === 'tag' || kind === 'pendant'));
  },
  // pressing a shirt or its price tag opens its card (and walks the camera to it)
  onSelect: (i) => openCard(i),
});

/* ---------------- bag */
const bagBtn = $('#bagBtn');
const bagCount = $('#bagCount');
const bagPanel = $('#bag');
const cart = new Cart({
  format,
  onChange: (c) => {
    syncBagBadge(c, true);
    stage.setBag(c.count, format(c.subtotal));
  },
});
function syncBagBadge(c, bump) {
  bagCount.textContent = c.count;
  bagBtn.classList.toggle('has-items', c.count > 0);
  if (bump) { bagCount.classList.remove('bump'); void bagCount.offsetWidth; bagCount.classList.add('bump'); }
}
syncBagBadge(cart, false);
stage.setBag(cart.count, format(cart.subtotal));

let inBag = false;
let savedScroll = 0;
function openBag() {
  if (inBag || !stage.ready) return;
  inBag = true;
  savedScroll = window.scrollY;
  closeCard();
  document.body.classList.add('in-bag');
  stage.enterCheckout();
  bagPanel.classList.add('is-open');
  bagPanel.setAttribute('aria-hidden', 'false');
}
function closeBag() {
  if (!inBag) return;
  inBag = false;
  document.body.classList.remove('in-bag');
  window.scrollTo(0, savedScroll);
  stage.exitCheckout();
  bagPanel.classList.remove('is-open');
  bagPanel.setAttribute('aria-hidden', 'true');
  onScroll();
}
bagBtn.addEventListener('click', () => (inBag ? closeBag() : openBag()));
$('#bagBack').addEventListener('click', closeBag);
$('#checkoutBtn').addEventListener('click', () => toast('Demo store — connect a checkout provider here.'));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (inBag) closeBag(); else closeCard();
});

/* ---------------- product card: only when a shirt or its tag is pressed */
const card = $('#product');
const sizesEl = $('#sizes');
const chosen = PRODUCTS.map(() => null); // size per product
let current = -1;      // product whose card is open
let arrived = false;   // the camera has reached that shirt (or the user took over scrolling)
SIZES.forEach((s) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s;
  b.dataset.size = s;
  b.setAttribute('role', 'radio');
  sizesEl.appendChild(b);
});

function openCard(i) {
  if (inBag) return;
  const p = PRODUCTS[i];
  current = i;
  arrived = false;
  $('#pIdx').textContent = `${String(i + 1).padStart(2, '0')} / ${String(PRODUCTS.length).padStart(2, '0')}`;
  $('#pName').textContent = p.name;
  $('#pPrice').textContent = format(p.price);
  paintSizes();
  card.classList.add('is-on');
  card.setAttribute('aria-hidden', 'false');
  stage.setCardOpen(true);
  const station = stations[SHIRT_STATIONS[i]];
  if (Math.abs(window.scrollY - station.offsetTop) > 2) station.scrollIntoView({ behavior: 'smooth' });
  else arrived = true;
}
function closeCard() {
  if (current < 0) return;
  current = -1;
  card.classList.remove('is-on');
  card.setAttribute('aria-hidden', 'true');
  stage.setCardOpen(false);
}
$('#pClose').addEventListener('click', closeCard);

function paintSizes() {
  $$('button', sizesEl).forEach((b) => {
    const on = current >= 0 && chosen[current] === b.dataset.size;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
}
sizesEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b || current < 0) return;
  chosen[current] = b.dataset.size;
  paintSizes();
});

$('#addBtn').addEventListener('click', async (e) => {
  const i = current;
  if (i < 0) return;
  if (!chosen[i]) {
    sizesEl.classList.remove('shake'); void sizesEl.offsetWidth; sizesEl.classList.add('shake');
    toast('Pick a size');
    return;
  }
  const p = PRODUCTS[i];
  const btn = e.currentTarget;
  const thumb = stage.ready ? await stage.captureThumb(i) : null;
  flyToBag(btn, thumb);
  setTimeout(() => {
    cart.add({ id: p.id, name: p.name, size: chosen[i], price: p.price, qty: 1, thumb });
    openBag();
  }, 520);
});

function flyToBag(fromBtn, thumb) {
  const from = fromBtn.getBoundingClientRect();
  const to = bagBtn.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly';
  if (thumb) el.style.backgroundImage = `url(${thumb})`;
  document.body.appendChild(el);
  const sx = from.left + from.width / 2 - 36, sy = from.top + from.height / 2 - 44;
  const ex = to.left + to.width / 2 - 36, ey = to.top + to.height / 2 - 44;
  el.animate(
    [
      { transform: `translate3d(${sx}px, ${sy}px, 0) scale(.6)`, opacity: 0 },
      { transform: `translate3d(${sx}px, ${sy - 60}px, 0) scale(1)`, opacity: 1, offset: 0.25 },
      { transform: `translate3d(${ex}px, ${ey}px, 0) scale(.18)`, opacity: 0.4 },
    ],
    { duration: 620, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' }
  ).onfinish = () => el.remove();
}

/* ---------------- the walk (page scroll -> camera) */
const stations = $$('[data-station]');
$$('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  if (inBag) closeBag();
  closeCard();
  stations[Number(a.dataset.go)].scrollIntoView({ behavior: 'smooth' });
}));
// the user grabbing the scroll mid-flight counts as "arrived": from then on scrolling away closes the card
const userScroll = () => { if (current >= 0) arrived = true; };
window.addEventListener('wheel', userScroll, { passive: true });
window.addEventListener('touchmove', userScroll, { passive: true });

let vh = window.innerHeight;
let scrollQueued = false;
function onScroll() {
  if (inBag) return;
  const story = clamp(window.scrollY / vh, 0, stations.length - 1);
  stage.setStory(story);
  if (current >= 0) {
    const d = Math.abs(story - SHIRT_STATIONS[current]);
    if (!arrived && d < 0.04) arrived = true;
    else if (arrived && d > 0.45) closeCard();
  }
}
// read the scroll position once per frame at most
window.addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; onScroll(); });
}, { passive: true });
window.addEventListener('resize', () => { vh = window.innerHeight; onScroll(); });
onScroll();

/* keyboard: arrows spin the shirt whose card is open */
canvas.addEventListener('keydown', (e) => {
  if (current < 0 || !stage.ready) return;
  const r = stage.rigs[current];
  if (e.key === 'ArrowLeft') { r.s.yawV -= 2.5; r.idleSince = stage.time; }
  if (e.key === 'ArrowRight') { r.s.yawV += 2.5; r.idleSince = stage.time; }
});

/* ---------------- intro: a hanger draws itself while the store loads, then the doors open */
const loader = $('#loader');
let shown = 0;
let loaded = false;
stage.load({
  shirt: PRODUCTS[0].model,
  brand: BRAND,
  products: PRODUCTS.map((p) => ({ priceLabel: plain.format(p.price), currency: CURRENCY })),
}).then(() => {
  loadTarget = 1;
  loaded = true;
}).catch((err) => {
  console.error(err);
  loader.classList.add('is-error');
});

function tickLoader(dt) {
  if (!loader.isConnected || document.body.classList.contains('is-ready')) return;
  shown += (loadTarget - shown) * (1 - Math.exp(-dt * 5));
  if (loaded && loadTarget - shown < 0.004) shown = 1;
  loader.style.setProperty('--p', shown.toFixed(4));
  if (shown >= 1 && loaded) {
    document.body.classList.add('is-ready');
    document.body.classList.remove('is-loading');
    stage.intro();
    onScroll();
    setTimeout(() => loader.remove(), 2200);
  }
}

/* ---------------- frame loop: one rAF drives everything, timed by the display clock */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tickLoader(dt);
  stage.update(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.addEventListener('selectstart', (e) => {
  if (document.body.classList.contains('is-dragging')) e.preventDefault();
});
canvas.addEventListener('mousedown', (e) => e.preventDefault());
if (import.meta.env.DEV) window.__stage = stage;
