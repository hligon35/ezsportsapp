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
function calcShippingCents(subtotalCents, method){
  if (subtotalCents >= 7500) return 0; // free over $75
  if (method === 'express') return 2500;
  return 1000; // standard
}
function updateSummary(cart, shippingMethod){
  const sub = calcSubtotalCents(cart);
  const ship = calcShippingCents(sub, shippingMethod);
  const total = sub + ship;
  const el = (id) => document.getElementById(id);
  if (el('sum-subtotal')) el('sum-subtotal').textContent = currencyFmt(fromCents(sub));
  if (el('sum-shipping')) el('sum-shipping').textContent = currencyFmt(fromCents(ship));
  if (el('sum-total')) el('sum-total').textContent = currencyFmt(fromCents(total));
  return { sub, ship, total };
}

async function initialize() {
  const form = document.getElementById('payment-form');
  const cart = readCart();

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
    const shippingMethod = fd.get('shippingMethod');
    // Send minimal items shape to backend
    const items = cart.map(i=>({ id: i.id, qty: i.qty }));
    return { items, customer, shipping, shippingMethod };
  };

  // Initialize Stripe and create PaymentIntent on backend if Stripe is enabled
  let clientSecret = null;
  let amount = 0;
  let elements = null;
  let orderId = null;
  await getStripe();
  if (stripeEnabled) {
    try {
      const intentResp = await fetch('/api/create-payment-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getPayload())
      }).then(r => r.json());
      if (intentResp && !intentResp.error) {
        clientSecret = intentResp.clientSecret;
        amount = intentResp.amount;
        orderId = intentResp.orderId || null;
        const _stripe = await getStripe();
        elements = _stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
        const paymentElement = elements.create('payment', { layout: 'tabs' });
        paymentElement.mount('#payment-element');
      }
    } catch (_) {
      // ignore; test mode fallback will handle
    }
  }

  // Always show a computed summary (even in test mode)
  const fd0 = new FormData(form);
  const shipMethod0 = fd0.get('shippingMethod') || 'standard';
  const { total: computedTotal } = updateSummary(cart, shipMethod0);
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

  // Recompute totals on shipping method change
  const shipRadios = form.querySelectorAll('input[name="shippingMethod"]');
  shipRadios.forEach(r => r.addEventListener('change', () => {
    const fd = new FormData(form);
    const method = fd.get('shippingMethod') || 'standard';
    updateSummary(cart, method);
  }));

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
        const fd = new FormData(form);
        const shipMethod = fd.get('shippingMethod') || 'standard';
        const sub = calcSubtotalCents(cart);
        const ship = calcShippingCents(sub, shipMethod);
        const total = sub + ship;
        let orderId = Date.now();
        if (resp.ok) {
          const data = await resp.json();
          orderId = data.orderId || orderId;
        }
        // Build a local order snapshot for confirmation
        const items = cart.map(i=>({ productName: i.title || i.id, id: i.id, quantity: i.qty, price: Number(i.price)||0, subtotal: (Number(i.price)||0) * (i.qty||0) }));
        const order = { id: orderId, items, total: Math.round(total)/100 };
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
      const total = amount || (calcSubtotalCents(cart) + calcShippingCents(calcSubtotalCents(cart), new FormData(form).get('shippingMethod')||'standard'));
      const order = { id: orderId, items, total: Math.round(total)/100 };
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
