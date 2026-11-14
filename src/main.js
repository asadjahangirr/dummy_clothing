import { Stage } from './stage.js';
import { Cart } from './cart.js';

/* ============================================================
   Product config — edit price, currency and sizes here.
   ============================================================ */
const PRODUCT = {
  id: 'nocturne-floral-shirt',
  name: 'Nocturne Floral Shirt',
  colour: 'Midnight Navy',
  price: 6450,
  currency: 'PKR',
  locale: 'en-PK',
  sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  freeShipping: 10000,
  model: '/models/shirt.glb',
};

const fmtNum = new Intl.NumberFormat(PRODUCT.locale, {
  style: 'currency', currency: PRODUCT.currency, maximumFractionDigits: 0,
});
const format = (n) => fmtNum.format(n);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const finePointer = window.matchMedia('(pointer: fine)').matches;

$$('[data-price]').forEach((el) => (el.textContent = format(PRODUCT.price)));
$$('[data-free]').forEach((el) => (el.textContent = format(PRODUCT.freeShipping)));

/* ---------------- toast */
const toastEl = $('#toast');
let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
}

/* ---------------- cart */
const bagCount = $('#bagCount');
const cart = new Cart({
  format,
  freeShipping: PRODUCT.freeShipping,
  onChange: (c) => {
    bagCount.textContent = c.count;
    bagCount.classList.remove('bump');
    void bagCount.offsetWidth;
    bagCount.classList.add('bump');
  },
});
bagCount.textContent = cart.count;
$('#bagBtn').addEventListener('click', () => cart.open());
$('#checkoutBtn').addEventListener('click', () => toast('Demo store — connect your checkout provider here.'));

/* ---------------- size + quantity */
let size = null;
let qty = 1;
const sizesEl = $('#sizes');
const sizeInd = $('.sizes__ind', sizesEl);
const popRow = $('[data-sizes-pop]');
PRODUCT.sizes.forEach((s) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s;
  b.dataset.size = s;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', 'false');
  sizesEl.appendChild(b);
  const pb = document.createElement('button');
  pb.type = 'button';
  pb.textContent = s;
  pb.dataset.size = s;
  popRow.appendChild(pb);
});

function selectSize(s) {
  size = s;
  $$('button[data-size]').forEach((b) => {
    const on = b.dataset.size === s;
    b.classList.toggle('is-active', on);
    if (b.closest('#sizes')) b.setAttribute('aria-checked', String(on));
  });
  const btn = $(`button[data-size="${s}"]`, sizesEl);
  if (btn) {
    sizeInd.style.width = `${btn.offsetWidth}px`;
    sizeInd.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
    sizeInd.style.height = `${btn.offsetHeight}px`;
    sizesEl.classList.add('has-size');
  }
}
sizesEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (b) selectSize(b.dataset.size);
});
window.addEventListener('resize', () => size && selectSize(size));

const qtyOut = $('#qty output');
$('#qty').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-step]');
  if (!b) return;
  qty = clamp(qty + Number(b.dataset.step), 1, 10);
  qtyOut.textContent = qty;
});

/* ---------------- add to bag */
const sizePop = $('#sizePop');
popRow.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b) return;
  selectSize(b.dataset.size);
  sizePop.classList.remove('is-open');
  addToBag($('#navAdd'));
});
document.addEventListener('click', (e) => {
  if (!sizePop.contains(e.target) && !e.target.closest('#navAdd') && !e.target.closest('[data-add]')) {
    sizePop.classList.remove('is-open');
  }
});

function needSize() {
  if (document.body.classList.contains('past-hero')) {
    sizePop.classList.add('is-open');
  } else {
    sizesEl.classList.remove('shake');
    void sizesEl.offsetWidth;
    sizesEl.classList.add('shake');
  }
  toast('Select a size first');
}

async function addToBag(fromBtn) {
  if (!size) return needSize();
  const thumb = stage && stage.ready ? await stage.captureThumb() : null;
  flyToBag(fromBtn, thumb);
  setTimeout(() => {
    cart.add({ id: PRODUCT.id, name: PRODUCT.name, colour: PRODUCT.colour, size, price: PRODUCT.price, qty, thumb });
    setTimeout(() => cart.open(), 380);
  }, 620);
  const label = $('span', fromBtn);
  if (!label) return;
  const prev = label.textContent;
  fromBtn.classList.add('is-added');
  label.textContent = 'Added';
  setTimeout(() => { fromBtn.classList.remove('is-added'); label.textContent = prev; }, 1600);
}

function flyToBag(fromBtn, thumb) {
  const from = fromBtn.getBoundingClientRect();
  const to = $('#bagBtn').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly';
  if (thumb) el.style.backgroundImage = `url(${thumb})`;
  document.body.appendChild(el);
  const sx = from.left + from.width / 2 - 36, sy = from.top + from.height / 2 - 44;
  const ex = to.left + to.width / 2 - 36, ey = to.top + to.height / 2 - 44;
  el.animate(
    [
      { transform: `translate(${sx}px, ${sy}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${sx}px, ${sy - 60}px) scale(1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${ex}px, ${ey}px) scale(.18)`, opacity: 0.4 },
    ],
    { duration: 700, easing: 'cubic-bezier(.6,.0,.2,1)', fill: 'forwards' }
  ).onfinish = () => el.remove();
}

$('#addBtn').addEventListener('click', (e) => addToBag(e.currentTarget));
$('#navAdd').addEventListener('click', (e) => addToBag(e.currentTarget));
$$('[data-add]').forEach((b) => b.addEventListener('click', (e) => addToBag(e.currentTarget)));

/* ---------------- 3D stage */
const canvas = $('#stage');
canvas.tabIndex = 0;
const cursor = $('#cursor');
const cursorLabel = $('#cursorLabel');
const HOVER_LABEL = { shirt: 'Grab', 'tag:price': 'Buy', 'tag:brand': 'Info' };
const DRAG_LABEL = { shirt: 'Pull', tag: 'Swing', look: 'Look' };

const stage = new Stage(canvas, {
  onProgress: (p) => (loadTarget = p * 0.9),
  onHover: (kind, mode) => {
    cursorLabel.textContent = mode ? DRAG_LABEL[mode] : (HOVER_LABEL[kind] || 'Look');
    cursor.classList.toggle('is-shirt', !!kind || mode === 'shirt' || mode === 'tag');
    cursor.classList.toggle('is-down', !!mode);
  },
  onTag: (id, x, y) => {
    if (id === 'price') openTagPop(x, y);
    else document.getElementById('specs').scrollIntoView({ behavior: 'smooth' });
  },
});
stage.setPriceLabel(new Intl.NumberFormat(PRODUCT.locale).format(PRODUCT.price), PRODUCT.currency);

/* ---------------- price-tag quick add */
const tagPop = $('#tagPop');
const tagRow = $('[data-sizes-tag]');
PRODUCT.sizes.forEach((s) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s;
  b.dataset.size = s;
  tagRow.appendChild(b);
});
function openTagPop(x, y) {
  const w = 300, h = 150;
  tagPop.style.left = `${clamp(x - w / 2, 12, innerWidth - w - 12)}px`;
  tagPop.style.top = `${clamp(y + 24, 80, innerHeight - h - 12)}px`;
  tagPop.classList.add('is-open');
}
tagRow.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b) return;
  selectSize(b.dataset.size);
  addToBag(b);
  setTimeout(() => tagPop.classList.remove('is-open'), 250);
});
document.addEventListener('pointerdown', (e) => {
  if (!tagPop.contains(e.target)) tagPop.classList.remove('is-open');
}, true);

/* ---------------- loader */
const loaderCount = $('#loaderCount');
const loaderBar = $('#loaderBar');
const loaderStatus = $('#loaderStatus');
let loadTarget = 0;
let loadShown = 0;
let loaded = false;

stage.load(PRODUCT.model).then(() => {
  loaderStatus.textContent = 'Calibrating cloth physics';
  loadTarget = 1;
  loaded = true;
}).catch((err) => {
  console.error(err);
  loaderStatus.textContent = 'Could not load the 3D model';
});

function tickLoader(dt) {
  if (document.body.classList.contains('is-ready')) return;
  loadShown += (loadTarget - loadShown) * (1 - Math.exp(-dt * 6));
  if (loaded && loadTarget - loadShown < 0.004) loadShown = 1;
  const pct = Math.round(loadShown * 100);
  loaderCount.textContent = pct;
  loaderBar.style.transform = `scaleX(${loadShown})`;
  if (pct >= 100 && loaded) reveal();
}

function reveal() {
  document.body.classList.add('is-ready');
  document.body.classList.remove('is-loading');
  stage.intro();
  setTimeout(() => $('#loader').remove(), 1400);
}

/* ---------------- story / scroll */
const chapters = $$('[data-chapter]');
const solid = $('#solid');
const railFill = $('#railFill');
const railIdx = $('#railIdx');
let centers = [];
let heroH = 0;

function measure() {
  centers = chapters.map((el) => el.offsetTop + el.offsetHeight / 2);
  heroH = chapters[0].offsetHeight;
}
window.addEventListener('resize', measure);
window.addEventListener('load', measure);
measure();

function onScroll() {
  const y = window.scrollY;
  const vh = window.innerHeight;
  const mid = y + vh / 2;
  let story = 0;
  if (mid >= centers[centers.length - 1]) story = centers.length - 1;
  else if (mid > centers[0]) {
    for (let i = 0; i < centers.length - 1; i++) {
      if (mid < centers[i + 1]) {
        const t = (mid - centers[i]) / (centers[i + 1] - centers[i]);
        story = i + clamp((t - 0.18) / 0.64, 0, 1);
        break;
      }
    }
  }
  stage.setStory(story);

  const w = Math.round(story);
  railFill.style.transform = `scaleY(${story / (centers.length - 1)})`;
  railIdx.textContent = String(w).padStart(2, '0');

  const solidTop = solid.getBoundingClientRect().top;
  stage.setActive(solidTop > 0);
  document.body.classList.toggle('story-done', solidTop < vh * 0.55);
  document.body.classList.toggle('past-hero', y > heroH * 0.55);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* reveal-on-view */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
}, { threshold: 0.25, rootMargin: '0px 0px -8% 0px' });
$$('.chapter:not(.chapter--hero), .reveal-up:not(.chapter--hero .reveal-up), .spec, .faq details').forEach((el) => io.observe(el));

/* ---------------- keyboard: arrows spin the shirt */
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') stage.spin(-2.5);
  if (e.key === 'ArrowRight') stage.spin(2.5);
});

/* ---------------- cursor + magnetic buttons */
let cx = innerWidth / 2, cy = innerHeight / 2, tx = cx, ty = cy;
if (finePointer) {
  document.body.classList.add('has-cursor');
  window.addEventListener('pointermove', (e) => {
    tx = e.clientX; ty = e.clientY;
    const onCanvas = e.target === canvas;
    cursor.classList.toggle('is-stage', onCanvas && !document.body.classList.contains('cart-open'));
    cursor.classList.toggle('is-link', !!e.target.closest('a, button, input, summary'));
  });
  cursorLabel.textContent = 'Look';

  $$('.magnetic').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.18;
      const y = (e.clientY - r.top - r.height / 2) * 0.3;
      b.style.transform = `translate(${x}px, ${y}px)`;
    });
    b.addEventListener('pointerleave', () => (b.style.transform = ''));
  });
}

/* ---------------- newsletter */
$('#news').addEventListener('submit', (e) => {
  e.preventDefault();
  e.target.reset();
  toast("You're on the list for Drop 02.");
});

/* ---------------- main loop */
const hudView = $('#hudView');
const hudSwing = $('#hudSwing');
let last = performance.now();
let frame = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tickLoader(dt);
  stage.update();

  if (finePointer) {
    cx += (tx - cx) * (1 - Math.exp(-dt * 22));
    cy += (ty - cy) * (1 - Math.exp(-dt * 22));
    cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
  }
  if (stage.ready && stage.active && ++frame % 4 === 0) {
    const h = stage.hud;
    hudView.textContent = `${String(Math.round(h.facing) % 360).padStart(3, '0')}°`;
    hudSwing.textContent = `${h.swing >= 0 ? '+' : '−'}${Math.abs(h.swing).toFixed(1)}°`;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- never select page text while dragging the 3D scene */
document.addEventListener('selectstart', (e) => {
  if (document.body.classList.contains('is-dragging')) e.preventDefault();
});
canvas.addEventListener('mousedown', (e) => e.preventDefault());

if (import.meta.env.DEV) window.__stage = stage; // handy for debugging in the console
window.addEventListener('scroll', () => tagPop.classList.remove('is-open'), { passive: true });
