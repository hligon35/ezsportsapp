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
  // Build unique list and filter placeholders/non-image tokens
  const isValidImg = (src) => {
    if (!src || typeof src !== 'string') return false;
    const s = src.trim(); if (!s) return false;
    const lower = s.toLowerCase();
    if (['removed','placeholder','n/a','na','null'].includes(lower)) return false;
    if (lower.includes('placeholder') || lower.includes('noimage') || lower.includes('coming-soon')) return false;
    return /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/.test(lower);
  };
  let unique = Array.from(new Set(gallery)).filter(isValidImg).slice(0,20);

    // Curated Accessories imagery overrides
    try {
      const lowerId = String(p.sku || id || '').toLowerCase();
      const lowerTitle = String(p.name || p.title || title || '').toLowerCase();
      // Screen Bulletz Leg Caps (4-Pack)
      if (lowerId === 'screen bulletz' || /screen\s*bulletz/.test(lowerTitle)) {
        const base = 'assets/prodImgs/Accessories/Screen_bulletz';
        const curated = [
          `${base}/screen_bulletz_a.avif`,
          `${base}/screen_bulletz1_a.avif`,
          `${base}/screen_bulletz2_a.avif`,
          `${base}/screen_bulletz3_a.avif`,
          `${base}/screen_bulletz4_a.avif`,
          `${base}/screen_bulletz5_a.avif`
        ];
        primary = curated[0];
        const extras = unique.filter(u => !curated.includes(u));
        unique = [...curated, ...extras].slice(0, 20);
      }
      // Bullet Wheeled Ball Basket
      if (lowerId === 'wbasket' || /wheeled\s*ball\s*basket/.test(lowerTitle)) {
        const hero = 'assets/prodImgs/Accessories/Wbasket/wbasket.avif';
        primary = hero;
        const extras = unique.filter(u => u !== hero);
        unique = [hero, ...extras].slice(0, 20);
      }
      // Armor Baseball Cart (Accessories)
      if (lowerId === 'armorbasket' || /armor\s*(baseball)?\s*cart|armor\s*basket/.test(lowerTitle)) {
        const base = 'assets/prodImgs/Accessories/Armor_basket';
        const curated = [
          `${base}/armorwbasket.avif`,
          `${base}/armorwbasket2.avif`,
          `${base}/armorwbasket3.avif`
        ];
        primary = curated[0];
        const extras = unique.filter(u => !curated.includes(u));
        unique = [...curated, ...extras].slice(0, 20);
      }
      // Pro Batting Mat (Accessories)
      if (lowerId === 'battingmat' || /\bbatting\s*mat\b/.test(lowerTitle)) {
        const base = 'assets/prodImgs/Battingmat';
        const curated = [
          `${base}/battingmata.avif`,
          `${base}/battingmat_blacka.avif`,
          `${base}/battingmat_browna.avif`,
          `${base}/battingmat_greena.avif`,
          `${base}/battingmat_orangea.avif`,
          `${base}/battingmat_reda.avif`,
          `${base}/battingmat_royala.avif`
        ];
        primary = curated[0];
        const extras = unique.filter(u => !curated.includes(u));
        unique = [...curated, ...extras].slice(0, 20);
      }
    } catch {}

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
    // Detect grouped pages to disable color dropdown
    const isPreMadeCagesGroup = /^(cages-21nylon|cages-36nylon|cages-36poly)$/i.test(String(prod.id||''));
    const isTwineSpoolGroup = /^twine-forever-black$/i.test(String(prod.id||''));
    const isCableGroup = /^cable-wire$/i.test(String(prod.id||''));
    const isRopeGroup = /^rope-516-poly$/i.test(String(prod.id||'')) || /5\/16\"\s*poly\s*twisted\s*rope/i.test(String(prod.title||''));
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
    // Skip for grouped pages and Armor Baseball Cart (no color dropdown requested)
    let colorOptions = [];
    const isArmorBasket = /armorbasket/i.test(String(prod.id||'')) || /armor\s*(baseball)?\s*cart|armor\s*basket/i.test(String(prod.title||''));
  if (!isPreMadeCagesGroup && !isTwineSpoolGroup && !isCableGroup && !isRopeGroup && !isArmorBasket) {
      try {
        const imgs = Array.isArray(prod.displayPairs) ? prod.displayPairs.map(p => p.large) : (prod.primary ? [prod.primary] : []);
        if (window.Store && typeof window.Store.extractProductColors === 'function') {
          colorOptions = window.Store.extractProductColors({ images: imgs, id: (new URLSearchParams(location.search)).get('pid') || prod.id, sku: (new URLSearchParams(location.search)).get('pid') || prod.id, title: prod.title });
        }
        // De-duplicate by color name keeping first image
        const seen = new Set();
        colorOptions = colorOptions.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
      } catch {}
    }
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
                    const dataImg = v.img ? ` data-img="${(v.img||'').replace(/"/g,'&quot;')}"` : '';
                    const dataSku = v.sku ? ` data-sku="${String(v.sku).replace(/"/g,'&quot;')}"` : '';
                    return `<option value="${label.replace(/"/g,'&quot;')}" data-price="${vPrice}"${dataImg}${dataSku}>${label}${priceText}</option>`;
                  }).join('')}
                </select>
              ` : ''}
              ${colorSelectHtml}
            </div>
            <div class="row gap-06">
              <button class="btn btn-primary" id="pd-add">Add to Cart</button>
              <button class="btn btn-ghost" type="button" id="pd-back">Back</button>
            </div>
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
          const imgSrc = opt?.dataset?.img;
          if (p > 0) {
            priceEl.textContent = `$${p.toFixed(2)}`;
          } else if (prod.priceMin && prod.priceMax && prod.priceMax !== prod.priceMin) {
            priceEl.textContent = `$${prod.priceMin.toFixed(2)} - $${prod.priceMax.toFixed(2)}`;
          } else if (prod.price > 0) {
            priceEl.textContent = `$${prod.price.toFixed(2)}`;
          } else {
            priceEl.textContent = '';
          }
          // Update image when option carries an image
          if (imgSrc) {
            const main = document.getElementById('pd-main-img');
            if (main) main.src = imgSrc;
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

    // If this is a Pitcher's Pocket Pro and options are all neutral, classify images to palette and rebuild dropdown
    (async () => {
      try {
        const pid = (new URLSearchParams(location.search)).get('pid') || prod.id || '';
        const looksLikePocketPro = /pitcher'?s\s*pocket.*\bpro\b/i.test(String(prod.title||'')) || /BBPP[-_]?PRO/i.test(pid) || /PPPRO/i.test(pid);
        const colorSel = document.getElementById('pd-color-select');
        if (!looksLikePocketPro || !colorSel || !window.Store || typeof window.Store._classifyImageToPalette !== 'function') return;
        const opts = Array.from(colorSel.options).slice(1);
        if (!opts.length) return;
        const allNeutral = opts.every(o => (o.dataset.colorClass||o.getAttribute('data-color-class')||'neutral') === 'neutral');
        if (!allNeutral) return;
        // Build classification map color -> first image
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
        let chosenImg = (document.getElementById('pd-main-img')?.getAttribute('src')) || prod.primary;
        if (optSel && optSel.value) {
          chosenLabel = `${prod.title} — ${optSel.value}`;
          const optEl = optSel.options[optSel.selectedIndex];
          const p = Number(optEl?.dataset?.price||0) || 0;
          if (p > 0) chosenPrice = p;
          if (optEl?.dataset?.img) chosenImg = optEl.dataset.img;
        } else if (prod.variations && prod.variations.length) {
          alert('Please choose an option.');
          return;
        }
        // Pass option as size to preserve cart key uniqueness
        const size = (optSel && optSel.value) ? optSel.value : undefined;
        const color = (colorSel && colorSel.value) ? colorSel.value : undefined;
        const product = { id: prod.id, title: chosenLabel, price: chosenPrice, img: chosenImg, category: 'netting' };
        window.Store && window.Store.add(product, { size, color });
      } catch {}
    });
    // Back button click handler for consistent sizing (button vs anchor)
    document.getElementById('pd-back')?.addEventListener('click', ()=>{
      try { history.back(); } catch {}
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

      // Handle Pre-Made Cages grouped detail pages
      const groupMap = {
        'cages-21nylon': { title: '#21 Nylon', material: 'nylon', gauge: 21 },
        'cages-36nylon': { title: '#36 Nylon', material: 'nylon', gauge: 36 },
        'cages-36poly':  { title: '#36 Poly',  material: 'poly',  gauge: 36 }
      };
      const pidKey = (pid||'').toLowerCase();
      // Grouped detail: Forever Black Twine Spool (#XX options)
      if (pidKey === 'twine-forever-black') {
        // Collect twine items from catalog by name match
        const twines = all.filter(p => /forever\s*black\s*twine\s*spool/i.test(String(p.name||p.title||'')));
        if (!twines.length) { render(null); return; }
        // Build variations labeled by #XX extracted from name
        const parseGauge = (name) => {
          const m = String(name||'').match(/#\s*(\d{1,3})/); return m ? m[1] : '';
        };
        const variations = twines.map((m,i) => {
          const gauge = parseGauge(m.name||m.title) || `Var ${i+1}`;
          const price = Number(m.map ?? m.price ?? m.wholesale ?? 0) || 0;
          const opt = `#${gauge}`;
          const img = (m.img || (m.images && (m.images.primary || (Array.isArray(m.images) && m.images[0])))) || '';
          return { option: opt, map: price, price, sku: m.sku || m.id, img };
        });
        // Primary image & gallery: use first valid image
        const first = twines[0] || {};
  // Curated hero image for Twine Spool
  const curatedHero = 'assets/prodImgs/Accessories/Forever/black_twine.jpeg';
  const primary = curatedHero || variations.find(v=>v.img)?.img || first.img || '';
        const gallery = variations.map(v=>v.img).filter(Boolean);
        const galleryPairs = (gallery.length ? gallery : [primary]).filter(Boolean).slice(0,12).map(src=>({thumb:src, large:src}));
        const displayPairs = galleryPairs.slice(0, Math.min(8, galleryPairs.length));
        // Price range
        const prices = variations.map(v=>v.price).filter(n=>Number.isFinite(n) && n>0);
        const priceMin = prices.length ? Math.min(...prices) : 0;
        const priceMax = prices.length ? Math.max(...prices) : 0;
        const features = (first.details && Array.isArray(first.details.features) ? first.details.features : (Array.isArray(first.features) ? first.features : []));
        const description = (first.details && first.details.description) || first.description || '';
        const synthetic = {
          id: pidKey,
          title: 'Forever Black Twine Spool',
          price: priceMin || 0,
          priceMin: priceMin || 0,
          priceMax: priceMax || priceMin || 0,
          primary: primary || '',
          displayPairs,
          features,
          description,
          variations
        };
        render(synthetic);
        return;
      }

      // Grouped detail: Cable Wire (CABLE* SKUs) — single dropdown for size/length with price
      if (pidKey === 'cable-wire') {
        const cables = all.filter(p => /^CABLE/i.test(String(p.sku||'')));
        if (!cables.length) { render(null); return; }
        // Extract option label from product name, e.g., "500' of 1/4\" Cable" → "1/4\" — 500'"
        const parseLabel = (name) => {
          const n = String(name||'');
          const len = (n.match(/(\d{2,4})'\b/) || [,''])[1];
          const size = (n.match(/(1\/4\"|5\/16\")/) || [,''])[1];
          if (size && len) return `${size} — ${len}'`;
          return n;
        };
        const variations = cables.map(m => {
          const price = Number(m.map ?? m.price ?? m.wholesale ?? 0) || 0;
          const option = parseLabel(m.name||m.title);
          const img = (m.img || (m.images && (m.images.primary || (Array.isArray(m.images) && m.images[0])))) || '';
          return { option, map: price, price, sku: m.sku || m.id, img };
        });
        const first = cables[0] || {};
  // Curated hero image for Cable
  const curatedHero = 'assets/prodImgs/Accessories/Cable/cable.jpeg';
  const primary = curatedHero || variations.find(v=>v.img)?.img || first.img || '';
        const gallery = variations.map(v=>v.img).filter(Boolean);
        const galleryPairs = (gallery.length ? gallery : [primary]).filter(Boolean).slice(0,12).map(src=>({thumb:src, large:src}));
        const displayPairs = galleryPairs.slice(0, Math.min(8, galleryPairs.length));
        const prices = variations.map(v=>v.price).filter(n=>Number.isFinite(n) && n>0);
        const priceMin = prices.length ? Math.min(...prices) : 0;
        const priceMax = prices.length ? Math.max(...prices) : 0;
        const features = (first.details && Array.isArray(first.details.features) ? first.details.features : (Array.isArray(first.features) ? first.features : []));
        const description = (first.details && first.details.description) || first.description || '';
        const synthetic = {
          id: pidKey,
          title: 'Cable',
          price: priceMin || 0,
          priceMin: priceMin || 0,
          priceMax: priceMax || priceMin || 0,
          primary: primary || '',
          displayPairs,
          features,
          description,
          variations
        };
        render(synthetic);
        return;
      }
      // Grouped detail: 5/16" Poly Twisted Rope — By the Foot and 1270' Spool
      if (pidKey === 'rope-516-poly') {
        const ropeFt = all.find(p => String(p.sku||'').toUpperCase() === '5/16-TPLYSTER-XFT');
        const ropeSpool = all.find(p => String(p.sku||'').toUpperCase() === '5/16-TPLYSTER-1270');
        if (!ropeFt && !ropeSpool) { render(null); return; }
        const pickImg = (rec) => {
          if (!rec) return '';
          const img = rec.img || (rec.images && (rec.images.primary || (Array.isArray(rec.images) && rec.images[0]))) || (rec.details && rec.details.image_url) || '';
          return img || '';
        };
  // Curated hero image for Twisted Rope
  const primary = 'assets/prodImgs/Accessories/Twisted_rope/twisted_rope.jpeg' || pickImg(ropeSpool) || pickImg(ropeFt) || '';
        const gallery = [primary].filter(Boolean);
        const galleryPairs = (gallery.length ? gallery : [primary]).filter(Boolean).slice(0,12).map(src=>({thumb:src, large:src}));
        const displayPairs = galleryPairs.slice(0, Math.min(8, galleryPairs.length));
        const variations = [
          { option: "1270' Spool", map: 230, price: 230, sku: '5/16-TPLYSTER-1270', img: primary },
          { option: 'By the Foot', map: 1, price: 1, sku: '5/16-TPLYSTER-xFT', img: primary }
        ];
        const priceMin = 1; const priceMax = 230;
        const features = Array.from(new Set([...(ropeFt?.details?.features||ropeFt?.features||[]), ...(ropeSpool?.details?.features||ropeSpool?.features||[])])).slice(0,10);
        const description = (ropeFt?.details?.description || ropeFt?.description || ropeSpool?.details?.description || ropeSpool?.description || 'Durable 5/16" poly twisted rope. Choose a full 1270\' spool or buy by the foot.');
        const synthetic = {
          id: pidKey,
          title: '5/16" Poly Twisted Rope',
          price: priceMin,
          priceMin,
          priceMax,
          primary: primary || 'assets/img/EZSportslogo.png',
          displayPairs,
          features,
          description,
          variations
        };
        render(synthetic);
        return;
      }
      if (groupMap[pidKey]) {
        const crit = groupMap[pidKey];
        // Collect models from Pre-Made Cages that match material/gauge
        const models = all.filter(p => String(p.material||'').toLowerCase() === crit.material && Number(p.gauge||0) === Number(crit.gauge||0));
        if (!models.length) { render(null); return; }
        // Build variations from sizes
        let variations = models.map(m => ({
          option: m.size || (m.name||m.title||m.sku),
          map: Number(m.map ?? m.price ?? m.wholesale ?? 0) || 0,
          price: Number(m.map ?? m.price ?? m.wholesale ?? 0) || 0,
          sku: m.sku || m.id,
          img: (m.img || (m.images && (m.images.primary || (Array.isArray(m.images) && m.images[0])))) || ''
        }));
        // Override imagery with curated group images
        const GROUP_IMAGES = {
          'cages-21nylon': [ 'assets/prodImgs/Pre_Made_Cages/21Nylon.avif', 'assets/prodImgs/Pre_Made_Cages/21Nylon2.avif' ],
          'cages-36nylon': [ 'assets/prodImgs/Pre_Made_Cages/36Nylon.avif', 'assets/prodImgs/Pre_Made_Cages/36Nylon2.avif' ],
          'cages-36poly':  [ 'assets/prodImgs/Pre_Made_Cages/36Poly.avif',  'assets/prodImgs/Pre_Made_Cages/36Poly2.avif' ]
        };
        const groupImgs = GROUP_IMAGES[pidKey] || [];
        // Ensure each variation references a valid image (use group hero)
        if (groupImgs.length) {
          variations = variations.map(v => ({ ...v, img: groupImgs[0] }));
        }
        // Compute primary and gallery from curated images (fallback to variation images if needed)
        const primary = (groupImgs[0]) || (variations.find(v => v.img)?.img) || (models[0]?.img) || '';
        const gallery = groupImgs.length ? groupImgs.slice(0, 10) : variations.map(v => v.img).filter(Boolean);
        const galleryPairs = (gallery.length ? gallery : [primary]).filter(Boolean).slice(0,20).map(src => ({ thumb: src, large: src }));
        const displayPairs = galleryPairs.slice(0, Math.min(8, galleryPairs.length));
        const prices = variations.map(v => v.price).filter(n=>Number.isFinite(n) && n>0);
        const priceMin = prices.length ? Math.min(...prices) : 0;
        const priceMax = prices.length ? Math.max(...prices) : 0;
        const first = models[0] || {};
        const features = (first.details && Array.isArray(first.details.features) ? first.details.features : (Array.isArray(first.features) ? first.features : []));
        const description = (first.details && first.details.description) || first.description || '';
        const synthetic = {
          id: pidKey,
          title: crit.title,
          price: priceMin || 0,
          priceMin: priceMin || 0,
          priceMax: priceMax || priceMin || 0,
          primary: primary || '',
          displayPairs,
          features,
          description,
          variations
        };
        render(synthetic);
        return;
      }

      // Normal single-product detail
      const raw = all.find(p => String(p.sku||p.id) === pid);
      render(raw ? toDisplayItem(raw) : null);
    } catch (e) {
      render(null);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
