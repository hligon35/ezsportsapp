const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const waitOn = require('wait-on');

function parseMoney(text) {
  const n = Number(String(text || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// Start the server before the tests and stop it afterwards
let child;

async function startServer() {
  // Load .env.test if it exists to populate Stripe and other test settings
  const envPath = path.join(__dirname, '..', '..', '.env.test');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
  const env = {
    ...process.env,
    PORT: process.env.PLAYWRIGHT_PORT || '5050',
    NODE_ENV: 'test',
  };
  // Force Stripe off for this suite to avoid external dependencies / flakiness.
  // This ensures the UI goes through the "Place Order" test-checkout path.
  env.STRIPE_SECRET_KEY = '';
  env.STRIPE_PUBLISHABLE_KEY = '';
  env.ALLOW_TEST_CHECKOUT = 'true';
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

  await page.locator('#submit').waitFor({ state: 'visible' });
  // If Stripe is enabled (keys loaded), the button text will be "Pay" and a Payment Element should exist.
  // Otherwise, it will show "Place Order" (test mode).
  const btnText = await page.locator('#submit').textContent();
  const isStripe = /pay/i.test(btnText || '');

    // Fill customer and address
    await page.fill('#name', customer.name);
    await page.fill('#email', customer.email);
    await page.fill('#address1', shipping.address1);
    await page.fill('#city', shipping.city);
    await page.fill('#state', shipping.state);
    await page.fill('#postal', shipping.postal);

    // Assert math: subtotal + shipping + GA tax (7%) = total
    // Seeded cart line: $349.95 with $50 shipping
    // Tax base = 349.95 + 50.00 = 399.95; tax = round(399.95 * 0.07) = 28.00
    // Total = 349.95 + 50.00 + 28.00 = 437.95
    await expect(page.locator('#sum-subtotal')).toContainText('$');
    await expect(page.locator('#sum-shipping')).toContainText('$');
    // Tax row should show for GA
    await expect(page.locator('#tax-row')).toBeVisible();

    const sub = parseMoney(await page.locator('#sum-subtotal').textContent());
    const shipCost = parseMoney(await page.locator('#sum-shipping').textContent());
    const tax = parseMoney(await page.locator('#sum-tax').textContent());
    const total = parseMoney(await page.locator('#sum-total').textContent());

    expect(sub).toBeCloseTo(349.95, 2);
    expect(shipCost).toBeCloseTo(50.00, 2);
    expect(tax).toBeCloseTo(28.00, 2);
    expect(total).toBeCloseTo(437.95, 2);

    // Optionally apply a bogus promo to exercise UX (should show invalid)
    await page.fill('#promo-code', 'NOTAREALCODE');
    await page.click('#apply-code');

    // Place order
    if (isStripe) {
      // With real Stripe keys, clicking Pay will attempt to confirmPayment and redirect to order-confirmation
      await page.click('#submit');
    } else {
      // Test mode (no Stripe): button shows Place Order and immediately posts to /api/order
      await expect(page.locator('#submit')).toHaveText(/Place Order/i);
      await page.click('#submit');
    }

    // We should land on order-confirmation.html; assert key elements
    await page.waitForURL(/order-confirmation\.html/);
    await expect(page.locator('h2')).toHaveText(/Thank you for your order/i);
    await expect(page.locator('#order-id')).not.toHaveText('—');
    await expect(page.locator('#total')).toContainText('$');
    await expect(page.locator('#lines li')).toHaveCount(1);

    // Capture a screenshot artifact for quickly validating receipt layout
    await page.screenshot({ path: 'test-results/checkout-confirmation.png', fullPage: true });
  });
});
