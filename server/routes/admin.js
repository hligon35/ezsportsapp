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

module.exports = router;
