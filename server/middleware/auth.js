const jwt = require('jsonwebtoken');
const DatabaseManager = require('../database/DatabaseManager');
const db = new DatabaseManager();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_insecure_secret_change_me';

function getTokenFromReq(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

function requireAuth(req, res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, async (err) => {
    if (err) return; // response already handled in requireAuth
    try {
      // Fast-path: token says admin
      if (req.user?.isAdmin) return next();
      // Fallback: known admin email
      if ((req.user?.email || '').toLowerCase() === 'admin@ezsports.com') return next();
      // Fallback: lookup user in DB and infer admin from stored flags/role
      if (req.user?.id) {
        const user = await db.findOne('users', { id: req.user.id });
        if (user && (user.isAdmin || user.role === 'admin' || (user.email||'').toLowerCase()==='admin@ezsports.com')) {
          req.user.isAdmin = true;
          return next();
        }
      }
      return res.status(403).json({ message: 'Forbidden' });
    } catch (e) {
      return res.status(403).json({ message: 'Forbidden' });
    }
  });
}

function signToken(user) {
  const computedIsAdmin = Boolean(user.isAdmin || user.role === 'admin' || user.email === 'admin@ezsports.com');
  const payload = { id: user.id, email: user.email, isAdmin: computedIsAdmin };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, requireAdmin, signToken };
