const KEY = 'aether-cart-v2';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable: the bag still works for this visit */ }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Cart {
  constructor({ format, onChange }) {
    this.format = format;
    this.onChange = onChange || (() => {});
    this.items = load();
    this.el = {
      panel: document.getElementById('bag'),
      list: document.getElementById('bagItems'),
      count: document.getElementById('bagCountLabel'),
      subtotal: document.getElementById('bagSubtotal'),
    };
    this.el.list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const li = btn.closest('li');
      const item = this.items.find((i) => i.key === li.dataset.key);
      if (!item) return;
      if (btn.dataset.act === 'inc') item.qty = Math.min(10, item.qty + 1);
      if (btn.dataset.act === 'dec') item.qty -= 1;
      if (btn.dataset.act === 'rm' || item.qty <= 0) {
        li.classList.add('is-leaving');
        setTimeout(() => { this.items = this.items.filter((i) => i !== item); this.commit(); }, 300);
        return;
      }
      this.commit();
    });
    this.render();
  }

  get count() { return this.items.reduce((n, i) => n + i.qty, 0); }
  get subtotal() { return this.items.reduce((n, i) => n + i.qty * i.price, 0); }

  add({ id, name, size, price, qty = 1, thumb }) {
    const key = `${id}:${size}`;
    const existing = this.items.find((i) => i.key === key);
    if (existing) {
      existing.qty = Math.min(10, existing.qty + qty);
      if (thumb) existing.thumb = thumb;
    } else {
      this.items.unshift({ key, id, name, size, price, qty, thumb });
    }
    this.commit();
  }

  commit() {
    save(this.items);
    this.render();
    this.onChange(this);
  }

  render() {
    const { list, count, subtotal, panel } = this.el;
    const f = this.format;
    list.innerHTML = this.items.map((i) => `
      <li data-key="${esc(i.key)}">
        <div class="ci__thumb">${i.thumb ? `<img src="${i.thumb}" alt="" />` : ''}</div>
        <div>
          <span class="ci__name">${esc(i.name)}</span>
          <div class="ci__meta">
            <span class="mono muted">${esc(i.size)}</span>
            <div class="stepper">
              <button data-act="dec" aria-label="Decrease">−</button><output>${i.qty}</output><button data-act="inc" aria-label="Increase">+</button>
            </div>
          </div>
        </div>
        <div class="ci__right">
          <button class="ci__rm" data-act="rm" aria-label="Remove"><svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
          <span class="ci__price">${f(i.price * i.qty)}</span>
        </div>
      </li>`).join('');
    const n = this.count;
    count.textContent = n ? `(${n})` : '';
    subtotal.textContent = f(this.subtotal);
    panel.classList.toggle('is-empty', !n);
  }
}
