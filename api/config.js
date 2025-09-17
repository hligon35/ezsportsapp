module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({});
  const pk = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51S839ERqL7uSdPTLyJZfpkX0Gjl2uE2w2BFSE1Ea08nEfM0sXIIhND0ORLgvl53zHylpTkyiRzY8sUNqRAsXJlBL009dYg2wfG';
  const enabled = !!process.env.STRIPE_SECRET_KEY; // backend can actually create PaymentIntents
  return res.status(200).json({ pk, enabled });
}
