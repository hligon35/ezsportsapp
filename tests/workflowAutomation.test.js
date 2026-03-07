const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

const DatabaseManager = require('../server/database/DatabaseManager');
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
});