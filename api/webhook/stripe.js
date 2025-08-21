const { buffer } = require('micro');
const { ensureSchema, markOrderPaidByPi } = require('../_lib_db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const sig = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set');
    return res.status(400).send('Webhook not configured');
  }
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
  try {
    const buf = await buffer(req);
    const event = stripe.webhooks.constructEvent(buf, sig, whSecret);
    await ensureSchema();

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      try {
        await markOrderPaidByPi(pi.id);
      } catch (e) {
        console.error('Failed to mark order paid', e);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}

export const config = {
  api: {
    bodyParser: false,
  }
};
