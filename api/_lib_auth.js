const jwt = require('jsonwebtoken');

function parseCookies(req) {
  const header = req.headers['cookie'] || req.headers['Cookie'];
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = decodeURIComponent(v.trim());
    return acc;
  }, {});
}

function signSession(user) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  const payload = { sub: String(user.id || user.email), email: user.email, isAdmin: !!(user.isAdmin || user.is_admin) };
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

function verifySession(req) {
  try {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (!token) return null;
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  const secure = process.env.VERCEL_ENV !== 'development';
  const cookie = `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${secure ? ' Secure;' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL_ENV !== 'development';
  const cookie = `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT;${secure ? ' Secure;' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

module.exports = { parseCookies, signSession, verifySession, setSessionCookie, clearSessionCookie };
