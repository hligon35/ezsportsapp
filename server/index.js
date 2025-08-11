// Basic Express server with Stripe integration for POS and ordering
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs/promises');
const compression = require('compression');
const helmet = require('helmet');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_yourkey'); // Replace with your real key

const app = express();
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false // Could be configured more strictly if domains finalized
}));
app.use(compression());
app.use(bodyParser.json({ limit: '100kb' }));

// Static assets caching (1 year for immutable, 1 hour for html)
app.use((req, res, next) => {
  if (/\.(?:js|css|png|jpg|jpeg|svg|gif|webp|ico)$/i.test(req.url)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/\.(?:html)$/i.test(req.url)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Basic price book (server authoritative)
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

// Create payment intent with server-side calculation
app.post('/api/create-payment-intent', async (req, res) => {
  const { items = [], customer = {}, shipping = {}, shippingMethod = 'standard', currency = 'usd' } = req.body;
  try {
    const subtotal = calcSubtotalCents(items);
    const shippingCents = calcShippingCents(subtotal, shippingMethod);
    const amount = subtotal + shippingCents; // taxes omitted in demo

    const description = `EZ Sports order — ${items.map(i => `${i.id}x${i.qty}`).join(', ')}`;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description,
      metadata: {
        email: customer.email || '',
        name: customer.name || '',
        shipping_method: shippingMethod,
        items: items.map(i => `${i.id}:${i.qty}`).join('|')
      },
      automatic_payment_methods: { enabled: true },
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
});

// Create order endpoint (save order details)
app.post('/api/order', async (req, res) => {
  try{
    const order = { ...req.body, ts: new Date().toISOString() };
    await fs.appendFile('orders.ndjson', JSON.stringify(order) + "\n");
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
