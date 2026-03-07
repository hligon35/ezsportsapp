const DatabaseManager = require('../database/DatabaseManager');
const TrackingDedupeService = require('./TrackingDedupeService');

class TrackingWorkflowService {
  constructor() {
    this.db = new DatabaseManager();
    this.dedupe = new TrackingDedupeService();
    this.workflowEvents = new Set([
      'email_capture',
      'quote_submit',
      'begin_checkout',
      'checkout_abandon',
      'payment_success',
      'payment_failure',
      'purchase',
      'cta_click',
      'facility_configurator_engage'
    ]);
  }

  async captureEvent(event) {
    if (!event || !this.workflowEvents.has(String(event.eventName || event.type || '').trim())) return null;
    const dedupeKey = `workflow:${event.eventName}:${event.dedupeKey || event.eventId || event.id || ''}`;
    const duplicate = await this.dedupe.isDuplicate('workflow_events', dedupeKey, 5 * 60 * 1000);
    if (duplicate) return { duplicate: true, dedupeKey };
    return await this.db.insert('workflow_events', {
      eventId: event.eventId || null,
      dedupeKey,
      eventName: event.eventName,
      source: event.source,
      identityId: event.identityId || null,
      visitorId: event.visitorId || null,
      userId: event.userId || null,
      email: event.email || null,
      emailHash: event.emailHash || null,
      path: event.path || null,
      occurredAt: event.occurredAt || event.timestamp || new Date().toISOString(),
      workflowKey: event.eventName,
      eligibility: {
        eligible: ['email_capture', 'quote_submit', 'begin_checkout', 'checkout_abandon', 'purchase', 'payment_success'].includes(event.eventName),
        suppressForHours: ['email_capture', 'quote_submit'].includes(event.eventName) ? 24 : 6
      },
      meta: {
        ecommerce: event.ecommerce || null,
        lead: event.lead || null,
        attribution: event.attribution || null,
        meta: event.meta || null
      }
    });
  }

  async recordSend(payload = {}) {
    return await this.db.insert('workflow_sends', {
      recipient: payload.recipient || null,
      recipientHash: payload.recipientHash || null,
      workflowKey: payload.workflowKey || null,
      templateKey: payload.templateKey || null,
      eventId: payload.eventId || null,
      status: payload.status || 'queued',
      provider: payload.provider || null,
      suppressUntil: payload.suppressUntil || null,
      meta: payload.meta || null,
      occurredAt: payload.occurredAt || new Date().toISOString()
    });
  }
}

module.exports = TrackingWorkflowService;