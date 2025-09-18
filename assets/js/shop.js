// Shop page logic: loads categories and products and wires filters/search

const Shop = {
  state: {
    category: 'all',
    search: '',
    products: [],
  categories: ['all','apparel','bats','gloves','batting-gloves','drip','gear','netting','helmets','l-screens','facility-field']
  },

  async init() {
  // Build category chips and sidebar
    this.renderCategories();
  // Prefer server-backed products; fallback to cached/local defaults
  await this.loadProducts();
  this.renderGrid();

    // Wire search
    const q = document.getElementById('shop-search');
    if (q) q.addEventListener('input', () => { this.state.search = q.value.trim(); this.renderGrid(); });

    // Sync from query params
    const params = new URLSearchParams(location.search);
    const cat = params.get('cat');
    if (cat) { this.state.category = cat; this.highlight(cat); this.renderGrid(); }
  },

  apiBases() {
    const ports = [4242];
    const bases = [];
    const isHttp = location.protocol.startsWith('http');
    const onLiveServer = isHttp && location.port === '5500';
    if (onLiveServer) {
      ['127.0.0.1','localhost'].forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
    } else {
      if (isHttp) bases.push(`${location.protocol}//${location.host}`);
      ['127.0.0.1','localhost'].forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
    }
    return Array.from(new Set(bases));
  },

  async loadProducts() {
    // 1) Try cache
    try {
      const cached = JSON.parse(localStorage.getItem('shopProducts')||'null');
      if (Array.isArray(cached) && cached.length) { this.state.products = cached; return; }
    } catch {}

    // 2) Try server /api/products with base fallbacks
    const bases = this.apiBases();
    for (const base of bases) {
      try {
        const res = await fetch(`${base}/api/products`, { credentials: 'include' });
        if (!res.ok) continue;
        const items = await res.json();
        const mapped = (items||[]).map(p => ({
          id: p.id,
          title: p.name || p.title || 'Item',
          price: Number(p.price||0),
          category: p.category || 'misc',
          img: p.image || p.img || 'assets/img/bats.jpg',
          stock: p.stock
        }));
        if (Array.isArray(mapped) && mapped.length > 0) {
          this.state.products = mapped;
          try { localStorage.setItem('shopProducts', JSON.stringify(mapped)); } catch {}
          return;
        }
      } catch {}
    }

    // 3) Fallback to defaults from Store
    try {
      const getter = window.Store && window.Store.getProducts ? window.Store.getProducts : null;
      this.state.products = getter ? getter() : [];
    } catch { this.state.products = []; }

    // 4) Final fallback to static catalog (mirrors individual pages)
    if (!this.state.products || this.state.products.length === 0) {
      try {
        if (Array.isArray(window.CATALOG_PRODUCTS) && window.CATALOG_PRODUCTS.length) {
          this.state.products = window.CATALOG_PRODUCTS;
          try { localStorage.setItem('shopProducts', JSON.stringify(this.state.products)); } catch {}
          // Developer hint so it's obvious we're not seeing live data
          setTimeout(()=>{
            if (!document.getElementById('fallback-warning')) {
              const warn = document.createElement('div');
              warn.id = 'fallback-warning';
              warn.style.cssText = 'background:#432;padding:10px 14px;margin:12px 0;border:1px solid #765;color:#fdb;font:14px system-ui;border-radius:6px;';
              warn.innerHTML = '<strong>Showing static fallback catalog.</strong> Live API returned no products. Start the backend server on port 4242 and clear localStorage key <code>shopProducts</code> then reload to view real data.';
              const main = document.querySelector('main');
              if (main) main.insertBefore(warn, main.firstChild);
            }
          }, 50);
        }
      } catch {}
    }

    // Guarantee at least 4 items for each known category by topping up from CATALOG_PRODUCTS
    try {
      const cats = this.state.categories.filter(c=>c!=='all');
      const have = this.state.products || [];
      const byCat = (arr,cat)=> (arr||[]).filter(p=>p.category===cat);
      const catSrc = Array.isArray(window.CATALOG_PRODUCTS) ? window.CATALOG_PRODUCTS : [];
      let changed = false;
      cats.forEach(cat => {
        const count = byCat(have, cat).length;
        if (count < 4) {
          const needed = 4 - count;
          const pool = byCat(catSrc, cat).filter(p => !have.find(h => h.id === p.id));
          const add = pool.slice(0, needed);
          if (add.length) { have.push(...add); changed = true; }
        }
      });
      if (changed) {
        this.state.products = have;
        try { localStorage.setItem('shopProducts', JSON.stringify(have)); } catch {}
      }
    } catch {}
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

    // Try to pull current products from Store as the source of truth if available
    let products = [];
    try {
      if (window.Store) {
        // window.Store maintains products via getProducts(); call that to get the latest
        const getter = window.Store.getProducts || null;
        products = getter ? getter() : [];
      }
    } catch { products = []; }
    if (!products || !products.length) products = this.state.products || [];
    if ((!products || products.length === 0) && Array.isArray(window.CATALOG_PRODUCTS)) {
      products = window.CATALOG_PRODUCTS;
    }

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
      if (product && window.Store) {
        window.Store.add(product, {});
      }
      try { window.trackEvent && window.trackEvent('add_to_cart', id); } catch {}
    }));
  }
};

window.addEventListener('DOMContentLoaded', () => Shop.init());
