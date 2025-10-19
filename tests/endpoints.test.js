const request = require('supertest');
const { startServer, stopServer } = require('./helpers/server');

let server;
let baseUrl;

describe('API endpoints', () => {
  beforeAll(async () => {
    const s = await startServer();
    server = s.child; baseUrl = s.baseUrl;
  });
  afterAll(async () => { await stopServer(server); });

  test('GET /health', async () => {
    const res = await request(baseUrl).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /api/config', async () => {
    const res = await request(baseUrl).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pk');
    expect(typeof res.body.enabled).toBe('boolean');
  });

  test('GET /api/products?limit=1', async () => {
    const res = await request(baseUrl).get('/api/products?limit=1');
    expect([200, 204]).toContain(res.status);
  });

  test('POST /api/analytics/track', async () => {
    const res = await request(baseUrl).post('/api/analytics/track').send({ path: '/', ts: new Date().toISOString() });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('ok');
  });

  test('POST /api/marketing/subscribe rejects spam and queues valid', async () => {
    const spam = await request(baseUrl).post('/api/marketing/subscribe').send({ email: 'x@example.com', hp: 'bot' });
    expect(spam.status).toBe(200);
    const ok = await request(baseUrl).post('/api/marketing/subscribe').send({ email: `u${Date.now()}@example.com` });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('ok', true);
  });
});
