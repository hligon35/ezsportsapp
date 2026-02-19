const DatabaseManager = require('../database/DatabaseManager');

class EmailService {
  constructor(){
    this.db = new DatabaseManager();
    // Email delivery: SendGrid (primary) with Cloudflare Worker (MailChannels) fallback.
    // Order of precedence: SENDGRID_FROM/MAIL_FROM -> sensible default
    this.from = process.env.MAIL_FROM || 'no-reply@ezsports.app';
    this.fromName = process.env.MAIL_FROM_NAME || 'EZ Sports Netting';

    // Primary: SendGrid
    this.sgApiKey = String(process.env.SENDGRID_API_KEY || '').trim();
    this.sgFrom = String(process.env.SENDGRID_FROM || '').trim();
    this.sgFromName = String(process.env.SENDGRID_FROM_NAME || '').trim();

    // Backup: Cloudflare Worker -> MailChannels
    this.cfUrl = process.env.CF_EMAIL_WEBHOOK_URL || '';
    this.cfApiKey = process.env.CF_EMAIL_API_KEY || '';
    this.cfAccessId = process.env.CF_ACCESS_CLIENT_ID || '';
    this.cfAccessSecret = process.env.CF_ACCESS_CLIENT_SECRET || '';

    this.debug = String(process.env.EMAIL_DEBUG || '').toLowerCase() === 'true';
    this.maxRetries = Number(process.env.EMAIL_MAX_RETRIES || 6);
    this.httpTimeoutMs = Number(process.env.EMAIL_HTTP_TIMEOUT_MS || 2500);

    // Testing support: redirect all outbound mail to a single inbox.
    // Opt-in only; does nothing unless set.
    this.overrideTo = String(process.env.EMAIL_OVERRIDE_TO || process.env.EMAIL_TEST_OVERRIDE_TO || '').trim();
  }

  hasTransport() {
    return !!(this.sgApiKey || this.cfUrl);
  }

  getFetch() {
    let doFetch = (typeof fetch === 'function') ? fetch : null;
    if (!doFetch) {
      try { doFetch = require('undici').fetch; } catch { /* no-op */ }
    }
    if (!doFetch) throw new Error('fetch is not available in this Node runtime');
    return doFetch;
  }

  calcBackoffSec(nextRetryCount) {
    const rc = Number(nextRetryCount || 0);
    // 10s, 20s, 40s... capped at 30m
    const exp = Math.min(Number.isFinite(this.maxRetries) ? this.maxRetries : 6, rc);
    const backoff = Math.pow(2, exp) * 5;
    return Math.min(1800, Math.max(5, backoff));
  }

  classifyFailureStatus(status) {
    const s = Number(status);
    if (!Number.isFinite(s)) return { permanent: false };
    if (s === 429) return { permanent: false };
    if (s >= 400 && s < 500) return { permanent: true };
    return { permanent: false };
  }

  async sendViaSendGrid({ to, subject, html, text, from, fromName, replyTo }) {
    if (!this.sgApiKey) {
      return { ok: false, status: 0, body: 'SendGrid not configured' };
    }

    const chosenFrom = this.sgFrom || from;
    const chosenFromName = this.sgFromName || fromName;
    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: chosenFrom, ...(chosenFromName ? { name: chosenFromName } : {}) },
      subject,
      content: [
        { type: 'text/plain', value: text || '' },
        { type: 'text/html', value: html || '' }
      ]
    };
    if (replyTo) payload.reply_to = { email: replyTo };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.sgApiKey}`
    };

    const doFetch = this.getFetch();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const resp = await doFetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await resp.text().catch(() => '');
      // SendGrid usually returns 202 Accepted on success.
      return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, body };
    } finally {
      clearTimeout(t);
    }
  }

  async sendViaCloudflareWorker({ to, subject, html, text, from, fromName, replyTo }) {
    if (!this.cfUrl) {
      return { ok: false, status: 0, body: 'Cloudflare Worker not configured' };
    }

    const payload = { to, subject, html, text, from, fromName, ...(replyTo ? { replyTo } : {}) };
    const headers = { 'Content-Type': 'application/json' };
    if (this.cfApiKey) headers.Authorization = `Bearer ${this.cfApiKey}`;
    if (this.cfAccessId && this.cfAccessSecret) {
      headers['CF-Access-Client-Id'] = this.cfAccessId;
      headers['CF-Access-Client-Secret'] = this.cfAccessSecret;
    }

    const doFetch = this.getFetch();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const resp = await doFetch(this.cfUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, body };
    } finally {
      clearTimeout(t);
    }
  }

  async queue({ to, subject, html, text, tags=[], replyTo = undefined, from = undefined, fromName = undefined }){
    // Always write to outbox for auditability
    const record = {
      to,
      subject,
      html,
      text,
      tags,
      replyTo,
      from: from || this.from,
      fromName: fromName || this.fromName,
      status: this.hasTransport() ? 'sending' : 'queued',
      createdAt: new Date().toISOString(),
      retryCount: 0,
      // Optional next attempt backoff scheduling (used by retry worker)
      nextAttemptAt: new Date(Date.now()).toISOString()
    };
    const email = await this.db.insert('emails', record);
    // Try to deliver immediately; callers can ignore the promise for fire-and-forget
    try {
      return await this.deliverExisting(email);
    } catch (e) {
      // If delivery threw synchronously, keep it queued for the retry worker
      if (this.debug) console.warn('[EmailService] initial deliver failed; left queued', e?.message||e);
      return email;
    }
  }

  // Deliver an existing record (used by queue and retry worker)
  async deliverExisting(email){
    const { id, to, subject, html, text, tags = [], replyTo, from, fromName } = email || {};
    if (!to || !subject) throw new Error('Email record incomplete');
    const currentRetryCount = Number(email?.retryCount || 0);
    const chosenFrom = from || this.from;
    const chosenFromName = fromName || this.fromName;

    const originalTo = String(to || '').trim();
    const effectiveTo = this.overrideTo || originalTo;
    const isOverridden = !!(this.overrideTo && originalTo && this.overrideTo !== originalTo);
    const prefix = isOverridden ? `[TEST to:${originalTo}] ` : '';
    const subjectOut = `${prefix}${subject}`;
    const bannerHtml = isOverridden
      ? `<div style="padding:10px 12px;border:1px solid #d3d0d7;border-radius:10px;margin:0 0 12px;background:#ffffff;color:#000;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:16px;"><strong>TEST OVERRIDE</strong> — original recipient: <span style="font-family:ui-monospace,Menlo,Consolas,monospace;">${originalTo.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span></div>`
      : '';
    const htmlOut = (html && isOverridden) ? `${bannerHtml}${html}` : html;
    const textOut = (text && isOverridden)
      ? `TEST OVERRIDE — original recipient: ${originalTo}\n\n${text}`
      : text;

    try {
      if (!this.hasTransport()) {
        try { await this.db.update('emails', { id }, { status: 'queued' }); } catch {}
        return { ...email, status: 'queued' };
      }

      const common = {
        to: effectiveTo,
        subject: subjectOut,
        html: htmlOut,
        text: textOut,
        from: chosenFrom,
        fromName: chosenFromName,
        replyTo
      };

      let primaryErr = '';
      let sgRes = null;

      // Primary: SendGrid
      if (this.sgApiKey) {
        if (this.debug) console.log('[EmailService] send via sendgrid', { to: String(to).slice(-12), subject: subject.slice(0, 48) });
        sgRes = await this.sendViaSendGrid(common);
        if (sgRes.ok) {
          await this.db.update('emails', { id }, {
            status: 'sent',
            provider: 'sendgrid',
            sentAt: new Date().toISOString(),
            deliveredTo: effectiveTo,
            nextAttemptAt: null,
            lastError: null
          });
          return { ...email, status: 'sent', provider: 'sendgrid', deliveredTo: effectiveTo, nextAttemptAt: null };
        }
        primaryErr = `SendGrid failed ${sgRes.status}: ${String(sgRes.body || '').slice(0, 500)}`;
      }

      // Backup: Cloudflare Worker
      if (this.cfUrl) {
        if (this.debug) {
          console.log('[EmailService] send via cloudflare worker', {
            url: this.cfUrl,
            hasAuth: !!this.cfApiKey,
            hasAccess: !!(this.cfAccessId && this.cfAccessSecret),
            to: String(to).slice(-12),
            subject: subject.slice(0, 48)
          });
        }
        const r = await this.sendViaCloudflareWorker(common);
        if (r.ok) {
          await this.db.update('emails', { id }, {
            status: 'sent',
            provider: 'cloudflare-worker',
            sentAt: new Date().toISOString(),
            deliveredTo: effectiveTo,
            nextAttemptAt: null,
            // Keep lastError for visibility if primary failed
            lastError: primaryErr || null
          });
          return { ...email, status: 'sent', provider: 'cloudflare-worker', deliveredTo: effectiveTo, nextAttemptAt: null };
        }
        const backupErr = `Cloudflare email failed ${r.status}: ${String(r.body || '').slice(0, 500)}`;
        const combined = [primaryErr, backupErr].filter(Boolean).join(' | ');

        const nextRetryCount = currentRetryCount + 1;
        const primaryClass = sgRes ? this.classifyFailureStatus(sgRes.status) : { permanent: false };
        const backupClass = this.classifyFailureStatus(r.status);
        // Mark as permanent only when Cloudflare failed permanently and
        // SendGrid is either not configured or also looks permanent.
        const permanent = backupClass.permanent && (!this.sgApiKey || primaryClass.permanent);

        if (permanent) {
          await this.db.update('emails', { id }, {
            status: 'permanent-failure',
            provider: this.sgApiKey ? 'sendgrid+cloudflare' : 'cloudflare-worker',
            error: combined || backupErr,
            failedAt: new Date().toISOString(),
            deliveredTo: effectiveTo,
            retryCount: nextRetryCount,
            nextAttemptAt: null,
            lastError: combined || backupErr
          });
          return { ...email, status: 'permanent-failure', provider: this.sgApiKey ? 'sendgrid+cloudflare' : 'cloudflare-worker', error: combined || backupErr, deliveredTo: effectiveTo, retryCount: nextRetryCount, nextAttemptAt: null };
        }

        const backoffSec = this.calcBackoffSec(nextRetryCount);
        const nextAttemptAt = new Date(Date.now() + backoffSec * 1000).toISOString();
        await this.db.update('emails', { id }, {
          status: 'failed',
          provider: this.sgApiKey ? 'sendgrid+cloudflare' : 'cloudflare-worker',
          error: combined || backupErr,
          failedAt: new Date().toISOString(),
          deliveredTo: effectiveTo,
          retryCount: nextRetryCount,
          nextAttemptAt,
          lastError: combined || backupErr
        });
        return { ...email, status: 'failed', provider: this.sgApiKey ? 'sendgrid+cloudflare' : 'cloudflare-worker', error: combined || backupErr, deliveredTo: effectiveTo, retryCount: nextRetryCount, nextAttemptAt };
      }

      // No Cloudflare fallback configured; SendGrid-only path failed
      const msg = primaryErr || 'SendGrid failed (unknown)';
      const nextRetryCount = currentRetryCount + 1;
      const sgClass = sgRes ? this.classifyFailureStatus(sgRes.status) : { permanent: false };

      if (sgClass.permanent) {
        await this.db.update('emails', { id }, {
          status: 'permanent-failure',
          provider: 'sendgrid',
          error: msg,
          failedAt: new Date().toISOString(),
          deliveredTo: effectiveTo,
          retryCount: nextRetryCount,
          nextAttemptAt: null,
          lastError: msg
        });
        return { ...email, status: 'permanent-failure', provider: 'sendgrid', error: msg, deliveredTo: effectiveTo, retryCount: nextRetryCount, nextAttemptAt: null };
      }

      const backoffSec = this.calcBackoffSec(nextRetryCount);
      const nextAttemptAt = new Date(Date.now() + backoffSec * 1000).toISOString();
      await this.db.update('emails', { id }, {
        status: 'failed',
        provider: 'sendgrid',
        error: msg,
        failedAt: new Date().toISOString(),
        deliveredTo: effectiveTo,
        retryCount: nextRetryCount,
        nextAttemptAt,
        lastError: msg
      });
      return { ...email, status: 'failed', provider: 'sendgrid', error: msg, deliveredTo: effectiveTo, retryCount: nextRetryCount, nextAttemptAt };
    } catch (e) {
      const msg = e?.message || String(e);
      try {
        const nextRetryCount = currentRetryCount + 1;
        const backoffSec = this.calcBackoffSec(nextRetryCount);
        const nextAttemptAt = new Date(Date.now() + backoffSec * 1000).toISOString();
        await this.db.update('emails', { id }, {
          status: 'failed',
          provider: this.sgApiKey ? 'sendgrid+cloudflare' : (this.cfUrl ? 'cloudflare-worker' : 'sendgrid'),
          error: msg,
          failedAt: new Date().toISOString(),
          deliveredTo: effectiveTo,
          retryCount: nextRetryCount,
          nextAttemptAt,
          lastError: msg
        });
      } catch {}
      if (this.debug) console.warn('Email send failed:', msg);
      return {
        ...email,
        status: 'failed',
        provider: this.sgApiKey ? 'sendgrid+cloudflare' : (this.cfUrl ? 'cloudflare-worker' : 'sendgrid'),
        error: msg,
        deliveredTo: effectiveTo,
        retryCount: currentRetryCount + 1,
        nextAttemptAt: new Date(Date.now() + this.calcBackoffSec(currentRetryCount + 1) * 1000).toISOString()
      };
    }
  }

  // Deliver by record ID (used by retry worker)
  async deliver(id){
    const list = await this.db.find('emails', {});
    const email = list.find(e => e.id === id);
    if (!email) throw new Error('Email not found');
    return await this.deliverExisting(email);
  }

  async list(){ return await this.db.findAll('emails'); }
}

module.exports = EmailService;
