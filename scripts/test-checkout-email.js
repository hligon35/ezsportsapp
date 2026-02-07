/*
  Creates a test-mode order via /api/order and then simulates a Stripe
  payment_intent.succeeded webhook to generate the customer email.

  Outputs:
  - test-results/test-order-email.html
  - test-results/test-order-email.txt

  This script intentionally disables real Stripe + email delivery.
*/

const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const waitOn = require('wait-on');

function pickLatestEmail(emails, predicate) {
  const arr = Array.isArray(emails) ? emails : [];
  const filtered = arr.filter(predicate);
  filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return filtered[0];
}

async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  try {
    const { fetch: undiciFetch } = require('undici');
    return undiciFetch;
  } catch {
    throw new Error('No fetch implementation available (need Node 18+ or undici).');
  }
}

async function startServer({ port }) {
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',

    // Ensure we exercise the test checkout path and avoid external dependencies
    STRIPE_SECRET_KEY: '',
    STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    ALLOW_TEST_CHECKOUT: 'true',

    // Ensure no real emails are sent
    CF_EMAIL_WEBHOOK_URL: '',
    CF_EMAIL_API_KEY: '',
    EMAIL_DEBUG: 'true',

    // Ensure staff/internal notification is generated
    ORDER_NOTIFY_TO: 'ops@example.com',
  };

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverOutput = [];
  child.stdout.on('data', (d) => serverOutput.push(d.toString()));
  child.stderr.on('data', (d) => serverOutput.push(d.toString()));

  await waitOn({ resources: [`http://localhost:${port}/health`], timeout: 15000, interval: 300 });
  return { child, baseUrl: `http://localhost:${port}`, serverOutput };
}

async function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.on('exit', () => resolve());
    child.kill('SIGINT');
  });
}

async function main() {
  const doFetch = await getFetch();
  const port = Number(process.env.TEST_PORT || 5056);

  const { child, baseUrl } = await startServer({ port });
  try {
    const now = Date.now();
    const customer = { name: 'Test Checkout', email: `test-checkout+${now}@example.com` };
    const shipping = { address1: '1 Peachtree St', address2: '', city: 'Atlanta', state: 'GA', postal: '30301', country: 'US' };

    // Keep payload aligned with assets/js/checkout.js submission (id/qty/price/ship + name + variation fields)
    const orderPayload = {
      items: [
        {
          id: 'PITCHERSPOCKET9',
          qty: 1,
          price: 349.95,
          ship: 50,
          // Variation fields used by confirmation + email
          color: 'Black',
          category: 'Training',
          name: "Pitcher’s Pocket 9"
        },
        // Variation-pricing example (wholesale/map stored in server/database/products.json under product.variations[])
        {
          id: 'BULLETL',
          qty: 2,
          price: 499.95,
          ship: 0,
          size: 'Padded',
          color: 'Black',
          category: 'Training',
          name: 'Bullet L Screen Baseball'
        },
        // By-the-foot example (length stored in size)
        {
          id: 'Screen Component',
          qty: 1,
          // Price is per-foot in catalog; server multiplies by the chosen feet.
          // Providing price here keeps the payload shape aligned, but server will compute final unit based on catalog.
          price: 1.5,
          ship: 0,
          size: "By the Foot: 8'",
          color: 'Blue',
          category: 'Accessories',
          name: 'Screen Padding by the FT'
        },
        // Netting calculator example (category netting => receipt should label as Dimensions + Spec)
        {
          id: 'custom-net-36-10x12-sewnrope',
          qty: 1,
          price: 199.95,
          ship: 25,
          size: `10' 0\" x 12' 0\"`,
          color: '#36 Nylon • Batting Cage | Sewn Rope',
          category: 'netting',
          name: `Custom Net 10' 0\" x 12' 0\" — #36 Nylon (Sewn Rope border)`
        }
      ],
      customer,
      shipping,
      shippingMethod: 'standard',
      couponCode: '',
      existingOrderId: null,
    };

    const orderResp = await doFetch(`${baseUrl}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload),
    });
    if (!orderResp.ok) {
      const body = await orderResp.text().catch(() => '');
      throw new Error(`/api/order failed ${orderResp.status}: ${body}`);
    }
    const orderJson = await orderResp.json();
    const orderId = String(orderJson.orderId || '');
    if (!orderId) throw new Error('No orderId returned from /api/order');

    // Simulate a payment success event to trigger the customer/internal emails
    // Keep PI amount consistent with the same inputs so the receipt totals match.
    const amountCents = Math.round(orderPayload.items.reduce((sum, it) => {
      const qty = Math.max(1, Number(it.qty || 1) || 1);
      const unit = Number(it.price || 0) || 0;
      const ship = Number(it.ship || 0) || 0;
      return sum + (unit * qty) + ship;
    }, 0) * 100);
    const evt = {
      id: `evt_test_${now}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_test_${now}`,
          amount: amountCents,
          currency: 'usd',
          receipt_email: customer.email,
          metadata: {
            order_id: orderId,
            email: customer.email,
            name: customer.name,
            items: 'PITCHERSPOCKET9:1',
            coupon_code: '',
            connect_destination: '',
            platform_fee_cents: '0',
            platform_fee_bps: '',
          },
          charges: { data: [{ id: `ch_test_${now}` }] },
        },
      },
    };

    const whResp = await doFetch(`${baseUrl}/webhook/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    });
    if (!whResp.ok) {
      const body = await whResp.text().catch(() => '');
      throw new Error(`/webhook/stripe failed ${whResp.status}: ${body}`);
    }

    // Read the outbox and write the latest order email to files for review
    const emailsPath = path.join(__dirname, '..', 'server', 'database', 'emails.json');
    const emailsRaw = await fs.readFile(emailsPath, 'utf8');
    const emails = JSON.parse(emailsRaw);

    const isOrderCustomerEmail = (e) => {
      const tags = Array.isArray(e.tags) ? e.tags : [];
      return tags.includes('order') && tags.includes('customer') && String(e.to || '').toLowerCase() === customer.email.toLowerCase();
    };

    const match = (Array.isArray(emails) ? emails : []).filter(isOrderCustomerEmail).slice(-1)[0];
    if (!match) {
      throw new Error('Could not find queued customer order email in server/database/emails.json');
    }

    const outDir = path.join(__dirname, '..', 'test-results');
    await fs.mkdir(outDir, { recursive: true });

    const htmlOut = path.join(outDir, 'test-order-email.html');
    const textOut = path.join(outDir, 'test-order-email.txt');

    const htmlDoc = `<!doctype html><meta charset="utf-8"/><title>${match.subject || 'Order Email'}</title>${match.html || ''}`;
    await fs.writeFile(htmlOut, htmlDoc, 'utf8');
    await fs.writeFile(textOut, match.text || '', 'utf8');

    // Staff/internal email artifact
    const staffEmail = pickLatestEmail(emails, (e) => {
      const tags = Array.isArray(e.tags) ? e.tags : [];
      return tags.includes('order') && tags.includes('paid') && tags.includes('internal');
    });

    if (!staffEmail) {
      throw new Error('Could not find queued staff/internal order email in server/database/emails.json');
    }

    const staffHtmlOut = path.join(outDir, 'test-staff-email.html');
    const staffTextOut = path.join(outDir, 'test-staff-email.txt');
    await fs.writeFile(staffHtmlOut, staffEmail.html || '', 'utf8');
    await fs.writeFile(staffTextOut, staffEmail.text || '', 'utf8');

    // Minimal console output (avoid dumping full HTML)
    console.log(JSON.stringify({
      orderId,
      customerEmail: customer.email,
      emailSubject: match.subject,
      emailStatus: match.status,
      htmlFile: path.relative(process.cwd(), htmlOut),
      textFile: path.relative(process.cwd(), textOut),
      staffHtmlFile: path.relative(process.cwd(), staffHtmlOut),
      staffTextFile: path.relative(process.cwd(), staffTextOut),
    }, null, 2));
  } finally {
    await stopServer(child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
