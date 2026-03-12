const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const SubscriberService = require('../services/SubscriberService');
const CouponService = require('../services/CouponService');
const EmailService = require('../services/EmailService');
const AnalyticsService = require('../services/AnalyticsService');
const WorkflowAutomationService = require('../services/WorkflowAutomationService');
const { escapeHtml, renderBrandedEmailHtml } = require('../services/EmailTheme');
const { requireAdmin } = require('../middleware/auth');
const { getFetch } = require('../utils/getFetch');

const subs = new SubscriberService();
const coupons = new CouponService();
const mail = new EmailService();
const analytics = new AnalyticsService();
const automation = new WorkflowAutomationService();

// Public subscribe endpoint
router.post('/subscribe', async (req, res) => {
  try {
    const { email, name, source, referer, hp } = req.body || {};
    // Basic anti-spam: honeypot should be empty
    if (hp) return res.json({ ok: true, queued: false, spam: true });
    const addr = (email || '').toString().trim();
    if (!addr) return res.status(400).json({ message: 'Email is required' });

    // Save subscriber
    const s = await subs.addOrUpdate(addr, name);

    await analytics.trackCanonicalEvent({
      eventName: 'email_capture',
      source: 'server_marketing',
      path: source || '/subscribe',
      referrer: referer || req.headers.referer || '',
      email: addr,
      visitorId: req.body?.visitorId || null,
      sessionId: req.body?.sessionId || null,
      lead: {
        submissionType: 'subscribe_form',
        formId: 'subscribe',
        topic: 'newsletter'
      },
      meta: {
        captureType: 'subscribe_form',
        name: name || null
      }
    }).catch(() => null);

    setImmediate(() => {
      void automation.processPending({ limit: 10 }).catch(err => {
        console.warn('Subscribe workflow processing failed:', err?.message || err);
      });
    });

    // Optional Apps Script forward (non-blocking)
    try {
      const url = (process.env.MARKETING_APPS_SCRIPT_URL || '').trim();
      if (url) {
        const payload = { type: 'subscribe', email: addr, name, source: source || '', referer: referer || '' };
        const body = JSON.stringify(payload);
        const doFetch = (typeof globalThis.fetch === 'function') ? getFetch() : null;
        if (doFetch) { void doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(()=>{}); }
      }
    } catch {}

    // Respond immediately
    res.json({ ok:true, subscriber: s });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Public: contact form intake -> queues an email to the internal inbox
router.post('/contact', async (req, res) => {
  try {
    const body = req.body || {};
    const name = (body.name || '').toString().trim() || 'Website Visitor';
    const email = (body.email || '').toString().trim();
    const phone = (body.phone || '').toString().trim();
    const message = (body.message || '').toString().trim();
    const subject = (body.subject || '').toString().trim() || 'New Contact Form Submission';
    const turnstile = body['cf-turnstile-response'] || body.cfTurnstileToken || '';
    const honeypot = body.hp || body._honeypot || '';
    const bypassTurnstile = ((process.env.TURNSTILE_BYPASS || process.env.CF_TURNSTILE_BYPASS || '').toLowerCase() === 'true');

    // Basic anti-spam: honeypot should be empty
    if (honeypot) return res.json({ ok: true, queued: false, spam: true });

    if (!email || !message) return res.status(400).json({ ok: false, error: 'Missing email or message' });

    await analytics.trackCanonicalEvent({
      eventName: 'quote_submit',
      source: 'server_marketing',
      path: body.source || req.path,
      referrer: body.referer || req.headers.referer || '',
      email,
      visitorId: body.visitorId || null,
      sessionId: body.sessionId || null,
      lead: {
        submissionType: body.topic === 'training-facility-design' ? 'facility_configurator' : 'contact_form',
        quoteType: body.topic === 'training-facility-design' ? 'training_facility' : 'contact',
        topic: body.topic || subject,
        formId: body.topic === 'training-facility-design' ? 'facility-quote-form' : 'contact-form',
        estimatedValue: Number(body?.facility?.estimate?.price?.high || body?.facility?.estimate?.price?.low || 0) || 0
      },
      meta: {
        phone: phone || null,
        messageLength: message.length,
        facility: body.facility || null
      }
    }).catch(() => null);

    // Respond immediately to keep the UI snappy
    res.json({ ok: true, queued: true });

    // Continue work in background: verify Turnstile (if enabled) and send emails.
    setImmediate(async () => {
      try {
        void automation.processPending({ limit: 10 }).catch(err => {
          console.warn('Quote workflow processing failed:', err?.message || err);
        });

        // Optional Cloudflare Turnstile verification (enable by setting CF_TURNSTILE_SECRET)
        let captchaOk = true;
        try {
          const tsSecret = (process.env.CF_TURNSTILE_SECRET || '').trim();
          if (tsSecret && !bypassTurnstile) {
            const doFetch = getFetch();
            const resp = await doFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ secret: tsSecret, response: turnstile || '' }).toString()
            }).catch(() => null);
            const data = resp ? await resp.json().catch(()=>({})) : {};
            captchaOk = !!(data && data.success === true);
          }
        } catch { /* ignore */ }

        const safeName = escapeHtml(name);
        const safeEmail = escapeHtml(email);
        const safePhone = phone ? escapeHtml(phone) : '';
        const safeSubject = escapeHtml(subject);
        const safeMessage = escapeHtml(message);

        const internalBody = `
          <p style="margin:0 0 12px;color:#5a5a5a;">A contact form submission was received from the website.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #d3d0d7;border-radius:10px;overflow:hidden;">
            <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Name</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeName}</td></tr>
            <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Email</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeEmail}</td></tr>
            ${safePhone ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Phone</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safePhone}</td></tr>` : ''}
            <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;">Subject</td><td style="padding:10px 12px;">${safeSubject}</td></tr>
          </table>

          <div style="margin:16px 0 8px;font-weight:800;color:#241773;">Message</div>
          <pre style="margin:0;padding:12px 12px;border:1px solid #d3d0d7;border-radius:10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:12px;line-height:1.45;color:#000000;">${safeMessage}</pre>
        `;

        const html = renderBrandedEmailHtml({
          title: `[Contact] ${subject}`,
          subtitle: 'Contact form submission',
          bodyHtml: internalBody,
          maxWidth: 680
        });

        const inbox = (process.env.CONTACT_INBOX || 'info@ezsportsnetting.com').trim();

        // Send internal notification only if captcha passes or bypass is enabled
        if (captchaOk || bypassTurnstile) {
          try {
            void mail.queue({
              to: inbox,
              subject: `[Contact] ${subject}`,
              html,
              text: `From: ${name} <${email}>\n${phone ? `Phone: ${phone}\n` : ''}\nSubject: ${subject}\n\n${message}`,
              tags: ['contact'],
              replyTo: email
            }).catch(e=>console.warn('Contact email queue failed:', e?.message||e));
          } catch { /* ignore internal failure */ }
        }
      } catch (e) {
        // Do not throw; background errors are logged only
        if (process.env.EMAIL_DEBUG === 'true') console.warn('Background contact handler error:', e?.message||e);
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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
    const body = req.body || {};
    // Normalize restriction fields: allow single string or array for userEmails/userIds
    const norm = { ...body };
    if (typeof norm.userEmails === 'string') norm.userEmails = norm.userEmails.split(',').map(s=>s.trim()).filter(Boolean);
    if (!Array.isArray(norm.userEmails)) norm.userEmails = [];
    if (typeof norm.userIds === 'string') norm.userIds = norm.userIds.split(',').map(s=>s.trim()).filter(Boolean);
    if (!Array.isArray(norm.userIds)) norm.userIds = [];
    const c = await coupons.create(norm);
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
const validateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
router.post('/validate-coupon', validateLimiter, async (req, res) => {
  try {
    const { code, email, userId } = req.body || {};
    const id = userId || (req.user && req.user.id) || null;
    const result = await coupons.validate(code, email, new Date(), id);
    // Enhance UX: always include reason when invalid
    if (!result.valid) {
      if (result.reason === 'restricted') {
        console.warn('Coupon restricted mismatch:', { code, email, userId: id });
      }
      return res.json({ valid:false, reason: result.reason || 'invalid' });
    }
    return res.json(result);
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
