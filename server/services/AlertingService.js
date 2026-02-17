const crypto = require('crypto');
const DatabaseManager = require('../database/DatabaseManager');
const EmailService = require('./EmailService');
const { escapeHtml, renderBrandedEmailHtml } = require('./EmailTheme');

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

    const safeWhen = escapeHtml(when);
    const safeSrc = escapeHtml(src);
    const safeUrl = escapeHtml(url || '(unknown)');
    const safeMsg = escapeHtml(msg || '(none)');
    const safeStack = escapeHtml(stack || '');
    const safeFingerprint = escapeHtml(fingerprint);

    const subject = safeStr(title || `EZSports Error (${src})`, 160);

    const bodyHtml = `
      <p style="margin:0 0 12px;color:#5a5a5a;line-height:20px;">An application error was captured.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #d3d0d7;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">When</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeWhen}</td></tr>
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Source</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeSrc}</td></tr>
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;">URL/Path</td><td style="padding:10px 12px;">${safeUrl}</td></tr>
      </table>

      <div style="margin:16px 0 8px;font-weight:800;color:#241773;">Message</div>
      <div style="border:1px solid #d3d0d7;border-radius:10px;padding:10px 12px;color:#000000;line-height:20px;">${safeMsg}</div>

      <div style="margin:16px 0 8px;font-weight:800;color:#241773;">Stack</div>
      <pre style="margin:0;padding:12px 12px;border:1px solid #d3d0d7;border-radius:10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:12px;line-height:1.45;color:#000000;">${safeStack}</pre>

      <div style="margin-top:12px;color:#5a5a5a;font-size:11px;line-height:15px;">Fingerprint: ${safeFingerprint}</div>
    `;

    const html = renderBrandedEmailHtml({
      title: 'EZ Sports App Error Alert',
      subtitle: escapeHtml(subject),
      bodyHtml,
      maxWidth: 680
    });
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
