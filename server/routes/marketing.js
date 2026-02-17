const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const SubscriberService = require('../services/SubscriberService');
const CouponService = require('../services/CouponService');
const EmailService = require('../services/EmailService');
const { escapeHtml, renderBrandedEmailHtml } = require('../services/EmailTheme');
const { requireAdmin } = require('../middleware/auth');

const subs = new SubscriberService();
const coupons = new CouponService();
const mail = new EmailService();

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

    // Queue emails in the background (do not await)
    try {
      const inbox = (process.env.CONTACT_INBOX || 'info@ezsportsnetting.com').trim();
      const safeAddr = escapeHtml(addr);
      const safeName = name ? escapeHtml(name) : '';
      const safeSource = source ? escapeHtml(source) : '';
      const safeReferer = referer ? escapeHtml(referer) : '';

      if (inbox) {
        const internalBody = `
          <p style="margin:0 0 10px;">A new visitor subscribed to the newsletter.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #d3d0d7;border-radius:10px;overflow:hidden;">
            <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Email</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeAddr}</td></tr>
            ${safeName ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Name</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeName}</td></tr>` : ''}
            ${safeSource ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Source</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeSource}</td></tr>` : ''}
            ${safeReferer ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;">Referrer</td><td style="padding:10px 12px;">${safeReferer}</td></tr>` : ''}
          </table>
        `;
        const html = renderBrandedEmailHtml({
          title: 'New subscriber',
          subtitle: 'Newsletter subscription',
          bodyHtml: internalBody
        });

        // Fire-and-forget; log errors but don't delay response
        void mail.queue({ to: inbox, subject: 'New subscriber', html, text: `Email: ${addr}\nName: ${name||''}\nSource: ${source||''}\nReferrer: ${referer||''}`, tags: ['subscribe','internal'], replyTo: addr }).catch(err=>console.warn('Subscribe internal email failed:', err?.message||err));
      }

      const welcomeBody = `
        <p style="margin:0 0 10px;">Thanks for subscribing to EZ Sports Netting!</p>
        <p style="margin:0;color:#5a5a5a;line-height:20px;">We’ll send occasional deals and product updates. You can unsubscribe anytime.</p>
      `;
      const welcomeHtml = renderBrandedEmailHtml({
        title: 'Thanks for subscribing',
        subtitle: 'EZ Sports Netting Newsletter',
        bodyHtml: welcomeBody
      });

      void mail.queue({ to: addr, subject: 'Thanks for subscribing to EZ Sports Netting', html: welcomeHtml, text: 'Thanks for subscribing to EZ Sports Netting! We’ll send occasional deals and product updates.', tags: ['subscribe','welcome'], replyTo: inbox }).catch(err=>console.warn('Subscribe welcome email failed:', err?.message||err));
    } catch {}

    // Optional Apps Script forward (non-blocking)
    try {
      const url = (process.env.MARKETING_APPS_SCRIPT_URL || '').trim();
      if (url) {
        const payload = { type: 'subscribe', email: addr, name, source: source || '', referer: referer || '' };
        const body = JSON.stringify(payload);
        const doFetch = (typeof fetch === 'function') ? fetch : null;
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

    // Respond immediately to keep the UI snappy
    res.json({ ok: true, queued: true });

    // Continue work in background: verify Turnstile (if enabled) and send emails.
    setImmediate(async () => {
      try {
        // Optional Cloudflare Turnstile verification (enable by setting CF_TURNSTILE_SECRET)
        let captchaOk = true;
        try {
          const tsSecret = (process.env.CF_TURNSTILE_SECRET || '').trim();
          if (tsSecret && !bypassTurnstile) {
            const doFetch = (typeof fetch === 'function') ? fetch : (require('undici').fetch);
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

        // Always send an acknowledgement to the sender (does not depend on captcha)
        try {
          const ackBody = `
            <p style="margin:0 0 10px;">Hi ${safeName},</p>
            <p style="margin:0 0 12px;color:#5a5a5a;line-height:20px;">Thanks for contacting EZ Sports Netting! We received your message and will get back to you soon.</p>
            <div style="margin:16px 0 8px;font-weight:800;color:#241773;">Your message</div>
            <pre style="margin:0;padding:12px 12px;border:1px solid #d3d0d7;border-radius:10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:12px;line-height:1.45;color:#000000;">${safeMessage}</pre>
          `;
          const ackHtml = renderBrandedEmailHtml({
            title: 'We received your message',
            subtitle: 'EZ Sports Netting Support',
            bodyHtml: ackBody
          });
          void mail.queue({
            to: email,
            subject: 'We received your message',
            html: ackHtml,
            text: `Hi ${name},\n\nThanks for contacting EZ Sports Netting! We received your message and will get back to you soon.\n\n---\nYour message:\n${message}`,
            tags: ['contact','ack'],
            replyTo: inbox
          }).catch(()=>{});
        } catch { /* ignore ack failure */ }

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
