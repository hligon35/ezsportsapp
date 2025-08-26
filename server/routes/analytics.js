const express = require('express');
const router = express.Router();
const AnalyticsService = require('../services/AnalyticsService');
const { requireAdmin } = require('../middleware/auth');

const analytics = new AnalyticsService();

// Track a page view (public)
router.post('/track', async (req, res) => {
  try {
    const origin = req.headers.origin || '';
    // When running front-end via Live Server (port 5500), skip writing analytics to avoid dev reload loops
    if (/^http:\/\/(localhost|127\.0\.0\.1):5500$/i.test(origin)) {
      return res.json({ ok: true, devSkipped: true });
    }
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
    const origin = req.headers.origin || '';
    if (/^http:\/\/(localhost|127\.0\.0\.1):5500$/i.test(origin)) {
      return res.json({ ok: true, devSkipped: true });
    }
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
