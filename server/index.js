// Basic Express server with Stripe integration for POS and ordering
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs/promises');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_yourkey'); // Replace with your real key

// Database and services
const DatabaseManager = require('./database/DatabaseManager');
const ProductService = require('./services/ProductService');
const OrderService = require('./services/OrderService');
const InventoryService = require('./services/InventoryService');

// Initialize database
const db = new DatabaseManager();
const productService = new ProductService();
const orderService = new OrderService();
const inventoryService = new InventoryService();

// Initialize database on startup
db.initialize().catch(console.error);

// Routes
const productRoutes = require('./routes/products');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const inventoryRoutes = require('./routes/inventory');
const app = express();
// Respect reverse proxy (needed for secure cookies and correct IPs when behind nginx/Heroku)
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

// CORS with optional allowlist and credentials for cookie-based auth
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS not allowed'), false);
    },
    credentials: true
  }));
} else {
  app.use(cors());
}
app.use(helmet({
  contentSecurityPolicy: false // Keep disabled for now to avoid breaking inline scripts/styles; tighten later
}));
app.use(compression());
app.use(cookieParser());
// Basic request logging
app.use(morgan('tiny'));
// Simple rate limiting on API routes
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', apiLimiter);

// Stripe webhook must be registered BEFORE JSON parser to preserve raw body
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  let event;
  try {
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
      event = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const itemsMeta = (pi.metadata?.items || '').split('|')
        .map(s => s.split(':')).filter(a => a.length === 2)
        .map(([id, qty]) => ({ id, qty: Number(qty) || 0 }));
      for (const it of itemsMeta) {
        await inventoryService.adjustStock(it.id, { type: 'remove', quantity: it.qty }, 'order', `Order paid PI ${pi.id}`);
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handling error:', e);
    res.status(500).json({ error: e.message });
  }
});

// JSON parser AFTER webhook route
app.use(bodyParser.json({ limit: '100kb' }));

// API routes
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/inventory', inventoryRoutes);

// Serve static frontend (HTML, assets, service worker) from project root
app.use(express.static(path.join(__dirname, '..')));

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

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Create order endpoint (save order details)
app.post('/api/order', async (req, res) => {
  try{
    const orderData = req.body;
    
    // Save to database using OrderService
    if (orderData.items && orderData.items.length > 0) {
      const order = await orderService.createOrder({
        userId: orderData.userId || null,
        userEmail: orderData.customer?.email || 'guest@example.com',
        items: orderData.items,
        shippingAddress: orderData.shipping,
        customerInfo: orderData.customer,
        paymentInfo: { method: 'stripe' }
      });
      res.json({ status: 'ok', orderId: order.id });
    } else {
      // Fallback to file logging for incomplete orders
      const order = { ...orderData, ts: new Date().toISOString() };
      await fs.appendFile('orders.ndjson', JSON.stringify(order) + "\n");
      res.json({ status: 'ok' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4242;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
