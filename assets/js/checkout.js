// Stripe Payment Element integration for cards, Apple Pay, Google Pay, PayPal
// Publishable key will be provided by a config endpoint or fallback (dev)
let stripe;
async function getStripe() {
  if (stripe) return stripe;
  try {
    const cfg = await fetch('/api/config').then(r=>r.ok?r.json():{ pk: 'pk_test_your_publishable_key' });
    stripe = Stripe(cfg.pk || 'pk_test_your_publishable_key');
  } catch {
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

async function initialize() {
  const form = document.getElementById('payment-form');
  const cart = readCart();

  // Render order lines (basic id/qty display)
  const lines = cart.map(i => `<div style="display:flex;justify-content:space-between"><span>${i.id}${variantText(i)?` (${variantText(i)})`:''}</span><span>x${i.qty}</span></div>`).join('');
  document.getElementById('order-lines').innerHTML = lines || '<p>Your cart is empty.</p>';

  const getPayload = () => {
    const fd = new FormData(form);
    const customer = { name: fd.get('name'), email: fd.get('email') };
    const shipping = { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), state: fd.get('state'), postal: fd.get('postal'), country: fd.get('country') };
    const shippingMethod = fd.get('shippingMethod');
    return { items: cart, customer, shipping, shippingMethod };
  };

  // Create PaymentIntent on backend with server-side calculation
  const intentResp = await fetch('/api/create-payment-intent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getPayload())
  }).then(r => r.json());
  if (intentResp.error) {
    document.getElementById('payment-message').textContent = intentResp.error;
    return;
  }
  const { clientSecret, amount } = intentResp;
  document.getElementById('sum-total').textContent = currencyFmt(amount);
  document.getElementById('sum-subtotal').textContent = '—';
  document.getElementById('sum-shipping').textContent = '—';

  const _stripe = await getStripe();
  const elements = _stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
  const paymentElement = elements.create('payment', { layout: 'tabs' });
  paymentElement.mount('#payment-element');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('submit').disabled = true;
    // Record order draft (optional)
  fetch('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(getPayload()) }).catch(()=>{});
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.origin + '/checkout.html?success=true' },
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
