const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_insecure_secret_change_me';
const JWT_ISS = process.env.JWT_ISS || 'ezsports';
const JWT_AUD = process.env.JWT_AUD || 'ezsports-apps';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'None';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'true') === 'true';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined; // e.g., .yourdomain.com

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
  const payload = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISS, audience: JWT_AUD });
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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d', issuer: JWT_ISS, audience: JWT_AUD });
}

function setAuthCookie(res, token) {
  const options = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
  if (COOKIE_DOMAIN) options.domain = COOKIE_DOMAIN;
  res.cookie('token', token, options);
}

function clearAuthCookie(res) {
  const options = { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: '/' };
  if (COOKIE_DOMAIN) options.domain = COOKIE_DOMAIN;
  res.clearCookie('token', options);
}

function getUserFromRequest(req) {
  try {
    const token = getTokenFromReq(req);
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISS, audience: JWT_AUD });
  } catch {
    return null;
  }
}

module.exports = { requireAuth, requireAdmin, signToken, setAuthCookie, clearAuthCookie, getUserFromRequest };
