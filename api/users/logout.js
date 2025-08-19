module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  // No server cookies in this version; frontend stores user in localStorage
  return res.status(200).json({ ok: true });
}
