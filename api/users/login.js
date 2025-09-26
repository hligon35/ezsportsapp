const { ensureSchema, ensureOwnerAdmin, findUserByIdentifier, verifyPassword, updateLastLogin, publicUser } = require('../_lib_db');
const { signSession, setSessionCookie } = require('../_lib_auth');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  try {
  await ensureSchema();
  // Ensure owner admin exists so they can log in immediately in production
  await ensureOwnerAdmin();
  const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body || {});
  const { identifier, password } = body;
    if (!identifier || !password) return res.status(400).json({ message: 'Missing credentials' });
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await verifyPassword(user, password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    await updateLastLogin(user.id);
  const pub = publicUser(user);
  // Set JWT session cookie
  const token = signSession(pub);
  setSessionCookie(res, token);
    return res.status(200).json({ user: pub });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Server error' });
  }
}
