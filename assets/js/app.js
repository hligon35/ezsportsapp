// EZ Sports Netting — tiny storefront demo (no backend)
// Lightweight state + rendering so you can drop this in and it just works.

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

const DEFAULT_PRODUCTS = [
  { id: 'bat-ghost', title: 'Ghost Unlimited Bat -11', price: 399.95, category: 'bats', img: 'assets/img/bat3.avif' },
  { id: 'bat-hype', title: 'HYPE Fire -10', price: 349.95, category: 'bats', img: 'assets/img/bat4.avif' },
  { id: 'glove-a2000', title: 'Wilson A2000 11.5"', price: 299.95, category: 'gloves', img: 'assets/img/glove3.avif' },
  { id: 'glove-heart', title: 'Heart of the Hide 12.25"', price: 279.95, category: 'gloves', img: 'assets/img/glove4.avif' },
  { id: 'net-pro', title: 'Pro Backstop Net 10x30', price: 219.00, category: 'netting', img: 'assets/img/netting.jpg' },
  { id: 'net-cage', title: 'Batting Cage Net 12x55', price: 649.00, category: 'netting', img: 'assets/img/netting3.jpg' },
  { id: 'helmet-pro', title: 'Pro Helmet With Face Guard', price: 89.99, category: 'helmets', img: 'assets/img/helmet3.avif' },
  { id: 'helmet-lite', title: 'Lightweight Helmet Youth', price: 59.99, category: 'helmets', img: 'assets/img/helmet3.avif' },
];

function getProducts() {
  try {
    const adminProducts = JSON.parse(localStorage.getItem('shopProducts') || 'null');
    return adminProducts || DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

let PRODUCTS = getProducts();

const Store = {
  state: {
    filter: 'all',
    cart: JSON.parse(localStorage.getItem('cart') || '[]'),
    user: null,
  },

  keyFor(item) {
    const size = (item.size || '').trim() || '-';
    const color = (item.color || '').trim() || '-';
    return `${item.id}__${size}__${color}`;
  },

  init() {
    // Load current user
    try {
      this.state.user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch {
      this.state.user = null;
    }

    this.ui = {
      grid: document.getElementById('product-grid'),
      count: document.getElementById('cart-count'),
      items: document.getElementById('cart-items'),
      subtotal: document.getElementById('cart-subtotal'),
      dialog: document.getElementById('mini-cart'),
    };

    // Ensure layout and nav
    this.ensureHeaderLayout();
    this.ensureCoreNav();
    this.ensureBreadcrumbs();
    this.updateNavigation();

    // Refresh products from admin updates
    PRODUCTS = getProducts();

    // Mobile nav toggle
    const toggle = document.querySelector('.menu-toggle');
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('is-open');
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      // Close nav when a link is chosen
      nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        if (nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          document.body.classList.remove('nav-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }));
    }

    // Render initial views
    if (this.ui.grid) {
      this.renderProducts();
    }
    this.renderCart();

    // Chips
    document.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('is-active'));
      ch.classList.add('is-active');
      this.state.filter = ch.dataset.chip;
      this.renderProducts();
    }));

    // Category tiles
    document.querySelectorAll('.tile').forEach(tile => tile.addEventListener('click', () => {
      const c = tile.dataset.filter; if (!c) return;
      this.filter(c);
    }));

    // Footer year
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();

    // Reveal header/nav only after everything is standardized
    document.body.classList.add('nav-ready');
  },

  ensureHeaderLayout() {
    const header = document.querySelector('.site-header .header-bar');
    if (!header) return;

    // Ensure actions container exists
    let actions = document.getElementById('header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'header-actions';
      actions.className = 'header-actions';
      // Insert after search form if present, else at end
      const search = header.querySelector('.search');
      if (search && search.nextSibling) {
        header.insertBefore(actions, search.nextSibling);
      } else {
        header.appendChild(actions);
      }
    }

    // Move cart button out of nav into actions (if present)
    const nav = document.getElementById('primary-nav') || header.querySelector('nav.quick-links');
    const cartBtn = nav ? nav.querySelector('.cart-btn') : null;
    if (cartBtn) actions.appendChild(cartBtn);

    // Standardize search bar (placeholder, button classes/text)
    const search = header.querySelector('.search');
    if (search) {
      const input = search.querySelector('input[type="search"]');
      if (input) input.placeholder = 'Search bats, gloves, helmets…';
      let btn = search.querySelector('button[type="submit"]');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'submit';
        search.appendChild(btn);
      }
      btn.className = 'btn btn-primary';
      btn.textContent = 'Search';

      // Ensure search submission navigates to Search Results page
      search.removeAttribute('onsubmit');
      search.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = (input?.value || '').trim();
        const url = 'search-results.html' + (q ? `?q=${encodeURIComponent(q)}` : '');
        window.location.href = url;
      }, { once: false });
    }
  },

  ensureCoreNav() {
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (!nav) return;

    // Canonical nav: rebuild to avoid legacy links and ensure correct order
    const required = [
      { href: 'deals.html', text: 'Deals' },
      { href: 'about.html', text: 'About' },
      { href: 'netting-calculator.html', text: 'Netting Calculator' },
      { href: 'bats.html', text: 'Bats' },
      { href: 'gloves.html', text: 'Gloves' },
      { href: 'batting-gloves.html', text: 'Batting Gloves' },
      { href: 'drip.html', text: 'Drip' },
      { href: 'gear.html', text: 'Gear' },
      { href: 'apparel.html', text: 'Apparel' },
      { href: 'l-screens.html', text: 'L-Screens' },
      { href: 'facility-field.html', text: 'Facility & Field' }
    ];

    // Preserve cart button if it sits inside nav (will be moved by ensureHeaderLayout)
    const cartBtn = nav.querySelector('.cart-btn');

    // Remove all anchor links
    nav.querySelectorAll('a').forEach(a => a.remove());

    // Append required links in order
    required.forEach(link => {
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.text;
      nav.appendChild(a);
    });


    // Highlight current page
    const path = location.pathname.split('/').pop() || 'index.html';
    const active = Array.from(nav.querySelectorAll('a')).find(a => (a.getAttribute('href') || '').endsWith(path));
    if (active) { active.classList.add('is-active'); active.setAttribute('aria-current', 'page'); }
  },

  updateNavigation() {
    const actions = document.getElementById('header-actions') || document.querySelector('.header-actions');
    if (!actions) return;

    // Remove existing auth elements from actions
    actions.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());

    if (this.state.user) {
      // User is logged in
      const userMenu = document.createElement('div');
      userMenu.className = 'user-menu';
      userMenu.innerHTML = `
        <span>Hello, ${this.state.user.name}</span>
        <a href="order-history.html" class="auth-link">Orders</a>
        ${this.state.user.isAdmin ? '<a href="admin.html" class="auth-link">Admin</a>' : ''}
        <button class="auth-link btn btn-ghost" onclick="Store.logout()">Logout</button>
      `;
      actions.appendChild(userMenu);
    } else {
      // User is not logged in
      const loginLink = document.createElement('a');
      loginLink.href = 'login.html';
      loginLink.className = 'auth-link';
      loginLink.textContent = 'Login';
      actions.appendChild(loginLink);
    }
  },

  ensureBreadcrumbs() {
    // Avoid duplicates
    if (document.querySelector('nav.breadcrumbs')) return;
    const main = document.querySelector('main#main') || document.querySelector('main');
    if (!main) return;

    // Resolve current page
    const base = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const TITLES = {
      'index.html': 'Home',
      'deals.html': 'Deals',
      'about.html': 'About',
      'support.html': 'Support',
      'careers.html': 'Careers',
      'login.html': 'Login',
      'checkout.html': 'Checkout',
      'admin.html': 'Admin',
      'order-history.html': 'Order History',
      'netting-calculator.html': 'Netting Calculator',
      'bats.html': 'Bats',
      'gloves.html': 'Gloves',
      'batting-gloves.html': 'Batting Gloves',
      'drip.html': 'Drip',
      'gear.html': 'Gear',
      'apparel.html': 'Apparel',
      'l-screens.html': 'L-Screens',
      'facility-field.html': 'Facility & Field'
    };

    const crumbs = [];
    crumbs.push({ label: 'Home', href: 'index.html' });
    if (base !== 'index.html') {
      crumbs.push({ label: TITLES[base] || (document.title?.split('—')[0].trim() || 'Current'), href: null });
    }

    // Build DOM
    const nav = document.createElement('nav');
    nav.className = 'breadcrumbs container wrap';
    nav.setAttribute('aria-label', 'Breadcrumb');
    const ol = document.createElement('ol');
    ol.className = 'crumbs';
    crumbs.forEach((c, idx) => {
      const li = document.createElement('li');
      if (c.href && idx < crumbs.length - 1) {
        const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
      } else {
        const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
      }
      ol.appendChild(li);
    });
    nav.appendChild(ol);
    // Insert before main
    main.parentNode.insertBefore(nav, main);
  },

  logout() {
    localStorage.removeItem('currentUser');
    this.state.user = null;
    this.updateNavigation();
    window.location.href = 'index.html';
  },

  filter(category) {
    this.state.filter = category || 'all';
    document.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-active', x.dataset.chip === this.state.filter));
    this.renderProducts();
    // Jump to catalog
    const cat = document.getElementById('catalog');
    if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  search(q) {
    this.state.filter = 'all';
    this.renderProducts(q);
    const cat = document.getElementById('catalog');
    if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  renderProducts(query = '') {
    if (!this.ui.grid) return;
    const list = PRODUCTS.filter(p =>
      (this.state.filter === 'all' || p.category === this.state.filter) &&
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    const html = list.map(p => `
      <article class="card ${p.category === 'netting' ? '' : ''}">
        <div class="media">
          <img src="${p.img}" alt="${p.title}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x400?text=Image+Unavailable';"/>
        </div>
        <div class="body">
          <h3 style="margin:0 0 .25rem;font-size:1rem">${p.title}</h3>
          ${p.stock !== undefined ? `<p style=\"font-size:.8rem;color:#666;margin:.25rem 0;\">Stock: ${p.stock}</p>` : ''}
          <div class="variant-row" style="display:flex; gap:.5rem; align-items:center; margin:.25rem 0;">
            <label style="font-size:.8rem; color:#555;">Size
              <select class="sel-size" style="margin-left:.25rem;">
                ${['XS','S','M','L','XL'].map(s=>`<option value=\"${s}\">${s}</option>`).join('')}
              </select>
            </label>
            <label style="font-size:.8rem; color:#555;">Color
              <select class="sel-color" style="margin-left:.25rem;">
                ${['Black','White','Red','Blue','Green'].map(c=>`<option value=\"${c}\">${c}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="price-row">
            <span class="price">${currency.format(p.price)}</span>
            <button class="btn btn-ghost" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
              ${p.stock === 0 ? 'Out of Stock' : 'Add'}
            </button>
          </div>
        </div>
      </article>
    `).join('');

    this.ui.grid.innerHTML = html || `<p>No products found.</p>`;

    // Bind add buttons
    this.ui.grid.querySelectorAll('[data-add]:not([disabled])').forEach(btn => btn.addEventListener('click', (ev) => {
      const id = btn.dataset.add;
      const product = PRODUCTS.find(p => p.id === id);
      const card = ev.target.closest('article');
      const sizeSel = card.querySelector('.sel-size');
      const colorSel = card.querySelector('.sel-color');
      const opts = { size: sizeSel ? sizeSel.value : undefined, color: colorSel ? colorSel.value : undefined };
      this.add(product, opts);
    }));
  },

  add(product, opts = {}) {
    const candidate = { id: product.id, size: opts.size, color: opts.color };
    const key = this.keyFor(candidate);
    const exists = this.state.cart.find(i => this.keyFor(i) === key);
    if (exists) exists.qty += 1; else this.state.cart.push({ id: product.id, qty: 1, size: opts.size, color: opts.color });
    this.persist();
    this.renderCart();
    this.openCart();
  // Track add_to_cart event if analytics is present
  try { window.trackEvent && window.trackEvent('add_to_cart', product.id); } catch {}
  },

  removeByKey(key) {
    this.state.cart = this.state.cart.filter(i => this.keyFor(i) !== key);
    this.persist();
    this.renderCart();
  },

  persist() {
    localStorage.setItem('cart', JSON.stringify(this.state.cart));
  },

  get cartDetailed() {
    return this.state.cart.map(i => ({ ...i, product: PRODUCTS.find(p => p.id === i.id) }));
  },

  get subtotal() {
    return this.cartDetailed.reduce((sum, i) => sum + (i.product.price * i.qty), 0);
  },

  renderCart() {
    const rows = this.cartDetailed.map(i => {
      const key = this.keyFor(i);
      const variant = `${(i.size || '').trim() ? `Size: ${i.size} ` : ''}${(i.color || '').trim() ? `Color: ${i.color}` : ''}`.trim();
      return `
      <div class="cart-row">
        <img src="${i.product.img}" alt="${i.product.title}" width="64" height="64" style="border-radius:.4rem;object-fit:cover"/>
        <div>
          <strong>${i.product.title}</strong>
          ${variant ? `<div style=\"font-size:.8rem;color:#555;\">${variant}</div>` : ''}
          <div style="opacity:.8">Qty: <button class="icon-btn" data-dec="${key}">−</button> ${i.qty} <button class="icon-btn" data-inc="${key}">+</button></div>
        </div>
        <div style="text-align:right">
          <div>${currency.format(i.product.price * i.qty)}</div>
          <button class="btn btn-ghost" data-remove="${key}">Remove</button>
        </div>
      </div>
    `;
    }).join('');

    if (this.ui.items) this.ui.items.innerHTML = rows || '<p>Your cart is empty.</p>';
    if (this.ui.count) this.ui.count.textContent = String(this.state.cart.reduce((s, i) => s + i.qty, 0));
    if (this.ui.subtotal) this.ui.subtotal.textContent = currency.format(this.subtotal);

    // Bind buttons
    if (this.ui.items) {
      this.ui.items.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => this.removeByKey(b.dataset.remove)));
      this.ui.items.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => { const it = this.state.cart.find(x => this.keyFor(x) === b.dataset.inc); if (!it) return; it.qty++; this.persist(); this.renderCart(); }));
      this.ui.items.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => { const it = this.state.cart.find(x => this.keyFor(x) === b.dataset.dec); if (!it) return; it.qty = Math.max(0, it.qty - 1); if (it.qty === 0) this.removeByKey(this.keyFor(it)); else { this.persist(); this.renderCart(); } }));
    }
  },

  toggleCart() {
    if (!this.ui.dialog) return;
    this.ui.dialog.open ? this.ui.dialog.close() : this.ui.dialog.showModal();
  },

  openCart() {
    if (!this.ui.dialog) return;
    if (!this.ui.dialog.open) this.ui.dialog.showModal();
  },

  checkout() {
    try {
      const cents = Math.round(this.subtotal * 100);
      localStorage.setItem('checkoutTotalCents', String(cents));
      // persist cart for the checkout page
      this.persist();
      window.location.href = 'checkout.html';
    } catch (e) {
      alert('Unable to proceed to checkout.');
      console.error(e);
    }
  }
};

window.Store = Store;
window.addEventListener('DOMContentLoaded', () => Store.init());
