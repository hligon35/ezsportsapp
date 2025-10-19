const DatabaseManager = require('../database/DatabaseManager');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* optional dependency installed at runtime */ }

class EmailService {
  constructor(){
    this.db = new DatabaseManager();
    this.transporter = null;
    this.from = process.env.SMTP_FROM || process.env.MAIL_FROM || 'no-reply@ezsports.app';
    this.cfUrl = process.env.CF_EMAIL_WEBHOOK_URL || '';
    this.cfApiKey = process.env.CF_EMAIL_API_KEY || '';
    // Configure SMTP transport if environment variables are present
    const hasSendgrid = !!process.env.SENDGRID_API_KEY;
    const hasSmtp = !!process.env.SMTP_HOST;
    if (nodemailer && (hasSendgrid || hasSmtp)) {
      try {
        if (hasSendgrid) {
          this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
            port: Number(process.env.SMTP_PORT || 587),
            secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
            auth: { user: process.env.SMTP_USER || 'apikey', pass: process.env.SENDGRID_API_KEY }
          });
        } else if (hasSmtp) {
          this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || String(process.env.SMTP_PORT) === '465',
            auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
          });
        }
      } catch (e) {
        console.warn('EmailService: Failed to initialize SMTP transport:', e.message);
        this.transporter = null;
      }
    }
  }

  async queue({ to, subject, html, text, tags=[], replyTo = undefined, from = undefined, fromName = undefined }){
    // Always write to outbox for auditability
    const record = { to, subject, html, text, tags, replyTo, from: from || this.from, fromName, status: this.transporter ? 'sending' : 'queued', createdAt: new Date().toISOString() };
    const email = await this.db.insert('emails', record);
    // Prefer Cloudflare Worker HTTP if configured
    if (this.cfUrl) {
      try {
        const payload = { to, subject, html, text, from: from || this.from };
        if (replyTo) payload.replyTo = replyTo;
        if (fromName) payload.fromName = fromName;
        const headers = { 'Content-Type': 'application/json' };
        if (this.cfApiKey) headers['Authorization'] = `Bearer ${this.cfApiKey}`;
        let doFetch = (typeof fetch === 'function') ? fetch : null;
        if (!doFetch) {
          try { doFetch = require('undici').fetch; } catch { /* no-op */ }
        }
        if (!doFetch) throw new Error('fetch is not available in this Node runtime');
        // Bound Cloudflare worker call with a short timeout to avoid hanging
        const controller = new AbortController();
        const t = setTimeout(()=>controller.abort(), Number(process.env.EMAIL_HTTP_TIMEOUT_MS||2500));
        let resp;
        try {
          resp = await doFetch(this.cfUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
        } finally { clearTimeout(t); }
        if (resp.ok) {
          await this.db.update('emails', { id: email.id }, { status: 'sent', provider: 'cloudflare-worker', sentAt: new Date().toISOString() });
          return { ...email, status: 'sent', provider: 'cloudflare-worker' };
        } else {
          const body = await resp.text().catch(()=> '');
          const cfError = new Error(`Cloudflare email failed ${resp.status}: ${body}`);
          // Attempt SMTP fallback if transporter is configured
          if (this.transporter) {
            try {
              const info = await this.transporter.sendMail({ from: from || this.from, to, subject, text, html, replyTo });
              await this.db.update('emails', { id: email.id }, { status: 'sent', provider: 'smtp', providerId: info?.messageId || null, sentAt: new Date().toISOString(), error: cfError.message });
              return { ...email, status: 'sent', provider: 'smtp', providerId: info?.messageId || null };
            } catch (smtpErr) {
              await this.db.update('emails', { id: email.id }, { status: 'failed', provider: 'cloudflare-worker|smtp', error: `${cfError.message} | SMTP: ${smtpErr.message}`, failedAt: new Date().toISOString() });
              return { ...email, status: 'failed', provider: 'cloudflare-worker|smtp', error: `${cfError.message} | SMTP: ${smtpErr.message}` };
            }
          }
          // No transporter available, record CF failure
          throw cfError;
        }
      } catch (e) {
        // If we are here, Cloudflare path threw synchronously before we could fallback
        // Try SMTP if available
        if (this.transporter) {
          try {
            const info = await this.transporter.sendMail({ from: from || this.from, to, subject, text, html, replyTo });
            await this.db.update('emails', { id: email.id }, { status: 'sent', provider: 'smtp', providerId: info?.messageId || null, sentAt: new Date().toISOString(), error: e.message });
            return { ...email, status: 'sent', provider: 'smtp', providerId: info?.messageId || null };
          } catch (smtpErr) {
            await this.db.update('emails', { id: email.id }, { status: 'failed', provider: 'cloudflare-worker|smtp', error: `${e.message} | SMTP: ${smtpErr.message}`, failedAt: new Date().toISOString() });
            console.warn('Email send via Cloudflare then SMTP failed:', `${e.message} | SMTP: ${smtpErr.message}`);
            return { ...email, status: 'failed', provider: 'cloudflare-worker|smtp', error: `${e.message} | SMTP: ${smtpErr.message}` };
          }
        }
        await this.db.update('emails', { id: email.id }, { status: 'failed', provider: 'cloudflare-worker', error: e.message, failedAt: new Date().toISOString() });
        console.warn('Email send via Cloudflare failed:', e.message);
        return { ...email, status: 'failed', provider: 'cloudflare-worker', error: e.message };
      }
    }
    if (!this.transporter) return email;

    try {
      const info = await this.transporter.sendMail({ from: from || this.from, to, subject, text, html, replyTo });
      await this.db.update('emails', { id: email.id }, { status: 'sent', providerId: info?.messageId || null, sentAt: new Date().toISOString() });
      return { ...email, status: 'sent', providerId: info?.messageId || null };
    } catch (e) {
      await this.db.update('emails', { id: email.id }, { status: 'failed', error: e.message, failedAt: new Date().toISOString() });
      console.warn('Email send failed:', e.message);
      return { ...email, status: 'failed', error: e.message };
    }
  }

  async list(){ return await this.db.findAll('emails'); }
}

module.exports = EmailService;
