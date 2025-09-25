// Product detail renderer powered by assets/prodList.json

(function(){
  function qs(k, d = window.location.search) {
    const p = new URLSearchParams(d);
    return p.get(k);
  }

  async function getCatalog() {
    try {
      const res = await fetch('assets/prodList.json', { cache: 'no-cache', credentials: 'same-origin' });
      if (!res.ok) throw new Error('prodList.json not found');
      return await res.json();
    } catch (e) {
      try {
        const res = await fetch('prodList.json', { cache: 'no-cache', credentials: 'same-origin' });
        if (!res.ok) throw new Error('prodList.json not found');
        return await res.json();
      } catch (e2) {
        return null;
      }
    }
  }

  function flattenItems(data){
    const out = [];
    if (!data) return out;
    // Legacy shape: pageKey arrays directly on root
    for (const [k,v] of Object.entries(data)) {
      if (k === 'schemaVersion' || k === 'updatedAt' || k === 'categories') continue;
      if (Array.isArray(v)) out.push(...v);
    }
    // New shape: categories map
    if (data.categories && typeof data.categories === 'object') {
      for (const arr of Object.values(data.categories)) {
        if (Array.isArray(arr)) out.push(...arr);
      }
    }
    return out;
  }

  function toDisplayItem(p){
    const id = String(p.sku || p.id || p.name || p.title || Math.random().toString(36).slice(2));
    const title = String(p.name || p.title || id);
    const price = Number(p.price ?? p.map ?? p.wholesale ?? 0) || 0;
    const isUsableSrc = (s) => typeof s === 'string' && /^(https?:|\/|assets\/)/i.test(s);
    let primary = null;
    // 1) explicit p.img
    if (isUsableSrc(p.img)) primary = p.img;
    // 2) images
    if (!primary && p.images) {
      if (isUsableSrc(p.images.primary)) primary = p.images.primary;
      else if (Array.isArray(p.images.all)) {
        const cand = p.images.all.find(isUsableSrc);
        if (cand) primary = cand;
      } else if (Array.isArray(p.images)) {
        const cand = p.images.find(isUsableSrc);
        if (cand) primary = cand;
      }
    }
    // 3) details.images / details.image_url
    if (!primary && p.details) {
      const di = p.details.images;
      if (di) {
        if (isUsableSrc(di.primary)) primary = di.primary;
        else if (Array.isArray(di.all)) {
          const cand = di.all.find(isUsableSrc);
          if (cand) primary = cand;
        }
      }
      if (!primary && isUsableSrc(p.details.image_url)) primary = p.details.image_url;
    }
    // 4) image
    if (!primary && isUsableSrc(p.image)) primary = p.image;
    // 5) downloaded_images
    const dl = (p.downloaded_images && Array.isArray(p.downloaded_images) ? p.downloaded_images : (p.details && Array.isArray(p.details.downloaded_images) ? p.details.downloaded_images : []));
    if (!primary && dl && dl.length) {
      const cand = dl.find(isUsableSrc);
      if (cand) primary = cand;
    }
    const gallery = [];
    if (p.images && Array.isArray(p.images.all)) gallery.push(...p.images.all.filter(isUsableSrc));
    if (p.details && p.details.images && Array.isArray(p.details.images.all)) gallery.push(...p.details.images.all.filter(isUsableSrc));
    if (Array.isArray(dl)) gallery.push(...dl.filter(isUsableSrc));
    if (primary && !gallery.length) gallery.push(primary);
    const features = Array.isArray(p.features) ? p.features : (p.details && Array.isArray(p.details.features) ? p.details.features : []);
    const description = p.description || (p.details && p.details.description) || '';
    return { id, title, price, primary, gallery: Array.from(new Set(gallery)).slice(0,8), features, description };
  }

  function render(prod){
    const el = document.getElementById('product-detail');
    if (!el) return;
    if (!prod) {
      el.innerHTML = '<div class="alert">Product not found.</div>';
      return;
    }
    const priceHtml = prod.price > 0 ? `<div class="price h3">$${prod.price.toFixed(2)}</div>` : '';
    const thumbs = prod.gallery.map((src,i)=>`<button class="thumb" data-index="${i}" aria-label="Show image ${i+1}"><img src="${src}" alt="${prod.title} image ${i+1}" loading="lazy"/></button>`).join('');
    const features = Array.isArray(prod.features) && prod.features.length ? `<ul class="features">${prod.features.map(f=>`<li>${f}</li>`).join('')}</ul>` : '';
    el.innerHTML = `
      <div class="pd-grid">
        <div class="pd-media">
          <div class="pd-main"><img id="pd-main-img" src="${prod.primary}" alt="${prod.title}"/></div>
          <div class="pd-thumbs" role="tablist">${thumbs}</div>
        </div>
        <div class="pd-info">
          <h1 class="pd-title">${prod.title}</h1>
          ${priceHtml}
          <div class="stack-05">
            <button class="btn btn-primary" id="pd-add">Add to Cart</button>
            <a class="btn" href="javascript:history.back()">Back</a>
          </div>
          <h3>Features</h3>
          ${features || '<p class="muted">No features listed.</p>'}
          <h3>Description</h3>
          <p class="pd-desc">${prod.description || ''}</p>
        </div>
      </div>
    `;
    const main = document.getElementById('pd-main-img');
    document.querySelectorAll('.pd-thumbs .thumb').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const i = Number(btn.dataset.index);
        if (Number.isFinite(i) && prod.gallery[i]) {
          main.src = prod.gallery[i];
        }
      });
    });
    document.getElementById('pd-add')?.addEventListener('click', ()=>{
      try {
        window.Store && window.Store.add({ id: prod.id, title: prod.title, price: prod.price, img: prod.primary, category: 'misc' });
      } catch {}
    });
  }

  async function init(){
    try {
      // allow app.js to build nav/footer
      if (window.Store && typeof window.Store.init === 'function') {
        // Do nothing; app.js already runs init on DOMContentLoaded
      }
      const pid = qs('pid');
      const data = await getCatalog();
      const all = flattenItems(data);
      const raw = all.find(p => String(p.sku||p.id) === pid);
      render(raw ? toDisplayItem(raw) : null);
    } catch (e) {
      render(null);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
