// Generic dynamic category page renderer.
// Usage: add data-category="bats" (etc) to <main> and include this script AFTER app.js.
// It reuses Store/fetchProducts and supports simple pagination.

(function(){
  async function ensureProductsLoaded(){
    if (window.Store && Array.isArray(window.Store.getProducts()) && window.Store.getProducts().length) return true;
    if (typeof fetchProducts === 'function') { try { await fetchProducts(); } catch {} }
    return (window.Store && window.Store.getProducts().length > 0);
  }

  function paginate(arr, page, perPage){
    const total = arr.length; const pages = Math.max(1, Math.ceil(total/perPage));
    const current = Math.min(Math.max(1, page), pages);
    const start = (current-1)*perPage;
    return { items: arr.slice(start, start+perPage), total, pages, current };
  }

  async function init(){
    const main = document.querySelector('main[data-category]');
    if (!main) return;
    const category = main.getAttribute('data-category');
    const grid = main.querySelector('[data-grid]') || document.getElementById(`${category}-grid`) || document.getElementById('category-grid');
    const pager = main.querySelector('[data-pagination]') || document.getElementById(`${category}-pagination`) || document.getElementById('category-pagination');
    if (!grid) return;

    const attemptRender = () => {
      let products = (window.Store && window.Store.getProducts()) ? window.Store.getProducts() : [];
      // Enhanced heuristic mapping (title/id token scan) for broader coverage
      const mapCat = (p) => {
        const c = (p.category||'').toLowerCase();
        const title = (p.title||'').toLowerCase();
        const id = (p.id||'').toLowerCase();
        if (category === 'l-screens') {
          return /l\s*-?screen|pitcher|protective|screen/.test(title) || c === 'l-screens';
        }
        if (category === 'bats') return c === 'bats' || /\bbat(s)?\b/.test(title) || /bat/.test(id);
        if (category === 'gloves') return c === 'gloves' || /glove|mitt/.test(title) || /glove|mitt/.test(id);
        if (category === 'netting') return c === 'netting' || /net|cage|screen|facility/.test(title);
        if (category === 'apparel') return c === 'apparel' || /jersey|pant|shirt|apparel|uniform|hoodie|jacket/.test(title);
        if (category === 'gear') return c === 'gear' || /catcher|cleat|helmet|guard|leg|chest|mitt/.test(title);
        if (category === 'facility-field') {
          return c === 'facility-field' || /facility|mound|trainer|agility|ladder|cone|hurdle|equipment|rack|cart|dugout|coach|clipboard|whistle|resistance|band/.test(title);
        }
        return c === category;
      };
      const filtered = products.filter(mapCat);
      if (!filtered.length) {
        grid.innerHTML = '<p class="muted">No matching products yet. Loading…</p>';
        return false;
      }
      render(1, filtered);
      return true;
    };

    const have = await ensureProductsLoaded();
    if (!attemptRender()) {
      if (!have) {
        // Wait for global event
        window.addEventListener('products:loaded', () => attemptRender(), { once: true });
      } else {
        // Products loaded but no matches; show a clearer message
        grid.innerHTML = '<p>No products found for this category.</p>';
      }
    }

    function render(page, filtered){
      const { items, pages, current } = paginate(filtered, page, 24);
      grid.innerHTML = items.map(p => `
          <article class="card product-card" data-product-id="${p.id}" ${p.stripe?.defaultPriceId ? `data-stripe-price="${p.stripe.defaultPriceId}"` : ''}>
            <div class="media aspect"><img src="${p.img}" alt="${p.title}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x400?text=No+Image';"/></div>
            <div class="body">
              <h3 class="h3-tight">${p.title}</h3>
              <div class="price-row">
                <span class="price">${(new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'})).format(p.price)}</span>
                <div class="actions">
                  <a class="btn btn-ghost" href="product.html?pid=${encodeURIComponent(p.id)}" aria-label="View ${p.title}">View</a>
                </div>
              </div>
            </div>
          </article>`).join('');
      // Pagination controls
      if (pager) {
        if (pages <= 1) { pager.innerHTML=''; return; }
        let h='';
        for (let i=1;i<=pages;i++) {
          h += `<button class="btn btn-ghost${i===current?' is-active':''}" data-page="${i}">${i}</button>`;
        }
        pager.innerHTML = h;
        pager.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', ()=> render(Number(b.getAttribute('data-page')), filtered)));
      }
      // No add/detail bindings needed; View links navigate to product detail
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
