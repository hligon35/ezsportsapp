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
    const variations = Array.isArray(p.variations) ? p.variations.slice() : [];
    // Compute price and price range from variations first (map preferred), else fallback
    const varPrices = variations
      .map(v => Number(v.map ?? v.price ?? 0))
      .filter(n => Number.isFinite(n) && n > 0);
    const priceMin = varPrices.length ? Math.min(...varPrices) : null;
    const priceMax = varPrices.length ? Math.max(...varPrices) : null;
    const price = varPrices.length ? priceMin : (Number(p.price ?? p.map ?? p.wholesale ?? 0) || 0);
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
    return { id, title, price, priceMin, priceMax, primary, galleryPairs, displayPairs, features, description, variations };
  }

  function render(prod){
    const el = document.getElementById('product-detail');
    if (!el) return;
    if (!prod) {
      el.innerHTML = '<div class="alert">Product not found.</div>';
      return;
    }
    // Render price or price range; will update dynamically on option change
    const basePriceHtml = (() => {
      if (prod.priceMin && prod.priceMax && prod.priceMax !== prod.priceMin) {
        return `<div class="price h3" id="pd-price">$${prod.priceMin.toFixed(2)} - $${prod.priceMax.toFixed(2)}</div>`;
      } else if (prod.price && prod.price > 0) {
        return `<div class="price h3" id="pd-price">$${prod.price.toFixed(2)}</div>`;
      }
      return `<div class="price h3" id="pd-price"></div>`;
    })();
    const thumbs = prod.displayPairs.map((g,i)=>`<button class="thumb" data-index="${i}" aria-label="Show image ${i+1}" data-large="${g.large}"><img src="${g.thumb}" alt="${prod.title} image ${i+1}" loading="lazy"/></button>`).join('');

    // Build color choices from product images using Store's color extraction
    let colorOptions = [];
    try {
      const imgs = Array.isArray(prod.displayPairs) ? prod.displayPairs.map(p => p.large) : (prod.primary ? [prod.primary] : []);
      if (window.Store && typeof window.Store.extractProductColors === 'function') {
        colorOptions = window.Store.extractProductColors({ images: imgs, id: (new URLSearchParams(location.search)).get('pid') || prod.id, sku: (new URLSearchParams(location.search)).get('pid') || prod.id, title: prod.title });
      }
      // De-duplicate by color name keeping first image
      const seen = new Set();
      colorOptions = colorOptions.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
    } catch {}
    const colorSelectHtml = (colorOptions && colorOptions.length) ? `
      <select id="pd-color-select" class="pd-option-select" aria-label="Color" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">
        <option value="">Choose a Color...</option>
        ${colorOptions.map(c => {
          const label = (c.label ? `Color ${c.label}` : (c.class && c.class !== 'neutral' ? (c.class.charAt(0).toUpperCase()+c.class.slice(1)) : (c.name.charAt(0).toUpperCase()+c.name.slice(1))));
          return `<option value="${(c.name||'').replace(/"/g,'&quot;')}" data-image="${c.image}" data-color-class="${c.class||''}">${label}</option>`;
        }).join('')}
      </select>
    ` : '';
    const features = Array.isArray(prod.features) && prod.features.length ? `<ul class="features">${prod.features.map(f=>`<li>${f}</li>`).join('')}</ul>` : '';
    el.innerHTML = `
      <div class="pd-grid">
        <div class="pd-media">
          <div class="pd-main"><img id="pd-main-img" src="${prod.primary}" alt="${prod.title}" loading="eager" fetchpriority="high" decoding="async"/></div>
          <div class="pd-thumbs" role="tablist">${thumbs}</div>
        </div>
        <div class="pd-info">
          <h1 class="pd-title">${prod.title}</h1>
          ${basePriceHtml}
          <div class="stack-05" id="pd-option-block" style="margin-top:.5rem;">
            <div class="row gap-06" id="pd-select-row">
              ${prod.variations && prod.variations.length ? `
                <select id="pd-option-select" class="pd-option-select" aria-label="Options" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">
                  <option value="">Choose an Option...</option>
                  ${prod.variations.map((v,i)=>{
                    const vPrice = Number(v.map ?? v.price ?? 0) || 0;
                    const label = v.option || `Option ${i+1}`;
                    const priceText = vPrice > 0 ? ` - $${vPrice.toFixed(2)}` : '';
                    return `<option value="${label.replace(/"/g,'&quot;')}" data-price="${vPrice}">${label}${priceText}</option>`;
                  }).join('')}
                </select>
              ` : ''}
              ${colorSelectHtml}
            </div>
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
    // Wire option select to update price dynamically
    try {
      const priceEl = document.getElementById('pd-price');
      const optSel = document.getElementById('pd-option-select');
      if (optSel && priceEl) {
        const updatePrice = () => {
          const opt = optSel.options[optSel.selectedIndex];
          const p = Number(opt?.dataset?.price||0) || 0;
          if (p > 0) {
            priceEl.textContent = `$${p.toFixed(2)}`;
          } else if (prod.priceMin && prod.priceMax && prod.priceMax !== prod.priceMin) {
            priceEl.textContent = `$${prod.priceMin.toFixed(2)} - $${prod.priceMax.toFixed(2)}`;
          } else if (prod.price > 0) {
            priceEl.textContent = `$${prod.price.toFixed(2)}`;
          } else {
            priceEl.textContent = '';
          }
        };
        optSel.addEventListener('change', updatePrice);
        // If there's exactly one option, preselect it and update price
        if (optSel.options.length === 2) { // includes the "Choose" placeholder
          optSel.selectedIndex = 1;
          updatePrice();
        }
      }
    } catch {}

    // Wire color select to update main image
    try {
      const colorSel = document.getElementById('pd-color-select');
      if (colorSel) {
        const applyColorImage = () => {
          const opt = colorSel.options[colorSel.selectedIndex];
          const imgSrc = opt?.dataset?.image;
          if (imgSrc) {
            main.src = imgSrc;
          }
        };
        colorSel.addEventListener('change', applyColorImage);
        // Preselect based on current main image if a matching color exists; else default to first real color
        const idx = Array.from(colorSel.options).findIndex(o => {
          const dataImg = o.dataset?.image || '';
          if (!dataImg) return false;
          // Normalize: compare by file name tail to avoid absolute vs relative mismatch
          const tail = (str) => (str||'').split('/').pop();
          return tail(dataImg) === tail(main.src||'');
        });
        if (idx > 0) { colorSel.selectedIndex = idx; }
        else if (colorSel.options.length > 1) { colorSel.selectedIndex = 1; applyColorImage(); }
      }
    } catch {}

    // If this is a JR product (bulletjrbb) and we currently have neutral color entries, classify to palette and rebuild the dropdown
    (async () => {
      try {
        const pid = (new URLSearchParams(location.search)).get('pid') || prod.id || '';
        const looksLikeJR = /bulletjrbb/i.test(String(pid)) || /bullet\s*l\s*screen\s*jr/i.test(prod.title||'');
        const colorSel = document.getElementById('pd-color-select');
        if (!looksLikeJR || !colorSel || !window.Store || typeof window.Store._classifyImageToPalette !== 'function' || typeof window.Store._palette !== 'function') return;
        // Detect if current options are neutral (no data-color-class or class == neutral)
        const opts = Array.from(colorSel.options).slice(1); // skip placeholder
        if (!opts.length) return;
        const allNeutral = opts.every(o => (o.dataset.colorClass||o.getAttribute('data-color-class')||'neutral') === 'neutral');
        if (!allNeutral) return;
        // Classify each image to a palette color
        const map = new Map();
        for (const o of opts) {
          const src = o.dataset.image; if (!src) continue;
          const color = await window.Store._classifyImageToPalette(src);
          if (!map.has(color)) map.set(color, src);
        }
        if (!map.size) return;
        const order = ['black','columbiablue','darkgreen','green','maroon','navy','orange','purple','red','royal','yellow'];
        const rebuilt = ['<option value="">Choose a Color...</option>'];
        order.forEach(c => {
          if (!map.has(c)) return;
          const src = map.get(c);
          const label = c.charAt(0).toUpperCase() + c.slice(1);
          rebuilt.push(`<option value="${c}" data-image="${src}" data-color-class="${c}">${label}</option>`);
        });
        colorSel.innerHTML = rebuilt.join('');
        // Select first and update image
        if (colorSel.options.length > 1) {
          colorSel.selectedIndex = 1; const img = colorSel.options[1].dataset.image; if (img) { main.src = img; }
        }
      } catch {}
    })();

    document.getElementById('pd-add')?.addEventListener('click', ()=>{
      try {
        // Determine selected variation (if any)
        const optSel = document.getElementById('pd-option-select');
        const colorSel = document.getElementById('pd-color-select');
        let chosenLabel = prod.title;
        let chosenPrice = prod.price || 0;
        if (optSel && optSel.value) {
          chosenLabel = `${prod.title} — ${optSel.value}`;
          const optEl = optSel.options[optSel.selectedIndex];
          const p = Number(optEl?.dataset?.price||0) || 0;
          if (p > 0) chosenPrice = p;
        } else if (prod.variations && prod.variations.length) {
          alert('Please choose an option.');
          return;
        }
        // Pass option as size to preserve cart key uniqueness
        const size = (optSel && optSel.value) ? optSel.value : undefined;
        const color = (colorSel && colorSel.value) ? colorSel.value : undefined;
        const product = { id: prod.id, title: chosenLabel, price: chosenPrice, img: main.src || prod.primary, category: 'netting' };
        window.Store && window.Store.add(product, { size, color });
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
