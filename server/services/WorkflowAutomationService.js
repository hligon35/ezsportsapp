const crypto = require('crypto');
const DatabaseManager = require('../database/DatabaseManager');
const EmailService = require('./EmailService');
const SubscriberService = require('./SubscriberService');
const TrackingWorkflowService = require('./TrackingWorkflowService');
const { renderBrandedEmailHtml, escapeHtml } = require('./EmailTheme');

class WorkflowAutomationService {
  constructor() {
    this.db = new DatabaseManager();
    this.mail = new EmailService();
    this.subscribers = new SubscriberService();
    this.workflowStore = new TrackingWorkflowService();
    this.baseUrl = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://ezsportsnetting.com').replace(/\/$/, '');
    this.supportEmail = String(process.env.CONTACT_INBOX || 'info@ezsportsnetting.com').trim();
    this.checkoutDelayMinutes = Math.max(0, Number(process.env.WORKFLOW_CHECKOUT_ABANDON_DELAY_MINUTES || 30) || 30);
    this.checkoutSuppressHours = Math.max(1, Number(process.env.WORKFLOW_CHECKOUT_ABANDON_SUPPRESS_HOURS || 24) || 24);
    this.emailCaptureSuppressHours = Math.max(1, Number(process.env.WORKFLOW_EMAIL_CAPTURE_SUPPRESS_HOURS || 24 * 30) || (24 * 30));
    this.quoteAckSuppressHours = Math.max(1, Number(process.env.WORKFLOW_QUOTE_ACK_SUPPRESS_HOURS || 24) || 24);
    this.marketingDailyCap = Math.max(1, Number(process.env.WORKFLOW_MARKETING_DAILY_CAP || 2) || 2);
    this.suppressedRecipientPattern = new RegExp(
      process.env.WORKFLOW_SUPPRESS_RECIPIENT_REGEX || '^(test\+|qa\+|dev\+)|@example\\.com$',
      'i'
    );
  }

  static activeRun = null;

  hashRecipient(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  normalizeEmail(value) {
    return String(value || '').trim().toLowerCase() || null;
  }

  getWorkflowsForEvent(event) {
    switch (String(event?.eventName || '').trim()) {
      case 'email_capture':
        return [
          {
            eventName: 'email_capture',
            workflowKey: 'subscriber_welcome',
            templateKey: 'subscriber-welcome',
            minAgeMs: 0,
            suppressHours: this.emailCaptureSuppressHours,
            category: 'marketing'
          },
          {
            eventName: 'email_capture',
            workflowKey: 'subscriber_internal_notify',
            templateKey: 'subscriber-internal-notify',
            minAgeMs: 0,
            suppressHours: 0,
            recipientMode: 'internal',
            category: 'internal'
          }
        ];
      case 'quote_submit':
        return [
          {
            eventName: 'quote_submit',
            workflowKey: 'quote_submit_ack',
            templateKey: 'quote-submit-ack',
            minAgeMs: 0,
            suppressHours: this.quoteAckSuppressHours,
            category: 'transactional'
          }
        ];
      case 'checkout_abandon':
        return [
          {
            eventName: 'checkout_abandon',
            workflowKey: 'checkout_abandon_recovery',
            templateKey: 'checkout-abandon-reminder',
            minAgeMs: this.checkoutDelayMinutes * 60 * 1000,
            suppressHours: this.checkoutSuppressHours,
            category: 'marketing'
          }
        ];
      default:
        return [];
    }
  }

  async processPending(options = {}) {
    if (WorkflowAutomationService.activeRun) {
      return WorkflowAutomationService.activeRun;
    }

    const run = this.runProcessPending(options).finally(() => {
      if (WorkflowAutomationService.activeRun === run) {
        WorkflowAutomationService.activeRun = null;
      }
    });

    WorkflowAutomationService.activeRun = run;
    return run;
  }

  async runProcessPending({ limit = 25, now = new Date() } = {}) {
    const max = Math.max(1, Math.min(250, Number(limit || 25)));
    const nowMs = now instanceof Date ? now.getTime() : Date.now();
    const events = await this.db.find('workflow_events');
    const sends = await this.db.find('workflow_sends');
    const analytics = await this.db.find('analytics');

    const ordered = (Array.isArray(events) ? events : [])
      .filter(event => event?.eligibility?.eligible !== false)
      .sort((a, b) => Date.parse(a?.occurredAt || a?.createdAt || 0) - Date.parse(b?.occurredAt || b?.createdAt || 0));

    const summary = {
      scanned: 0,
      sent: 0,
      queued: 0,
      skipped: 0,
      deferred: 0,
      failed: 0,
      processed: []
    };

    for (const event of ordered) {
      if (summary.scanned >= max) break;
      const workflows = this.getWorkflowsForEvent(event);
      if (!workflows.length) continue;
      for (const workflow of workflows) {
        if (summary.scanned >= max) break;
        summary.scanned += 1;
        const result = await this.processEvent(event, workflow, { sends, analytics, nowMs });
        if (!result) continue;
        if (result.record) sends.push(result.record);
        if (Object.prototype.hasOwnProperty.call(summary, result.status)) summary[result.status] += 1;
        summary.processed.push({
          eventId: event.eventId || event.id,
          workflowKey: workflow.workflowKey,
          status: result.status,
          reason: result.reason || null
        });
      }
    }

    return summary;
  }

  async processEvent(event, workflow, context) {
    const existing = this.findExistingSend(context.sends, workflow.workflowKey, event);
    if (existing) return null;

    const occurredAt = Date.parse(event?.occurredAt || event?.createdAt || 0);
    const ageMs = Number.isFinite(occurredAt) ? Math.max(0, context.nowMs - occurredAt) : workflow.minAgeMs;
    if (ageMs < workflow.minAgeMs) {
      return { status: 'deferred', reason: 'waiting_delay_window' };
    }

    if (workflow.workflowKey === 'subscriber_welcome') {
      return await this.processEmailCaptureWelcome(event, workflow, context);
    }

    if (workflow.workflowKey === 'subscriber_internal_notify') {
      return await this.processEmailCaptureInternal(event, workflow, context);
    }

    if (workflow.workflowKey === 'quote_submit_ack') {
      return await this.processQuoteSubmitAck(event, workflow, context);
    }

    if (workflow.workflowKey === 'checkout_abandon_recovery') {
      return await this.processCheckoutAbandon(event, workflow, context, ageMs);
    }

    return null;
  }

  findExistingSend(sends, workflowKey, event) {
    return (Array.isArray(sends) ? sends : []).find(send => {
      if (String(send?.workflowKey || '') !== workflowKey) return false;
      if (send?.eventId && event?.eventId && send.eventId === event.eventId) return true;
      if (send?.eventId && !event?.eventId && send.eventId === event.id) return true;
      return false;
    }) || null;
  }

  hasRecentWorkflowSend(sends, workflowKey, recipientHash, suppressHours, nowMs) {
    if (!recipientHash || !suppressHours) return false;
    const cutoff = nowMs - (Math.max(1, Number(suppressHours || 0)) * 60 * 60 * 1000);
    return (Array.isArray(sends) ? sends : []).some(send => {
      if (String(send?.workflowKey || '') !== workflowKey) return false;
      if (String(send?.recipientHash || '') !== recipientHash) return false;
      if (!['sent', 'queued', 'sending'].includes(String(send?.status || '').toLowerCase())) return false;
      const ts = Date.parse(send?.occurredAt || send?.createdAt || 0);
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }

  hasRecoveredOrderSinceEvent(event, analytics, occurredAt) {
    const ecommerce = event?.meta?.ecommerce || {};
    const orderId = ecommerce.orderId || null;
    const paymentIntentId = ecommerce.paymentIntentId || null;
    const emailHash = event?.emailHash || null;
    const email = this.normalizeEmail(event?.email || null);
    return (Array.isArray(analytics) ? analytics : []).some(row => {
      const eventName = String(row?.eventName || row?.type || '').trim().toLowerCase();
      if (!['purchase', 'payment_success'].includes(eventName)) return false;
      const rowTs = Date.parse(row?.occurredAt || row?.timestamp || row?.createdAt || 0);
      if (!Number.isFinite(rowTs) || rowTs < occurredAt) return false;
      const rowOrderId = row?.ecommerce?.orderId || row?.meta?.orderId || null;
      const rowPaymentIntentId = row?.ecommerce?.paymentIntentId || row?.meta?.paymentIntentId || null;
      const rowEmailHash = row?.emailHash || null;
      const rowEmail = this.normalizeEmail(row?.email || null);
      if (orderId && rowOrderId && String(orderId) === String(rowOrderId)) return true;
      if (paymentIntentId && rowPaymentIntentId && String(paymentIntentId) === String(rowPaymentIntentId)) return true;
      if (emailHash && rowEmailHash && String(emailHash) === String(rowEmailHash)) return true;
      if (email && rowEmail && email === rowEmail) return true;
      return false;
    });
  }

  getEventMeta(event) {
    return event?.meta?.meta || {};
  }

  async isUnsubscribed(recipient) {
    const email = this.normalizeEmail(recipient);
    if (!email) return false;
    const subscriber = await this.db.findOne('subscribers', { email });
    return !!subscriber && subscriber.subscribed === false;
  }

  isSuppressedInternalOrTestRecipient(recipient, workflow) {
    const email = this.normalizeEmail(recipient);
    if (!email || String(process.env.NODE_ENV || '').toLowerCase() === 'test') return false;
    if (workflow?.category === 'internal') return false;
    if (this.mail.overrideTo && email === this.normalizeEmail(this.mail.overrideTo)) return false;
    return this.suppressedRecipientPattern.test(email);
  }

  hasExceededDailyMarketingCap(sends, recipientHash, nowMs) {
    if (!recipientHash || !this.marketingDailyCap) return false;
    const cutoff = nowMs - (24 * 60 * 60 * 1000);
    let count = 0;
    for (const send of (Array.isArray(sends) ? sends : [])) {
      if (String(send?.recipientHash || '') !== recipientHash) continue;
      if (!['sent', 'queued', 'sending'].includes(String(send?.status || '').toLowerCase())) continue;
      const category = String(send?.meta?.category || '').toLowerCase();
      if (category !== 'marketing') continue;
      const ts = Date.parse(send?.occurredAt || send?.createdAt || 0);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      count += 1;
      if (count >= this.marketingDailyCap) return true;
    }
    return false;
  }

  async evaluateGovernance({ workflow, recipient, recipientHash, context, event }) {
    if (!recipient) return { suppressed: true, reason: 'missing_email' };
    if (this.isSuppressedInternalOrTestRecipient(recipient, workflow)) {
      return { suppressed: true, reason: 'suppressed_test_or_internal_recipient' };
    }
    if (workflow?.category === 'marketing' && await this.isUnsubscribed(recipient)) {
      return { suppressed: true, reason: 'unsubscribed' };
    }
    if (workflow?.category === 'marketing' && this.hasExceededDailyMarketingCap(context.sends, recipientHash, context.nowMs)) {
      return { suppressed: true, reason: 'daily_marketing_cap_reached' };
    }
    if (this.hasRecentWorkflowSend(context.sends, workflow.workflowKey, recipientHash, workflow.suppressHours, context.nowMs)) {
      return { suppressed: true, reason: 'suppressed_recent_send' };
    }
    if (workflow.workflowKey === 'checkout_abandon_recovery') {
      const occurredAt = Date.parse(event?.occurredAt || event?.createdAt || 0) || context.nowMs;
      if (this.hasRecoveredOrderSinceEvent(event, context.analytics, occurredAt)) {
        return { suppressed: true, reason: 'purchase_recorded_after_abandon' };
      }
    }
    return { suppressed: false };
  }

  buildWorkflowEmail({ recipient, recipientHash, workflow, event, context, composed, tags = [], provider = null }) {
    return this.workflowStore.recordSend({
      recipient,
      recipientHash,
      workflowKey: workflow.workflowKey,
      templateKey: workflow.templateKey,
      eventId: event.eventId || event.id,
      status: composed.status,
      provider,
      suppressUntil: workflow.suppressHours
        ? new Date(context.nowMs + workflow.suppressHours * 60 * 60 * 1000).toISOString()
        : null,
      meta: {
        ...(composed.meta || {}),
        sourceEvent: event?.eventName || null,
        category: workflow?.category || null,
        tags
      },
      occurredAt: new Date(context.nowMs).toISOString()
    });
  }

  async queueWorkflowEmail({ recipient, workflow, event, context, composed, tags = [] }) {
    const email = await this.mail.queue({
      to: recipient,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      tags,
      replyTo: composed.replyTo || this.supportEmail || undefined
    });

    const emailStatus = String(email?.status || 'queued').toLowerCase();
    const workflowStatus = ['failed', 'permanent-failure'].includes(emailStatus)
      ? 'failed'
      : (emailStatus === 'sent' ? 'sent' : 'queued');
    const record = await this.buildWorkflowEmail({
      recipient,
      recipientHash: this.hashRecipient(recipient),
      workflow,
      event,
      context,
      composed: {
        status: workflowStatus,
        meta: {
          emailId: email?.id || null,
          emailStatus
        }
      },
      tags,
      provider: email?.provider || null
    });
    return { status: workflowStatus, reason: null, record };
  }

  async recordSkipped({ workflow, event, context, recipient = null, recipientHash = null, reason }) {
    const record = await this.buildWorkflowEmail({
      recipient,
      recipientHash,
      workflow,
      event,
      context,
      composed: { status: 'skipped', meta: { reason } }
    });
    return { status: 'skipped', reason, record };
  }

  async processEmailCaptureWelcome(event, workflow, context) {
    const recipient = this.normalizeEmail(event?.email);
    const recipientHash = event?.emailHash || this.hashRecipient(recipient);
    const governance = await this.evaluateGovernance({ workflow, recipient, recipientHash, context, event });
    if (governance.suppressed) {
      return await this.recordSkipped({ workflow, event, context, recipient, recipientHash, reason: governance.reason });
    }
    const composed = this.buildEmailCaptureWelcomeEmail(event);
    return await this.queueWorkflowEmail({
      recipient,
      workflow,
      event,
      context,
      composed,
      tags: ['workflow', 'subscribe', 'welcome']
    });
  }

  async processEmailCaptureInternal(event, workflow, context) {
    const recipient = this.normalizeEmail(this.supportEmail);
    const recipientHash = this.hashRecipient(recipient);
    if (!recipient) {
      return await this.recordSkipped({ workflow, event, context, recipientHash, reason: 'missing_internal_recipient' });
    }
    const composed = this.buildEmailCaptureInternalEmail(event);
    return await this.queueWorkflowEmail({
      recipient,
      workflow,
      event,
      context,
      composed,
      tags: ['workflow', 'subscribe', 'internal']
    });
  }

  async processQuoteSubmitAck(event, workflow, context) {
    const recipient = this.normalizeEmail(event?.email);
    const recipientHash = event?.emailHash || this.hashRecipient(recipient);
    const governance = await this.evaluateGovernance({ workflow, recipient, recipientHash, context, event });
    if (governance.suppressed) {
      return await this.recordSkipped({ workflow, event, context, recipient, recipientHash, reason: governance.reason });
    }
    const composed = this.buildQuoteSubmitAckEmail(event);
    return await this.queueWorkflowEmail({
      recipient,
      workflow,
      event,
      context,
      composed,
      tags: ['workflow', 'contact', 'ack']
    });
  }

  async processCheckoutAbandon(event, workflow, context, ageMs) {
    const recipient = this.normalizeEmail(event?.email);
    const recipientHash = event?.emailHash || this.hashRecipient(recipient);
    const governance = await this.evaluateGovernance({ workflow, recipient, recipientHash, context, event });
    if (governance.suppressed) {
      return await this.recordSkipped({ workflow, event, context, recipient, recipientHash, reason: governance.reason });
    }

    const composed = this.buildCheckoutAbandonEmail(event, ageMs);
    return await this.queueWorkflowEmail({
      recipient,
      workflow,
      event,
      context,
      composed,
      tags: ['workflow', 'checkout-abandon']
    });
  }

  buildEmailCaptureWelcomeEmail() {
    const bodyHtml = `
      <p style="margin:0 0 10px;">Thanks for subscribing to EZ Sports Netting!</p>
      <p style="margin:0;color:#5a5a5a;line-height:20px;">We’ll send occasional deals and product updates. You can unsubscribe anytime.</p>
    `;
    return {
      subject: 'Thanks for subscribing to EZ Sports Netting',
      html: renderBrandedEmailHtml({
        title: 'Thanks for subscribing',
        subtitle: 'EZ Sports Netting Newsletter',
        bodyHtml
      }),
      text: 'Thanks for subscribing to EZ Sports Netting! We’ll send occasional deals and product updates. You can unsubscribe anytime.'
    };
  }

  buildEmailCaptureInternalEmail(event) {
    const meta = this.getEventMeta(event);
    const name = meta?.name ? escapeHtml(meta.name) : '';
    const safeEmail = escapeHtml(event?.email || '');
    const safePath = event?.path ? escapeHtml(event.path) : '';
    const safeReferrer = event?.referrer ? escapeHtml(event.referrer) : '';
    const captureType = meta?.captureType ? escapeHtml(meta.captureType) : 'unknown';
    const bodyHtml = `
      <p style="margin:0 0 10px;">A new visitor subscribed to the newsletter.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #d3d0d7;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Email</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safeEmail}</td></tr>
        ${name ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Name</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${name}</td></tr>` : ''}
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Capture Type</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${captureType}</td></tr>
        ${safePath ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Source</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${safePath}</td></tr>` : ''}
        ${safeReferrer ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;">Referrer</td><td style="padding:10px 12px;">${safeReferrer}</td></tr>` : ''}
      </table>
    `;
    return {
      subject: 'New subscriber',
      html: renderBrandedEmailHtml({
        title: 'New subscriber',
        subtitle: 'Newsletter subscription',
        bodyHtml
      }),
      text: `Email: ${event?.email || ''}\nName: ${meta?.name || ''}\nCapture Type: ${meta?.captureType || ''}\nSource: ${event?.path || ''}\nReferrer: ${event?.referrer || ''}`,
      replyTo: event?.email || undefined
    };
  }

  buildQuoteSubmitAckEmail(event) {
    const meta = this.getEventMeta(event);
    const lead = event?.meta?.lead || {};
    const name = escapeHtml(meta?.name || 'there');
    const topic = escapeHtml(lead?.topic || 'your request');
    const quoteType = String(lead?.quoteType || '').trim().toLowerCase();
    const estimatedValue = Number(lead?.estimatedValue || 0) || 0;
    const message = escapeHtml(meta?.message || '');
    const subjectLine = quoteType === 'training_facility'
      ? 'We received your facility request'
      : 'We received your message';
    const facilitySummary = `
      <div style="margin:16px 0 8px;font-weight:800;color:#241773;">Request summary</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #d3d0d7;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;border-bottom:1px solid #d3d0d7;">Topic</td><td style="padding:10px 12px;border-bottom:1px solid #d3d0d7;">${topic}</td></tr>
        <tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;${estimatedValue > 0 ? 'border-bottom:1px solid #d3d0d7;' : ''}">Request Type</td><td style="padding:10px 12px;${estimatedValue > 0 ? 'border-bottom:1px solid #d3d0d7;' : ''}">${escapeHtml(lead?.submissionType || 'contact_form')}</td></tr>
        ${estimatedValue > 0 ? `<tr><td style="padding:10px 12px;background:#ffffff;color:#5a5a5a;width:38%;">Estimated Project Value</td><td style="padding:10px 12px;">$${escapeHtml(estimatedValue.toFixed(2))}</td></tr>` : ''}
      </table>
    `;
    const generalSummary = message
      ? `
      <div style="margin:16px 0 8px;font-weight:800;color:#241773;">Your message</div>
      <pre style="margin:0;padding:12px 12px;border:1px solid #d3d0d7;border-radius:10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:12px;line-height:1.45;color:#000000;">${message}</pre>
    `
      : '';
    const bodyHtml = `
      <p style="margin:0 0 10px;">Hi ${name},</p>
      <p style="margin:0 0 12px;color:#5a5a5a;line-height:20px;">Thanks for contacting EZ Sports Netting! We received your ${quoteType === 'training_facility' ? 'facility request' : 'message'} and will get back to you soon.</p>
      ${quoteType === 'training_facility' ? facilitySummary : generalSummary}
    `;
    return {
      subject: subjectLine,
      html: renderBrandedEmailHtml({
        title: subjectLine,
        subtitle: 'EZ Sports Netting Support',
        bodyHtml
      }),
      text: quoteType === 'training_facility'
        ? `Hi ${meta?.name || 'there'},\n\nThanks for contacting EZ Sports Netting! We received your facility request and will get back to you soon.\n\nTopic: ${lead?.topic || 'your request'}${estimatedValue > 0 ? `\nEstimated Project Value: $${estimatedValue.toFixed(2)}` : ''}`
        : `Hi ${meta?.name || 'there'},\n\nThanks for contacting EZ Sports Netting! We received your message and will get back to you soon.${meta?.message ? `\n\n---\nYour message:\n${meta.message}` : ''}`
    };
  }

  buildCheckoutAbandonEmail(event, ageMs) {
    const ecommerce = event?.meta?.ecommerce || {};
    const items = Array.isArray(ecommerce.items) ? ecommerce.items : [];
    const lines = items.slice(0, 5).map(item => {
      const name = escapeHtml(item?.productName || item?.name || item?.productId || 'Item');
      const qty = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
      const price = Number(item?.price || 0) || 0;
      const total = (price * qty).toFixed(2);
      return `<li style="margin:0 0 8px;"><strong>${name}</strong> &times; ${qty}${price > 0 ? ` <span style="color:#5a5a5a;">($${escapeHtml(total)})</span>` : ''}</li>`;
    }).join('');
    const cartValue = Number(ecommerce.value || 0) || 0;
    const resumeUrl = `${this.baseUrl}/checkout.html`;
    const hoursAgo = Math.max(1, Math.round(ageMs / (60 * 60 * 1000)));
    const bodyHtml = `
      <p style="margin:0 0 10px;">You started checkout on EZ Sports Netting but didn’t finish your order.</p>
      <p style="margin:0 0 14px;color:#5a5a5a;line-height:20px;">Your cart is still available. Use the link below to return to checkout and finish when you’re ready.</p>
      ${cartValue > 0 ? `<p style="margin:0 0 14px;"><strong>Estimated order total:</strong> $${escapeHtml(cartValue.toFixed(2))}</p>` : ''}
      ${lines ? `<div style="margin:16px 0 8px;font-weight:800;color:#241773;">Items waiting in your cart</div><ul style="margin:0 0 16px 18px;padding:0;color:#000000;line-height:20px;">${lines}</ul>` : ''}
      <p style="margin:0 0 16px;"><a href="${escapeHtml(resumeUrl)}" style="display:inline-block;background:#241773;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">Return to checkout</a></p>
      <p style="margin:0;color:#5a5a5a;line-height:20px;">If you ran into an issue or need help choosing the right netting, reply to this email and our team will help.</p>
      <p style="margin:14px 0 0;color:#5a5a5a;font-size:12px;line-height:16px;">Trigger: checkout abandoned about ${escapeHtml(String(hoursAgo))} hour${hoursAgo === 1 ? '' : 's'} ago.</p>
    `;
    const html = renderBrandedEmailHtml({
      title: 'Complete your order',
      subtitle: 'EZ Sports Netting Checkout Reminder',
      bodyHtml
    });
    const itemText = items.slice(0, 5).map(item => {
      const name = item?.productName || item?.name || item?.productId || 'Item';
      const qty = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
      return `- ${name} x${qty}`;
    }).join('\n');
    const text = [
      'You started checkout on EZ Sports Netting but did not finish your order.',
      cartValue > 0 ? `Estimated order total: $${cartValue.toFixed(2)}` : '',
      itemText ? `Items in your cart:\n${itemText}` : '',
      `Resume checkout: ${resumeUrl}`,
      this.supportEmail ? `Need help? Reply to this email or contact ${this.supportEmail}` : ''
    ].filter(Boolean).join('\n\n');
    return {
      subject: 'Complete your EZ Sports Netting order',
      html,
      text
    };
  }
}

module.exports = WorkflowAutomationService;