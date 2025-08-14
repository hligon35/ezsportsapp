// EZ Sports Netting — tiny storefront demo (no backend)
// Lightweight state + rendering so you can drop this in and it just works.

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

const DEFAULT_PRODUCTS = [
  { id: 'bat-ghost', title: 'Ghost Unlimited Bat -11', price: 399.95, category: 'bats', img: 'https://source.unsplash.com/1200x900/?baseball,bat&sig=1' },
  { id: 'bat-hype', title: 'HYPE Fire -10', price: 349.95, category: 'bats', img: 'https://source.unsplash.com/1200x900/?baseball,bat&sig=2' },
  { id: 'glove-a2000', title: 'Wilson A2000 11.5"', price: 299.95, category: 'gloves', img: 'https://source.unsplash.com/1200x900/?baseball,glove&sig=1' },
  { id: 'glove-heart', title: 'Heart of the Hide 12.25"', price: 279.95, category: 'gloves', img: 'https://source.unsplash.com/1200x900/?baseball,glove&sig=2' },
  { id: 'net-pro', title: 'Pro Backstop Net 10x30', price: 219.00, category: 'netting', img: 'https://source.unsplash.com/1200x900/?baseball,net&sig=1' },
  { id: 'net-cage', title: 'Batting Cage Net 12x55', price: 649.00, category: 'netting', img: 'https://source.unsplash.com/1200x900/?baseball,cage,net&sig=2' },
  { id: 'helmet-pro', title: 'Pro Helmet With Face Guard', price: 89.99, category: 'helmets', img: 'https://source.unsplash.com/1200x900/?baseball,helmet&sig=1' },
  { id: 'helmet-lite', title: 'Lightweight Helmet Youth', price: 59.99, category: 'helmets', img: 'https://source.unsplash.com/1200x900/?baseball,helmet&sig=2' },
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
      dialog: document.getElementById('mini-cart')
    };

  // Ensure core nav links exist on all pages and highlight active
  this.ensureCoreNav();
  // Update navigation for authenticated users
  this.updateNavigation();

    // Refresh products from admin updates
    PRODUCTS = getProducts();

    // Mobile nav toggle
    const toggle = document.querySelector('.menu-toggle');
    const nav = document.getElementById('primary-nav');
    if(toggle && nav){
      toggle.addEventListener('click', ()=>{
        const open = nav.classList.toggle('is-open');
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      // Close nav when a link is chosen
      nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
        if(nav.classList.contains('is-open')){
          nav.classList.remove('is-open');
          document.body.classList.remove('nav-open');
          toggle.setAttribute('aria-expanded','false');
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
    document.querySelectorAll('.tile').forEach(tile => tile.addEventListener('click', (e) => {
      const c = tile.dataset.filter; if (!c) return;
      this.filter(c);
    }));

    // Footer year
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();

    // Expose for console
    window.Store = this;
    window.PRODUCTS = PRODUCTS;
  },
  updateNavigation() {
    const nav = document.getElementById('primary-nav');
    if (!nav) return;

    // Remove existing auth elements
    nav.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());

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
      nav.appendChild(userMenu);
    } else {
      // User is not logged in
      const loginLink = document.createElement('a');
      loginLink.href = 'login.html';
      loginLink.className = 'auth-link';
      loginLink.textContent = 'Login';
      nav.appendChild(loginLink);
    }
  },
  ensureCoreNav(){
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (!nav) return;
    const required = [
      { href: 'shop.html', text: 'Shop' },
      { href: 'deals.html', text: 'Deals' },
      { href: 'about.html', text: 'About' },
    ];
    // Insert any missing core links before cart/login controls
    const existingHrefs = Array.from(nav.querySelectorAll('a')).map(a=>a.getAttribute('href'));
    const cartBtn = nav.querySelector('.cart-btn');
    required.forEach(link => {
      if (!existingHrefs.includes(link.href)){
        const a = document.createElement('a');
        a.href = link.href; a.textContent = link.text;
        if (cartBtn) nav.insertBefore(a, cartBtn); else nav.appendChild(a);
      }
    });
    // Highlight current page
    const path = location.pathname.split('/').pop() || 'index.html';
    const active = Array.from(nav.querySelectorAll('a')).find(a => (a.getAttribute('href')||'').endsWith(path));
    if (active) { active.classList.add('is-active'); active.setAttribute('aria-current','page'); }
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
          ${p.stock !== undefined ? `<p style="font-size:.8rem;color:#666;margin:.25rem 0;">Stock: ${p.stock}</p>` : ''}
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
    this.ui.grid.querySelectorAll('[data-add]:not([disabled])').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.add;
      const product = PRODUCTS.find(p => p.id === id);
      this.add(product);
    }));
  },
  add(product) {
    const exists = this.state.cart.find(i => i.id === product.id);
    if (exists) exists.qty += 1; else this.state.cart.push({ id: product.id, qty: 1 });
    this.persist();
    this.renderCart();
    this.openCart();
  },
  remove(id) {
    this.state.cart = this.state.cart.filter(i => i.id !== id);
    this.persist();
    this.renderCart();
  },
  persist(){
    localStorage.setItem('cart', JSON.stringify(this.state.cart));
  },
  get cartDetailed(){
    return this.state.cart.map(i => ({ ...i, product: PRODUCTS.find(p => p.id === i.id) }));
  },
  get subtotal(){
    return this.cartDetailed.reduce((sum, i) => sum + (i.product.price * i.qty), 0);
  },
  renderCart(){
    const rows = this.cartDetailed.map(i => `
      <div class="cart-row">
        <img src="${i.product.img}" alt="${i.product.title}" width="64" height="64" style="border-radius:.4rem;object-fit:cover"/>
        <div>
          <strong>${i.product.title}</strong>
          <div style="opacity:.8">Qty: <button class="icon-btn" data-dec="${i.id}">−</button> ${i.qty} <button class="icon-btn" data-inc="${i.id}">+</button></div>
        </div>
        <div style="text-align:right">
          <div>${currency.format(i.product.price * i.qty)}</div>
          <button class="btn btn-ghost" data-remove="${i.id}">Remove</button>
        </div>
      </div>
    `).join('');

    this.ui.items.innerHTML = rows || '<p>Your cart is empty.</p>';
    this.ui.count.textContent = String(this.state.cart.reduce((s,i)=>s+i.qty,0));
    this.ui.subtotal.textContent = currency.format(this.subtotal);

    // Bind buttons
    this.ui.items.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>this.remove(b.dataset.remove)));
    this.ui.items.querySelectorAll('[data-inc]').forEach(b=>b.addEventListener('click',()=>{const it=this.state.cart.find(x=>x.id===b.dataset.inc);it.qty++;this.persist();this.renderCart();}));
    this.ui.items.querySelectorAll('[data-dec]').forEach(b=>b.addEventListener('click',()=>{const it=this.state.cart.find(x=>x.id===b.dataset.dec);it.qty=Math.max(0,it.qty-1);if(it.qty===0)this.remove(it.id);else{this.persist();this.renderCart();}}));
  },
  toggleCart(){
    this.ui.dialog.open ? this.ui.dialog.close() : this.ui.dialog.showModal();
  },
  openCart(){
    if(!this.ui.dialog.open) this.ui.dialog.showModal();
  },
  checkout(){
    try{
      const cents = Math.round(this.subtotal * 100);
      localStorage.setItem('checkoutTotalCents', String(cents));
      // persist cart for the checkout page
      this.persist();
      window.location.href = 'checkout.html';
    }catch(e){
      alert('Unable to proceed to checkout.');
      console.error(e);
    }
  }
};

window.Store = Store;
window.addEventListener('DOMContentLoaded', () => Store.init());
