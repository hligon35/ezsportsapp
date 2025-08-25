module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({});
  return res.status(200).json({ pk: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_your_publishable_key' });
}
