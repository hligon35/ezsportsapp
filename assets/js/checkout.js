// Stripe Payment Element integration for cards, Apple Pay, Google Pay, PayPal
// Publishable key will be provided by a config endpoint or fallback (dev)
let stripe;
let stripeEnabled = false;
// Enable verbose logging with ?debug=1 or by setting window.__CHECKOUT_DEBUG = true
const DEBUG = (() => {
  try {
    const qd = new URLSearchParams(window.location.search);
    return qd.get('debug') === '1' || !!window.__CHECKOUT_DEBUG;
  } catch { return false; }
})();
// API base configuration: prefer window.__API_BASE or <meta name="api-base" content="https://api.example.com">
// Fallback guess: Render default domain from service name (adjust if your service name changes)
const __META_API = (function(){ try{ return (document.querySelector('meta[name="api-base"]')?.content||'').trim(); }catch{ return ''; } })();
const GUESSED_BASES = [ 'https://ezsportsapp.onrender.com' ];
let API_BASE = (typeof window !== 'undefined' && window.__API_BASE ? String(window.__API_BASE) : __META_API).replace(/\/$/, '');
if (DEBUG) { try { console.info('[checkout] initial API_BASE =', API_BASE || '(same-origin)'); } catch {} }

async function fetchJsonWithFallback(path, options){
  const bases = [ API_BASE || '', ...GUESSED_BASES.filter(b => b && b !== API_BASE) ];
  let lastErr = null;
  for (const base of bases) {
    const url = base ? (base + path) : path;
    try {
      const res = await fetch(url, options);
      // Success path
      if (res.ok) {
        // If we succeeded using a guessed base, persist it for subsequent calls
        if (base && base !== API_BASE) {
          API_BASE = base;
          if (DEBUG) { try { console.info('[checkout] API_BASE switched to', API_BASE); } catch {} }
        }
        return await res.json();
      }
      // If 404 and we haven't tried all, continue to next base
      if (res.status === 404) {
        if (DEBUG) { try { console.warn('[checkout] 404 at', url, 'trying next base'); } catch {} }
        continue;
      }
      // Other HTTP errors: return parsed error payload if possible
      try { return await res.json(); } catch {
        if (DEBUG) { try { console.error('[checkout] HTTP error', res.status, 'at', url); } catch {} }
        return { error: `HTTP ${res.status}` };
      }
    } catch (e) {
      lastErr = e;
      if (DEBUG) { try { console.warn('[checkout] fetch failed at', url, e?.message||e); } catch {} }
      // Try next base
    }
  }
  // If everything failed, surface a generic error
  if (lastErr) {
    if (DEBUG) { try { console.error('[checkout] all bases failed for', path, lastErr?.message||lastErr); } catch {} }
    return { error: lastErr.message || 'Network error' };
  }
  return { error: 'Request failed' };
}
async function getStripe() {
  if (stripe) return stripe;
  try {
  const cfg = await fetchJsonWithFallback('/api/config', { method: 'GET', cache: 'no-store' });
    try { window.__stripeCfg = cfg; } catch {}
    stripeEnabled = !!cfg.enabled;
    if (DEBUG) { try { console.info('[checkout] /api/config ->', cfg); } catch {} }
    stripe = Stripe(cfg.pk || 'pk_test_your_publishable_key');
  } catch {
    stripeEnabled = false;
    if (DEBUG) { try { console.warn('[checkout] /api/config failed; falling back to test pk'); } catch {} }
    stripe = Stripe('pk_test_your_publishable_key');
  }
  return stripe;
}

function currencyFmt(cents){ return (cents/100).toLocaleString(undefined,{style:'currency',currency:'USD'}); }
function readCart(){ try{ return JSON.parse(localStorage.getItem('cart')||'[]'); }catch{ return []; } }
function variantText(i){
  const parts = [];
  if ((i.size||'').trim()) parts.push(`Size ${i.size}`);
  if ((i.color||'').trim()) parts.push(`Color ${i.color}`);
  return parts.join(', ');
}

function toCents(n){ return Math.round(Number(n||0) * 100); }
function fromCents(c){ return Math.max(0, Math.round(Number(c||0))); }
function calcSubtotalCents(cart){
  return cart.reduce((sum,i)=> sum + (toCents(i.price||0) * (i.qty||0)), 0);
}
function calcShippingCentsForCart(cart){
  // New policy: each item has its own shipping: if item has dsr (ship), use it; otherwise default $100 per item
  let total = 0;
  for (const i of cart) {
    const raw = (typeof i.ship !== 'undefined') ? i.ship : i.shipAmount;
    const dsr = Number(raw);
    // Respect explicit zero as free shipping
    const per = Number.isFinite(dsr) ? (dsr === 0 ? 0 : (dsr > 0 ? dsr : 100)) : 100; // $100 default
    const qty = Math.max(1, Number(i.qty) || 1);
    total += Math.round(per * 100) * qty;
  }
  return total;
}
function taxRateForAddress(addr){
  // Mirror server defaults: GA 7%, else 0 unless overridden in future
  const country = String(addr?.country || 'US').toUpperCase();
  // Normalize common full state names to 2-letter codes for client-side fallback
  const RAW = String(addr?.state || '').trim();
  const MAP = { 'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA','COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA','HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA','KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD','MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO','MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH','OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC','SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA','WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY','DISTRICT OF COLUMBIA':'DC' };
  let state = RAW.toUpperCase();
  if (state.length > 2) state = MAP[state] || state;
  if (country === 'US' && state === 'GA') return 0.07;
  return 0;
}

function updateSummary(cart, applied, shippingAddr){
  const sub = calcSubtotalCents(cart);
  const ship = calcShippingCentsForCart(cart);
  let discount = 0;
  if (applied && applied.type && applied.value) {
    if (applied.type === 'percent') {
      discount = Math.round((sub + ship) * (Number(applied.value)||0) / 100);
    } else if (applied.type === 'fixed') {
      discount = Math.round(Number(applied.value||0) * 100);
    }
    if (discount > (sub + ship)) discount = (sub + ship);
  }
  // Tax is calculated on (sub + ship - discount)
  const taxBase = Math.max(0, sub + ship - discount);
  const rate = taxRateForAddress(shippingAddr||{});
  const tax = Math.round(taxBase * rate);
  const total = sub + ship - discount + tax;
  const el = (id) => document.getElementById(id);
  if (el('sum-subtotal')) el('sum-subtotal').textContent = currencyFmt(fromCents(sub));
  if (el('sum-shipping')) el('sum-shipping').textContent = ship === 0 ? 'Free' : currencyFmt(fromCents(ship));
  const taxRow = document.getElementById('tax-row');
  if (taxRow) taxRow.style.display = tax > 0 ? '' : 'none';
  const taxEl = document.getElementById('sum-tax');
  if (taxEl) taxEl.textContent = currencyFmt(fromCents(tax));
  if (discount > 0) {
    const row = document.getElementById('discount-row');
    if (row) row.style.display = '';
    const dEl = document.getElementById('sum-discount');
    if (dEl) dEl.textContent = '-' + currencyFmt(fromCents(discount));
  } else {
    const row = document.getElementById('discount-row');
    if (row) row.style.display = 'none';
  }
  if (el('sum-total')) el('sum-total').textContent = currencyFmt(fromCents(total));
  return { sub, ship, discount, tax, total };
}

function computeDiscountCents(sub, ship, applied) {
  let discount = 0;
  if (applied && applied.type && applied.value) {
    if (applied.type === 'percent') {
      discount = Math.round((sub + ship) * (Number(applied.value)||0) / 100);
    } else if (applied.type === 'fixed') {
      discount = Math.round(Number(applied.value||0) * 100);
    }
    if (discount > (sub + ship)) discount = (sub + ship);
  }
  return discount;
}

async function initialize() {
  const form = document.getElementById('payment-form');
  const cart = readCart();
  let appliedCoupon = null; // { code, type, value }
  let clientSecret = null;
  let amount = 0;
  let elements = null;
  let orderId = null;
  let serverBreakdown = null; // latest server-provided breakdown

  // Render order lines with price and quantity
  const lines = cart.map(i => {
    const title = i.title || i.id;
    const unit = Number(i.price) || 0;
    const qty = i.qty || 0;
    const unitCents = toCents(unit);
    const lineCents = unitCents * qty;
    const raw = (typeof i.ship !== 'undefined') ? i.ship : i.shipAmount;
    const shipPer = Number(raw);
    const shipEach = Number.isFinite(shipPer) ? (shipPer === 0 ? 0 : (shipPer > 0 ? shipPer : 100)) : 100;
    const shipCents = toCents(shipEach) * qty;
    const variant = variantText(i);
    return `
      <div class="flex-row items-start gap-075 space-between">
        <div>
          <strong>${title}</strong>
          ${variant ? `<div class="muted">${variant}</div>` : ''}
          <div class="muted">${currencyFmt(unitCents)} × ${qty}</div>
          <div class="muted">Shipping: ${shipEach===0 ? 'Free' : currencyFmt(toCents(shipEach))} × ${qty}</div>
        </div>
        <div class="text-right">
          <strong>${currencyFmt(lineCents)}</strong>
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('order-lines').innerHTML = lines || '<p>Your cart is empty.</p>';

  const getPayload = () => {
    const fd = new FormData(form);
    const customer = { name: fd.get('name'), email: fd.get('email') };
    const shipping = { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), state: fd.get('state'), postal: fd.get('postal'), country: fd.get('country') };
    // Send minimal items shape to backend
    const items = cart.map(i=>({ id: i.id, qty: i.qty }));
    return { items, customer, shipping, couponCode: appliedCoupon?.code || '', existingOrderId: orderId };
  };

  function getShippingAddress(){
    const fd = new FormData(form);
    // Normalize state to uppercase (and ideally to 2-letter if user typed code)
    let state = (fd.get('state')||'').toString().trim();
    if (state.length === 2) state = state.toUpperCase();
    return { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), state, postal: fd.get('postal'), country: fd.get('country') };
  }

  function debounce(fn, wait){ let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), wait); }; }

  async function createOrUpdatePaymentIntent() {
    await getStripe();
    if (!stripeEnabled) return;
    try {
      const intentResp = await fetchJsonWithFallback('/api/create-payment-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getPayload()), cache: 'no-store'
      });
      if (DEBUG) { try { console.info('[checkout] PI response', intentResp); } catch {} }
      if (intentResp && !intentResp.error) {
        clientSecret = intentResp.clientSecret;
        amount = intentResp.amount;
        orderId = intentResp.orderId || orderId;
        if (intentResp.couponApplied) {
          appliedCoupon = intentResp.couponApplied;
          document.getElementById('discount-row').style.display = '';
          document.getElementById('discount-code-label').textContent = `(${appliedCoupon.code})`;
        }
        // If server provides a pricing breakdown, render it exactly
        try {
          const bd = intentResp.breakdown || null;
          serverBreakdown = bd || null;
          const set = (id, cents) => { const el = document.getElementById(id); if (el && Number.isFinite(cents)) el.textContent = currencyFmt(fromCents(cents)); };
          if (bd) {
            set('sum-subtotal', bd.subtotal);
            // Shipping: show Free when zero for consistency
            const shipEl = document.getElementById('sum-shipping');
            if (shipEl) shipEl.textContent = (bd.shipping === 0) ? 'Free' : currencyFmt(fromCents(bd.shipping));
            const taxRow = document.getElementById('tax-row');
            if (taxRow) taxRow.style.display = bd.tax && bd.tax > 0 ? '' : 'none';
            if (Number.isFinite(bd.tax)) set('sum-tax', bd.tax);
            if (bd.discount && bd.discount > 0) {
              const row = document.getElementById('discount-row');
              if (row) row.style.display = '';
              const dEl = document.getElementById('sum-discount');
              if (dEl) dEl.textContent = '-' + currencyFmt(fromCents(bd.discount));
            }
            const totalEl = document.getElementById('sum-total');
            if (totalEl) totalEl.textContent = currencyFmt(fromCents(bd.total));
          }
        } catch {}
        const _stripe = await getStripe();
        // Always recreate Elements for a new clientSecret to ensure correct PI binding
        try {
          if (elements) {
            try { const host = document.getElementById('payment-element'); host && (host.innerHTML = ''); } catch {}
          }
          elements = _stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
          const paymentElement = elements.create('payment', { layout: 'tabs' });
          paymentElement.mount('#payment-element');
        } catch {}
      }
      if (intentResp && intentResp.error) {
        if (DEBUG) { try { console.error('[checkout] PI error', intentResp.error); } catch {} }
        const msg = document.getElementById('payment-message');
        if (msg) msg.textContent = intentResp.error || 'Could not initialize payment.';
      }
    } catch (_) { /* ignore */ }
  }

  // Initialize Stripe and create PaymentIntent on backend if Stripe is enabled
  await createOrUpdatePaymentIntent();

  // Always show a computed summary (even in test mode). Server breakdown overrides this during PI creation.
  const { total: computedTotal } = updateSummary(cart, appliedCoupon, getShippingAddress());
  if (amount > 0) {
    document.getElementById('sum-total').textContent = currencyFmt(amount);
  } else {
    document.getElementById('sum-total').textContent = currencyFmt(fromCents(computedTotal));
  }
  if (!clientSecret) {
    const pe = document.getElementById('payment-element');
    const submit = document.getElementById('submit');
    if (stripeEnabled) {
      // Stripe is configured, but PI could not be created. Do NOT silently fall back to test checkout.
      if (DEBUG) { try { console.warn('[checkout] Stripe enabled but no clientSecret — PI init failed, keeping real checkout disabled UI.'); } catch {} }
      if (pe) pe.innerHTML = '<p class="muted">Card payments are temporarily unavailable. Please verify your details and try again in a moment. If the problem persists, contact support.</p>';
      if (submit) submit.textContent = 'Try Again';
      const msg = document.getElementById('payment-message');
      if (msg && !msg.textContent) msg.textContent = 'Unable to initialize payment. Please retry.';
    } else {
      // Stripe disabled: enable explicit test checkout fallback
      if (DEBUG) { try { console.warn('[checkout] Stripe disabled (cfg.enabled=false) — switching to test checkout fallback. API_BASE =', API_BASE||'(same-origin)'); } catch {} }
      if (pe) pe.innerHTML = '<p class="muted">Test checkout active (no card required)</p>';
      if (submit) submit.textContent = 'Place Order';
      // If Stripe is disabled due to server config, surface a helpful note
      try {
        const cfg = window.__stripeCfg;
        if (cfg && cfg.missing && (cfg.missing.secret || cfg.missing.publishable)) {
          const m2 = document.getElementById('payment-message');
          if (m2) m2.textContent = 'Card payments are temporarily unavailable. You can still place your order and we will follow up to complete payment.';
        }
      } catch {}
    }
  }

  // Shipping method selection removed; totals depend only on cart contents and coupon

  // Promo code apply handler
  const applyBtn = document.getElementById('apply-code');
  if (applyBtn) applyBtn.addEventListener('click', async () => {
    const codeInput = document.getElementById('promo-code');
    const msg = document.getElementById('promo-msg');
    const code = (codeInput?.value || '').trim();
    if (!code) { msg.textContent = 'Enter a code.'; return; }
    try {
      const data = await fetchJsonWithFallback('/api/marketing/validate-coupon', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code, email: (new FormData(form)).get('email')||'' }) });
      if (data.valid) {
        appliedCoupon = data.coupon ? { code: data.coupon.code, type: data.coupon.type, value: data.coupon.value } : { code, type:'percent', value:0 };
        document.getElementById('discount-code-label').textContent = `(${appliedCoupon.code})`;
        updateSummary(cart, appliedCoupon, getShippingAddress());
        await createOrUpdatePaymentIntent();
        if (amount > 0) document.getElementById('sum-total').textContent = currencyFmt(amount);
        msg.textContent = 'Code applied.';
      } else {
        appliedCoupon = null;
        updateSummary(cart, appliedCoupon, getShippingAddress());
        msg.textContent = 'Invalid or expired code.';
      }
    } catch (e) {
      msg.textContent = 'Could not validate code.';
    }
  });

  // Recalculate when address changes (debounced)
  const onAddrChange = debounce(async () => {
    // Update local summary immediately for test mode and UX
    updateSummary(cart, appliedCoupon, getShippingAddress());
    await createOrUpdatePaymentIntent();
    if (amount > 0) document.getElementById('sum-total').textContent = currencyFmt(amount);
  }, 350);
  ['address1','address2','city','state','postal','country'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', onAddrChange);
    el.addEventListener('change', onAddrChange);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('submit').disabled = true;
    // Decide mode: Real Stripe when we have a clientSecret; else only allow test fallback when Stripe is disabled
    const testMode = !clientSecret && !stripeEnabled;
    if (testMode) {
      try {
        const payload = getPayload();
        // Try to create order via backend (unauthenticated endpoint)
        const respJson = await fetchJsonWithFallback('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        // Compute totals locally for confirmation
        const sub = calcSubtotalCents(cart);
        const ship = calcShippingCentsForCart(cart);
        const discount = computeDiscountCents(sub, ship, appliedCoupon);
        const tax = Math.round(Math.max(0, sub + ship - discount) * taxRateForAddress(getShippingAddress()));
        const total = sub + ship - discount + tax;
        let orderId = Date.now();
        if (respJson && respJson.orderId) { orderId = respJson.orderId; }
        // Build a local order snapshot for confirmation
        const items = cart.map(i=>({ productName: i.title || i.id, id: i.id, quantity: i.qty, price: Number(i.price)||0, subtotal: (Number(i.price)||0) * (i.qty||0) }));
        const order = {
          id: orderId,
          items,
          total: Math.round(total)/100,
          subtotal: Math.round(sub)/100,
          shipping: Math.round(ship)/100,
          discount: Math.round(discount)/100,
          tax: Math.round(tax)/100,
          couponCode: appliedCoupon?.code || null
        };
        // Save for confirmation page
        try{ sessionStorage.setItem('lastOrder', JSON.stringify(order)); }catch{}
  localStorage.removeItem('cart');
  const dest = new URL('order-confirmation.html?id=' + encodeURIComponent(order.id), window.location.href);
  window.location.href = dest.href;
      } catch (err) {
        document.getElementById('payment-message').textContent = err.message || 'Checkout failed.';
        document.getElementById('submit').disabled = false;
      }
      return;
    }

    // Real Stripe flow
    // Save a lightweight snapshot for confirmation page UI
    try {
      const items = cart.map(i=>({ productName: i.title || i.id, id: i.id, quantity: i.qty, price: Number(i.price)||0, subtotal: (Number(i.price)||0) * (i.qty||0) }));
      const sub = calcSubtotalCents(cart);
      const ship = calcShippingCentsForCart(cart);
      const fallbackTotal = sub + ship;
      const totalCents = typeof amount === 'number' && amount > 0 ? amount : fallbackTotal;
      const discount = Math.max(0, fallbackTotal - totalCents);
      // Prefer server-provided tax if available
      const taxCents = serverBreakdown && Number.isFinite(serverBreakdown.tax) ? serverBreakdown.tax : Math.max(0, totalCents - (sub + ship - discount));
      const order = {
        id: orderId,
        items,
        total: Math.round(totalCents)/100,
        subtotal: Math.round(sub)/100,
        shipping: Math.round(ship)/100,
        discount: Math.round(discount)/100,
        tax: Math.round(taxCents)/100,
        couponCode: appliedCoupon?.code || null
      };
      sessionStorage.setItem('lastOrder', JSON.stringify(order));
    } catch {}
    const _stripe = await getStripe();
    const { error } = await _stripe.confirmPayment({
      elements,
      confirmParams: { return_url: new URL('order-confirmation.html' + (orderId ? ('?id=' + encodeURIComponent(orderId)) : ''), window.location.href).href },
    });
    if (error) {
      document.getElementById('payment-message').textContent = error.message;
      document.getElementById('submit').disabled = false;
    }
  });

  // Handle success message if redirected back
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    document.getElementById('payment-message').style.color = 'green';
    document.getElementById('payment-message').textContent = 'Payment successful! Thank you for your order.';
    // Save order to localStorage for order history
    try {
      const cart = readCart();
      const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (cart && cart.length) {
        const orders = JSON.parse(localStorage.getItem('orders') || '[]');
        // For demo, use id as timestamp
        const id = Date.now();
        // For price, use static PRODUCTS from shop page if available
        let PRODUCTS = window.PRODUCTS;
        if (!PRODUCTS && window.parent && window.parent.PRODUCTS) PRODUCTS = window.parent.PRODUCTS;
        if (!PRODUCTS) PRODUCTS = [];
        const items = cart.map(i => {
          let price = 0;
          if (PRODUCTS && PRODUCTS.length) {
            const prod = PRODUCTS.find(p => p.id === i.id);
            price = prod ? prod.price : 0;
          }
          return { ...i, price };
        });
        const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
        const order = { 
          id, 
          date: new Date().toISOString(), 
          items, 
          total,
          userEmail: user ? user.email : 'guest@example.com' // Associate with user
        };
        orders.push(order);
        localStorage.setItem('orders', JSON.stringify(orders));
      }
    } catch(e) { /* ignore */ }
    localStorage.removeItem('checkoutTotalCents');
    localStorage.removeItem('cart');
  }
}

initialize();
