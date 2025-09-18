// Basic Express server with Stripe integration for POS and ordering
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs/promises');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
// Initialize Stripe client only if a secret key is provided (set in Render env)
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch (e) {
  console.warn('Stripe SDK failed to initialize:', e.message);
}

// Database and services
const DatabaseManager = require('./database/DatabaseManager');
const ProductService = require('./services/ProductService');
const OrderService = require('./services/OrderService');
const InvoiceService = require('./services/InvoiceService');
const AnalyticsService = require('./services/AnalyticsService');
const { requireAdmin } = require('./middleware/auth');

// Initialize database
const db = new DatabaseManager();
const productService = new ProductService();
const orderService = new OrderService();
const invoiceService = new InvoiceService();
const analyticsService = new AnalyticsService();

// Initialize database on startup
db.initialize().catch(console.error);

// Routes
const productRoutes = require('./routes/products');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const inventoryRoutes = require('./routes/inventory');
const invoiceRoutes = require('./routes/invoices');
const analyticsRoutes = require('./routes/analytics');
const app = express();
// Respect reverse proxy (needed for secure cookies and correct IPs when behind nginx/Heroku)
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

// CORS with optional allowlist and credentials for cookie-based auth
const envOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const devOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://localhost:4242'];
const allowList = envOrigins.length ? envOrigins : devOrigins;
const corsOptions = {
  origin: (origin, cb) => {
    // Allow non-browser/same-origin requests, and file:// (Origin: 'null') during development
    if (!origin || origin === 'null') return cb(null, true);
    if (allowList.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
// Ensure preflight is handled for any route
app.options('*', cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: false // Keep disabled for now to avoid breaking inline scripts/styles; tighten later
}));
app.use(compression());
app.use(cookieParser());
// Basic request logging
app.use(morgan('tiny'));
// Simple rate limiting (avoid blocking analytics tracking in dev)
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
  app.use('/api/users', generalLimiter);
  app.use('/api/orders', generalLimiter);
  app.use('/api/invoices', generalLimiter);
  app.use('/api/products', generalLimiter);
  app.use('/api/inventory', generalLimiter);
  // Admin analytics endpoints can be limited too
  app.use('/api/analytics/admin', generalLimiter);
} else {
  // No limiter in development to simplify testing
}

// Stripe webhook must be registered BEFORE JSON parser to preserve raw body
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  let event;
  try {
    if (!endpointSecret) {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
      event = JSON.parse(raw);
    } else if (stripe) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      throw new Error('Stripe not initialized; cannot verify webhook with endpoint secret.');
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // For dropship model, do not mutate stock on payment events
    // Optionally, mark related order as paid via metadata in the future
    if (event.type === 'payment_intent.succeeded') {
      // no-op for inventory
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handling error:', e);
    res.status(500).json({ error: e.message });
  }
});

// JSON parser AFTER webhook route
app.use(express.json({ limit: '100kb' }));

// API routes
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/analytics', analyticsRoutes);

// Legacy redirects for removed static pages (migrated from previous hosting config)
const redirects = [
  ['/overhead.html', '/ez-nets.html'],
  ['/multi-sport.html', '/sports-netting.html'],
  ['/debris-netting.html', '/commercial-netting.html'],
  ['/diving-range.html', '/golf-netting.html'],
  ['/golf-course.html', '/golf-netting.html'],
  ['/golf-cube.html', '/golf-netting.html'],
  ['/cricket-football.html', '/sports-netting.html'],
  ['/auto-drone.html', '/commercial-netting.html'],
  ['/drone-enclosure.html', '/commercial-netting.html'],
  ['/warehouse.html', '/commercial-netting.html'],
  ['/safety-netting.html', '/commercial-netting.html'],
  ['/landfill-netting.html', '/commercial-netting.html'],
  ['/sports-baseball.html', '/sports-netting.html'],
  ['/sports-golf.html', '/sports-netting.html'],
  ['/sports-lacrosse.html', '/sports-netting.html'],
  ['/sports-soccer.html', '/sports-netting.html'],
];
redirects.forEach(([source, dest]) => {
  app.get(source, (req, res) => res.redirect(301, dest));
});

// Lightweight config endpoint for frontend checkout/test mode
app.get('/api/config', (req, res) => {
  const enabled = !!process.env.STRIPE_SECRET_KEY;
  res.json({ pk: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_your_publishable_key', enabled });
});

// Fallback endpoints (defensive): ensure core routes respond in dev even if router mounting is altered
app.post('/api/analytics/track', async (req, res) => {
  try {
    const { path, referrer, visitorId, userId, ts } = req.body || {};
    const ev = await analyticsService.trackPageView({ path, referrer, visitorId, userId, ts });
    res.json({ ok: true, id: ev?.id });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.post('/api/analytics/event', async (req, res) => {
  try {
    const { type, productId, visitorId, userId, ts } = req.body || {};
    const ev = await analyticsService.trackEvent({ type, productId, visitorId, userId, ts });
    res.json({ ok: true, id: ev?.id });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.get('/api/invoices/admin/all', requireAdmin, async (req, res) => {
  try {
    const { status, page, pageSize, sortBy, sortDir } = req.query;
    const result = await invoiceService.getAllInvoices(status, { page, pageSize, sortBy, sortDir });
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Serve static frontend (HTML, assets, service worker) from project root
// Serve favicon explicitly (browsers request /favicon.ico by default)
app.get('/favicon.ico', (req, res) => {
  try {
    return res.sendFile(path.join(__dirname, '..', 'assets', 'img', 'favicon-32.png'));
  } catch (e) {
    return res.sendStatus(404);
  }
});

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

// Dynamic pricing sourced from products DB (cached briefly in-memory)
let priceCache = { ts: 0, map: new Map() };
async function loadPriceMap() {
  const now = Date.now();
  if (now - priceCache.ts < 60_000 && priceCache.map.size) return priceCache.map;
  const all = await productService.getAllProducts(false);
  const map = new Map();
  all.forEach(p => { if (p.isActive !== false && typeof p.price === 'number') map.set(p.id, Math.round(p.price * 100)); });
  priceCache = { ts: now, map };
  return map;
}
async function calcSubtotalCents(items = []) {
  const priceMap = await loadPriceMap();
  return items.reduce((sum, it) => {
    const cents = priceMap.get(it.id);
    if (!cents) return sum;
    const qty = Math.max(1, Number(it.qty) || 1);
    return sum + cents * qty;
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
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.' });
    }
    const subtotal = await calcSubtotalCents(items);
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

let basePort = Number(process.env.PORT) || 4242;
// Optional auto product sync on startup (e.g., AUTOSYNC_PRODUCTS=1)
async function autoSyncOnStart() {
  if (process.env.AUTOSYNC_PRODUCTS === '1') {
    try {
      const { spawn } = require('child_process');
      const args = ['scripts/sync-products.js'];
      if (process.env.AUTOSYNC_STRIPE !== '1') args.push('--no-stripe');
      const child = spawn('node', args, { cwd: path.join(__dirname), stdio: 'inherit' });
      child.on('exit', code => console.log('Auto product sync finished with code', code));
    } catch (e) {
      console.warn('Auto product sync failed:', e.message);
    }
  }
}

function startServer(attempt = 0) {
  const tryPort = basePort + attempt;
  const srv = app.listen(tryPort, '0.0.0.0', () => {
    console.log(`Server running on port ${tryPort}`);
    if (attempt > 0) console.log(`(Original port ${basePort} was busy; using fallback ${tryPort})`);
    autoSyncOnStart();
  });
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 5) {
      console.warn(`Port ${tryPort} in use, retrying on ${tryPort + 1}...`);
      setTimeout(() => startServer(attempt + 1), 300);
    } else {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    }
  });
  return srv;
}

const server = startServer();

// Graceful shutdown
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
