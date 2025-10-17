const request = require('supertest');
const { startServer, stopServer } = require('./helpers/server');

let server, baseUrl;

describe('E2E order flow (Stripe test mode)', () => {
  beforeAll(async () => { ({ child: server, baseUrl } = await startServer()); });
  afterAll(async () => { await stopServer(server); });

  test('Browse → coupon (optional) → PI created', async () => {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn('Skipping E2E Stripe test: STRIPE_SECRET_KEY not set');
      return;
    }
    // 1. Products
    const list = await request(baseUrl).get('/api/products');
    expect(list.status).toBe(200);
    const any = Array.isArray(list.body) && list.body[0];
    const item = any ? { id: any.id || any.sku || 'prod-2001', qty: 1 } : { id: 'prod-2001', qty: 1 };

    // 2. Optional: validate coupon (if service grants test coupons)
    // const v = await request(baseUrl).post('/api/marketing/validate-coupon').send({ code: 'TEST10', email: 'e2e@example.com' });

    // 3. Create PI
    const payload = { items: [item], customer: { email: `e2e${Date.now()}@example.com`, name: 'E2E Tester' }, shipping: { address1: '1 Peachtree St', city: 'Atlanta', state: 'GA', postal: '30301', country: 'US' }, currency: 'usd' };
    const pi = await request(baseUrl).post('/api/create-payment-intent').send(payload);
    expect(pi.status).toBe(200);
    expect(pi.body).toHaveProperty('clientSecret');
    expect(pi.body).toHaveProperty('orderId');
  });
});
