// Stripe Payment Element integration for cards, Apple Pay, Google Pay, PayPal
// Publishable key will be provided by a config endpoint or fallback (dev)
let stripe;
let stripeEnabled = false;
async function getStripe() {
  if (stripe) return stripe;
  try {
    const cfg = await fetch('/api/config').then(r=>r.ok?r.json():{ pk: 'pk_test_your_publishable_key', enabled: false });
    stripeEnabled = !!cfg.enabled;
    stripe = Stripe(cfg.pk || 'pk_test_your_publishable_key');
  } catch {
    stripeEnabled = false;
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
  // New policy: if any cart items carry a per-product dsr (ship), sum ship * qty; else flat $100 per order
  let dsrTotal = 0;
  let hasAnyDsr = false;
  for (const i of cart) {
    const dsr = Number(i.ship || 0);
    if (dsr > 0) {
      hasAnyDsr = true;
      const qty = Math.max(1, Number(i.qty) || 1);
      dsrTotal += Math.round(dsr * 100) * qty;
    }
  }
  if (hasAnyDsr) return dsrTotal;
  return 10000; // $100 default when no dsr present
}
function updateSummary(cart, applied){
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
  const total = sub + ship - discount;
  const el = (id) => document.getElementById(id);
  if (el('sum-subtotal')) el('sum-subtotal').textContent = currencyFmt(fromCents(sub));
  if (el('sum-shipping')) el('sum-shipping').textContent = currencyFmt(fromCents(ship));
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
  return { sub, ship, discount, total };
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

  // Render order lines with price and quantity
  const lines = cart.map(i => {
    const title = i.title || i.id;
    const unit = Number(i.price) || 0;
    const qty = i.qty || 0;
    const unitCents = toCents(unit);
    const lineCents = unitCents * qty;
    const variant = variantText(i);
    return `
      <div class="flex-row items-start gap-075 space-between">
        <div>
          <strong>${title}</strong>
          ${variant ? `<div class="muted">${variant}</div>` : ''}
          <div class="muted">${currencyFmt(unitCents)} × ${qty}</div>
        </div>
        <div class="text-right"><strong>${currencyFmt(lineCents)}</strong></div>
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

  async function createOrUpdatePaymentIntent() {
    await getStripe();
    if (!stripeEnabled) return;
    try {
      const intentResp = await fetch('/api/create-payment-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getPayload())
      }).then(r => r.json());
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
          const set = (id, cents) => { const el = document.getElementById(id); if (el && Number.isFinite(cents)) el.textContent = currencyFmt(fromCents(cents)); };
          if (bd) {
            set('sum-subtotal', bd.subtotal);
            set('sum-shipping', bd.shipping);
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
    } catch (_) { /* ignore */ }
  }

  // Initialize Stripe and create PaymentIntent on backend if Stripe is enabled
  await createOrUpdatePaymentIntent();

  // Always show a computed summary (even in test mode). Server breakdown overrides this during PI creation.
  const { total: computedTotal } = updateSummary(cart, appliedCoupon);
  if (amount > 0) {
    document.getElementById('sum-total').textContent = currencyFmt(amount);
  } else {
    document.getElementById('sum-total').textContent = currencyFmt(fromCents(computedTotal));
  }
  if (!clientSecret) {
    // Hide payment UI in test mode without Stripe
    const pe = document.getElementById('payment-element');
    if (pe) pe.innerHTML = '<p class="muted">Test checkout active (no card required)</p>';
    const submit = document.getElementById('submit');
    if (submit) submit.textContent = 'Place Order';
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
      const res = await fetch('/api/marketing/validate-coupon', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code, email: (new FormData(form)).get('email')||'' }) });
      const data = await res.json();
      if (data.valid) {
        appliedCoupon = data.coupon ? { code: data.coupon.code, type: data.coupon.type, value: data.coupon.value } : { code, type:'percent', value:0 };
        document.getElementById('discount-code-label').textContent = `(${appliedCoupon.code})`;
        updateSummary(cart, appliedCoupon);
        await createOrUpdatePaymentIntent();
        if (amount > 0) document.getElementById('sum-total').textContent = currencyFmt(amount);
        msg.textContent = 'Code applied.';
      } else {
        appliedCoupon = null;
        updateSummary(cart, appliedCoupon);
        msg.textContent = 'Invalid or expired code.';
      }
    } catch (e) {
      msg.textContent = 'Could not validate code.';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('submit').disabled = true;
  // Decide mode: Real Stripe when we have a clientSecret; else test mode
  const testMode = !clientSecret;
    if (testMode) {
      try {
        const payload = getPayload();
        // Try to create order via backend (unauthenticated endpoint)
        const resp = await fetch('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
        // Compute totals locally for confirmation
        const sub = calcSubtotalCents(cart);
        const ship = calcShippingCentsForCart(cart);
        const discount = computeDiscountCents(sub, ship, appliedCoupon);
        const total = sub + ship - discount;
        let orderId = Date.now();
        if (resp.ok) {
          const data = await resp.json();
          orderId = data.orderId || orderId;
        }
        // Build a local order snapshot for confirmation
        const items = cart.map(i=>({ productName: i.title || i.id, id: i.id, quantity: i.qty, price: Number(i.price)||0, subtotal: (Number(i.price)||0) * (i.qty||0) }));
        const order = {
          id: orderId,
          items,
          total: Math.round(total)/100,
          subtotal: Math.round(sub)/100,
          shipping: Math.round(ship)/100,
          discount: Math.round(discount)/100,
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
      const order = {
        id: orderId,
        items,
        total: Math.round(totalCents)/100,
        subtotal: Math.round(sub)/100,
        shipping: Math.round(ship)/100,
        discount: Math.round(discount)/100,
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
