const { sql } = require('@vercel/postgres');
const { ensureSchema } = require('../_lib_db');
const { getPriceCents } = require('../_lib_products');
const { verifySession } = require('../_lib_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  const sess = verifySession(req);
  if (!sess) return res.status(401).json({ message: 'Unauthorized' });
  await ensureSchema();
  const { rows } = await sql`SELECT id, user_email, total_cents, status, created_at, items, summary FROM orders WHERE lower(user_email)=lower(${sess.email}) ORDER BY created_at DESC LIMIT 100`;
  const orders = rows.map(r => {
    const items = Array.isArray(r.items) ? r.items.map(i => ({
      ...i,
      price: i.price ?? (getPriceCents(i.id) / 100)
    })) : [];
    return {
      id: r.id,
      date: r.created_at,
      createdAt: r.created_at,
      items,
      total: (Number(r.total_cents)||0)/100,
      status: r.status,
      summary: r.summary
    };
  });
  return res.json(orders);
}
