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
  // Collect gallery candidates from various shapes:
  // 1) images.all (object shape)
  if (p.images && Array.isArray(p.images.all)) gallery.push(...p.images.all.filter(isUsableSrc));
  // 2) images (plain array shape)
  if (Array.isArray(p.images)) gallery.push(...p.images.filter(isUsableSrc));
    if (p.details && p.details.images && Array.isArray(p.details.images.all)) gallery.push(...p.details.images.all.filter(isUsableSrc));
    if (Array.isArray(dl)) gallery.push(...dl.filter(isUsableSrc));
    if (primary && !gallery.length) gallery.push(primary);
    const features = Array.isArray(p.features) ? p.features : (p.details && Array.isArray(p.details.features) ? p.details.features : []);
    const description = p.description || (p.details && p.details.description) || '';
  const unique = Array.from(new Set(gallery)).slice(0,20);

    // Build a mapping of thumb -> large image using filename heuristics.
    // Patterns handled:
    //  - base + color + optional letter (e.g., bulletjrbb1a.avif) -> try removing trailing letter 'a'
    //  - files containing '(1)' treated as large hero already
    //  - if file ends with '1a' and a sibling without the 'a' exists, pair them
    //  - if a colored variant (e.g., _black_a) exists along with _black (hero), associate
    const byName = new Set(unique.map(u=>u.split('/').pop()));
    function deriveLarge(src){
      const parts = src.split('/');
      const file = parts.pop();
      if (!/\.avif$/i.test(file)) return src; // only transform avif heuristics
      // Already a hero candidate if contains '(1)'
      if (/\(1\)\.avif$/i.test(file)) return parts.concat(file).join('/');
      // bulletjrbb1a.avif -> bulletjrbb1.avif -> bulletjrbb.avif preference
      let base = file;
      if (/1a\.avif$/i.test(base)) {
        const withoutA = base.replace(/1a\.avif$/i,'1.avif');
        if (byName.has(withoutA)) base = withoutA;
      }
      // If ends with '1.avif' and variant without digit exists, use that as large
      if (/1\.avif$/i.test(base)) {
        const noDigit = base.replace(/1\.avif$/i,'.avif');
        if (byName.has(noDigit)) base = noDigit;
      }
      // *_black_a.avif -> *_black.avif
      if (/_([a-z]+)_a\.avif$/i.test(base)) {
        const cand = base.replace(/_([a-z]+)_a\.avif$/i,'_$1.avif');
        if (byName.has(cand)) base = cand;
      }
      return parts.concat(base).join('/');
    }

    // Build structured gallery entries
    const galleryPairs = unique.map(src => ({ thumb: src, large: deriveLarge(src) }));
    // Large/hero variants to keep in visible gallery: filenames containing (1) OR 1a before extension OR _a variant suffix
  // Include hero variants: (1), 1a, _a, or plain trailing 'a' before extension
  const largePattern = /(\(1\)\.|1a\.|_a\.|[^\w]a\.)/i;
    let displayPairs = galleryPairs.filter(g => {
      const name = g.large.split('/').pop().toLowerCase();
      return largePattern.test(name);
    });
    // If filtering nuked everything (edge case), fallback to originals
    if (!displayPairs.length) displayPairs = galleryPairs.slice();

    // Deduplicate by base color/slug keeping highest quality variant order: (1) > _a > 1a > a > plain
    const orderScore = (name) => {
      if (/\(1\)\./.test(name)) return 500;
      if (/_a\./.test(name)) return 400;
      if (/1a\./.test(name)) return 300;
      if (/[^\w]a\./.test(name)) return 200;
      return 100; // plain fallback
    };
    const baseKey = (name) => {
      // Remove (1), remove _a, 1a, trailing 'a' (non-word) before extension, collapse color suffix groups
      let base = name
        .replace(/\(1\)/,'')
        .replace(/_a\./,'.')
        .replace(/1a\./,'1.')
        .replace(/([^\w])a\./,'$1.')
        .replace(/\s+/g,'');
      return base;
    };
    const bestByBase = new Map();
    displayPairs.forEach(p => {
      const filename = p.large.split('/').pop().toLowerCase();
      const key = baseKey(filename);
      const score = orderScore(filename);
      const existing = bestByBase.get(key);
      if (!existing || score > existing.score) {
        bestByBase.set(key, { pair: p, score });
      }
    });
    displayPairs = Array.from(bestByBase.values()).sort((a,b)=> b.score - a.score).map(v=>v.pair);
    // Ensure primary is one of the LARGE versions; if not, pick first large
    const largeSet = new Set(galleryPairs.map(g=>g.large));
    if (!primary || !largeSet.has(primary)) {
      // Prefer a hero containing (1) or lacking color suffix
      const hero = galleryPairs.find(g=>/\(1\)\.avif$/i.test(g.large)) || galleryPairs[0];
      primary = hero ? hero.large : (primary || galleryPairs[0]?.large);
    }
    return { id, title, price, primary, galleryPairs, displayPairs, features, description };
  }

  function render(prod){
    const el = document.getElementById('product-detail');
    if (!el) return;
    if (!prod) {
      el.innerHTML = '<div class="alert">Product not found.</div>';
      return;
    }
    const priceHtml = prod.price > 0 ? `<div class="price h3">$${prod.price.toFixed(2)}</div>` : '';
  const thumbs = prod.displayPairs.map((g,i)=>`<button class="thumb" data-index="${i}" aria-label="Show image ${i+1}" data-large="${g.large}"><img src="${g.thumb}" alt="${prod.title} image ${i+1}" loading="lazy"/></button>`).join('');
    const features = Array.isArray(prod.features) && prod.features.length ? `<ul class="features">${prod.features.map(f=>`<li>${f}</li>`).join('')}</ul>` : '';
    el.innerHTML = `
      <div class="pd-grid">
        <div class="pd-media">
          <div class="pd-main"><img id="pd-main-img" src="${prod.primary}" alt="${prod.title}" loading="eager" fetchpriority="high" decoding="async"/></div>
          <div class="pd-thumbs" role="tablist">${thumbs}</div>
        </div>
        <div class="pd-info">
          <h1 class="pd-title">${prod.title}</h1>
          ${priceHtml}
          <div class="stack-05">
            <label class="text-xs" for="pd-model-select" style="font-weight:700;letter-spacing:.4px;">Model</label>
            <select id="pd-model-select" class="pd-model-select" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">
              <option value="">Choose an Option...</option>
            </select>
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
        if (!Number.isFinite(i)) return;
        const pair = prod.displayPairs[i];
        if (pair && pair.large) {
          main.src = pair.large;
          // Visual active state
          document.querySelectorAll('.pd-thumbs .thumb').forEach(b=>b.classList.toggle('is-active', b===btn));
        }
      });
    });
    // Populate model select from gallery (basic heuristic labels)
    try {
      const sel = document.getElementById('pd-model-select');
      if (sel && prod.displayPairs) {
        const seen = new Set();
        prod.displayPairs.forEach(pair => {
          const file = pair.large.split('/').pop();
          let label = file.replace(/\.avif$/i,'').replace(/[-_]/g,' ').replace(/\(1\)/,'').trim();
          if (label.length > 48) label = label.slice(0,48)+'…';
          const key = label.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            const opt = document.createElement('option');
            opt.value = pair.large;
            opt.textContent = label.charAt(0).toUpperCase()+label.slice(1);
            sel.appendChild(opt);
          }
        });
        sel.addEventListener('change', ()=>{
          if (sel.value) {
            main.src = sel.value;
          }
        });
      }
    } catch {}

    document.getElementById('pd-add')?.addEventListener('click', ()=>{
      try {
        const sel = document.getElementById('pd-model-select');
        const chosen = sel && sel.value ? sel.options[sel.selectedIndex].textContent : prod.title;
        window.Store && window.Store.add({ id: prod.id, title: chosen || prod.title, price: prod.price, img: main.src || prod.primary, category: 'misc' });
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
