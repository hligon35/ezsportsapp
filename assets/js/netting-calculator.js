// Netting Calculator: live pricing and add-to-cart for custom net panels
// Pricing model: mesh priced per square foot (MAP = wholesale + markup from netting.json);
// sewn border adds per linear foot; expedited adds flat fee (from netting.json defaults)

const NCurrency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

// Fallback meshes (used if assets/netting.json is missing or fails to load)
let MESHES = [
  // Meshes (prices kept at full precision; UI displays two decimals only)
  // Baseball gauges (#xx)
  { id: 'baseball-18', label: '#18', priceSqFt: 0.2699, sport: 'baseball' },
  { id: 'baseball-21', label: '#21', priceSqFt: 0.3267, sport: 'baseball' },
  { id: 'baseball-30', label: '#30', priceSqFt: 0.4235, sport: 'baseball' },
  { id: 'baseball-36', label: '#36', priceSqFt: 0.4961, sport: 'baseball' },
  { id: 'baseball-42', label: '#42', priceSqFt: 0.5687, sport: 'baseball' },
  { id: 'baseball-60', label: '#60', priceSqFt: 0.847, sport: 'baseball' },
  { id: 'baseball-96', label: '#96', priceSqFt: 1.5125, sport: 'baseball' },

  // Golf variants
  { id: 'golf-golf', label: 'Golf', priceSqFt: 0.46, sport: 'golf' },
  { id: 'golf-30', label: 'Golf 30', priceSqFt: 0.9075, sport: 'golf' },
  { id: 'golf-ntp', label: 'NTPGolf', priceSqFt: 0.242, sport: 'golf' },

  // Soccer variants
  { id: 'soccer-21', label: 'Soccer 21', priceSqFt: 0.1573, sport: 'soccer' },
  { id: 'soccer-36', label: 'Soccer 36', priceSqFt: 0.2662, sport: 'soccer' },

  // Lacrosse variants
  { id: 'lacrosse-21', label: 'Lax 21', priceSqFt: 0.363, sport: 'lacrosse' },
  { id: 'lacrosse-30', label: 'Lax 30', priceSqFt: 0.5082, sport: 'lacrosse' },

  // Poly / NOVA / DN variants (categorized as other)
  { id: 'poly-21', label: 'Poly 21', priceSqFt: 0.218405, sport: 'other' },
  { id: 'poly-36', label: 'Poly 36', priceSqFt: 0.3267, sport: 'other' },
  { id: 'nova-24', label: 'NOVA24', priceSqFt: 0.58212, sport: 'other' },
  { id: 'nova-30', label: 'NOVA30', priceSqFt: 0.627, sport: 'other' },
  { id: 'nova-44', label: 'NOVA44', priceSqFt: 0.8925, sport: 'other' },
  { id: 'dn-6', label: 'DN6', priceSqFt: 0.6, sport: 'other' },
  { id: 'dn-18', label: 'DN18', priceSqFt: 1.6, sport: 'other' }
];

// Runtime-configurable defaults; replaced once netting.json is loaded
let BORDER_SURCHARGE_PER_FT = 0.35; // sewn border adds this per linear foot
let EXPEDITED_FEE = 25; // flat
let SHIP_PER_ITEM = 100; // per configured panel

async function loadNettingConfig() {
  try {
    const res = await fetch('assets/netting.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('netting.json fetch failed');
    const data = await res.json();
    const defaults = data.defaults || {};
    // Update defaults if provided
    if (Number.isFinite(defaults.borderSurchargePerFt)) BORDER_SURCHARGE_PER_FT = Number(defaults.borderSurchargePerFt);
    if (Number.isFinite(defaults.expeditedFee)) EXPEDITED_FEE = Number(defaults.expeditedFee);
    if (Number.isFinite(defaults.shipPerItem)) SHIP_PER_ITEM = Number(defaults.shipPerItem);
    const markup = Number(defaults.markupPerSqFt || 0.25);

    if (Array.isArray(data.meshPrices) && data.meshPrices.length) {
      // Build MESHES using MAP = wholesale + markup
      MESHES = data.meshPrices.map(m => ({
        id: String(m.id),
        label: String(m.label),
        sport: String(m.sport || 'other'),
        // priceSqFt exposed to UI is MAP; internal calc also uses MAP
        priceSqFt: Number(m.wholesaleSqFt || 0) + markup,
        wholesaleSqFt: Number(m.wholesaleSqFt || 0),
        markupPerSqFt: markup
      }));
    }
  } catch (e) {
    // Keep fallback pricing; log in dev
    try { console.warn('Using fallback netting pricing:', e.message || e); } catch {}
  }
}

function toFeet(ft, inches) {
  const f = Number(ft) || 0; const i = Math.min(11, Math.max(0, Number(inches) || 0));
  return f + (i / 12);
}

function calcTotals({ meshId, lenFt, lenIn, widFt, widIn, border, qty, fab }) {
  const mesh = MESHES.find(m => m.id === meshId) || MESHES[0];
  const L = toFeet(lenFt, lenIn);
  const W = toFeet(widFt, widIn);
  const area = Math.max(1, L * W); // sq ft
  const perim = 2 * (L + W); // ft
  const base = area * mesh.priceSqFt;
  const borderCost = border === 'sewn' ? perim * BORDER_SURCHARGE_PER_FT : 0;
  const perPanel = base + borderCost;
  const expedited = fab === 'expedited' ? EXPEDITED_FEE : 0;
  const total = (perPanel * qty) + expedited;
  return { mesh, L, W, area, perim, perPanel, expedited, total };
}

function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

// Normalize raw feet/inches to canonical integers with inch carryover
function normalizeFeetInches(ft, inches){
  let f = Math.max(0, Math.floor(Number(ft) || 0));
  let i = Math.max(0, Math.floor(Number(inches) || 0));
  if (i >= 12){ f += Math.floor(i / 12); i = i % 12; }
  return { ft: f, in: i };
}

function buildDimsFormats(config){
  const L = normalizeFeetInches(config.lenFt, config.lenIn);
  const W = normalizeFeetInches(config.widFt, config.widIn);
  const display = `${L.ft}' ${L.in}" x ${W.ft}' ${W.in}"`;
  const key = `${L.ft}ft-${L.in}in_x_${W.ft}ft-${W.in}in`;
  return { display, key };
}

function ensureCustomProduct(config, totals){
  // Create a unique product id per configuration so cart lines track distinct pricing
  const dimsFmt = buildDimsFormats(config);
  const id = `custom-net-${slugify(config.meshId)}-${slugify(dimsFmt.key)}-${config.border}-${config.fab}`;
  const title = `Custom Net ${dimsFmt.display} — ${totals.mesh.label} (${config.border} border${config.fab==='expedited'?' • Expedited':''})`;
  const product = {
    id,
    title,
    price: Number(totals.perPanel.toFixed(2)), // per panel price
    category: 'netting',
    // Default a consistent local image for all custom netting items in cart/checkout
    img: 'assets/img/netting3.jpg'
  };
  // Make sure PRODUCTS exists and include this product for cart rendering
  if (window.PRODUCTS && !window.PRODUCTS.find(p => p.id === id)) {
    window.PRODUCTS.push(product);
  }
  return product;
}

function updateSummary(form){
  const data = readForm(form);
  const t = calcTotals(data);
  // Show dimensions consistently in ft/in
  const dimsFmt = buildDimsFormats(data);
  document.getElementById('sum-area').textContent = `${t.area.toFixed(1)} sq ft`;
  document.getElementById('sum-mesh').textContent = MESHES.find(m=>m.id===data.meshId)?.label || '—';
  document.getElementById('sum-border').textContent = data.border === 'sewn' ? 'Sewn' : 'Regular';
  document.getElementById('sum-perim').textContent = `${t.perim.toFixed(1)} ft`;
  document.getElementById('sum-qty').textContent = String(data.qty);
  document.getElementById('sum-total').textContent = NCurrency.format(t.total);
  return t;
}

function readForm(form){
  return {
    meshId: form.querySelector('#mesh').value,
  usage: form.querySelector('#usage')?.value || '',
    lenFt: form.querySelector('#len-ft').value,
    lenIn: form.querySelector('#len-in').value,
    widFt: form.querySelector('#wid-ft').value,
    widIn: form.querySelector('#wid-in').value,
    border: form.querySelector('input[name="border"]:checked')?.value || 'regular',
    qty: Math.max(1, Number(form.querySelector('#qty').value) || 1),
    // Fabrication selection removed; default to standard for backward compatibility
    fab: 'standard'
  };
}

function bindQtyControls(form){
  const qty = form.querySelector('#qty');
  form.querySelector('#qty-inc').addEventListener('click',()=>{ qty.value = String(Math.max(1,(Number(qty.value)||1)+1)); updateSummary(form); });
  form.querySelector('#qty-dec').addEventListener('click',()=>{ qty.value = String(Math.max(1,(Number(qty.value)||1)-1)); updateSummary(form); });
}

function setup(){
  const form = document.getElementById('net-form');
  if(!form) return;
  // Load pricing config first, then render UI
  loadNettingConfig().then(()=>{
  // Populate mesh options – group by inferred sport for scannability
  const sel = form.querySelector('#mesh');
  const groups = {};
  MESHES.forEach(m=>{
    const sport = m.sport || (/(baseball)/i.test(m.label)?'baseball':/(golf)/i.test(m.label)?'golf':/(lacrosse)/i.test(m.label)?'lacrosse':/(soccer)/i.test(m.label)?'soccer':'other');
    groups[sport] = groups[sport] || [];
    groups[sport].push(m);
  });
  const sportLabels = { baseball:'Baseball', golf:'Golf', lacrosse:'Lacrosse', soccer:'Soccer', other:'Other'};
  let options = '<option value="">— Select Mesh —</option>';
  Object.keys(groups).forEach(key=>{
    options += `<optgroup label="${sportLabels[key]||key}">` +
      groups[key].map(m=>{
        // Keep compact labels but preserve identifiers like "#18" and specific names when already short
        const hasParen = m.label.includes('(');
        const short = hasParen ? (m.sport || m.label.split('(')[0]).trim().replace(/\s+\(.*$/,'') : m.label.trim();
        // Display price with two decimals via currency formatter; calculations retain full precision
        return `<option value="${m.id}" data-full="${m.label}">${short} — ${NCurrency.format(m.priceSqFt)}/sq ft</option>`;
      }).join('') + '</optgroup>';
  });
  sel.innerHTML = options;
  sel.value = '';
  // Helper description below select (created once)
  let helper = form.querySelector('#mesh-help');
  if(!helper){
    helper = document.createElement('p');
    helper.id = 'mesh-help';
    helper.className = 'muted mesh-help';
    // Place helper at end of the label's parent (form) directly after the label wrapper for consistent spacing
    const labelRow = sel.closest('label.form-row');
    if(labelRow && labelRow.parentNode){
      labelRow.insertAdjacentElement('afterend', helper);
    } else {
      sel.insertAdjacentElement('afterend', helper);
    }
  }

  const usageWrap = document.getElementById('usage-wrap');
  function updateUsageVisibility(){
    const mesh = MESHES.find(m=>m.id===sel.value);
    const isBaseball = !!mesh && (mesh.sport === 'baseball' || /baseball/i.test(mesh.label));
    if (usageWrap) {
      usageWrap.classList.toggle('hidden', !isBaseball);
      usageWrap.style.display = isBaseball ? '' : 'none';
    }
    if (!isBaseball) {
      const usageSel = document.getElementById('usage');
      if (usageSel) usageSel.value = '';
    }
    // Update helper text with contextual guidance
    if (helper) {
      if (!mesh){
        helper.textContent = 'Select a sport mesh size to view pricing per square foot.';
      } else {
  // Display-only rounding to two decimals; keeps internal precision for calc
  const rate = `${NCurrency.format(Math.round(mesh.priceSqFt * 100) / 100)}/sq ft`;
        let extra = '';
        if(isBaseball) extra = ' Choose a usage profile for more tailored recommendations.';
  helper.textContent = `${mesh.label} — ${rate}.${extra}`;
      }
    }
  }
  updateUsageVisibility();

  // Bind change handlers
  form.querySelectorAll('input, select').forEach(el=>{
    el.addEventListener('input', ()=> updateSummary(form));
    el.addEventListener('change', ()=> updateSummary(form));
  });
  sel.addEventListener('change', updateUsageVisibility);
  bindQtyControls(form);

  // Initial
  let totals = updateSummary(form);

  // Add to cart
  document.getElementById('add-cart').addEventListener('click', ()=>{
    const data = readForm(form);
    if (!data.meshId){
      alert('Please select a sport/mesh size before adding to cart.');
      return;
    }
    const t = calcTotals(data);
    const product = ensureCustomProduct(data, t);
    const variantSize = buildDimsFormats(data).display;
  const usage = (data.usage||'').trim();
  const mesh = MESHES.find(m=>m.id===data.meshId);
  const isBaseball = !!mesh && (mesh.sport === 'baseball' || /baseball/i.test(mesh.label));
  const variantColor = `${t.mesh.label}${(isBaseball && usage)?` • ${usage}`:''} | ${data.border}`;

    // Add N times for quantity
    const n = data.qty;
    for(let i=0;i<n;i++){
      // Pass explicit per-item shipping amount from config so backend honors it
      window.Store?.add(product, { size: variantSize, color: variantColor, ship: SHIP_PER_ITEM });
    }
    window.Store?.openCart();
  });
  }); // end loadNettingConfig
}

window.addEventListener('DOMContentLoaded', setup);

// --- Gallery (progressive enhancement) ---
(function(){
  window.addEventListener('DOMContentLoaded', ()=>{
  const list = document.getElementById('calc-gallery');
  const mainImg = document.querySelector('.calc-media .media-crop img');
  if(!list || !mainImg) return;
    // Add loading class to reserve space & show skeleton until images resolved
    list.classList.add('loading');
    // Define candidate images (will attempt to use any that actually exist). Since assets/img/info is empty now,
    // we include fallbacks (reuse existing netting image + generic ones) – these won't 404 because they already exist.
    // Build candidate list: look for sequentially named files user may add later in assets/img/info (net-info-1.jpg/png etc.)
    // Actual provided images (deterministic ordering)
    const provided = [
      'assets/info/baseballnetting1.png',
      'assets/info/baseballnetting2.png',
      'assets/info/golfnetting.png',
      'assets/info/lacrossenetting.png',
      'assets/info/soccernetting.png',
      'assets/info/nettingoptions.png',
      'assets/info/netsizing.png'
    ];
    // Fallbacks (existing site images) if some fail to load
    const fallbacks = [
      'assets/img/netting3.jpg',
      'assets/img/netting.jpg',
      'assets/img/netting2.jpg',
      'assets/img/netting4.jpg',
      'assets/img/netting5.jpg'
    ];
    const candidates = [...provided, ...fallbacks];
    // De‑dupe & filter to those that load successfully; create promises to probe images quickly (timeout 2s)
    const unique = [...new Set(candidates)];
    const loaders = unique.map(src => new Promise(resolve => {
      const img = new Image();
      let done = false;
      const finish = ok => { if(done) return; done = true; resolve(ok ? src : null); };
      img.onload = ()=>finish(true);
      img.onerror = ()=>finish(false);
      img.src = src;
      setTimeout(()=>finish(false), 2000);
    }));
    Promise.all(loaders).then(results => {
      const imgs = results.filter(Boolean);
      list.innerHTML = '';
      if(!imgs.length){
        // Keep friendly empty state; allow future population if images added later without code changes
        list.innerHTML = '<li class="gallery-empty">Add images to assets/img/info to populate gallery.</li>';
        list.classList.remove('loading');
        return;
      }
      // Build items first
      const items = imgs.slice(0,8).map((src,i)=>{
        const li = document.createElement('li');
        if(i===0) li.classList.add('is-active');
        const btn = document.createElement('button');
        btn.type='button';
        btn.setAttribute('aria-label','View image '+(i+1));
        btn.innerHTML = `<img src="${src}" alt="Netting detail ${i+1}">`;
        btn.addEventListener('click',()=>{
          if(mainImg.getAttribute('src')!==src){
            mainImg.style.opacity='0';
            setTimeout(()=>{
              mainImg.setAttribute('src',src);
              mainImg.style.transition='opacity .25s ease';
              requestAnimationFrame(()=>{ mainImg.style.opacity='1'; });
              setTimeout(()=>{ mainImg.style.transition=''; },300);
            },120);
          }
          list.querySelectorAll('li').forEach(li=>li.classList.remove('is-active'));
          li.classList.add('is-active');
        });
        li.appendChild(btn);
        return li;
      });
      // If narrow viewport, activate slider mode
      const activateSlider = () => window.matchMedia('(max-width:640px)').matches;
      if(activateSlider()){
        list.classList.add('slider');
        // Create track
        const track = document.createElement('div');
        track.className = 'calc-gallery-track';
        items.forEach(li=>track.appendChild(li));
        list.innerHTML='';
        list.appendChild(track);
        // Nav
        const nav = document.createElement('div');
        nav.className='gallery-nav';
        const prev = document.createElement('button'); prev.type='button'; prev.className='gallery-btn prev'; prev.setAttribute('aria-label','Previous thumbnails'); prev.textContent='‹';
        const next = document.createElement('button'); next.type='button'; next.className='gallery-btn next'; next.setAttribute('aria-label','Next thumbnails'); next.textContent='›';
        nav.appendChild(prev); nav.appendChild(next); list.appendChild(nav);
        let index=0; const visible= Math.max(1, Math.floor((list.clientWidth - 10) / 70));
        function clamp(i){ return Math.max(0, Math.min(items.length - visible, i)); }
        function update(){ track.style.transform = `translateX(${-index*(70+8)}px)`; }
        prev.addEventListener('click',()=>{ index = clamp(index-1); update(); });
        next.addEventListener('click',()=>{ index = clamp(index+1); update(); });
        // Recompute on resize
        window.addEventListener('resize',()=>{ if(!activateSlider()) return; update(); });
        update();
      } else {
        // Standard wrapping grid
        list.innerHTML='';
        items.forEach(li=>list.appendChild(li));
      }
      // Trigger fade-in
      const fadeTargets = list.querySelectorAll('li');
      fadeTargets.forEach((li,idx)=>{
        li.style.opacity='0';
        li.style.transition='opacity .4s ease';
        setTimeout(()=>{ li.style.opacity='1'; },30+idx*40);
      });
      list.classList.remove('loading');
    });
  });
})();
