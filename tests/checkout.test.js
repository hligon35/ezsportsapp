const request = require('supertest');
const { startServer, stopServer } = require('./helpers/server');

let server, baseUrl;

describe('Checkout flow (server-side pieces)', () => {
  beforeAll(async () => { ({ child: server, baseUrl } = await startServer()); });
  afterAll(async () => { await stopServer(server); });

  test('Create PaymentIntent with test items and tax', async () => {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn('Skipping PI test: STRIPE_SECRET_KEY not set');
      return;
    }
    const payload = {
      items: [{ id: 'prod-2001', qty: 1 }],
      customer: { email: `t${Date.now()}@example.com`, name: 'Test User' },
      shipping: { address1: '1 Peachtree St', city: 'Atlanta', state: 'GA', postal: '30301', country: 'US' },
      currency: 'usd', couponCode: ''
    };
    const res = await request(baseUrl).post('/api/create-payment-intent').send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('clientSecret');
    expect(res.body).toHaveProperty('amount');
    expect(res.body.breakdown).toHaveProperty('tax');
  });
});
