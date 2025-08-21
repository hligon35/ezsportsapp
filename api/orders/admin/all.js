const { sql } = require('@vercel/postgres');
const { verifySession } = require('../../_lib_auth');
const { ensureSchema } = require('../../_lib_db');

module.exports = async function handler(req, res) {
  const sess = verifySession(req);
  if (!sess || !sess.isAdmin) return res.status(401).json({ message: 'Unauthorized' });
  await ensureSchema();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const page = Math.max(1, parseInt(url.searchParams.get('page')||'1', 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize')||'10', 10)));
  const offset = (page - 1) * pageSize;
  const sortBy = ['created_at','status','total_cents'].includes(url.searchParams.get('sortBy')) ? url.searchParams.get('sortBy') : 'created_at';
  const sortDir = (url.searchParams.get('sortDir')||'desc').toLowerCase()==='asc' ? 'asc' : 'desc';
  const totalRes = await sql`SELECT count(*)::int as count FROM orders`;
  const total = totalRes.rows[0].count;
  const { rows } = await sql`SELECT id, user_email, total_cents, status, created_at, summary FROM orders ORDER BY ${sql.raw(sortBy)} ${sql.raw(sortDir)} LIMIT ${pageSize} OFFSET ${offset}`;
  return res.json({ items: rows, total, page, pageSize });
}
