const { ensureSchema, ensureOwnerAdmin, createUser, findUserByIdentifier, publicUser } = require('../_lib_db');

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
  // Ensure owner admin exists for production bootstrapping
  await ensureOwnerAdmin();
  const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body || {});
  const { email, password, name } = body;
    if (!email || !password) return res.status(400).json({ message: 'Missing fields' });
    const exists = await findUserByIdentifier(email);
    if (exists) return res.status(409).json({ message: 'User already exists' });
    const isAdmin = /@ezsports\.com$/i.test(email) || /admin/i.test(email);
    const user = await createUser({ email, name, password, isAdmin });
    return res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Server error' });
  }
}
