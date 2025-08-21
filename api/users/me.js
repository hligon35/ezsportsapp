const { verifySession } = require('../_lib_auth');
const { ensureSchema, findUserByIdentifier, publicUser } = require('../_lib_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });
  const sess = verifySession(req);
  if (!sess) return res.status(401).json({ message: 'Unauthorized' });
  await ensureSchema();
  // Try to get fresh user info; fall back to session payload
  let user = null;
  try { user = await findUserByIdentifier(sess.email); } catch {}
  const out = user ? publicUser(user) : { email: sess.email, isAdmin: !!sess.isAdmin };
  return res.status(200).json({ user: out });
}
