const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const waitOn = require('wait-on');

let child;

function parseSqFt(text) {
  // Example: "~5,600 sq ft" -> 5600
  const m = String(text || '').match(/~?\s*([0-9][0-9,]*)\s*sq\s*ft/i);
  if (!m) return NaN;
  return Number(m[1].replace(/,/g, ''));
}

async function startServer() {
  const envPath = path.join(__dirname, '..', '..', '.env.test');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
  const env = {
    ...process.env,
    PORT: process.env.PLAYWRIGHT_PORT || '5052',
    NODE_ENV: 'test',
  };

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

test.describe('Training facility configurator math', () => {
  test.beforeAll(async () => {
    const base = await startServer();
    process.env.BASE_URL = base;
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test('default sqft matches length/width/height + coverage', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:5052';
    await page.goto(base + '/training-facility-design.html');

    const estimate = page.locator('#facility-estimate');
    await expect(estimate).toContainText('sq ft');

    // Defaults in HTML: L=60, W=40, H=16, coverage=full
    // perimeter = 2*(60+40)=200
    // walls = 200*16=3200
    // ceiling = 60*40=2400
    // total = 5600
    const txt = await estimate.textContent();
    const sqft = parseSqFt(txt);
    expect(sqft).toBe(5600);

    // Message box should mirror the same computed areas
    const msg = await page.locator('#facility-message').inputValue();
    expect(msg).toMatch(/Estimated netting area:\s+5,600\s+sq ft/i);
    expect(msg).toMatch(/- Walls:\s+3,200\s+sq ft/i);
    expect(msg).toMatch(/- Ceiling:\s+2,400\s+sq ft/i);
  });

  test('dividers + impact percent adjust total sqft correctly', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:5052';
    await page.goto(base + '/training-facility-design.html');

    // Set 2 dividers and 50% impact coverage
    await page.fill('#facility-dividers', '2');
    await page.fill('#facility-impact', '50');

    const estimate = page.locator('#facility-estimate');
    await expect(estimate).toContainText('sq ft');

    // divider area each = width*height = 40*16=640; 2 => 1280
    // impact area = wallArea*0.5 = 3200*0.5 = 1600
    // base (full) = 5600
    // total = 5600 + 1280 + 1600 = 8480
    const txt = await estimate.textContent();
    const sqft = parseSqFt(txt);
    expect(sqft).toBe(8480);

    const msg = await page.locator('#facility-message').inputValue();
    expect(msg).toMatch(/Estimated netting area:\s+8,480\s+sq ft/i);
    expect(msg).toMatch(/- Dividers:\s+1,280\s+sq ft\s+\(2 divider\(s\)\)/i);
    expect(msg).toMatch(/- Impact panels:\s+1,600\s+sq ft\s+\(50%\)/i);
  });
});
