// EZ Sports Netting — tiny storefront demo (no backend)
// Lightweight state + rendering so you can drop this in and it just works.

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

const PRODUCTS = [
  { id: 'bat-ghost', title: 'Ghost Unlimited Bat -11', price: 399.95, category: 'bats', img: 'https://source.unsplash.com/1200x900/?baseball,bat&sig=1' },
  { id: 'bat-hype', title: 'HYPE Fire -10', price: 349.95, category: 'bats', img: 'https://source.unsplash.com/1200x900/?baseball,bat&sig=2' },
  { id: 'glove-a2000', title: 'Wilson A2000 11.5"', price: 299.95, category: 'gloves', img: 'https://source.unsplash.com/1200x900/?baseball,glove&sig=1' },
  { id: 'glove-heart', title: 'Heart of the Hide 12.25"', price: 279.95, category: 'gloves', img: 'https://source.unsplash.com/1200x900/?baseball,glove&sig=2' },
  { id: 'net-pro', title: 'Pro Backstop Net 10x30', price: 219.00, category: 'netting', img: 'https://source.unsplash.com/1200x900/?baseball,net&sig=1' },
  { id: 'net-cage', title: 'Batting Cage Net 12x55', price: 649.00, category: 'netting', img: 'https://source.unsplash.com/1200x900/?baseball,cage,net&sig=2' },
  { id: 'helmet-pro', title: 'Pro Helmet With Face Guard', price: 89.99, category: 'helmets', img: 'https://source.unsplash.com/1200x900/?baseball,helmet&sig=1' },
  { id: 'helmet-lite', title: 'Lightweight Helmet Youth', price: 59.99, category: 'helmets', img: 'https://source.unsplash.com/1200x900/?baseball,helmet&sig=2' },
];

const Store = {
  state: {
    filter: 'all',
    cart: JSON.parse(localStorage.getItem('cart') || '[]'),
  },
  init() {
    this.ui = {
      grid: document.getElementById('product-grid'),
      count: document.getElementById('cart-count'),
      items: document.getElementById('cart-items'),
      subtotal: document.getElementById('cart-subtotal'),
      dialog: document.getElementById('mini-cart')
    };

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
          <div class="price-row">
            <span class="price">${currency.format(p.price)}</span>
            <button class="btn btn-ghost" data-add="${p.id}">Add</button>
          </div>
        </div>
      </article>
    `).join('');

    this.ui.grid.innerHTML = html || `<p>No products found.</p>`;

    // Bind add buttons
    this.ui.grid.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
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
