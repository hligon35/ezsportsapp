const jwt = require('jsonwebtoken');

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
  requireAuth(req, res, (err) => {
    if (err) return; // response already handled
    if (!req.user?.isAdmin) return res.status(403).json({ message: 'Forbidden' });
    next();
  });
}

function signToken(user) {
  const payload = { id: user.id, email: user.email, isAdmin: !!user.isAdmin };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, requireAdmin, signToken };
