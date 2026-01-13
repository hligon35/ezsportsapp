const express = require('express');
const rateLimit = require('express-rate-limit');
const AlertingService = require('../services/AlertingService');

const router = express.Router();
const alerts = new AlertingService();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.ERROR_REPORT_RATE_LIMIT_PER_MIN || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

function sanitizeClientError(body) {
  const b = body || {};
  const out = {
    source: 'client',
    name: String(b.name || '').slice(0, 120) || null,
    message: String(b.message || '').slice(0, 2000) || null,
    stack: String(b.stack || '').slice(0, 12000) || null,
    url: String(b.url || '').slice(0, 2000) || null,
    path: String(b.path || '').slice(0, 600) || null,
    userAgent: String(b.userAgent || '').slice(0, 400) || null,
    visitorId: String(b.visitorId || '').slice(0, 120) || null,
    userId: b.userId || null,
    severity: String(b.severity || 'error').slice(0, 20),
    kind: String(b.kind || '').slice(0, 50) || null,
    meta: b.meta && typeof b.meta === 'object' ? b.meta : null,
    createdAt: b.ts ? new Date(b.ts).toISOString() : new Date().toISOString(),
  };
  return out;
}

// Public endpoint used by the frontend to report runtime errors
router.post('/report', limiter, async (req, res) => {
  try {
    const origin = req.headers.origin || '';
    // If frontend is running via Live Server (5500), skip sending emails to avoid noise.
    if (/^http:\/\/(localhost|127\.0\.0\.1):5500$/i.test(origin)) {
      return res.json({ ok: true, devSkipped: true });
    }

    const record = sanitizeClientError(req.body);
    const saved = await alerts.recordError(record);

    // Only alert for error-level or higher
    const sev = String(record.severity || 'error').toLowerCase();
    const shouldAlert = ['error', 'fatal', 'critical'].includes(sev);

    if (shouldAlert) {
      // Fire-and-forget; the client doesn’t need to wait
      alerts.sendErrorAlert({
        title: `EZSports Client Error${record.path ? `: ${record.path}` : ''}`,
        errorRecord: saved
      }).catch(() => {});
    }

    res.json({ ok: true, id: saved?.id, alerted: shouldAlert });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

module.exports = router;
