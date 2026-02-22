// Netting Calculator: live pricing and add-to-cart for custom net panels
// Pricing model: mesh priced per square foot (MAP = wholesale + markup from netting.json);
// sewn border adds per linear foot; expedited adds flat fee (from netting.json defaults)

import { getPricingData } from './netting-pricing-data-loader.js';

const NCurrency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

let NET_COMPONENTS = [];
let BORDER_OPTIONS = [];
let SHIP_PER_ITEM = 100; // per configured panel

let ACTIVE_CREATOR = 'panel'; // 'panel' | 'cage'

function normKey(s) { return String(s || '').trim().toLowerCase(); }

function findBorderOption(borderType) {
  const k = normKey(borderType);
  return BORDER_OPTIONS.find(b => normKey(b?.border_type) === k) || null;
}

function mapUiBorderToBorderType(uiBorder) {
  // Keep existing UX labels (Regular/Sewn) but map to CSV-driven border types.
  if (uiBorder === 'sewn') return 'Sewn Rope';
  return 'Rope';
}

async function loadNettingConfig() {
  try {
    const res = await fetch('assets/netting.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('netting.json fetch failed');
    const data = await res.json();
    const defaults = data.defaults || {};
    if (Number.isFinite(defaults.shipPerItem)) SHIP_PER_ITEM = Number(defaults.shipPerItem);
  } catch (e) {
    // Shipping config is optional; pricing is now CSV-backed.
    try { console.warn('Netting config load failed (shipping defaults only):', e.message || e); } catch {}
  }
}

function toFeet(ft) {
  return Number(ft) || 0;
}

function calcTotals({ meshId, lenFt, widFt, border, qty, fab }) {
  const mesh = NET_COMPONENTS.find(m => normKey(m.name) === normKey(meshId)) || NET_COMPONENTS[0];
  const L = toFeet(lenFt);
  const W = toFeet(widFt);
  const area = Math.max(1, L * W); // sq ft
  const perim = 2 * (L + W); // ft
  const base = area * (Number(mesh?.retail_price_per_unit) || 0);
  const nettingWeightLbs = area * (Number(mesh?.weight_per_unit) || 0);
  const borderType = mapUiBorderToBorderType(border);
  const borderOpt = findBorderOption(borderType);
  const borderCost = perim * (Number(borderOpt?.base_cost) || 0);
  const borderWeightLbs = perim * (Number(borderOpt?.weight_per_unit) || 0);
  const perPanel = base + borderCost;
  const expedited = 0;
  const total = (perPanel * qty) + expedited;
  const weightLbsEach = nettingWeightLbs + borderWeightLbs;
  return { mesh, L, W, area, perim, perPanel, expedited, total, weightLbsEach };
}

function calcCageTotals({ meshId, widFt, lenFt, hgtFt, border, doors, qty }) {
  const mesh = NET_COMPONENTS.find(m => normKey(m.name) === normKey(meshId)) || NET_COMPONENTS[0];
  const W = toFeet(widFt);
  const L = toFeet(lenFt);
  const H = toFeet(hgtFt);

  // Surface area approximation consistent with catalog "tube" cages: (perimeter of cross-section) * length
  // Cross-section is Width x Height; no end caps.
  const tubePerimeter = 2 * (W + H); // ft
  const area = Math.max(1, tubePerimeter * L); // sq ft

  // Border for cages: apply to both open ends (2x cross-section perimeter)
  const borderLinearFt = 2 * tubePerimeter; // ft

  const base = area * (Number(mesh?.retail_price_per_unit) || 0);
  const nettingWeightLbs = area * (Number(mesh?.weight_per_unit) || 0);
  const borderType = mapUiBorderToBorderType(border);
  const borderOpt = findBorderOption(borderType);
  const borderCost = borderLinearFt * (Number(borderOpt?.base_cost) || 0);
  const borderWeightLbs = borderLinearFt * (Number(borderOpt?.weight_per_unit) || 0);

  const doorCount = Math.max(0, Math.floor(Number(doors) || 0));
  const doorFee = doorCount * 50;

  const perCage = base + borderCost + doorFee;
  const total = perCage * Math.max(1, Number(qty) || 1);
  const weightLbsEach = nettingWeightLbs + borderWeightLbs;
  return { mesh, W, L, H, area, perim: borderLinearFt, perCage, doorCount, doorFee, total, weightLbsEach };
}

function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

function normalizeFeet(ft){
  return Math.max(0, Math.floor(Number(ft) || 0));
}

function buildDimsFormats(config){
  const L = normalizeFeet(config.lenFt);
  const W = normalizeFeet(config.widFt);
  // UI shows Width, then Length
  const display = `${W}' x ${L}'`;
  const key = `${W}ft_x_${L}ft`;
  return { display, key };
}

function buildCageDimsFormats(config){
  const W = normalizeFeet(config.widFt);
  const L = normalizeFeet(config.lenFt);
  const H = normalizeFeet(config.hgtFt);
  const display = `${W}' x ${L}' x ${H}'`;
  const key = `${W}ft_x_${L}ft_x_${H}ft`;
  return { display, key };
}

function ensureCustomProduct(config, totals){
  // Create a unique product id per configuration so cart lines track distinct pricing
  const dimsFmt = buildDimsFormats(config);
  const id = `custom-net-${slugify(config.meshId)}-${slugify(dimsFmt.key)}-${config.border}-${config.fab}`;
  const meshName = String(totals?.mesh?.name || config.meshId || 'Mesh').trim();
  const title = `Custom Net ${dimsFmt.display} — ${meshName} (${config.border} border${config.fab==='expedited'?' • Expedited':''})`;
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

function ensureCustomCageProduct(config, totals){
  const dimsFmt = buildCageDimsFormats(config);
  const id = `custom-cage-${slugify(config.meshId)}-${slugify(dimsFmt.key)}-${config.border}-doors-${config.doors}`;
  const meshName = String(totals?.mesh?.name || config.meshId || 'Mesh').trim();
  const title = `Custom Batting Cage ${dimsFmt.display} — ${meshName} (${config.border} border${config.doors?` • ${config.doors} doors`:''})`;
  const product = {
    id,
    title,
    price: Number((totals.perCage || 0).toFixed(2)),
    category: 'netting',
    img: 'assets/img/netting3.jpg'
  };
  if (window.PRODUCTS && !window.PRODUCTS.find(p => p.id === id)) {
    window.PRODUCTS.push(product);
  }
  return product;
}

function updateSummary(form){
  const data = readForm(form);
  const t = calcTotals(data);
  // Show dimensions consistently in feet
  const dimsFmt = buildDimsFormats(data);
  const areaEl = document.getElementById('sum-area');
  if (areaEl) areaEl.textContent = `${t.area.toFixed(1)} sq ft`;
  const meshEl = document.getElementById('sum-mesh');
  if (meshEl) meshEl.textContent = NET_COMPONENTS.find(m=>normKey(m.name)===normKey(data.meshId))?.name || '—';
  const borderEl = document.getElementById('sum-border');
  if (borderEl) borderEl.textContent = data.border === 'sewn' ? 'Sewn' : 'Regular';
  const perimEl = document.getElementById('sum-perim');
  if (perimEl) perimEl.textContent = `${t.perim.toFixed(1)} ft`;
  const qtyEl = document.getElementById('sum-qty');
  if (qtyEl) qtyEl.textContent = String(data.qty);
  const totalEl = document.getElementById('sum-total');
  if (totalEl) totalEl.textContent = NCurrency.format(t.total);
  // Mirror total into mobile sticky bar if present (panel active)
  const m = document.getElementById('sum-total-mobile');
  if (m && ACTIVE_CREATOR === 'panel') m.textContent = NCurrency.format(t.total);
  return t;
}

function updateCageSummary(form){
  const data = readCageForm(form);
  const t = calcCageTotals(data);
  const areaEl = document.getElementById('cage-sum-area');
  if (areaEl) areaEl.textContent = `${t.area.toFixed(1)} sq ft`;
  const meshEl = document.getElementById('cage-sum-mesh');
  if (meshEl) meshEl.textContent = NET_COMPONENTS.find(m=>normKey(m.name)===normKey(data.meshId))?.name || '—';
  const borderEl = document.getElementById('cage-sum-border');
  if (borderEl) borderEl.textContent = data.border === 'sewn' ? 'Sewn' : 'Regular';
  const perimEl = document.getElementById('cage-sum-perim');
  if (perimEl) perimEl.textContent = `${t.perim.toFixed(1)} ft`;
  const doorsEl = document.getElementById('cage-sum-doors');
  if (doorsEl) doorsEl.textContent = String(t.doorCount);
  const qtyEl = document.getElementById('cage-sum-qty');
  if (qtyEl) qtyEl.textContent = String(data.qty);
  const totalEl = document.getElementById('cage-sum-total');
  if (totalEl) totalEl.textContent = NCurrency.format(t.total);

  const m = document.getElementById('sum-total-mobile');
  if (m && ACTIVE_CREATOR === 'cage') m.textContent = NCurrency.format(t.total);
  return t;
}

function readForm(form){
  return {
    meshId: form.querySelector('#mesh').value,
    usage: form.querySelector('#usage')?.value || '',
    lenFt: form.querySelector('#len-ft').value,
    widFt: form.querySelector('#wid-ft').value,
    border: form.querySelector('#border')?.value || 'regular',
    qty: Math.max(1, Number(form.querySelector('#qty').value) || 1),
    // Fabrication selection removed; default to standard for backward compatibility
    fab: 'standard'
  };
}

function readCageForm(form){
  return {
    meshId: form.querySelector('#cage-mesh')?.value || '',
    widFt: form.querySelector('#cage-wid-ft')?.value,
    lenFt: form.querySelector('#cage-len-ft')?.value,
    hgtFt: form.querySelector('#cage-hgt-ft')?.value,
    border: form.querySelector('#cage-border')?.value || 'regular',
    doors: form.querySelector('#cage-doors')?.value,
    qty: Math.max(1, Number(form.querySelector('#cage-qty')?.value) || 1),
  };
}

function bindQtyControls(form, { qtySelector, incSelector, decSelector, onChange }){
  const qty = form.querySelector(qtySelector);
  const inc = form.querySelector(incSelector);
  const dec = form.querySelector(decSelector);
  if (!qty || !inc || !dec) return;
  inc.addEventListener('click',()=>{ qty.value = String(Math.max(1,(Number(qty.value)||1)+1)); onChange(); });
  dec.addEventListener('click',()=>{ qty.value = String(Math.max(1,(Number(qty.value)||1)-1)); onChange(); });
}

function populateMeshSelect(sel){
  if (!sel) return;
  const groups = {};
  NET_COMPONENTS.forEach(m=>{
    const sport = (/(^#)/.test(m.name)?'baseball':/(golf)/i.test(m.name)?'golf':/(lax|lacrosse)/i.test(m.name)?'lacrosse':/(soccer)/i.test(m.name)?'soccer':'other');
    groups[sport] = groups[sport] || [];
    groups[sport].push(m);
  });
  const sportLabels = { baseball:'Baseball', golf:'Golf', lacrosse:'Lacrosse', soccer:'Soccer', other:'Other'};
  let options = '<option value="">— Select Mesh —</option>';
  Object.keys(groups).forEach(key=>{
    options += `<optgroup label="${sportLabels[key]||key}">` +
      groups[key].map(m=>{
        const label = String(m.name || '').trim();
        const rate = Number(m.retail_price_per_unit) || 0;
        return `<option value="${label}" data-full="${label}">${label} — ${NCurrency.format(rate)}/sq ft</option>`;
      }).join('') + '</optgroup>';
  });
  sel.innerHTML = options;
  sel.value = '';
}

function ensureMeshHelper(form, sel, helperId){
  if (!form || !sel) return null;
  let helper = form.querySelector(`#${helperId}`);
  const labelRow = sel.closest('label.form-row');
  if (helper && labelRow && helper.parentElement !== labelRow) {
    labelRow.appendChild(helper);
  }
  if (!helper) {
    helper = document.createElement('p');
    helper.id = helperId;
    helper.className = 'muted mesh-help';
    sel.insertAdjacentElement('afterend', helper);
  }
  return helper;
}

function initGallery(){
  const list = document.getElementById('calc-gallery');
  const mainImg = document.querySelector('.calc-media .media-crop img');
  if (!list || !mainImg) return;

  list.classList.add('loading');

  const candidates = [
    'assets/img/netting3.jpg',
    'assets/img/netting2.jpg',
    'assets/img/netting.jpg',
    'assets/img/backstopnetting.jpg'
  ];

  const unique = [...new Set(candidates)];
  const loaders = unique.map(src => new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = ok => { if (done) return; done = true; resolve(ok ? src : null); };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = src;
    setTimeout(() => finish(false), 2000);
  }));

  Promise.all(loaders).then(results => {
    const imgs = results.filter(Boolean);
    list.innerHTML = '';
    if (!imgs.length) {
      list.innerHTML = '<li class="gallery-empty">Add images to assets/img to populate gallery.</li>';
      list.classList.remove('loading');
      return;
    }

    const items = imgs.slice(0, 8).map((src, i) => {
      const li = document.createElement('li');
      if (i === 0) li.classList.add('is-active');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'View image ' + (i + 1));
      btn.innerHTML = `<img src="${src}" alt="Netting detail ${i + 1}">`;
      btn.addEventListener('click', () => {
        if (mainImg.getAttribute('src') !== src) {
          mainImg.style.opacity = '0';
          setTimeout(() => {
            mainImg.setAttribute('src', src);
            mainImg.style.transition = 'opacity .25s ease';
            requestAnimationFrame(() => { mainImg.style.opacity = '1'; });
            setTimeout(() => { mainImg.style.transition = ''; }, 300);
          }, 120);
        }
        list.querySelectorAll('li').forEach(x => x.classList.remove('is-active'));
        li.classList.add('is-active');
      });
      li.appendChild(btn);
      return li;
    });

    const activateSlider = () => window.matchMedia('(max-width:640px)').matches;
    if (activateSlider()) {
      list.classList.add('slider');
      const track = document.createElement('div');
      track.className = 'calc-gallery-track';
      items.forEach(li => track.appendChild(li));
      list.innerHTML = '';
      list.appendChild(track);

      const nav = document.createElement('div');
      nav.className = 'gallery-nav';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'gallery-btn prev';
      prev.setAttribute('aria-label', 'Previous thumbnails');
      prev.textContent = '‹';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'gallery-btn next';
      next.setAttribute('aria-label', 'Next thumbnails');
      next.textContent = '›';
      nav.appendChild(prev);
      nav.appendChild(next);
      list.appendChild(nav);

      let index = 0;
      function visibleCount(){
        return Math.max(1, Math.floor((list.clientWidth - 10) / 70));
      }
      function clamp(i){
        return Math.max(0, Math.min(items.length - visibleCount(), i));
      }
      function update(){
        track.style.transform = `translateX(${-index * (70 + 8)}px)`;
      }
      prev.addEventListener('click', () => { index = clamp(index - 1); update(); });
      next.addEventListener('click', () => { index = clamp(index + 1); update(); });
      window.addEventListener('resize', () => { if (activateSlider()) update(); }, { passive: true });
      update();
    } else {
      list.innerHTML = '';
      items.forEach(li => list.appendChild(li));
    }

    list.querySelectorAll('li').forEach((li, idx) => {
      li.style.opacity = '0';
      li.style.transition = 'opacity .4s ease';
      setTimeout(() => { li.style.opacity = '1'; }, 30 + idx * 40);
    });

    list.classList.remove('loading');
  }).catch(() => {
    list.innerHTML = '<li class="gallery-empty">Unable to load gallery images.</li>';
    list.classList.remove('loading');
  });
}

async function setup(){
  const form = document.getElementById('net-form');
  const cageForm = document.getElementById('cage-form');
  if (!form && !cageForm) return;

  try {
    await loadNettingConfig();
    const data = await getPricingData();
    NET_COMPONENTS = Array.isArray(data?.pricingData?.netComponents) ? data.pricingData.netComponents : [];
    BORDER_OPTIONS = Array.isArray(data?.pricingData?.borderOptions) ? data.pricingData.borderOptions : [];
  } catch (e) {
    try { console.error('Failed to load pricing data:', e); } catch {}
    return;
  }

  let panelHandleAdd = null;
  if (form) {
    const sel = form.querySelector('#mesh');
    populateMeshSelect(sel);
    const panelHelper = ensureMeshHelper(form, sel, 'mesh-help');

    const usageWrap = document.getElementById('usage-wrap');
    function updateUsageVisibility(){
      const mesh = NET_COMPONENTS.find(m => normKey(m.name) === normKey(sel?.value));
      const isBaseball = !!mesh && (/(^#)/.test(mesh.name) || /baseball/i.test(mesh.name));
      if (usageWrap) {
        usageWrap.classList.toggle('hidden', !isBaseball);
        usageWrap.style.display = isBaseball ? '' : 'none';
      }
      if (!isBaseball) {
        const usageSel = document.getElementById('usage');
        if (usageSel) usageSel.value = '';
      }
      if (panelHelper) {
        if (!mesh) {
          panelHelper.textContent = 'Select a sport mesh size to view pricing per square foot.';
        } else {
          const per = Number(mesh.retail_price_per_unit) || 0;
          const rate = `${NCurrency.format(Math.round(per * 100) / 100)}/sq ft`;
          const extra = isBaseball ? ' Choose a usage profile for more tailored recommendations.' : '';
          panelHelper.textContent = `${mesh.name} — ${rate}.${extra}`;
        }
      }
    }

    const panelUpdate = () => { ACTIVE_CREATOR = 'panel'; updateSummary(form); };
    form.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', panelUpdate);
      el.addEventListener('change', panelUpdate);
    });
    sel?.addEventListener('change', updateUsageVisibility);
    bindQtyControls(form, {
      qtySelector: '#qty',
      incSelector: '#qty-inc',
      decSelector: '#qty-dec',
      onChange: panelUpdate
    });

    updateUsageVisibility();
    updateSummary(form);

    panelHandleAdd = function handleAdd(){
      ACTIVE_CREATOR = 'panel';
      const data = readForm(form);
      if (!data.meshId) {
        alert('Please select a sport/mesh size before adding to cart.');
        return;
      }
      const t = calcTotals(data);
      const product = ensureCustomProduct(data, t);
      const variantSize = buildDimsFormats(data).display;
      const usage = (data.usage || '').trim();
      const mesh = NET_COMPONENTS.find(m => normKey(m.name) === normKey(data.meshId));
      const isBaseball = !!mesh && (/(^#)/.test(mesh.name) || /baseball/i.test(mesh.name));
      const borderLabel = (data.border === 'sewn') ? 'Sewn' : 'Regular';
      const variantColor = `${t.mesh.name}${(isBaseball && usage) ? ` • ${usage}` : ''} | ${borderLabel}`;
      const n = data.qty;
      for (let i = 0; i < n; i++) {
        window.Store?.add(product, { size: variantSize, color: variantColor, ship: SHIP_PER_ITEM, weightLbsEach: t.weightLbsEach });
      }
      window.Store?.openCart();
    };
    document.getElementById('add-cart')?.addEventListener('click', panelHandleAdd);
  }

  let cageHandleAdd = null;
  if (cageForm) {
    const sel = cageForm.querySelector('#cage-mesh');
    populateMeshSelect(sel);
    const cageHelper = ensureMeshHelper(cageForm, sel, 'cage-mesh-help');
    if (cageHelper) cageHelper.textContent = 'Select a sport mesh size to view pricing per square foot.';

    const cageUpdate = () => { ACTIVE_CREATOR = 'cage'; updateCageSummary(cageForm); };
    cageForm.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', cageUpdate);
      el.addEventListener('change', cageUpdate);
    });
    bindQtyControls(cageForm, {
      qtySelector: '#cage-qty',
      incSelector: '#cage-qty-inc',
      decSelector: '#cage-qty-dec',
      onChange: cageUpdate
    });

    updateCageSummary(cageForm);

    cageHandleAdd = function handleAddCage(){
      ACTIVE_CREATOR = 'cage';
      const data = readCageForm(cageForm);
      if (!data.meshId) {
        alert('Please select a sport/mesh size before adding to cart.');
        return;
      }
      const t = calcCageTotals(data);
      const product = ensureCustomCageProduct(data, t);
      const variantSize = buildCageDimsFormats(data).display;
      const borderLabel = (data.border === 'sewn') ? 'Sewn' : 'Regular';
      const variantColor = `${t.mesh.name} | ${borderLabel}${t.doorCount ? ` | ${t.doorCount} doors` : ''}`;
      const n = data.qty;
      for (let i = 0; i < n; i++) {
        window.Store?.add(product, { size: variantSize, color: variantColor, ship: SHIP_PER_ITEM, weightLbsEach: t.weightLbsEach });
      }
      window.Store?.openCart();
    };
    document.getElementById('add-cart-cage')?.addEventListener('click', cageHandleAdd);
  }

  const addMobile = document.getElementById('add-cart-mobile');
  if (addMobile) {
    addMobile.addEventListener('click', () => {
      if (ACTIVE_CREATOR === 'cage' && typeof cageHandleAdd === 'function') return cageHandleAdd();
      if (typeof panelHandleAdd === 'function') return panelHandleAdd();
    });
  }
}

function init(){
  initGallery();
  setup();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
