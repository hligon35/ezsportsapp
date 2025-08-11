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
    localStorage.removeItem('checkoutTotalCents');
    localStorage.removeItem('cart');
  }
}

initialize();
