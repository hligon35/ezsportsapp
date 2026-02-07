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
    const isVisible = (p) => {
      try {
        if (!p || typeof p !== 'object') return false;
        if (p.hidden === true) return false;
        if (p.draft === true) return false;
        if (p.active === false) return false;
        if (p.exclude === true || p.excluded === true) return false;
      } catch {}
      return true;
    };
    // Legacy shape: pageKey arrays directly on root
    for (const [k,v] of Object.entries(data)) {
      if (k === 'schemaVersion' || k === 'updatedAt' || k === 'categories') continue;
      if (Array.isArray(v)) out.push(...v.filter(isVisible));
    }
    // New shape: categories map
    if (data.categories && typeof data.categories === 'object') {
      for (const arr of Object.values(data.categories)) {
        if (Array.isArray(arr)) out.push(...arr.filter(isVisible));
      }
    }
    return out;
  }

  function toSlug(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .trim()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Heuristic shipping fallback (dsr) when product-level/variation dsr is missing
  function guessDsr(prod) {
    try {
      const t = String(prod?.title || prod?.name || '').toLowerCase();
      const id = String(prod?.id || prod?.sku || '').toLowerCase();
      // Pre‑Made / cages tend to ship higher
      if (/cages-|\bpre[-\s]?made\b|batting\s*cage|\bcage\b/.test(t) || /cages-/.test(id)) return 125;
      // L-Screens, Protective Screens, Pitcher's Pocket, Replacement Nets cluster
      if (/l[- ]?screen|\bbullet\b/.test(t)) return 75;
      if (/protective\s+screen/.test(t)) return 75;
      if (/replacement|\brn-/.test(t)) return 75;
      if (/pitcher'?s\s*pocket/.test(t)) return 75;
      // Accessories cluster
      if (/cable|twine|rope|pad\s*kit|basket|mat|screen\s*bulletz|armor/.test(t)) return 100;
      // Default
      return 100;
    } catch { return 100; }
  }

  function toDisplayItem(p){
    const id = String(p.sku || p.id || p.name || p.title || Math.random().toString(36).slice(2));
    const title = String(p.name || p.title || id);
    const variations = Array.isArray(p.variations) ? p.variations.slice() : [];
    const parseNumberLikePrice = (val) => {
      if (val == null) return 0;
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (typeof val === 'string') {
        const m = val.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (m) return parseFloat(m[1]);
      }
      return 0;
    };
    // Compute price and price range from variations first (map preferred), else fallback
    const varPrices = variations
      .map(v => Number(v.map ?? v.price ?? 0))
      .filter(n => Number.isFinite(n) && n > 0);
    const priceMin = varPrices.length ? Math.min(...varPrices) : null;
    const priceMax = varPrices.length ? Math.max(...varPrices) : null;
    const price = varPrices.length ? priceMin : (parseNumberLikePrice(p.price ?? p.map ?? p.wholesale ?? 0) || 0);
    const isUsableSrc = (s) => typeof s === 'string' && /^(https?:|\/|assets\/)/i.test(s);
  let primary = null;
    // 1) explicit p.img
    if (isUsableSrc(p.stripeImg)) primary = p.stripeImg;
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
    // 2b) stripeImages
    if (!primary && Array.isArray(p.stripeImages)) {
      const cand = p.stripeImages.find(isUsableSrc);
      if (cand) primary = cand;
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
  if (Array.isArray(p.stripeImages)) gallery.push(...p.stripeImages.filter(isUsableSrc));
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
    // Deduplicate by resolved large URL so we keep one per unique color/image
    const seenLarge = new Set();
    let displayPairs = [];
    for (const p of galleryPairs) {
      const key = (p.large || '').toLowerCase();
      if (!key) continue;
      if (seenLarge.has(key)) continue;
      seenLarge.add(key);
      displayPairs.push(p);
    }
    if (!displayPairs.length) displayPairs = galleryPairs.slice();
    // Ensure primary is one of the LARGE versions; if not, pick first
    const largeSet = new Set(galleryPairs.map(g=>g.large));
    if (!primary || !largeSet.has(primary)) {
      const hero = galleryPairs[0];
      primary = hero ? hero.large : (primary || galleryPairs[0]?.large);
    }
    // Move primary to the front
    try {
      const idx = displayPairs.findIndex(p => p.large === primary);
      if (idx > 0) { const [picked] = displayPairs.splice(idx,1); displayPairs.unshift(picked); }
    } catch {}
    // Include product-level dsr (shipping dollar) if present
    // Free shipping override for Batting Mat and Armor Basket
    const lid = String(p.sku || p.id || '').toLowerCase();
    const lt = String(p.name || p.title || '').toLowerCase();
    const isFreeShip = (lid === 'battingmat' || lid === 'armorbasket') || (/\bbatting\s*mat\b/.test(lt)) || (/armor\s*(baseball)?\s*cart|armor\s*basket/.test(lt));
    const dsr = isFreeShip ? 0 : (Number(p.dsr ?? 0) || 0);
    return { id, title, price, priceMin, priceMax, primary, galleryPairs, displayPairs, features, description, variations, dsr };
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
      // Cable group: hide price until a selection is made (then show Talk to an Expert)
      if (isCableGroup) return `<div class="price h3" id="pd-price"></div>`;
      if (prod.priceMin && prod.priceMax && prod.priceMax !== prod.priceMin) {
        return `<div class="price h3" id="pd-price">$${prod.priceMin.toFixed(2)} - $${prod.priceMax.toFixed(2)}</div>`;
      } else if (prod.price && prod.price > 0) {
        return `<div class="price h3" id="pd-price">$${prod.price.toFixed(2)}</div>`;
      }
      return `<div class="price h3" id="pd-price"></div>`;
    })();
  const thumbs = prod.displayPairs.map((g,i)=>`<button class="thumb" data-index="${i}" aria-label="Show image ${i+1}" data-large="${g.large}"><img src="${g.thumb}" alt="${prod.title} image ${i+1}" loading="lazy" onerror="this.closest('button') && this.closest('button').remove()"/></button>`).join('');
    const thumbsSection = (Array.isArray(prod.displayPairs) && prod.displayPairs.length > 1)
      ? `<div class="pd-thumbs" role="tablist">${thumbs}</div>`
      : '';

    // Compute initial shipping (dsr) display before option selection
    const variationDsrs = Array.isArray(prod.variations) ? prod.variations
      .map(v => Number(v.dsr ?? 0))
      .filter(n => Number.isFinite(n) && n > 0) : [];
    const initialShippingText = (() => {
      // Cable group: shipping blank until an option is selected
      if (isCableGroup) return ``;
      const lid = String(prod.id||'').toLowerCase();
      const lt = String(prod.title||'').toLowerCase();
      const isFreeShip = (lid === 'battingmat' || lid === 'armorbasket') || (/\bbatting\s*mat\b/.test(lt)) || (/armor\s*(baseball)?\s*cart|armor\s*basket/.test(lt));
      if (isFreeShip) return `Shipping: Free`;
      if (variationDsrs.length) {
        const min = Math.min(...variationDsrs);
        const max = Math.max(...variationDsrs);
        if (min === max) return `Shipping: $${min.toFixed(2)}`;
        return `Shipping: $${min.toFixed(2)} - $${max.toFixed(2)}`;
      }
      const pDsr = Number(prod.dsr ?? 0) || 0;
      if (pDsr > 0) return `Shipping: $${pDsr.toFixed(2)}`;
      // New policy fallback: show $100 flat when no dsr present
      return `Shipping: $${(100).toFixed(2)}`;
    })();

    // Build color choices from product images using Store's color extraction
    // Skip for grouped pages, Screen Bulletz, and Armor Baseball Cart (no color dropdown requested)
  let colorOptions = [];
    const isArmorBasket = /armorbasket/i.test(String(prod.id||'')) || /armor\s*(baseball)?\s*cart|armor\s*basket/i.test(String(prod.title||''));
    const isScreenBulletz = /screen\s*bulletz/i.test(String(prod.id||'')) || /screen\s*bulletz/i.test(String(prod.title||''));
  if (!isPreMadeCagesGroup && !isTwineSpoolGroup && !isCableGroup && !isRopeGroup && !isArmorBasket && !isScreenBulletz) {
      try {
        const imgs = Array.isArray(prod.displayPairs) ? prod.displayPairs.map(p => p.large) : (prod.primary ? [prod.primary] : []);
        if (window.Store && typeof window.Store.extractProductColors === 'function') {
          colorOptions = window.Store.extractProductColors({ images: imgs, id: (new URLSearchParams(location.search)).get('pid') || prod.id, sku: (new URLSearchParams(location.search)).get('pid') || prod.id, title: prod.title });
        }
        // De-duplicate by image URL so all distinct color images are kept
        const seenImages = new Set();
        colorOptions = colorOptions.filter(c => {
          const key = String(c.image || '').toLowerCase();
          if (!key) return false;
          if (seenImages.has(key)) return false;
          seenImages.add(key);
          return true;
        });
      } catch {}
    }
    const colorSelectHtml = (colorOptions && colorOptions.length > 1) ? `
      <select id="pd-color-select" class="pd-option-select" aria-label="Color" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">
        <option value="">Choose a Color...</option>
        ${(() => {
          let neutralIndex = 1;
          return colorOptions.map(c => {
            const isNeutral = (c.class || '') === 'neutral';
            const label = isNeutral
              ? `Image ${neutralIndex++}`
              : (c.class ? (c.class.charAt(0).toUpperCase() + c.class.slice(1)) : (c.name ? (c.name.charAt(0).toUpperCase() + c.name.slice(1)) : 'Image'));
            return `<option value="${(c.name||'').replace(/"/g,'&quot;')}" data-image="${c.image}" data-color-class="${c.class||''}">${label}</option>`;
          }).join('');
        })()}
      </select>
    ` : '';
    const features = Array.isArray(prod.features) && prod.features.length ? `<ul class="features">${prod.features.map(f=>`<li>${f}</li>`).join('')}</ul>` : '';
    el.innerHTML = `
      <div class="pd-grid">
        <div class="pd-media">
          <div class="pd-main"><img id="pd-main-img" src="${prod.primary}" alt="${prod.title}" loading="eager" fetchpriority="high" decoding="async" onerror="this.onerror=null; this.src='assets/EZSportslogo.png';"/></div>
          ${thumbsSection}
        </div>
        <div class="pd-info">
          <h1 class="pd-title">${prod.title}</h1>
          ${basePriceHtml}
          <div class="text-sm text-muted" id="pd-expert-contact" style="display:none; margin:.15rem 0 .35rem;">
            <div><strong>Call:</strong> <a href="tel:+13868373131" aria-label="Call EZ Sports Netting at 386-837-3131">(386) 837-3131</a></div>
            <div><strong>Email:</strong> <a href="mailto:info@ezsportsnetting.com">info@ezsportsnetting.com</a></div>
          </div>
          <div class="text-sm text-muted" id="pd-shipping">${initialShippingText}</div>
          <div class="stack-05" id="pd-option-block" style="margin-top:.5rem;">
            <div class="row gap-06" id="pd-select-row">
              ${(prod.variations && prod.variations.length > 1) ? `
                <select id="pd-option-select" class="pd-option-select" aria-label="Options" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">
                  <option value="">Choose an Option...</option>
                  ${prod.variations.map((v,i)=>{
                    const vPrice = Number(v.map ?? v.price ?? 0) || 0;
                    const vDsr = Number(v.dsr ?? prod.dsr ?? 0) || 0;
                    const label = v.option || `Option ${i+1}`;
                    // For Cable group, suppress inline price text in the dropdown
                    const priceText = (isCableGroup ? '' : (vPrice > 0 ? ` - $${vPrice.toFixed(2)}` : ''));
                    const dataImg = v.img ? ` data-img="${(v.img||'').replace(/"/g,'&quot;')}"` : '';
                    const dataSku = v.sku ? ` data-sku="${String(v.sku).replace(/"/g,'&quot;')}"` : '';
                    const dataDsr = vDsr > 0 ? ` data-dsr="${vDsr}"` : '';
                    const dataByFoot = (v.byfoot || /\bby\s*the\s*foot\b/i.test(label)) ? ' data-byfoot="1"' : '';
                    return `<option value="${label.replace(/\"/g,'&quot;')}" data-price="${vPrice}"${dataImg}${dataSku}${dataDsr}${dataByFoot}>${label}${priceText}</option>`;
                  }).join('')}
                </select>
              ` : ''}
              ${colorSelectHtml}
            </div>
            <div id="pd-footage-block" class="stack-02" style="display:none;margin-top:.5rem;">
              <label for="pd-feet" class="text-sm" style="font-weight:600;">Length (feet)</label>
              <input id="pd-feet" type="number" min="1" step="1" value="1" inputmode="numeric" style="padding:.6rem .7rem;border:1px solid var(--border);border-radius:.5rem;width:9rem;" />
              <div class="text-xs text-muted">Sold by the foot (1' increments).</div>
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
    // Disable Add to Cart for Cable group pages
    try {
      if (isCableGroup) {
        const addBtn = document.getElementById('pd-add');
        if (addBtn) {
          addBtn.disabled = true;
          addBtn.setAttribute('aria-disabled','true');
          // Keep label unchanged per request; styling/class can be added by CSS if desired
        }
      }
    } catch {}
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
    // If fewer than two thumbnails remain (e.g., some removed on error), hide the strip
    try {
      const thumbsWrap = document.querySelector('.pd-thumbs');
      if (thumbsWrap && thumbsWrap.querySelectorAll('.thumb').length < 2) {
        thumbsWrap.style.display = 'none';
      }
    } catch {}
    // Wire option select to update price dynamically
    try {
      const priceEl = document.getElementById('pd-price');
      const shipEl = document.getElementById('pd-shipping');
      const optSel = document.getElementById('pd-option-select');
      const feetBlock = document.getElementById('pd-footage-block');
      const feetInput = document.getElementById('pd-feet');
  const contactEl = document.getElementById('pd-expert-contact');
      if (optSel && priceEl) {
        const calcFeet = () => {
          if (!feetInput) return 1;
          let n = Number(feetInput.value);
          if (!Number.isFinite(n) || n < 1) n = 1;
          return Math.floor(n);
        };
        const updateDisplays = () => {
          const opt = optSel.options[optSel.selectedIndex];
          const p = Number(opt?.dataset?.price||0) || 0;
          const imgSrc = opt?.dataset?.img;
          const byFoot = (opt?.dataset?.byfoot === '1') || /\bby\s*the\s*foot\b/i.test(String(optSel.value||''));
          // Toggle feet UI
          if (feetBlock) feetBlock.style.display = byFoot ? '' : 'none';
          if (isCableGroup) {
            // Cable group: only when a concrete option is chosen, show CTA text; keep shipping blank
            if (optSel.value) {
              priceEl.textContent = 'Talk to an Expert';
              if (contactEl) contactEl.style.display = '';
            } else {
              priceEl.textContent = '';
              if (contactEl) contactEl.style.display = 'none';
            }
            if (shipEl) shipEl.textContent = '';
          } else if (p > 0) {
            const multiplier = byFoot ? calcFeet() : 1;
            priceEl.textContent = `$${(p * multiplier).toFixed(2)}`;
            if (contactEl) contactEl.style.display = 'none';
          } else if (prod.priceMin && prod.priceMax && prod.priceMax !== prod.priceMin) {
            priceEl.textContent = `$${prod.priceMin.toFixed(2)} - $${prod.priceMax.toFixed(2)}`;
            if (contactEl) contactEl.style.display = 'none';
          } else if (prod.price > 0) {
            priceEl.textContent = `$${prod.price.toFixed(2)}`;
            if (contactEl) contactEl.style.display = 'none';
          } else {
            priceEl.textContent = '';
            if (contactEl) contactEl.style.display = 'none';
          }
          // Shipping (dsr): prefer selected variation's dsr, else product-level, else keep initial/range
          if (shipEl) {
            if (isCableGroup) {
              shipEl.textContent = '';
            } else {
            const lid = String(prod.id||'').toLowerCase();
            const lt = String(prod.title||'').toLowerCase();
            const isFreeShip = (lid === 'battingmat' || lid === 'armorbasket') || (/\bbatting\s*mat\b/.test(lt)) || (/armor\s*(baseball)?\s*cart|armor\s*basket/.test(lt));
            if (isFreeShip) {
              shipEl.textContent = `Shipping: Free`;
            } else {
              const dsr = Number(opt?.dataset?.dsr||0) || 0;
              if (dsr > 0) {
                shipEl.textContent = `Shipping: $${dsr.toFixed(2)}`;
              } else {
                // Recompute from variations or product-level
                const vDsrs = Array.isArray(prod.variations) ? prod.variations
                  .map(v => Number(v.dsr ?? 0))
                  .filter(n => Number.isFinite(n) && n > 0) : [];
                if (vDsrs.length) {
                  const min = Math.min(...vDsrs); const max = Math.max(...vDsrs);
                  shipEl.textContent = (min===max) ? `Shipping: $${min.toFixed(2)}` : `Shipping: $${min.toFixed(2)} - $${max.toFixed(2)}`;
                } else if (Number(prod.dsr||0) > 0) {
                  shipEl.textContent = `Shipping: $${Number(prod.dsr).toFixed(2)}`;
                } else {
                  // New policy fallback: show $100 flat when no dsr present
                  shipEl.textContent = `Shipping: $${(100).toFixed(2)}`;
                }
              }
            }
            }
          }
          // Update image when option carries an image (except Cable group, which stays on the curated cable image)
          if (imgSrc && !isCableGroup) {
            const main = document.getElementById('pd-main-img');
            if (main) main.src = imgSrc;
          }
        };
        optSel.addEventListener('change', updateDisplays);
        // When feet changes, recompute price if by-foot selected
        if (feetInput) feetInput.addEventListener('input', () => {
          // sanitize to integer >=1
          const n = Number(feetInput.value);
          if (!Number.isFinite(n) || n < 1) feetInput.value = '1';
          updateDisplays();
        });
        // If there's exactly one option, preselect it and update price/shipping
        if (optSel.options.length === 2) { // includes the "Choose" placeholder
          optSel.selectedIndex = 1;
          updateDisplays();
        }
      }
    } catch {}

    // If this is a single by-the-foot product (no option dropdown), expose feet input and multiply price
    try {
      const priceEl = document.getElementById('pd-price');
      const feetBlock = document.getElementById('pd-footage-block');
      const feetInput = document.getElementById('pd-feet');
      const hasOptions = !!document.getElementById('pd-option-select');
      const isByFootTitle = /by\s*the\s*f(?:oot|t)\b/i.test(String(prod.title||''));
      const isByFootId = /xft$/i.test(String(prod.id||'')) || /-xft-/i.test(String(prod.id||'')) || /xft/i.test(String(prod.id||''));
      if (!hasOptions && (isByFootTitle || isByFootId)) {
        if (feetBlock) feetBlock.style.display = '';
        const perFoot = Number(prod.price || prod.priceMin || 0) || 0;
        const calcFeet = () => {
          if (!feetInput) return 1; let n = Number(feetInput.value); if (!Number.isFinite(n) || n < 1) n = 1; return Math.floor(n);
        };
        const updateFeetPrice = () => {
          if (!priceEl) return;
          if (perFoot > 0) {
            priceEl.textContent = `$${(perFoot * calcFeet()).toFixed(2)}`;
          }
        };
        if (feetInput) feetInput.addEventListener('input', () => {
          const n = Number(feetInput.value); if (!Number.isFinite(n) || n < 1) feetInput.value = '1';
          updateFeetPrice();
        });
        updateFeetPrice();
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
        // Guard: prevent add-to-cart on Cable group pages entirely
        const pidKey = (new URLSearchParams(location.search)).get('pid') || (prod.id||'');
        if (/^cable-wire$/i.test(String(pidKey))) {
          return; // disabled behavior enforced above; double-guard here
        }
        // Determine selected variation (if any)
        const optSel = document.getElementById('pd-option-select');
        const colorSel = document.getElementById('pd-color-select');
        let chosenLabel = prod.title;
        let chosenPrice = prod.price || 0;
        let chosenImg = (document.getElementById('pd-main-img')?.getAttribute('src')) || prod.primary;
  let chosenShipRaw = (typeof prod.dsr !== 'undefined') ? prod.dsr : undefined;
        const singleVar = (prod.variations && prod.variations.length === 1) ? prod.variations[0] : null;
        if (optSel && optSel.value) {
          chosenLabel = `${prod.title} — ${optSel.value}`;
          const optEl = optSel.options[optSel.selectedIndex];
          const p = Number(optEl?.dataset?.price||0) || 0;
          if (p > 0) {
            const byFoot = (optEl?.dataset?.byfoot === '1') || /\bby\s*the\s*foot\b/i.test(String(optSel.value||''));
            if (byFoot) {
              const feetInput = document.getElementById('pd-feet');
              let feet = Number(feetInput?.value || 1);
              if (!Number.isFinite(feet) || feet < 1) feet = 1;
              feet = Math.floor(feet);
              chosenPrice = p * feet;
              chosenLabel = `${chosenLabel} (${feet}')`;
            } else {
              chosenPrice = p;
            }
          }
          if (optEl?.dataset?.img) chosenImg = optEl.dataset.img;
          if (typeof optEl?.dataset?.dsr !== 'undefined') {
            const dsrNum = Number(optEl.dataset.dsr);
            chosenShipRaw = Number.isFinite(dsrNum) && dsrNum > 0 ? dsrNum : (optEl.dataset.dsr || chosenShipRaw);
          }
          // Prefer a concrete SKU for the cart item ID when available
          if (optEl?.dataset?.sku) {
            try { prod = { ...prod, id: String(optEl.dataset.sku) }; } catch {}
          }
        } else if (singleVar) {
          // Single-variation product: no dropdown; use that variation's values implicitly
          const p = Number(singleVar.map ?? singleVar.price ?? 0) || 0;
          if (p > 0) chosenPrice = p;
          if (singleVar.img) chosenImg = singleVar.img;
          if (typeof singleVar.dsr !== 'undefined') chosenShipRaw = singleVar.dsr;
          // include option label as size for cart uniqueness/context
          if (singleVar.option) chosenLabel = `${prod.title} — ${singleVar.option}`;
          // Prefer concrete SKU for cart id
          if (singleVar.sku) {
            try { prod = { ...prod, id: String(singleVar.sku) }; } catch {}
          }
        } else if (prod.variations && prod.variations.length > 1) {
          alert('Please choose an option.');
          return;
        } else {
          // No variations: support single by-the-foot items (e.g., Vinyl Top by the FT, Screen Padding by the FT)
          const isByFootTitle = /by\s*the\s*f(?:oot|t)\b/i.test(String(prod.title||''));
          const isByFootId = /xft$/i.test(String(prod.id||'')) || /-xft-/i.test(String(prod.id||'')) || /xft/i.test(String(prod.id||''));
          if (isByFootTitle || isByFootId) {
            const feetInput = document.getElementById('pd-feet');
            let feet = Number(feetInput?.value || 1); if (!Number.isFinite(feet) || feet < 1) feet = 1; feet = Math.floor(feet);
            const perFoot = Number(prod.price || prod.priceMin || 0) || 0;
            if (perFoot > 0) {
              chosenPrice = perFoot * feet;
              chosenLabel = `${chosenLabel} (${feet}')`;
            }
          }
        }
        // Pass option as size to preserve cart key uniqueness
        const size = (optSel && optSel.value)
          ? (() => {
              const optEl = optSel.options[optSel.selectedIndex];
              const byFoot = (optEl?.dataset?.byfoot === '1') || /\bby\s*the\s*foot\b/i.test(String(optSel.value||''));
              if (!byFoot) return optSel.value;
              let feet = Number(document.getElementById('pd-feet')?.value || 1);
              if (!Number.isFinite(feet) || feet < 1) feet = 1;
              feet = Math.floor(feet);
              return `${optSel.value}: ${feet}'`;
            })()
          : (() => {
              // For single by-foot products, include feet in size for clarity
              const isByFootTitle = /by\s*the\s*f(?:oot|t)\b/i.test(String(prod.title||''));
              const isByFootId = /xft$/i.test(String(prod.id||'')) || /-xft-/i.test(String(prod.id||'')) || /xft/i.test(String(prod.id||''));
              if (isByFootTitle || isByFootId) {
                let feet = Number(document.getElementById('pd-feet')?.value || 1); if (!Number.isFinite(feet) || feet < 1) feet = 1; feet = Math.floor(feet);
                return `By the Foot: ${feet}'`;
              }
              return (singleVar && singleVar.option ? singleVar.option : undefined);
            })();
        const color = (colorSel && colorSel.value) ? colorSel.value : undefined;
        // Include per-product shipping only when an explicit dsr is defined (>0). Otherwise omit and default $100 applies at checkout.
        const product = { id: prod.id, title: chosenLabel, price: chosenPrice, img: chosenImg, category: 'netting' };
        const opts = { size, color };
        // Free shipping override
        try {
          const lid = String(prod.id||'').toLowerCase();
          const lt = String(prod.title||'').toLowerCase();
          const isFreeShip = (lid === 'battingmat' || lid === 'armorbasket') || (/\bbatting\s*mat\b/.test(lt)) || (/armor\s*(baseball)?\s*cart|armor\s*basket/.test(lt));
          if (isFreeShip) opts.ship = 0;
        } catch {}
        if (Number(chosenShipRaw) > 0 && typeof opts.ship === 'undefined') opts.ship = Number(chosenShipRaw);
        window.Store && window.Store.add(product, opts);
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
          const dsr = Number(m.dsr ?? m.details?.dsr ?? 0) || 0;
          return { option: opt, map: price, price, sku: m.sku || m.id, img, dsr };
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
  const dsrs = variations.map(v=>Number(v.dsr||0)).filter(n=>Number.isFinite(n) && n>0);
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
          variations,
          dsr: (dsrs.length ? Math.min(...dsrs) : 0)
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
          const dsr = Number(m.dsr ?? m.details?.dsr ?? 0) || 0;
          return { option, map: price, price, sku: m.sku || m.id, img, dsr };
        });
        const first = cables[0] || {};
  // Curated hero image for Cable
  const curatedHero = 'assets/prodImgs/Accessories/Cable/cable.jpeg';
  const primary = curatedHero || variations.find(v=>v.img)?.img || first.img || '';
        const gallery = variations.map(v=>v.img).filter(Boolean);
        const galleryPairs = (gallery.length ? gallery : [primary]).filter(Boolean).slice(0,12).map(src=>({thumb:src, large:src}));
        const displayPairs = galleryPairs.slice(0, Math.min(8, galleryPairs.length));
  const prices = variations.map(v=>v.price).filter(n=>Number.isFinite(n) && n>0);
  const dsrs = variations.map(v=>Number(v.dsr||0)).filter(n=>Number.isFinite(n) && n>0);
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
          variations,
          dsr: (dsrs.length ? Math.min(...dsrs) : 0)
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
        const vDsrSpool = Number(ropeSpool?.dsr ?? ropeSpool?.details?.dsr ?? 0) || 0;
        const vDsrFt = Number(ropeFt?.dsr ?? ropeFt?.details?.dsr ?? 0) || 0;
        const variations = [
          { option: "1270' Spool", map: 230, price: 230, sku: '5/16-TPLYSTER-1270', img: primary, dsr: vDsrSpool },
          { option: 'By the Foot', map: 1, price: 1, sku: '5/16-TPLYSTER-xFT', img: primary, dsr: vDsrFt }
        ];
        const priceMin = 1; const priceMax = 230;
        const dsrs = [vDsrSpool, vDsrFt].filter(n=>Number.isFinite(n) && n>0);
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
          variations,
          dsr: (dsrs.length ? Math.min(...dsrs) : 0)
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
          img: (m.img || (m.images && (m.images.primary || (Array.isArray(m.images) && m.images[0])))) || '',
          dsr: Number(m.dsr ?? m.details?.dsr ?? 0) || 0
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
  const dsrs = variations.map(v=>Number(v.dsr||0)).filter(n=>Number.isFinite(n) && n>0);
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
          variations,
          dsr: (dsrs.length ? Math.min(...dsrs) : 0)
        };
        render(synthetic);
        return;
      }

      // Normal single-product detail
      // Resolve by multiple keys to avoid collisions on generic SKUs (e.g., "Screen Component")
      const pidNorm = String(pid||'');
      const pidLower = pidNorm.toLowerCase();
      const raw = all.find(p => {
        const id = String(p.id||'');
        const sku = String(p.sku||'');
        const name = String(p.name||p.title||'');
        const title = String(p.title||p.name||'');
        if (id === pidNorm || sku === pidNorm || name === pidNorm || title === pidNorm) return true;
        // also match lowercase forms
        if (id.toLowerCase() === pidLower || sku.toLowerCase() === pidLower) return true;
        // support slug-based linking by name/title
        const nameSlug = toSlug(name);
        const titleSlug = toSlug(title);
        if (nameSlug && nameSlug === pidLower) return true;
        if (titleSlug && titleSlug === pidLower) return true;
        return false;
      });
      // Guard: if an item was explicitly hidden but somehow slipped through, suppress rendering
      if (raw && (raw.hidden === true || raw.draft === true || raw.active === false || raw.exclude === true || raw.excluded === true)) {
        render(null);
        return;
      }
      render(raw ? toDisplayItem(raw) : null);
    } catch (e) {
      render(null);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
