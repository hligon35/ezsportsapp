const { ensureSchema, createOrderRecord } = require('./_lib_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    await ensureSchema();
    const orderData = req.body || {};
    const items = Array.isArray(orderData.items) ? orderData.items : [];
    const totalCents = Number(orderData.totalCents) || (items || []).reduce((sum, i) => sum + (Number(i.price||0) * Number(i.qty||0) * 100), 0);
    const row = await createOrderRecord({ userEmail: orderData.customer?.email || orderData.userEmail || null, items, totalCents: Math.round(totalCents) });
    res.json({ status: 'ok', orderId: row.id, createdAt: row.created_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
