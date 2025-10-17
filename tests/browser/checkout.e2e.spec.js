const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const waitOn = require('wait-on');

// Start the server before the tests and stop it afterwards
let child;

async function startServer() {
  const env = { 
    ...process.env, 
    PORT: process.env.PORT || '5050', 
    NODE_ENV: 'test',
    // Force test-mode checkout without Stripe
    STRIPE_SECRET_KEY: '',
    STRIPE_PUBLISHABLE_KEY: '',
    ALLOW_TEST_CHECKOUT: 'true'
  };
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitOn({ resources: [`http://localhost:${env.PORT}/health`], timeout: 15000, interval: 300 });
  return `http://localhost:${env.PORT}`;
}

async function stopServer() {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.on('exit', () => resolve());
    child.kill('SIGINT');
  });
}

// Choose a stable SKU from prodList fallback
const SKU = 'PITCHERSPOCKET9';

// Minimal customer + address for GA to exercise tax calculation
const customer = { name: 'Browser E2E', email: `browser+${Date.now()}@example.com` };
const shipping = { address1: '1 Peachtree St', city: 'Atlanta', state: 'GA', postal: '30301', country: 'US' };


// Only run in test mode without Stripe to avoid external payment UI flakiness
// We assert the test-mode path (button label switches to "Place Order") and that we land on confirmation

test.describe('Checkout flow (browser, test mode)', () => {
  test.beforeAll(async () => {
    const base = await startServer();
    process.env.BASE_URL = base;
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('add to cart via localStorage, fill form, place order, confirm page', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:5050';

    // Provide a safe Stripe stub so frontend code doesn't throw if the real library is blocked/unavailable
    await page.addInitScript(() => {
      // Only override if not already provided by the page
      if (!window.Stripe) {
        window.Stripe = function() {
          return {
            elements: () => ({ create: () => ({ mount: () => {} }) }),
            confirmPayment: async () => ({})
          };
        };
      }
    });

    // Seed cart in localStorage
    await page.goto(base + '/index.html');
    await page.addInitScript(([sku]) => {
      const cart = [
        { id: sku, title: 'Pitcher\'s Pocket 9', price: 349.95, qty: 1, ship: 50 }
      ];
      localStorage.setItem('cart', JSON.stringify(cart));
    }, [SKU]);

    // Go to checkout
    await page.goto(base + '/checkout.html');

    // Expect payment UI to be in test mode (no Stripe clientSecret available)
    await page.locator('#submit').waitFor({ state: 'visible' });
    await expect(page.locator('#submit')).toHaveText(/Place Order/i);

    // Fill customer and address
    await page.fill('#name', customer.name);
    await page.fill('#email', customer.email);
    await page.fill('#address1', shipping.address1);
    await page.fill('#city', shipping.city);
    await page.fill('#state', shipping.state);
    await page.fill('#postal', shipping.postal);

    // Optionally apply a bogus promo to exercise UX (should show invalid)
    await page.fill('#promo-code', 'NOTAREALCODE');
    await page.click('#apply-code');

    // Place order
    await page.click('#submit');

    // We should land on order-confirmation.html; assert key elements
    await page.waitForURL(/order-confirmation\.html/);
    await expect(page.locator('h2')).toHaveText(/Thank you for your order/i);
    await expect(page.locator('#order-id')).not.toHaveText('—');
    await expect(page.locator('#total')).toContainText('$');
    await expect(page.locator('#lines li')).toHaveCount(1);
  });
});
