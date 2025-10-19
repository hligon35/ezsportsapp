module.exports = async function handler(req, res) {
  // This deployment uses the Express server (/server/index.js). Disable this endpoint to avoid confusion.
  return res.status(410).json({ error: 'Gone', message: 'Use /api/create-payment-intent on the Express server.' });
}
