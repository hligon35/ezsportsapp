const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

const DatabaseManager = require('../server/database/DatabaseManager');
const WorkflowAutomationService = require('../server/services/WorkflowAutomationService');
const { startServer, stopServer } = require('./helpers/server');

async function waitFor(assertion, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  let lastError = null;
  while ((Date.now() - start) < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError || new Error('Timed out waiting for condition');
}

describe('Workflow automation', () => {
  let server;
  let baseUrl;
  let tempDbPath;
  let previousDbPath;
  let db;

  beforeEach(() => {
    WorkflowAutomationService.activeRun = null;
  });

  beforeAll(async () => {
    tempDbPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ezsports-workflow-'));
    previousDbPath = process.env.DB_PATH;
    process.env.DB_PATH = tempDbPath;
    ({ child: server, baseUrl } = await startServer());
    db = new DatabaseManager(tempDbPath);
  });

  afterAll(async () => {
    await stopServer(server);
    if (previousDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousDbPath;
    }
    await fs.rm(tempDbPath, { recursive: true, force: true });
  });

  test('subscribe request queues welcome and internal subscriber workflows', async () => {
    const email = `workflow-subscribe-${Date.now()}@example.com`;
    const response = await request(baseUrl)
      .post('/api/marketing/subscribe')
      .send({
        email,
        name: 'Workflow Subscriber',
        source: '/support.html',
        referer: 'https://example.com/campaign'
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('ok', true);

    await waitFor(async () => {
      const sends = await db.find('workflow_sends');
      const welcome = sends.find(send => send.workflowKey === 'subscriber_welcome' && send.recipient === email);
      const internal = sends.find(send => send.workflowKey === 'subscriber_internal_notify' && send.recipient === 'info@ezsportsnetting.com');
      expect(welcome).toBeTruthy();
      expect(internal).toBeTruthy();
    });

    const emails = await db.find('emails');
    expect(emails.some(row => row.to === email && row.subject === 'Thanks for subscribing to EZ Sports Netting')).toBe(true);
    expect(emails.some(row => row.to === 'info@ezsportsnetting.com' && row.subject === 'New subscriber')).toBe(true);
  });

  test('contact request queues workflow-driven acknowledgement', async () => {
    const email = `workflow-contact-${Date.now()}@example.com`;
    const response = await request(baseUrl)
      .post('/api/marketing/contact')
      .send({
        name: 'Workflow Contact',
        email,
        phone: '555-0100',
        subject: 'Batting cage quote',
        topic: 'general_contact',
        message: 'Need pricing for a batting cage install.',
        source: '/contactus.html'
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('ok', true);

    await waitFor(async () => {
      const sends = await db.find('workflow_sends');
      const ack = sends.find(send => send.workflowKey === 'quote_submit_ack' && send.recipient === email);
      expect(ack).toBeTruthy();
    });

    const emails = await db.find('emails');
    expect(emails.some(row => row.to === email && row.subject === 'We received your message')).toBe(true);
    expect(emails.some(row => row.to === 'info@ezsportsnetting.com' && row.subject === '[Contact] Batting cage quote')).toBe(true);
  });

  test('unsubscribed recipients are suppressed for marketing recovery emails', async () => {
    const workflowEmail = `workflow-unsub-${Date.now()}@example.com`;
    await db.insert('subscribers', { email: workflowEmail, name: 'Unsubscribed User', subscribed: false });
    await db.insert('workflow_events', {
      eventId: `evt_${Date.now()}`,
      eventName: 'checkout_abandon',
      source: 'test',
      email: workflowEmail,
      emailHash: null,
      occurredAt: new Date(Date.now() - (45 * 60 * 1000)).toISOString(),
      eligibility: { eligible: true },
      meta: {
        ecommerce: {
          currency: 'USD',
          value: 499.99,
          orderId: 'order-test-1',
          paymentIntentId: null,
          items: [{ productId: 'sku-1', productName: 'Test Net', quantity: 1, price: 499.99 }]
        },
        lead: null,
        attribution: null,
        meta: { cartFingerprint: 'fp-1', reason: 'test' }
      }
    });

    const automation = new WorkflowAutomationService();
    const result = await automation.processPending({ limit: 10, now: new Date() });
    expect(result.skipped).toBeGreaterThan(0);

    const sends = await db.find('workflow_sends');
    const suppressed = sends.find(send => send.workflowKey === 'checkout_abandon_recovery' && send.recipient === workflowEmail);
    expect(suppressed).toBeTruthy();
    expect(suppressed.status).toBe('skipped');
    expect(suppressed.meta.reason).toBe('unsubscribed');
  });

  test('daily marketing cap suppresses additional marketing sends', async () => {
    const workflowEmail = `workflow-cap-${Date.now()}@example.com`;
    const automation = new WorkflowAutomationService();
    const recipientHash = automation.hashRecipient(workflowEmail);

    await db.insert('workflow_sends', {
      recipient: workflowEmail,
      recipientHash,
      workflowKey: 'subscriber_welcome',
      templateKey: 'subscriber-welcome',
      status: 'sent',
      occurredAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
      meta: { category: 'marketing' }
    });
    await db.insert('workflow_sends', {
      recipient: workflowEmail,
      recipientHash,
      workflowKey: 'checkout_abandon_recovery',
      templateKey: 'checkout-abandon-reminder',
      status: 'sent',
      occurredAt: new Date(Date.now() - (60 * 60 * 1000)).toISOString(),
      meta: { category: 'marketing' }
    });
    await db.insert('workflow_events', {
      eventId: `evt_cap_${Date.now()}`,
      eventName: 'email_capture',
      source: 'test',
      email: workflowEmail,
      emailHash: null,
      occurredAt: new Date().toISOString(),
      eligibility: { eligible: true },
      meta: {
        ecommerce: { currency: 'USD', value: 0, orderId: null, paymentIntentId: null, items: [] },
        lead: { submissionType: 'subscribe_form', topic: 'newsletter', quoteType: null, formId: 'subscribe', estimatedValue: 0 },
        attribution: null,
        meta: { captureType: 'subscribe_form', name: 'Cap User' }
      }
    });

    const result = await automation.processPending({ limit: 10, now: new Date() });
    expect(result.skipped).toBeGreaterThan(0);

    const sends = await db.find('workflow_sends');
    const suppressed = sends.find(send => send.workflowKey === 'subscriber_welcome' && send.recipient === workflowEmail && send.status === 'skipped');
    expect(suppressed).toBeTruthy();
    expect(suppressed.meta.reason).toBe('daily_marketing_cap_reached');
  });

  test('concurrent processPending calls do not duplicate workflow sends', async () => {
    const workflowEmail = `workflow-lock-${Date.now()}@example.com`;
    await db.insert('workflow_events', {
      eventId: `evt_lock_${Date.now()}`,
      eventName: 'quote_submit',
      source: 'test',
      email: workflowEmail,
      emailHash: null,
      occurredAt: new Date().toISOString(),
      eligibility: { eligible: true },
      meta: {
        ecommerce: { currency: 'USD', value: 0, orderId: null, paymentIntentId: null, items: [] },
        lead: { submissionType: 'contact_form', topic: 'general_contact', quoteType: null, formId: 'contact', estimatedValue: 0 },
        attribution: null,
        meta: {
          name: 'Lock Test',
          message: 'Checking concurrent workflow processing.',
          topicLabel: 'General Contact'
        }
      }
    });

    const first = new WorkflowAutomationService();
    const second = new WorkflowAutomationService();
    const [resultA, resultB] = await Promise.all([
      first.processPending({ limit: 10, now: new Date() }),
      second.processPending({ limit: 10, now: new Date() })
    ]);

    expect(resultA.processed).toEqual(resultB.processed);

    const sends = await db.find('workflow_sends');
    const acknowledgements = sends.filter(send => send.workflowKey === 'quote_submit_ack' && send.recipient === workflowEmail);
    expect(acknowledgements).toHaveLength(1);

    const emails = await db.find('emails');
    const queued = emails.filter(row => row.to === workflowEmail && row.subject === 'We received your message');
    expect(queued).toHaveLength(1);
  });
});