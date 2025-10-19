const { verifySession } = require('../_lib_auth');
const { ensureSchema, getUserByEmail, setUserStripeCustomer } = require('../_lib_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const user = verifySession(req);
  if (!user || !user.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const { email, return_url } = req.body || {};
  if (!process.env.STRIPE_SECRET_KEY) return res.status(400).json({ error: 'Stripe not configured' });
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  try {
    await ensureSchema();
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const record = await getUserByEmail(email);
    let customerId = record?.stripe_customer_id || null;

    // If no stored customer id, try to find or create in Stripe
    if (!customerId) {
      // Search by email in Stripe
      const search = await stripe.customers.search({ query: `email:'${email.replace(/'/g, "\\'")}'` });
      let customer = search?.data?.[0] || null;
      if (!customer) {
        customer = await stripe.customers.create({ email });
      }
      customerId = customer.id;
      if (record) await setUserStripeCustomer(email, customerId);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: return_url || `${req.headers.origin || ''}/admin.html`
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('billing-portal error', e);
    return res.status(500).json({ error: 'Unable to create billing portal session' });
  }
};
