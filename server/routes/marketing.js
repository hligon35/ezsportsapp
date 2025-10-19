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
      if (inbox) {
        const html = `
          <h2>New Newsletter Subscriber</h2>
          <p><strong>Email:</strong> ${addr}</p>
          ${name ? `<p><strong>Name:</strong> ${name}</p>` : ''}
          ${source ? `<p><strong>Source:</strong> ${source}</p>` : ''}
          ${referer ? `<p><strong>Referrer:</strong> ${referer}</p>` : ''}
        `;
        // Fire-and-forget; log errors but don't delay response
        void mail.queue({ to: inbox, subject: 'New subscriber', html, text: `Email: ${addr}\nName: ${name||''}\nSource: ${source||''}\nReferrer: ${referer||''}`, tags: ['subscribe','internal'], replyTo: addr }).catch(err=>console.warn('Subscribe internal email failed:', err?.message||err));
      }
      const welcomeHtml = `
        <p>Thanks for subscribing to EZ Sports Netting!</p>
        <p>We’ll send occasional deals and product updates. You can unsubscribe anytime.</p>
      `;
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

    // Optional Cloudflare Turnstile verification (enable by setting CF_TURNSTILE_SECRET)
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
        if (!data || data.success !== true) {
          return res.status(400).json({ ok:false, error: 'Captcha verification failed' });
        }
      }
    } catch { /* treat as no captcha when network fails */ }

    const html = `
      <h2>Contact Form Submission</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap">${message}</pre>
    `;

    const inbox = (process.env.CONTACT_INBOX || 'info@ezsportsnetting.com').trim();
    // Fire-and-forget the internal notification and the acknowledgement; do not await
    try {
      void mail.queue({
        to: inbox,
        subject: `[Contact] ${subject}`,
        html,
        text: `From: ${name} <${email}>\n${phone ? `Phone: ${phone}\n` : ''}\nSubject: ${subject}\n\n${message}`,
        tags: ['contact'],
        replyTo: email
      }).catch(e=>console.warn('Contact email queue failed:', e?.message||e));

      const ackHtml = `
        <p>Hi ${name.replace(/</g,'&lt;')},</p>
        <p>Thanks for contacting EZ Sports Netting! We received your message and will get back to you soon.</p>
        <hr/>
        <p><strong>Your message:</strong></p>
        <pre style="white-space:pre-wrap">${message.replace(/</g,'&lt;')}</pre>
      `;
      void mail.queue({
        to: email,
        subject: 'We received your message',
        html: ackHtml,
        text: `Hi ${name},\n\nThanks for contacting EZ Sports Netting! We received your message and will get back to you soon.\n\n---\nYour message:\n${message}`,
        tags: ['contact','ack'],
        replyTo: inbox
      }).catch(()=>{});
    } catch {}

    res.json({ ok: true, queued: true });
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
