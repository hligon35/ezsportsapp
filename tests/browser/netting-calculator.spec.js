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

    // Provide deterministic CSV pricing so the expected total is stable.
    await page.route('**/assets/product-pricing-weights.csv', async (route) => {
      const csv = [
        'Column 1,Retail,Wholesale,Weight',
        '"#18",0.35,0.10,0.01',
        'Rope,0.25,0.25,0.02',
        '"Sewn Rope",0.5,0.5,0.02',
        '"No Border",0,0,0',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    });

    await page.route('**/assets/border-pricing-multipliers.csv', async (route) => {
      const csv = [
        'Border Item,Standard Cost Multiplier,Override/Final Multiplier',
        'Rope,0.25,',
        '"Sewn Rope",0.5,',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    });

    // netting.json is still loaded for shipping defaults; keep it deterministic.
    await page.route('**/assets/netting.json', async (route) => {
      const body = { defaults: { shipPerItem: 100 } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(base + '/netting-calculator.html');

    // Creator forms are now hidden behind <details> dropdowns.
    await page.locator('details.creator-block >> text=Netting Panel Creator').first().click();

    await page.locator('#mesh option[value="#18"]').waitFor({ state: 'attached' });
    await page.selectOption('#mesh', '#18');

    // 10' x 10' => 100 sq ft; perimeter = 40 ft
    await page.fill('#len-ft', '10');
    await page.fill('#wid-ft', '10');

    // Sewn border adds 0.5/ft => 40 * 0.5 = 20
    await page.selectOption('#border', 'sewn');

    // qty = 2
    await page.fill('#qty', '2');

    // Expected:
    // retail_price_per_unit (#18) = 0.35
    // base = 100 * 0.35 = 35
    // sewn border base_cost = 0.5/ft => 40 * 0.5 = 20
    // perPanel = 55
    // total = 55 * 2 = 110
    await expect(page.locator('#sum-area')).toHaveText('100.0 sq ft');
    await expect(page.locator('#sum-perim')).toHaveText('40.0 ft');

    const totalText = await page.locator('#sum-total').textContent();
    const total = parseMoney(totalText);
    expect(total).toBeCloseTo(110, 2);
  });

  test('batting cage total includes $50 per door', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:5051';

    // Provide deterministic CSV pricing so the expected total is stable.
    await page.route('**/assets/product-pricing-weights.csv', async (route) => {
      const csv = [
        'Column 1,Retail,Wholesale,Weight',
        '"#18",0.35,0.10,0.01',
        'Rope,0.25,0.25,0.02',
        '"Sewn Rope",0.5,0.5,0.02',
        '"No Border",0,0,0',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    });

    await page.route('**/assets/border-pricing-multipliers.csv', async (route) => {
      const csv = [
        'Border Item,Standard Cost Multiplier,Override/Final Multiplier',
        'Rope,0.25,',
        '"Sewn Rope",0.5,',
      ].join('\n');
      await route.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    });

    await page.route('**/assets/netting.json', async (route) => {
      const body = { defaults: { shipPerItem: 100 } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(base + '/netting-calculator.html');

    // Open cage creator
    await page.locator('details.creator-block >> text=Batting Cage Creator').first().click();

    await page.locator('#cage-mesh option[value="#18"]').waitFor({ state: 'attached' });
    await page.selectOption('#cage-mesh', '#18');

    // Choose dimensions so math is clean:
    // W=10, H=10, L=10 => tubePerimeter=2*(W+H)=40
    // area = tubePerimeter*L = 400 sq ft
    // borderLinearFt = 2*tubePerimeter = 80 ft
    await page.fill('#cage-wid-ft', '10');
    await page.fill('#cage-hgt-ft', '10');
    await page.fill('#cage-len-ft', '10');

    // Sewn border 0.5/ft => 80*0.5 = 40
    await page.selectOption('#cage-border', 'sewn');

    // doors = 2 => 100
    await page.fill('#cage-doors', '2');

    // qty = 1
    await page.fill('#cage-qty', '1');

    // Expected:
    // base = 400 * 0.35 = 140
    // border = 40
    // doors = 100
    // total = 280
    await expect(page.locator('#cage-sum-area')).toHaveText('400.0 sq ft');
    await expect(page.locator('#cage-sum-perim')).toHaveText('80.0 ft');

    const totalText = await page.locator('#cage-sum-total').textContent();
    const total = parseMoney(totalText);
    expect(total).toBeCloseTo(280, 2);
  });
});
