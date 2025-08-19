if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY is not set. Set it in Vercel env for secure payments.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_yourkey');

const PRODUCTS = {
  'bat-ghost': 399_95,
  'bat-hype': 349_95,
  'glove-a2000': 299_95,
  'glove-heart': 279_95,
  'net-pro': 219_00,
  'net-cage': 649_00,
  'helmet-pro': 89_99,
  'helmet-lite': 59_99,
};

function toCents(n) { return Math.round(Number(n) * 100); }
function calcSubtotalCents(items = []){
  return items.reduce((sum, it) => {
    const price = PRODUCTS[it.id];
    if (!price) return sum;
    return sum + Math.round((price) * it.qty);
  }, 0);
}
function calcShippingCents(subtotalCents, method = 'standard'){
  if (subtotalCents >= 7500) return 0; // free over $75
  if (method === 'express') return 2500;
  return 1000; // standard
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const { items = [], customer = {}, shipping = {}, shippingMethod = 'standard', currency = 'usd' } = req.body || {};
  try {
    const subtotal = calcSubtotalCents(items);
    const shippingCents = calcShippingCents(subtotal, shippingMethod);
    const amount = subtotal + shippingCents;

  const description = `EZ Sports order — ${items.map(i => `${i.id}${(i.size||i.color)?`(${[i.size,i.color].filter(Boolean).join('/')})`:''}x${i.qty}`).join(', ')}`;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: {
        email: customer.email || '',
        name: customer.name || '',
        shipping_method: shippingMethod,
  items: items.map(i => `${i.id}:${i.qty}:${i.size||''}:${i.color||''}`).join('|')
      },
      receipt_email: customer.email || undefined,
      shipping: {
        name: customer.name || 'Customer',
        address: {
          line1: shipping.address1 || '',
          line2: shipping.address2 || undefined,
          city: shipping.city || '',
          state: shipping.state || '',
          postal_code: shipping.postal || '',
          country: shipping.country || 'US',
        }
      }
    });
    res.json({ clientSecret: paymentIntent.client_secret, amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
