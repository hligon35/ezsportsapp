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

  test('POST /calculate_price returns totals (CSV-backed)', async () => {
    const res = await request(baseUrl).post('/calculate_price').send({
      Net_Height: 10,
      Net_Width: 10,
      Net_Length: 0,
      Net_Gauge: '#18',
      Border_Type: 'Sewn Rope',
      Doors: 2,
      Freight: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRetailPrice');
    expect(res.body).toHaveProperty('totalWholesalePrice');
    expect(res.body).toHaveProperty('totalProductWeight');

    // Uses current CSV assets:
    // #18 retail=0.2699, wholesale=0.21592, weight=0.018375
    // Sewn Rope base_cost=0.5 (from border multipliers), weight_per_unit=0.02 (from weights)
    // area=100, perimeter=40, doors=2, freight=true
    expect(res.body.totalRetailPrice).toBeCloseTo(221.99, 2);
    expect(res.body.totalWholesalePrice).toBeCloseTo(41.592, 3);
    expect(res.body.totalProductWeight).toBeCloseTo(2.6375, 4);
  });

  test('POST /calculate_price rejects unknown gauge', async () => {
    const res = await request(baseUrl).post('/calculate_price').send({
      Net_Height: 10,
      Net_Width: 10,
      Net_Length: 0,
      Net_Gauge: '#999',
      Border_Type: 'Rope',
    });
    expect(res.status).toBe(400);
  });
});
