const { clearSessionCookie } = require('../_lib_auth');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
