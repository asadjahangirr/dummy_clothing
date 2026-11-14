const KEY = 'aether-cart-v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable: cart still works for this visit */ }
}

export class Cart {
  constructor({ format, freeShipping, onChange }) {
    this.format = format;
    this.freeShipping = freeShipping;
    this.onChange = onChange || (() => {});
    this.items = load();
    this.el = {
      drawer: document.getElementById('cart'),
      scrim: document.getElementById('scrim'),
      list: document.getElementById('cartItems'),
      empty: document.getElementById('cartEmpty'),
      count: document.getElementById('cartCount'),
      subtotal: document.getElementById('cartSubtotal'),
      shipMsg: document.getElementById('shipMsg'),
      shipBar: document.getElementById('shipBar'),
    };
    this.el.scrim.addEventListener('click', () => this.close());
    document.getElementById('cartClose').addEventListener('click', () => this.close());
    document.getElementById('cartShop').addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());

    this.el.list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const key = btn.closest('li').dataset.key;
      const item = this.items.find((i) => i.key === key);
      if (!item) return;
      if (btn.dataset.act === 'inc') item.qty = Math.min(10, item.qty + 1);
      if (btn.dataset.act === 'dec') item.qty -= 1;
      if (btn.dataset.act === 'rm' || item.qty <= 0) {
        const li = btn.closest('li');
        li.classList.add('is-leaving');
        setTimeout(() => { this.items = this.items.filter((i) => i.key !== key); this.commit(); }, 320);
        return;
      }
      this.commit();
    });
    this.render();
  }

  get count() { return this.items.reduce((n, i) => n + i.qty, 0); }
  get subtotal() { return this.items.reduce((n, i) => n + i.qty * i.price, 0); }

  add({ id, name, colour, size, price, qty, thumb }) {
    const key = `${id}:${size}`;
    const existing = this.items.find((i) => i.key === key);
    if (existing) {
      existing.qty = Math.min(10, existing.qty + qty);
      if (thumb) existing.thumb = thumb;
    } else {
      this.items.unshift({ key, id, name, colour, size, price, qty, thumb });
    }
    this.lastAdded = key;
    this.commit();
  }

  commit() {
    save(this.items);
    this.render();
    this.onChange(this);
  }

  open() {
    this.el.drawer.classList.add('is-open');
    this.el.scrim.classList.add('is-open');
    this.el.drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cart-open');
  }

  close() {
    this.el.drawer.classList.remove('is-open');
    this.el.scrim.classList.remove('is-open');
    this.el.drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cart-open');
  }

  render() {
    const { list, empty, count, subtotal, shipMsg, shipBar } = this.el;
    const f = this.format;
    list.innerHTML = this.items.map((i) => `
      <li data-key="${i.key}" class="${i.key === this.lastAdded ? 'is-new' : ''}">
        <div class="ci__thumb">${i.thumb ? `<img src="${i.thumb}" alt="" />` : ''}</div>
        <div class="ci__body">
          <div class="ci__top"><span class="ci__name">${i.name}</span><span class="ci__price">${f(i.price * i.qty)}</span></div>
          <span class="mono muted">${i.colour} · Size ${i.size}</span>
          <div class="ci__bottom">
            <div class="stepper stepper--sm">
              <button data-act="dec" aria-label="Decrease">−</button><output>${i.qty}</output><button data-act="inc" aria-label="Increase">+</button>
            </div>
            <button class="ci__rm mono" data-act="rm">Remove</button>
          </div>
        </div>
      </li>`).join('');
    this.lastAdded = null;

    const n = this.count;
    const sub = this.subtotal;
    count.textContent = `(${n})`;
    subtotal.textContent = f(sub);
    empty.style.display = n ? 'none' : '';
    this.el.drawer.classList.toggle('is-empty', !n);
    const left = this.freeShipping - sub;
    shipMsg.innerHTML = left > 0
      ? `You're <b>${f(left)}</b> away from free shipping`
      : `<b>Free shipping</b> unlocked`;
    shipBar.style.transform = `scaleX(${Math.min(1, sub / this.freeShipping)})`;
  }
}
