const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const DatabaseManager = require('../database/DatabaseManager');
const AnalyticsService = require('../services/AnalyticsService');
const OrderService = require('../services/OrderService');
const CouponService = require('../services/CouponService');
const SubscriberService = require('../services/SubscriberService');
const EmailService = require('../services/EmailService');
const PayoutService = require('../services/PayoutService');
const DailyReportService = require('../services/DailyReportService');

// Stripe Billing Portal for admins to open on behalf of customer
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch {}

router.post('/billing-portal', requireAdmin, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Stripe is not configured on the server.' });
    const { email, return_url } = req.body || {};
    if (!email) return res.status(400).json({ message: 'email required' });
    const search = await stripe.customers.search({ query: `email:'${String(email).replace(/'/g, "\\'")}'` });
    let customer = search?.data?.[0] || null;
    if (!customer) customer = await stripe.customers.create({ email });
    const session = await stripe.billingPortal.sessions.create({ customer: customer.id, return_url: return_url || (req.headers.origin || '').replace(/\/$/,'') + '/admin.html' });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to create billing portal session' });
  }
});

// --- Admin diagnostics: surface integration readiness for dashboards ---
router.get('/diagnostics', requireAdmin, async (req, res) => {
  try {
    const db = new DatabaseManager();
    const analytics = new AnalyticsService();
    const ordersSvc = new OrderService();
    const couponsSvc = new CouponService();
    const subsSvc = new SubscriberService();
    const emailSvc = new EmailService();
    const payoutsSvc = new PayoutService();

    // Counts (tolerate failures)
    const safeCount = async (fn) => { try { const arr = await fn(); return Array.isArray(arr) ? arr.length : (arr && arr.items ? arr.items.length : 0); } catch { return null; } };
    const ordersCount = await safeCount(() => db.find('orders'));
    const analyticsCount = await safeCount(() => db.find('analytics'));
    const couponsCount = await safeCount(() => db.find('coupons'));
    const subsCount = await safeCount(() => db.find('subscribers'));
    const emailsCount = await safeCount(() => db.find('emails'));
    const payoutsCount = await safeCount(() => db.find('payouts'));

    // Quick traffic summary for last 7d
    let traffic7 = null;
    try { traffic7 = await analytics.getTrafficSummary('week'); } catch {}

    // Stripe readiness
    const stripeReady = !!process.env.STRIPE_SECRET_KEY;
    const stripeWebhook = !!process.env.STRIPE_WEBHOOK_SECRET;
    const stripePk = !!process.env.STRIPE_PUBLISHABLE_KEY;
    // Cloudflare readiness
    const cfReady = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);

    // Auth/cookies
    const jwtSet = !!process.env.JWT_SECRET && process.env.JWT_SECRET !== 'dev_insecure_secret_change_me';
    const cookieDomain = process.env.COOKIE_DOMAIN || null;

    // CORS
    const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);

    res.json({
      now: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      integrations: {
        stripe: { configured: stripeReady, publishableSet: stripePk, webhookSecretSet: stripeWebhook },
        cloudflare: { configured: cfReady }
      },
      auth: { jwtSet, cookieDomain },
      cors: { origins: corsOrigins },
      storage: {
        ordersCount, analyticsCount, couponsCount, subscribersCount: subsCount, emailsCount, payoutsCount
      },
      analytics: traffic7 ? {
        timeframe: traffic7.timeframe,
        totalPageviews: traffic7.totalPageviews,
        uniqueVisitors: traffic7.uniqueVisitors,
        topPages: traffic7.topPages
      } : null
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Diagnostics failed' });
  }
});

// --- Reports: send daily visitor activity email now (admin) ---
router.post('/reports/daily/send', requireAdmin, async (req, res) => {
  try {
    const { day } = req.body || {}; // 'yesterday' (default) or 'YYYY-MM-DD'
    const svc = new DailyReportService();
    const out = await svc.sendDailyActivityReport({ day: day || 'yesterday' });
    res.json({ ok: true, report: { dayKey: out.dayKey, start: out.start, end: out.end }, sent: out.sent });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || 'Failed to send report' });
  }
});

// --- Stripe Admin Finance Endpoints ---
function getTimeframeRange(tf = 'week') {
  const now = Math.floor(Date.now() / 1000);
  // defaults
  let from = now - 7 * 24 * 3600;
  if (tf === 'today') {
    const d = new Date(); d.setHours(0,0,0,0);
    from = Math.floor(d.getTime() / 1000);
  } else if (tf === 'month') {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
    from = Math.floor(d.getTime() / 1000);
  } else if (tf === 'all') {
    from = 0;
  }
  return { from, to: now };
}

// Summary of gross/net/fees and balances
router.get('/stripe/summary', requireAdmin, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Stripe is not configured on the server.' });
    const { timeframe = 'week' } = req.query;
    const { from, to } = getTimeframeRange(String(timeframe));

    // Balance transactions contain net and fee details
    let hasMore = true; let startingAfter = undefined; const txs = [];
    while (hasMore && txs.length < 500) { // cap to avoid runaway
      const resp = await stripe.balanceTransactions.list({
        limit: 100,
        created: { gte: from || undefined, lte: to || undefined },
        starting_after: startingAfter
      });
      txs.push(...resp.data);
      hasMore = resp.has_more;
      startingAfter = resp.data.length ? resp.data[resp.data.length - 1].id : undefined;
      if (!resp.data.length) break;
    }
    const cents = (n) => Number(n || 0);
    const sumBy = (filterFn) => txs.filter(filterFn).reduce((s,t)=> s + cents(t.amount), 0);

    const grossCharges = sumBy(t => t.type === 'charge');
    const refunds = sumBy(t => t.type === 'refund' || t.type === 'payment_refund');
    const fees = txs.reduce((s,t)=> s + cents(t.fee), 0);
    const net = txs.reduce((s,t)=> s + cents(t.net), 0);

    // Build daily series for charts
    const byDay = new Map();
    for (const t of txs) {
      const d = new Date((t.created||0)*1000);
      const key = d.toISOString().slice(0,10);
      if (!byDay.has(key)) byDay.set(key, { date: key, gross: 0, refunds: 0, fees: 0, net: 0 });
      const row = byDay.get(key);
      const amt = cents(t.amount);
      row.fees += cents(t.fee);
      row.net += cents(t.net);
      if (t.type === 'charge') row.gross += amt;
      if (t.type === 'refund' || t.type === 'payment_refund') row.refunds += Math.abs(amt);
    }
    const series = Array.from(byDay.values()).sort((a,b)=> a.date.localeCompare(b.date)).map(r => ({
      date: r.date,
      gross: r.gross/100, refunds: r.refunds/100, fees: r.fees/100, net: r.net/100
    }));

    // Current balance and payouts
    const balance = await stripe.balance.retrieve();
    const payouts = await stripe.payouts.list({ limit: 10 });

    return res.json({
      timeframe,
      summary: {
        gross: grossCharges / 100,
        refunds: Math.abs(refunds) / 100,
        fees: Math.abs(fees) / 100,
        net: net / 100
      },
      balance: {
        available: (balance.available || []).map(b => ({ currency: b.currency, amount: b.amount / 100 })),
        pending: (balance.pending || []).map(b => ({ currency: b.currency, amount: b.amount / 100 }))
      },
      payouts: payouts.data.map(p => ({ id: p.id, amount: p.amount/100, currency: p.currency, status: p.status, arrival_date: p.arrival_date, created: p.created })),
      series
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to fetch Stripe summary' });
  }
});

// Optional: list recent Stripe invoices (if using Stripe Invoicing)
router.get('/stripe/invoices', requireAdmin, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Stripe is not configured on the server.' });
    const { status, limit = 20, timeframe = 'month' } = req.query;
    const { from, to } = getTimeframeRange(String(timeframe));
    const params = { limit: Math.min(100, parseInt(limit) || 20) };
    if (status) params.status = String(status);
    if (from) params.created = { gte: from };
    const resp = await stripe.invoices.list(params);
    return res.json({ items: resp.data, has_more: resp.has_more });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to fetch Stripe invoices' });
  }
});

// --- Cloudflare Analytics (GraphQL) ---
router.get('/stripe/payouts-local', requireAdmin, async (req, res) => {
  try {
    const PayoutService = require('../services/PayoutService');
    const svc = new PayoutService();
    const list = await svc.list(50);
    res.json({ items: list });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to load local payouts' });
  }
});

// --- Cloudflare Analytics (GraphQL) ---
router.get('/cloudflare/summary', requireAdmin, async (req, res) => {
  try {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const zone = process.env.CLOUDFLARE_ZONE_ID;
    if (!token || !zone) return res.status(503).json({ message: 'Cloudflare not configured' });
    const { timeframe = 'week' } = req.query;
    const range = getTimeframeRange(String(timeframe));
    // Cloudflare's `httpRequests1dGroups` expects date filters in YYYY-MM-DD format
    // (not full ISO timestamps). Using Date variables avoids GraphQL argument parsing errors.
    const fromDate = new Date((range.from || 0) * 1000).toISOString().slice(0, 10);
    const toDate = new Date((range.to || Date.now() / 1000) * 1000).toISOString().slice(0, 10);

    const query = `
      query($zoneTag: String!, $from: Date!, $to: Date!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequests1dGroups(limit: 30, filter: { date_geq: $from, date_lt: $to }) {
              dimensions { date }
              sum { requests cachedRequests threats bytes cachedBytes }
            }
            topPaths: httpRequests1dGroups(limit: 10, orderBy: [sum_requests_DESC]) {
              dimensions { clientRequestPath }
              sum { requests }
            }
            country: httpRequests1dGroups(limit: 10, orderBy: [sum_requests_DESC]) {
              dimensions { clientCountryName }
              sum { requests }
            }
          }
        }
      }
    `;
    const body = { query, variables: { zoneTag: zone, from: fromDate, to: toDate } };
    const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok || !data || !data.data) {
      return res.status(500).json({ message: 'Cloudflare API error', details: data?.errors || null });
    }
    const zoneData = data.data.viewer?.zones?.[0] || {};
    const groups = zoneData.httpRequests1dGroups || [];
    const totals = groups.reduce((acc, g) => {
      acc.requests += Number(g.sum?.requests||0);
      acc.cachedRequests += Number(g.sum?.cachedRequests||0);
      acc.threats += Number(g.sum?.threats||0);
      acc.bytes += Number(g.sum?.bytes||0);
      acc.cachedBytes += Number(g.sum?.cachedBytes||0);
      return acc;
    }, { requests:0, cachedRequests:0, threats:0, bytes:0, cachedBytes:0 });
    const topPaths = (zoneData.topPaths||[]).map(g => ({ path: g.dimensions?.clientRequestPath || '/', requests: Number(g.sum?.requests||0) }));
    const byCountry = (zoneData.country||[]).map(g => ({ country: g.dimensions?.clientCountryName || 'Unknown', requests: Number(g.sum?.requests||0) }));
    const series = groups.map(g => ({
      date: g.dimensions?.date || '',
      requests: Number(g.sum?.requests||0),
      cachedRequests: Number(g.sum?.cachedRequests||0),
      bytes: Number(g.sum?.bytes||0),
      threats: Number(g.sum?.threats||0)
    })).sort((a,b)=> a.date.localeCompare(b.date));
    res.json({
      timeframe,
      totals,
      cacheRatio: totals.requests ? (totals.cachedRequests / totals.requests) : 0,
      bandwidthMB: totals.bytes / (1024*1024),
      topPaths,
      byCountry,
      series
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to fetch Cloudflare analytics' });
  }
});

module.exports = router;

// --- Admin Product Sync (local DB + optional Stripe) ---
// Triggers server/scripts/sync-products.js. Protected with requireAdmin.
router.post('/products/sync', requireAdmin, async (req, res) => {
  try {
    // Query flags: stripe=1 to enable Stripe, dry=1 for dry run, deactivateRemoved=1 to deactivate in Stripe
    const stripeFlag = String(req.query.stripe || '1');
    const dryFlag = String(req.query.dry || '0');
    const deactFlag = String(req.query.deactivateRemoved || '0');
    const fromDbFlag = String(req.query.from || 'db');

  const args = ['scripts/sync-products.js'];
    if (!(stripeFlag === '1' || /true/i.test(stripeFlag))) args.push('--no-stripe');
    if (dryFlag === '1' || /true/i.test(dryFlag)) args.push('--dry');
    if (deactFlag === '1' || /true/i.test(deactFlag)) args.push('--deactivate-removed');
  if (fromDbFlag === 'db') args.push('--from-db');

    const cwd = path.join(__dirname, '..');
    const child = spawn('node', args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let responded = false;
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (responded) return;
      responded = true;
      res.status(500).json({ ok: false, message: err.message });
    });
    child.on('exit', (code) => {
      if (responded) return;
      responded = true;
      const wroteMatch = stdout.match(/Wrote\s+(\d+)\s+products/i);
      const discoveredMatch = stdout.match(/Discovered\s+(\d+)\s+product JSON files/i);
      const warnings = [];
      try {
        const lines = stdout.split(/\r?\n/);
        let warnIdx = lines.findIndex(l => /^Warnings:/i.test(l));
        if (warnIdx >= 0) {
          for (let i = warnIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            warnings.push(line.replace(/^\s*-\s*/, ''));
          }
        }
      } catch {}
      res.json({
        ok: code === 0,
        code,
        discovered: discoveredMatch ? Number(discoveredMatch[1]) : null,
        wrote: wroteMatch ? Number(wroteMatch[1]) : null,
        stdout,
        stderr,
        warnings
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// --- Netting calculator config (assets/netting.json) ---
// GET current netting config
router.get('/netting-config', requireAdmin, async (req, res) => {
  try {
    const path = require('path');
    const file = path.join(__dirname, '..', '..', 'assets', 'netting.json');
    let json;
    try {
      const raw = await fs.readFile(file, 'utf8');
      json = JSON.parse(raw);
    } catch (_) {
      // Provide a sensible default if file missing
      json = {
        version: 1,
        updated: new Date().toISOString(),
        defaults: { markupPerSqFt: 0.25, borderSurchargePerFt: 0.35, expeditedFee: 25, shipPerItem: 100 },
        meshPrices: []
      };
    }
    res.json(json);
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to read netting config' });
  }
});

// PUT update netting config (full replace)
router.put('/netting-config', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    // Basic validation/sanitization
    const out = {
      version: Number(body.version || 1),
      updated: new Date().toISOString(),
      defaults: {
        markupPerSqFt: Number(body?.defaults?.markupPerSqFt ?? 0.25) || 0,
        borderSurchargePerFt: Number(body?.defaults?.borderSurchargePerFt ?? 0.35) || 0,
        expeditedFee: Number(body?.defaults?.expeditedFee ?? 25) || 0,
        shipPerItem: Number(body?.defaults?.shipPerItem ?? 100) || 0
      },
      meshPrices: Array.isArray(body.meshPrices) ? body.meshPrices.map(m => ({
        id: String(m.id || ''),
        label: String(m.label || ''),
        sport: String(m.sport || 'other'),
        wholesaleSqFt: Number(m.wholesaleSqFt || 0) || 0
      })) : []
    };
    const path = require('path');
    const file = path.join(__dirname, '..', '..', 'assets', 'netting.json');
    await fs.writeFile(file, JSON.stringify(out, null, 2), 'utf8');
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to write netting config' });
  }
});

// --- Bulk updates to assets/prodList.json for MAP/Shipping ---
router.post('/prodlist/bulk-update', requireAdmin, async (req, res) => {
  try {
    const path = require('path');
    const file = path.join(__dirname, '..', '..', 'assets', 'prodList.json');
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);
    const categories = json && json.categories && typeof json.categories === 'object' ? json.categories : {};
    const { op } = req.body || {};

    if (!op || typeof op !== 'object') {
      return res.status(400).json({ message: 'Missing op payload' });
    }

    let changed = 0;
    const applyForItem = (item, catName) => {
      // Helper to match by optional category
      const catOk = !op.category || String(catName) === String(op.category);
      if (!catOk) return false;
      let touched = false;
      // Operation: set shipping (dsr)
      if (op.type === 'setShipping') {
        const onlyMissing = !!op.onlyMissing;
        const val = Number(op.value);
        if (Number.isFinite(val) && val >= 0) {
          const has = Number(item.dsr || (item.details && item.details.dsr));
          if (!onlyMissing || !(Number.isFinite(has) && has > 0)) {
            item.dsr = val;
            if (item.details && typeof item.details === 'object') {
              item.details.dsr = val;
            }
            touched = true;
          }
        }
      }
      // Operation: change MAP where current MAP equals from
      if (op.type === 'changeMapEqual') {
        const from = Number(op.from);
        const to = Number(op.to);
        if (Number.isFinite(from) && Number.isFinite(to)) {
          const setIfEqual = (obj) => {
            const cur = Number(obj.map ?? obj.price ?? 0);
            if (Number.isFinite(cur) && cur === from) {
              obj.map = to;
              touched = true;
            }
          };
          // Item or its variations
          if (Array.isArray(item.variations) && item.variations.length) {
            item.variations.forEach(v => setIfEqual(v));
          } else {
            setIfEqual(item);
          }
        }
      }
      // Operation: set MAP directly by SKU map { sku: price }
      if (op.type === 'setMapBySku') {
        const mp = op.map || {};
        const val = mp[item.sku];
        if (val != null) {
          const num = Number(val);
          if (Number.isFinite(num)) {
            if (Array.isArray(item.variations) && item.variations.length) {
              // apply to base (if present), else to all variations
              item.map = num;
              item.variations.forEach(v => { v.map = num; });
            } else {
              item.map = num;
            }
            touched = true;
          }
        }
      }
      return touched;
    };

    for (const [catName, arr] of Object.entries(categories)) {
      if (!Array.isArray(arr)) continue;
      arr.forEach(item => {
        if (applyForItem(item, catName)) changed++;
      });
    }

    if (!changed) {
      return res.json({ ok: true, changed: 0 });
    }

    json.updatedAt = new Date().toISOString();
    await fs.writeFile(file, JSON.stringify(json, null, 2), 'utf8');
    res.json({ ok: true, changed });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Bulk update failed' });
  }
});
