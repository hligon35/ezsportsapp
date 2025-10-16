const { ensureSchema, createOrderRecord } = require('./_lib_db');

module.exports = async function handler(req, res) {
  return res.status(410).json({ error: 'Gone', message: 'Use /api/order on the Express server.' });
}
