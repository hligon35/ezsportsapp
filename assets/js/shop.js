// Shop page logic: now relies exclusively on product-loader (prodList.json) output.
// We wait for window.CATALOG_PRODUCTS (emitted via catalog:ready) then derive categories + render.

const Shop = {
  state: {
    category: 'all',
    search: '',
    products: [],
    categories: ['all']
  },

  init() {
    // Wire search early
    const q = document.getElementById('shop-search');
    if (q) q.addEventListener('input', () => { this.state.search = q.value.trim(); this.renderGrid(); });

    // If product-loader already finished, ingest immediately; else wait for event.
    if (Array.isArray(window.CATALOG_PRODUCTS) && window.CATALOG_PRODUCTS.length) {
      this.ingest(window.CATALOG_PRODUCTS);
    } else {
      window.addEventListener('catalog:ready', () => {
        this.ingest(Array.isArray(window.CATALOG_PRODUCTS) ? window.CATALOG_PRODUCTS : []);
      }, { once:true });
      window.addEventListener('catalog:error', () => {
        this.ingest([]);
      }, { once:true });
    }

    // Sync selected category from query string after ingest (ingest calls render)
    const params = new URLSearchParams(location.search);
    this._pendingCat = params.get('cat');
  },

  ingest(list) {
    this.state.products = list.slice();
    // Derive categories dynamically from product data
    const cats = Array.from(new Set(list.map(p => p.category))).sort();
    this.state.categories = ['all', ...cats];
    this.renderCategories();
    if (this._pendingCat && this.state.categories.includes(this._pendingCat)) {
      this.state.category = this._pendingCat;
      this.highlight(this._pendingCat);
    }
    this.renderGrid();
  },

  renderCategories() {
    const list = document.getElementById('cat-list');
    const chips = document.getElementById('cat-chips');
    const cats = this.state.categories;
    function label(k){
      return (
        {
          'all':'All', 'batting-gloves':'Batting Gloves', 'l-screens':'L-Screens', 'facility-field':'Facility & Field'
        }[k] || (k.charAt(0).toUpperCase()+k.slice(1))
      );
    }
    if (list) list.innerHTML = cats.map(c=>`<li><a href="#" data-cat="${c}">${label(c)}</a></li>`).join('');
    if (chips) chips.innerHTML = cats.map(c=>`<button class="chip${c==='all'?' is-active':''}" data-cat="${c}">${label(c)}</button>`).join('');

    const onPick = (cat)=>{ this.state.category = cat; this.highlight(cat); this.updateQuery(cat); this.renderGrid(); };
    (list||document).querySelectorAll('[data-cat]').forEach(el=> el.addEventListener('click', (e)=>{ e.preventDefault(); onPick(el.getAttribute('data-cat')); }));
  },

  highlight(cat){
    document.querySelectorAll('#cat-chips .chip').forEach(b=> b.classList.toggle('is-active', b.getAttribute('data-cat')===cat));
  },

  updateQuery(cat){
    const url = new URL(location.href);
    if (cat && cat !== 'all') url.searchParams.set('cat', cat); else url.searchParams.delete('cat');
    history.replaceState(null, '', url);
  },

  renderGrid(){
    const grid = document.getElementById('shop-grid');
    if (!grid) return;

    // Source of truth: state.products (from prodList.json via product-loader)
    let products = this.state.products || [];

    const q = (this.state.search||'').toLowerCase();
    const cat = this.state.category;
    const list = products.filter(p => {
      const matchCat = (cat==='all') || (p.category === cat);
      const matchQ = !q || (p.title||p.name||'').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

  grid.innerHTML = list.map(p => `
      <article class="card">
        <div class="media">
          <img src="${p.img || p.image || 'assets/img/bats.jpg'}" alt="${p.title || p.name}" loading="lazy" />
        </div>
        <div class="body">
      <h3>${p.title || p.name}</h3>
          <div class="price-row">
            <span class="price">$${Number(p.price||0).toFixed(2)}</span>
            <button class="btn btn-ghost" data-id="${p.id}">Add</button>
          </div>
        </div>
      </article>
    `).join('') || '<p>No products found.</p>';

    grid.querySelectorAll('[data-id]').forEach(btn => btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      const product = (products||[]).find(p => p.id === id);
      if (product && window.Store && typeof window.Store.add === 'function') {
        window.Store.add(product, {});
      }
      try { window.trackEvent && window.trackEvent('add_to_cart', id); } catch {}
    }));
  }
};

window.addEventListener('DOMContentLoaded', () => Shop.init());
