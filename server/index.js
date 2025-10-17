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
const fsSync = require('fs');
const crypto = require('crypto');
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
const CouponService = require('./services/CouponService');
const InvoiceService = require('./services/InvoiceService');
const AnalyticsService = require('./services/AnalyticsService');
const couponService = new CouponService();
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
const marketingRoutes = require('./routes/marketing');
const adminRoutes = require('./routes/admin');
const app = express();
// Optional: Google Maps Places API key exposure for client autocomplete
app.get('/api/maps-config', (req, res) => {
  // Only expose key for known origins; otherwise return null
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.MAPS_API_KEY || process.env.GMAPS_KEY || null;
  const origin = req.headers.origin || '';
  const envOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const devOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500'];
  const allowList = envOrigins.length ? envOrigins : devOrigins;
  const allowed = !origin || allowList.includes(origin);
  res.json({ googleMapsApiKey: allowed ? key : null });
});

// Respect reverse proxy (needed for secure cookies and correct IPs when behind nginx/Heroku)
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

// Optional HTTPS redirect behind proxies (ENABLE with FORCE_HTTPS=true)
if (String(process.env.FORCE_HTTPS || '').toLowerCase() === 'true') {
  app.use((req, res, next) => {
    const proto = (req.headers['x-forwarded-proto'] || '').toString();
    if (proto && proto !== 'https') {
      const host = req.headers.host;
      const url = `https://${host}${req.originalUrl}`;
      return res.redirect(301, url);
    }
    next();
  });
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
// Add HSTS explicitly (works when behind proxy with trust proxy enabled)
try {
  app.use((req, res, next) => { res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); next(); });
} catch {}
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
  // Tighter limits for auth and public marketing endpoints to reduce abuse
  const tightLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
  app.use(['/api/users/login', '/api/users/register', '/api/marketing/subscribe', '/api/marketing/contact'], tightLimiter);
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
    // Update orders and finance metadata by event types
    switch (event.type) {
      case 'payment_intent.succeeded': {
        try {
          const pi = event.data.object;
          const orderId = pi?.metadata?.order_id;
          const couponCode = pi?.metadata?.coupon_code;
          if (orderId) {
            await orderService.updateOrderStatus(orderId, 'paid');
            const latestChargeId = Array.isArray(pi.charges?.data) && pi.charges.data[0]?.id ? pi.charges.data[0].id : undefined;
            let fees, net;
            if (latestChargeId && stripe) {
              try {
                const ch = await stripe.charges.retrieve(latestChargeId, { expand: ['balance_transaction'] });
                const bt = ch.balance_transaction;
                if (bt) { fees = (bt.fee || 0) / 100; net = (bt.net || 0) / 100; }
              } catch (e) { /* ignore fee fetch errors */ }
            }
            await orderService.updatePaymentInfo(orderId, {
              intentId: pi.id,
              latestChargeId,
              amount: (pi.amount || 0) / 100,
              currency: pi.currency,
              fees,
              net,
              method: 'stripe',
              paidAt: new Date().toISOString()
            });
          }
          if (couponCode) {
            try { await couponService.consume(String(couponCode)); } catch (e) { console.warn('Coupon consume failed:', e.message); }
          }
          // Queue order confirmation email (simple DB queue for now)
          try {
            const EmailService = require('./services/EmailService');
            const emailSvc = new EmailService();
            let orderSummary = '';
            try { const order = orderId ? await orderService.getOrderById(orderId) : null; if (order) {
              const lines = (order.items||[]).map(i=>`${i.quantity}x ${i.productName} — $${Number(i.subtotal||0).toFixed(2)}`).join('<br/>');
              orderSummary = `<p><strong>Order #${order.id}</strong></p><p>${lines}</p><p>Total: $${Number(order.total||0).toFixed(2)}</p>`;
            }} catch {}
            await emailSvc.queue({ to: pi?.receipt_email || pi?.metadata?.email || '', subject: 'Order confirmed', html: orderSummary || '<p>Thank you for your purchase.</p>' });
          } catch (e) { console.warn('Email queue failed:', e.message); }
        } catch (e) {
          console.warn('payment_intent.succeeded handling failed:', e.message);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        try {
          const pi = event.data.object;
          const orderId = pi?.metadata?.order_id;
          if (orderId) {
            await orderService.updateOrderStatus(orderId, 'cancelled');
            await orderService.updatePaymentInfo(orderId, { intentId: pi.id, failureCode: pi.last_payment_error?.code, failureMessage: pi.last_payment_error?.message });
          }
        } catch (e) { console.warn('payment_failed handling failed:', e.message); }
        break;
      }
      case 'charge.refunded':
      case 'refund.created': {
        try {
          const obj = event.data.object;
          const charge = event.type === 'charge.refunded' ? obj : obj.charge;
          // We don’t always have order_id here; if you set it in PI metadata, you can look it up via the PaymentIntent on the charge
          if (charge && stripe) {
            try {
              const ch = typeof charge === 'string' ? await stripe.charges.retrieve(charge) : charge;
              const intentId = ch.payment_intent;
              if (intentId) {
                const pi = await stripe.paymentIntents.retrieve(intentId);
                const orderId = pi?.metadata?.order_id;
                if (orderId) {
                  await orderService.patchOrder(orderId, { status: 'cancelled', refundedAt: new Date().toISOString() });
                  await orderService.updatePaymentInfo(orderId, { refunded: true, refundId: event.type === 'refund.created' ? obj.id : undefined });
                }
              }
            } catch (e) { console.warn('Refund reconciliation failed:', e.message); }
          }
        } catch (e) { console.warn('refund handling failed:', e.message); }
        break;
      }
      case 'charge.dispute.created': {
        try {
          const charge = event.data.object.charge;
          if (charge && stripe) {
            try {
              const ch = typeof charge === 'string' ? await stripe.charges.retrieve(charge) : charge;
              const pi = ch.payment_intent ? await stripe.paymentIntents.retrieve(ch.payment_intent) : null;
              const orderId = pi?.metadata?.order_id;
              if (orderId) {
                await orderService.patchOrder(orderId, { dispute: { id: event.data.object.id, status: event.data.object.status, created: new Date().toISOString() } });
              }
            } catch (e) { console.warn('Dispute reconciliation failed:', e.message); }
          }
        } catch (e) { console.warn('dispute handling failed:', e.message); }
        break;
      }
      case 'payout.paid':
      case 'payout.failed': {
        try {
          const PayoutService = require('./services/PayoutService');
          const svc = new PayoutService();
          await svc.recordPayout(event.data.object);
        } catch (e) { console.warn('Payout record failed:', e.message); }
        break;
      }
      default: break;
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
// Accept text/plain payloads (JSON string) for marketing endpoints to support legacy/form fallbacks
app.use('/api/marketing', express.text({ type: ['text/plain', 'text/*'], limit: '100kb' }), (req, _res, next) => {
  if (typeof req.body === 'string') {
    const s = req.body.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try { req.body = JSON.parse(s); } catch { /* leave as string */ }
    }
  }
  next();
});
app.use('/api/marketing', marketingRoutes);
app.use('/api/admin', adminRoutes);

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

// AVIF MIME correction & fallback middleware (before express.static)
app.use((req, res, next) => {
  if (req.url.endsWith('.avif')) {
    const filePath = path.join(__dirname, '..', decodeURIComponent(req.path));
    if (fsSync.existsSync(filePath)) {
      res.type('image/avif');
    } else {
      // Fallback to an existing jpg placeholder if the avif is missing
      const fallback = path.join(__dirname, '..', 'assets', 'img', 'bats.jpg');
      if (fsSync.existsSync(fallback)) {
        return res.sendFile(fallback);
      }
    }
  }
  next();
});

// Block access to sensitive repo directories from being served statically
app.use((req, res, next) => {
  const p = req.path || '';
  if (/^\/(?:server|database)\b/.test(p)) {
    return res.status(404).send('Not Found');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..')));

// Static assets caching (1 year for immutable, 1 hour for html)
app.use((req, res, next) => {
  if (/\.(?:js|css|png|jpg|jpeg|svg|gif|webp|avif|ico)$/i.test(req.url)) {
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

// Fallback static 404 logger for assets (after express.static)
app.use((req, res, next) => {
  if (/\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)$/i.test(req.url)) {
    console.warn('Asset 404 (image) ->', req.url);
  }
  next();
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

// Dynamic pricing sourced from products DB (cached briefly in-memory)
let priceCache = { ts: 0, map: new Map() };
async function loadFallbackPriceMap() {
  try {
    const file = path.join(__dirname, '..', 'assets', 'prodList.json');
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);
    const out = new Map();
    if (json && json.categories && typeof json.categories === 'object') {
      for (const arr of Object.values(json.categories)) {
        if (!Array.isArray(arr)) continue;
        arr.forEach(p => {
          const id = String(p.sku || p.id || p.name || '').trim();
          if (!id) return;
          const price = Number(p.map ?? p.price ?? p.wholesale ?? 0) || 0;
          const cents = Math.round(price * 100);
          // dsr may exist on some records; if absent, 0 (fallback logic will apply flat shipping)
          const dsr = Number(p.dsr || (p.details && p.details.dsr) || 0) || 0;
          out.set(id, { cents, dsr });
        });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}
async function loadPriceMap() {
  const now = Date.now();
  if (now - priceCache.ts < 60_000 && priceCache.map.size) return priceCache.map;
  const all = await productService.getAllProducts(false);
  const map = new Map();
  all.forEach(p => {
    if (p.isActive === false) return;
    const cents = (typeof p.price === 'number' && isFinite(p.price)) ? Math.round(p.price * 100) : 0;
    map.set(p.id, { cents, dsr: Number(p.dsr || 0) || 0 });
  });
  // Merge fallback prodList prices for SKUs not present in DB
  try {
    const fb = await loadFallbackPriceMap();
    if (fb && fb.size) {
      for (const [id, rec] of fb.entries()) {
        if (!map.has(id)) map.set(id, rec);
      }
    }
  } catch {}
  priceCache = { ts: now, map };
  return map;
}
async function calcSubtotalCents(items = []) {
  const priceMap = await loadPriceMap();
  return items.reduce((sum, it) => {
    const rec = priceMap.get(it.id);
    const cents = rec?.cents;
    if (!cents) return sum;
    const qty = Math.max(1, Number(it.qty) || 1);
    return sum + cents * qty;
  }, 0);
}

async function calcShippingCents(items = [], _subtotalCents, _method = 'standard'){
  // New policy: per-item shipping: use dsr when available; default $100 per item otherwise
  try {
    const priceMap = await loadPriceMap();
    let total = 0;
    for (const it of items) {
      const lid = String(it.id || '').toLowerCase();
      // Free shipping override for specific products
      const isFreeShip = (() => {
        if (!lid) return false;
        if (lid === 'battingmat' || lid === 'armorbasket') return true;
        if (lid.includes('batting') && lid.includes('mat')) return true;
        if (lid.includes('armor') && (lid.includes('basket') || lid.includes('baseball') && lid.includes('cart'))) return true;
        return false;
      })();
      if (isFreeShip) {
        // Free shipping per item
        const qty = Math.max(1, Number(it.qty) || 1);
        total += 0 * qty;
        continue;
      }
      const rec = priceMap.get(it.id);
      const dsr = Number(rec?.dsr || 0);
      const per = (Number.isFinite(dsr) && dsr > 0) ? dsr : 100;
      const qty = Math.max(1, Number(it.qty) || 1);
      total += Math.round(per * 100) * qty;
    }
    return total;
  } catch {
    // Fallback: treat as $100 per item
    return (items || []).reduce((s, it) => s + (10000 * Math.max(1, Number(it.qty)||1)), 0);
  }
}

// --- Basic tax calculation ---
// Efficient, local fallback: apply a simple state-based rate. Supports overrides via env.
// Env formats supported:
//  - TAX_RATES_JSON: JSON string like { "US": { "GA": 0.07, "FL": 0.06 } }
//  - TAX_RATES: CSV like "GA:0.07,FL:0.06" (assumes US)
function loadTaxRates() {
  // Defaults: collect in GA at 7% unless overridden
  const defaults = { US: { GA: 0.07 } };
  try {
    if (process.env.TAX_RATES_JSON) {
      const parsed = JSON.parse(process.env.TAX_RATES_JSON);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  try {
    if (process.env.TAX_RATES) {
      const parts = String(process.env.TAX_RATES).split(',').map(s=>s.trim()).filter(Boolean);
      const out = { US: {} };
      for (const p of parts) {
        const [st, rate] = p.split(':');
        const key = String(st||'').trim().toUpperCase();
        const r = Number(rate);
        if (key && Number.isFinite(r) && r >= 0) out.US[key] = r;
      }
      if (Object.keys(out.US).length) return out;
    }
  } catch {}
  return defaults;
}
const TAX_RATES = loadTaxRates();

function getTaxRateForAddress(addr = {}) {
  const country = String(addr.country || 'US').toUpperCase();
  // Normalize state (handle full names like "Georgia" to GA)
  const RAW_STATE = String(addr.state || '').trim();
  const STATE_MAP = {
    'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA','COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA','HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA','KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD','MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO','MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH','OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC','SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA','WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY','DISTRICT OF COLUMBIA':'DC'
  };
  let state = RAW_STATE.toUpperCase();
  if (state.length > 2) {
    const key = state.replace(/\./g, '').replace(/\s+/g, ' ').trim();
    state = STATE_MAP[key] || state;
  }
  const byCountry = TAX_RATES[country];
  if (!byCountry) return 0;
  const rate = byCountry[state];
  return Number.isFinite(rate) ? rate : 0;
}

function calcTaxCents(subtotalCents = 0, shippingCents = 0, discountCents = 0, shippingAddr = {}) {
  const rate = getTaxRateForAddress(shippingAddr);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const taxableBase = Math.max(0, Math.round(Number(subtotalCents||0)) + Math.round(Number(shippingCents||0)) - Math.round(Number(discountCents||0)));
  return Math.round(taxableBase * rate);
}

// Create payment intent with server-side calculation
app.post('/api/create-payment-intent', async (req, res) => {
  const { items = [], customer = {}, shipping = {}, currency = 'usd', couponCode = '', existingOrderId = null } = req.body;
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.' });
    }
    // Basic input validation and normalization
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Items are required' });
    const normItems = items.map(i => ({ id: String(i.id || '').trim(), qty: Math.max(1, Math.min(20, parseInt(i.qty || 1))) }));
    const safeCurrency = (String(currency || 'usd').toLowerCase() === 'usd') ? 'usd' : 'usd';
    const subtotal = await calcSubtotalCents(normItems);
    const shippingCents = await calcShippingCents(normItems, subtotal);
    let amount = subtotal + shippingCents; // initial base before discounts/tax

    // Optional: apply coupon
    let appliedCoupon = null;
    let discountCents = 0;
    if (couponCode) {
      try {
        const v = await couponService.validate(couponCode, customer.email || '');
        if (v.valid) {
          appliedCoupon = v.coupon;
          const before = amount;
          amount = couponService.applyDiscount(amount, appliedCoupon);
          discountCents = Math.max(0, before - amount);
        }
      } catch (e) {
        // ignore invalid coupon; frontend can call validate endpoint for messaging
      }
    }

    // Compute taxes based on shipping address and post-discount amount
  const taxCents = calcTaxCents(subtotal, shippingCents, discountCents, shipping);
  amount = Math.max(0, subtotal + shippingCents - discountCents + taxCents);

    const description = `EZ Sports order — ${items.map(i => `${i.id}x${i.qty}`).join(', ')}`;
    // Create a local order first for analytics/visibility
    let newOrder = null;
    try {
      const orderPayload = {
        userId: null,
        userEmail: customer.email || undefined,
        items: normItems.map(i => ({ id: i.id, qty: i.qty })),
        shippingAddress: shipping,
        customerInfo: customer,
        paymentInfo: { method: 'stripe' }
      };
      if (existingOrderId) {
        newOrder = { id: existingOrderId };
      } else {
        newOrder = await orderService.createOrder(orderPayload);
      }
    } catch (e) {
      // Keep going; order will still be created on /api/order fallback
      newOrder = null;
    }

    // Provide an idempotency key to prevent duplicate PI creation on retries
    const idemKey = crypto
      .createHash('sha256')
      .update(JSON.stringify({ normItems, email: customer.email || '', existingOrderId: newOrder?.id || existingOrderId || null }))
      .digest('hex')
      .slice(0, 64);

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: safeCurrency,
      description,
      metadata: {
        email: customer.email || '',
        name: customer.name || '',
        items: normItems.map(i => `${i.id}:${i.qty}`).join('|'),
        order_id: newOrder?.id ? String(newOrder.id) : '',
        coupon_code: appliedCoupon ? String(appliedCoupon.code) : ''
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
    }, { idempotencyKey: idemKey });
    // Return client secret and linked order id so the frontend can keep them in sync
    res.json({
      clientSecret: paymentIntent.client_secret,
      amount,
      orderId: newOrder?.id || null,
      couponApplied: appliedCoupon ? { code: appliedCoupon.code, type: appliedCoupon.type, value: appliedCoupon.value } : null,
      breakdown: {
        subtotal: subtotal,
        shipping: shippingCents,
        discount: discountCents,
        tax: taxCents,
        total: amount
      }
    });
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
    // Block in production unless explicitly allowed (test checkout path)
    const allowTest = String(process.env.ALLOW_TEST_CHECKOUT || '').toLowerCase() === 'true';
    if (process.env.NODE_ENV === 'production' && !allowTest) {
      return res.status(403).json({ error: 'Disabled in production' });
    }
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
      const order = { ...orderData, ts: new Date().toISOString(), test: true };
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
