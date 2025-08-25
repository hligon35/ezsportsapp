module.exports = function handler(req, res) {
  return res.status(200).json({ status: 'ok', time: new Date().toISOString() });
}
