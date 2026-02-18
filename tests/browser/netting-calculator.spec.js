const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const waitOn = require('wait-on');

let child;

function parseMoney(text) {
  const n = Number(String(text || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

async function startServer() {
  const envPath = path.join(__dirname, '..', '..', '.env.test');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
  const env = {
    ...process.env,
    PORT: process.env.PLAYWRIGHT_PORT || '5051',
    NODE_ENV: 'test',
  };

  // Keep Stripe off; we only need static assets.
  env.STRIPE_SECRET_KEY = '';
  env.STRIPE_PUBLISHABLE_KEY = '';
  env.ALLOW_TEST_CHECKOUT = 'true';

  child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
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

test.describe('Netting calculator math', () => {
  test.beforeAll(async () => {
    const base = await startServer();
    process.env.BASE_URL = base;
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('area, perimeter, and total price compute correctly', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:5051';

    // Provide deterministic pricing config so the expected total is stable.
    await page.route('**/assets/netting.json', async (route) => {
      const body = {
        defaults: {
          borderSurchargePerFt: 0.5,
          expeditedFee: 25,
          shipPerItem: 100,
          markupPerSqFt: 0.25,
        },
        meshPrices: [
          { id: 'baseball-18', label: '#18', sport: 'baseball', wholesaleSqFt: 0.10 },
        ],
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(base + '/netting-calculator.html');

    await page.locator('#mesh option[value="baseball-18"]').waitFor();
    await page.selectOption('#mesh', 'baseball-18');

    // 10' x 10' => 100 sq ft; perimeter = 40 ft
    await page.fill('#len-ft', '10');
    await page.fill('#len-in', '0');
    await page.fill('#wid-ft', '10');
    await page.fill('#wid-in', '0');

    // Sewn border adds 0.5/ft => 40 * 0.5 = 20
    await page.check('input[name="border"][value="sewn"]');

    // qty = 2
    await page.fill('#qty', '2');

    // Expected:
    // priceSqFt = wholesale (0.10) + markup (0.25) = 0.35
    // base = 100 * 0.35 = 35
    // border = 20
    // perPanel = 55
    // total = 55 * 2 = 110
    await expect(page.locator('#sum-area')).toHaveText('100.0 sq ft');
    await expect(page.locator('#sum-perim')).toHaveText('40.0 ft');

    const totalText = await page.locator('#sum-total').textContent();
    const total = parseMoney(totalText);
    expect(total).toBeCloseTo(110, 2);

    // Mobile mirror should match too.
    const mobileText = await page.locator('#sum-total-mobile').textContent();
    const mobileTotal = parseMoney(mobileText);
    expect(mobileTotal).toBeCloseTo(110, 2);
  });
});
