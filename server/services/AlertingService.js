const crypto = require('crypto');
const DatabaseManager = require('../database/DatabaseManager');
const EmailService = require('./EmailService');

function safeStr(v, max = 4000) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.length > max ? (s.slice(0, max) + '…') : s;
}

function hashForDedupe(parts) {
  try {
    const h = crypto.createHash('sha256');
    parts.forEach(p => h.update(String(p || '')));
    return h.digest('hex');
  } catch {
    return String(Date.now());
  }
}

class AlertingService {
  constructor() {
    this.db = new DatabaseManager();
    this.email = new EmailService();

    this.alertTo = (process.env.ALERT_EMAIL_TO || 'hligon@getsparqd.com').trim();
    this.reportTo = (process.env.REPORT_EMAIL_TO || 'info@getsparqd.com').trim();
    this.alertFrom = (process.env.ALERT_EMAIL_FROM || process.env.MAIL_FROM || '').trim() || undefined;
    this.alertEnabled = String(process.env.ALERT_EMAIL_ENABLED || 'true').toLowerCase() === 'true';

    // Dedupe window (minutes) for “same error” alerts
    this.dedupeMinutes = Number(process.env.ALERT_DEDUPE_MINUTES || 10);
    this._recent = new Map(); // hash -> lastSentMs
  }

  _shouldSend(hash) {
    const now = Date.now();
    const last = this._recent.get(hash) || 0;
    const windowMs = Math.max(1, this.dedupeMinutes) * 60 * 1000;
    if (now - last < windowMs) return false;
    this._recent.set(hash, now);
    return true;
  }

  async recordError(errorRecord) {
    try {
      return await this.db.insert('errors', {
        ...errorRecord,
        createdAt: errorRecord.createdAt || new Date().toISOString(),
      });
    } catch (e) {
      // If DB is misconfigured, still return a minimal object
      return { id: null, ...errorRecord, dbError: e?.message || String(e) };
    }
  }

  async sendErrorAlert({ title, errorRecord }) {
    if (!this.alertEnabled || !this.alertTo) return { ok: false, skipped: true };

    const fingerprint = hashForDedupe([
      errorRecord?.source,
      errorRecord?.message,
      errorRecord?.name,
      errorRecord?.stack,
      errorRecord?.path,
      errorRecord?.url
    ]);

    if (!this._shouldSend(fingerprint)) {
      return { ok: true, deduped: true, fingerprint };
    }

    const when = safeStr(errorRecord?.createdAt || new Date().toISOString(), 64);
    const src = safeStr(errorRecord?.source || 'unknown', 32);
    const msg = safeStr(errorRecord?.message || '', 1200);
    const stack = safeStr(errorRecord?.stack || '', 8000);
    const url = safeStr(errorRecord?.url || errorRecord?.path || '', 2000);

    const html = `
      <h2>EZ Sports App Error Alert</h2>
      <p><strong>When:</strong> ${when}</p>
      <p><strong>Source:</strong> ${src}</p>
      <p><strong>URL/Path:</strong> ${url || '(unknown)'}</p>
      <p><strong>Message:</strong> ${msg || '(none)'}</p>
      <pre style="white-space:pre-wrap;word-break:break-word">${stack || ''}</pre>
      <p><small>Fingerprint: ${fingerprint}</small></p>
    `;

    const subject = safeStr(title || `EZSports Error (${src})`, 160);
    const out = await this.email.queue({
      to: this.alertTo,
      subject,
      html,
      text: `EZ Sports App Error Alert\nWhen: ${when}\nSource: ${src}\nURL/Path: ${url}\nMessage: ${msg}\n\n${stack}\n\nFingerprint: ${fingerprint}`,
      tags: ['alert', 'error', src],
      from: this.alertFrom
    });

    return { ok: true, fingerprint, email: out };
  }

  async sendDailyReport({ subject, html, text }) {
    // Reports go to the reporting inbox (not the error-alert inbox)
    if (!this.alertEnabled || !this.reportTo) return { ok: false, skipped: true };
    const out = await this.email.queue({
      to: this.reportTo,
      subject: safeStr(subject || 'EZSports Daily Activity Report', 160),
      html: html || '<p>(no report)</p>',
      text: text || 'no report',
      tags: ['report', 'daily'],
      from: this.alertFrom
    });
    return { ok: true, email: out };
  }

  async sendReport({ subject, html, text, tags = ['report'] }) {
    if (!this.alertEnabled || !this.reportTo) return { ok: false, skipped: true };
    const out = await this.email.queue({
      to: this.reportTo,
      subject: safeStr(subject || 'EZ Sports Report', 160),
      html: html || '<p>(no report)</p>',
      text: text || 'no report',
      tags,
      from: this.alertFrom
    });
    return { ok: true, email: out };
  }
}

module.exports = AlertingService;
