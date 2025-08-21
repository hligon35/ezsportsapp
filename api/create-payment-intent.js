if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY is not set. Set it in Vercel env for secure payments.');
}
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.warn('STRIPE_SECRET_KEY is not set. Set it in Vercel env for secure payments.');
}
const stripe = require('stripe')(stripeSecret || 'sk_test_yourkey');
const { ensureSchema, createOrderRecord, updateOrderStripePi } = require('./_lib_db');
const { getPriceCents } = require('./_lib_products');

function calcSubtotalCents(items = []){
  return items.reduce((sum, it) => {
  const priceCents = getPriceCents(it.id);
  if (!priceCents) return sum;
  return sum + (priceCents * it.qty);
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
  await ensureSchema();
    const subtotal = calcSubtotalCents(items);
    const shippingCents = calcShippingCents(subtotal, shippingMethod);
    const amount = subtotal + shippingCents;

  const description = `EZ Sports order — ${items.map(i => `${i.id}${(i.size||i.color)?`(${[i.size,i.color].filter(Boolean).join('/')})`:''}x${i.qty}`).join(', ')}`;

    // Create local order in pending state
    const summary = items.map(i => `${i.id}${(i.size||i.color)?`(${[i.size,i.color].filter(Boolean).join('/')})`:''}x${i.qty}`).join(', ');
    const orderRow = await createOrderRecord({
      userEmail: customer.email || null,
      items,
      totalCents: amount,
      customerName: customer.name || null,
      shipping,
      status: 'pending',
      summary
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: {
        order_id: String(orderRow.id),
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
  // Link local order to PI
  await updateOrderStripePi(orderRow.id, paymentIntent.id);
  res.json({ clientSecret: paymentIntent.client_secret, amount, orderId: orderRow.id });
  } catch (err) {
  console.error('create-payment-intent error', err);
  res.status(500).json({ error: 'Unable to create payment intent' });
  }
}
