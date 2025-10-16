const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

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
    const fromIso = new Date((range.from||0)*1000).toISOString();
    const toIso = new Date((range.to||Date.now()/1000)*1000).toISOString();

    const query = `
      query($zoneTag: String!, $from: Time!, $to: Time!) {
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
    const body = { query, variables: { zoneTag: zone, from: fromIso, to: toIso } };
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
