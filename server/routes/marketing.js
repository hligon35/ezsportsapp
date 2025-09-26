const express = require('express');
const router = express.Router();
const SubscriberService = require('../services/SubscriberService');
const CouponService = require('../services/CouponService');
const EmailService = require('../services/EmailService');
const { requireAdmin } = require('../middleware/auth');

const subs = new SubscriberService();
const coupons = new CouponService();
const mail = new EmailService();

// Public subscribe endpoint
router.post('/subscribe', async (req, res) => {
  try {
    const { email, name } = req.body || {};
    const s = await subs.addOrUpdate(email, name);
    res.json({ ok:true, subscriber: s });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Public unsubscribe
router.post('/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body || {};
    await subs.unsubscribe(email);
    res.json({ ok:true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Admin: list subscribers
router.get('/admin/subscribers', requireAdmin, async (req, res) => {
  const list = await subs.list(!!req.query.activeOnly);
  res.json(list);
});

// Admin: create coupon
router.post('/admin/coupons', requireAdmin, async (req, res) => {
  try {
    const c = await coupons.create(req.body||{});
    res.status(201).json(c);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Admin: list coupons
router.get('/admin/coupons', requireAdmin, async (req, res) => {
  const list = await coupons.list();
  res.json(list);
});

// Admin: deactivate coupon
router.post('/admin/coupons/:code/deactivate', requireAdmin, async (req, res) => {
  try { const c = await coupons.deactivate(req.params.code); res.json(c); }
  catch (e) { res.status(400).json({ message: e.message }); }
});

// Public: validate coupon
router.post('/validate-coupon', async (req, res) => {
  try {
    const { code, email } = req.body || {};
    const result = await coupons.validate(code, email);
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Admin: send newsletter (queue emails to subscribers)
router.post('/admin/newsletter', requireAdmin, async (req, res) => {
  try {
    const { subject, html, text, segment } = req.body || {};
    const list = await subs.list(true);
    // Optional segment: 'all', 'recent' (placeholder), 'custom'
    const targets = list; // For now, all active subscribers
    const queued = [];
    for (const s of targets) {
      const e = await mail.queue({ to: s.email, subject, html, text, tags:['newsletter'] });
      queued.push(e);
    }
    res.json({ queued: queued.length });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

module.exports = router;
