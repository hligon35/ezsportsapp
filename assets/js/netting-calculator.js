// Netting Calculator: live pricing and add-to-cart for custom net panels
// Pricing model (example): mesh priced per square foot; sewn border adds per linear foot; expedited adds flat fee

const NCurrency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

const MESHES = [
  { id: 'baseball-1-7-8', label: 'Baseball (1-7/8" x 1-7/8" Sq Mesh)', priceSqFt: 1.25, sport: 'baseball' },
  { id: 'golf-1', label: 'Golf (1" x 1" Sq Mesh)', priceSqFt: 0.95 },
  { id: 'lacrosse-1-1-2', label: 'Lacrosse (1-1/2" x 1-1/2" Sq Mesh)', priceSqFt: 1.20 },
  { id: 'soccer-4', label: 'Soccer (4" x 4" Sq Mesh)', priceSqFt: 0.80 }
];

const BORDER_SURCHARGE_PER_FT = 0.35; // sewn border adds this per linear foot
const EXPEDITED_FEE = 25; // flat

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

function ensureCustomProduct(config, totals){
  // Create a unique product id per configuration so cart lines track distinct pricing
  const dims = `${totals.L.toFixed(2)}x${totals.W.toFixed(2)}`;
  const id = `custom-net-${slugify(config.meshId)}-${slugify(dims)}-${config.border}-${config.fab}`;
  const title = `Custom Net ${dims} ft — ${totals.mesh.label} (${config.border} border${config.fab==='expedited'?' • Expedited':''})`;
  const product = {
    id,
    title,
    price: Number(totals.perPanel.toFixed(2)), // per panel price
    category: 'netting',
    img: 'https://images.unsplash.com/photo-1551892374-5d94925ad893?q=80&w=800&auto=format&fit=crop'
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
    fab: form.querySelector('input[name="fab"]:checked')?.value || 'standard'
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
  // Populate mesh options
  const sel = form.querySelector('#mesh');
  sel.innerHTML = `<option value="">— Select —</option>` +
    MESHES.map(m=>`<option value="${m.id}">${m.label} — ${NCurrency.format(m.priceSqFt)}/sq ft</option>`).join('');
  sel.value = '';

  const usageWrap = document.getElementById('usage-wrap');
  function updateUsageVisibility(){
  const mesh = MESHES.find(m=>m.id===sel.value);
  const isBaseball = !!mesh && (mesh.sport === 'baseball' || /baseball/i.test(mesh.label));
    if (usageWrap) {
      usageWrap.classList.toggle('hidden', !isBaseball);
      // Force inline style to override any layout rules
      usageWrap.style.display = isBaseball ? '' : 'none';
    }
    if (!isBaseball) {
      const usageSel = document.getElementById('usage');
      if (usageSel) usageSel.value = '';
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
    const variantSize = `${t.L.toFixed(2)}' x ${t.W.toFixed(2)}'`;
  const usage = (data.usage||'').trim();
  const mesh = MESHES.find(m=>m.id===data.meshId);
  const isBaseball = !!mesh && (mesh.sport === 'baseball' || /baseball/i.test(mesh.label));
  const variantColor = `${t.mesh.label}${(isBaseball && usage)?` • ${usage}`:''} | ${data.border}${data.fab==='expedited'?' | Expedited':''}`;

    // Add N times for quantity
    const n = data.qty;
    for(let i=0;i<n;i++){
      window.Store?.add(product, { size: variantSize, color: variantColor });
    }
    // Add expedited fee as separate line item once
    if (data.fab === 'expedited') {
      const feeProduct = {
        id: 'custom-net-expedited-fee',
        title: 'Expedited Fabrication (3–6 days)',
        price: EXPEDITED_FEE,
        category: 'netting',
        img: 'https://images.unsplash.com/photo-1551892374-5d94925ad893?q=80&w=800&auto=format&fit=crop'
      };
      if (window.PRODUCTS && !window.PRODUCTS.find(p=>p.id==='custom-net-expedited-fee')){
        window.PRODUCTS.push(feeProduct);
      }
      window.Store?.add(feeProduct, { size: '—', color: '—' });
    }
    window.Store?.openCart();
  });
}

window.addEventListener('DOMContentLoaded', setup);
