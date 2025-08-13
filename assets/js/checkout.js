// Stripe Payment Element integration for cards, Apple Pay, Google Pay, PayPal
const stripe = Stripe('pk_test_your_publishable_key'); // Replace with your real Stripe publishable key

function currencyFmt(cents){ return (cents/100).toLocaleString(undefined,{style:'currency',currency:'USD'}); }
function readCart(){ try{ return JSON.parse(localStorage.getItem('cart')||'[]'); }catch{ return []; } }

async function initialize() {
  const form = document.getElementById('payment-form');
  const cart = readCart();

  // Render order lines (basic id/qty display)
  const lines = cart.map(i => `<div style="display:flex;justify-content:space-between"><span>${i.id}</span><span>x${i.qty}</span></div>`).join('');
  document.getElementById('order-lines').innerHTML = lines || '<p>Your cart is empty.</p>';

  const getPayload = () => {
    const fd = new FormData(form);
    const customer = { name: fd.get('name'), email: fd.get('email') };
    const shipping = { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), state: fd.get('state'), postal: fd.get('postal'), country: fd.get('country') };
    const shippingMethod = fd.get('shippingMethod');
    return { items: cart, customer, shipping, shippingMethod };
  };

  // Create PaymentIntent on backend with server-side calculation
  const intentResp = await fetch('http://68.54.208.207:4242/api/create-payment-intent', {
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

  const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
  const paymentElement = elements.create('payment', { layout: 'tabs' });
  paymentElement.mount('#payment-element');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('submit').disabled = true;
    // Record order draft (optional)
    fetch('http://68.54.208.207:4242/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(getPayload()) }).catch(()=>{});
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
