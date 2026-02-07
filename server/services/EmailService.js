const DatabaseManager = require('../database/DatabaseManager');

class EmailService {
  constructor(){
    this.db = new DatabaseManager();
    // Mail delivery is handled ONLY via Cloudflare Worker -> MailChannels.
    // Order of precedence: MAIL_FROM -> sensible default
    this.from = process.env.MAIL_FROM || 'no-reply@ezsports.app';
    this.fromName = process.env.MAIL_FROM_NAME || 'EZ Sports Netting';
    this.cfUrl = process.env.CF_EMAIL_WEBHOOK_URL || '';
    this.cfApiKey = process.env.CF_EMAIL_API_KEY || '';
    this.cfAccessId = process.env.CF_ACCESS_CLIENT_ID || '';
    this.cfAccessSecret = process.env.CF_ACCESS_CLIENT_SECRET || '';
    this.debug = String(process.env.EMAIL_DEBUG || '').toLowerCase() === 'true';
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
      status: this.cfUrl ? 'sending' : 'queued',
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
    const chosenFrom = from || this.from;
    const chosenFromName = fromName || this.fromName;

    // Cloudflare Worker (MailChannels) is the only supported delivery path.
    if (!this.cfUrl) {
      // Leave queued until configured.
      try { await this.db.update('emails', { id }, { status: 'queued' }); } catch {}
      return { ...email, status: 'queued' };
    }

    try {
      const payload = { to, subject, html, text, from: chosenFrom };
      if (replyTo) payload.replyTo = replyTo;
      if (chosenFromName) payload.fromName = chosenFromName;
      const headers = { 'Content-Type': 'application/json' };
      if (this.cfApiKey) headers['Authorization'] = `Bearer ${this.cfApiKey}`;
      // Optional Cloudflare Access service token support
      if (this.cfAccessId && this.cfAccessSecret) {
        headers['CF-Access-Client-Id'] = this.cfAccessId;
        headers['CF-Access-Client-Secret'] = this.cfAccessSecret;
      }
      if (this.debug) {
        console.log('[EmailService] POST worker', {
          url: this.cfUrl,
          hasAuth: !!this.cfApiKey,
          hasAccess: !!(this.cfAccessId && this.cfAccessSecret),
          to: String(to).slice(-12),
          subject: subject.slice(0, 48)
        });
      }
      let doFetch = (typeof fetch === 'function') ? fetch : null;
      if (!doFetch) {
        try { doFetch = require('undici').fetch; } catch { /* no-op */ }
      }
      if (!doFetch) throw new Error('fetch is not available in this Node runtime');
      // Bound worker call with a short timeout to avoid hanging
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Number(process.env.EMAIL_HTTP_TIMEOUT_MS || 2500));
      let resp;
      try {
        resp = await doFetch(this.cfUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
      if (resp.ok) {
        await this.db.update('emails', { id }, { status: 'sent', provider: 'cloudflare-worker', sentAt: new Date().toISOString() });
        return { ...email, status: 'sent', provider: 'cloudflare-worker' };
      }
      const body = await resp.text().catch(() => '');
      const msg = `Cloudflare email failed ${resp.status}: ${body}`;
      await this.db.update('emails', { id }, { status: 'failed', provider: 'cloudflare-worker', error: msg, failedAt: new Date().toISOString() });
      if (this.debug) console.warn('[EmailService] Worker response not OK', { status: resp.status, body: body?.slice(0, 200) });
      return { ...email, status: 'failed', provider: 'cloudflare-worker', error: msg };
    } catch (e) {
      const msg = e?.message || String(e);
      try {
        await this.db.update('emails', { id }, { status: 'failed', provider: 'cloudflare-worker', error: msg, failedAt: new Date().toISOString() });
      } catch {}
      if (this.debug) console.warn('Email send via Cloudflare failed:', msg);
      return { ...email, status: 'failed', provider: 'cloudflare-worker', error: msg };
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
