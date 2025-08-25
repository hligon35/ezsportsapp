const express = require('express');
const router = express.Router();
const AnalyticsService = require('../services/AnalyticsService');
const { requireAdmin } = require('../middleware/auth');

const analytics = new AnalyticsService();

// Track a page view (public)
router.post('/track', async (req, res) => {
  try {
    const { path, referrer, visitorId, userId, ts } = req.body || {};
    await analytics.trackPageView({ path, referrer, visitorId, userId, ts });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Track a generic event (public) - e.g., favorite, add_to_cart
router.post('/event', async (req, res) => {
  try {
    const { type, productId, visitorId, userId, ts } = req.body || {};
    await analytics.trackEvent({ type, productId, visitorId, userId, ts });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin traffic summary
router.get('/admin/traffic', requireAdmin, async (req, res) => {
  try {
    const { timeframe = 'all' } = req.query;
    const summary = await analytics.getTrafficSummary(timeframe);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin product toplists
router.get('/admin/products', requireAdmin, async (req, res) => {
  try {
    const { timeframe = 'all', limit = 10 } = req.query;
    const toplists = await analytics.getProductToplists(timeframe, parseInt(limit));
    res.json(toplists);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
