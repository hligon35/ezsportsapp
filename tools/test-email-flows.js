/*
  Integration-style email flow test runner.

  What it triggers:
  - Contact form (ack + internal)
  - Newsletter subscribe (welcome + internal)
  - Test order creation + Stripe webhook simulation (customer receipt + internal)
  - Daily + Weekly payout report emails
  - Daily Activity report email
  - Password reset email
  - Error alert email
  - Newsletter sample email
  - (Legacy daily finance report removed; payout reports are the finance reports now)

  Safe defaults:
  - Designed to run with CF_EMAIL_WEBHOOK_URL unset/empty so emails are queued, not delivered.

  Usage:
  - Start server (recommended):
      powershell> $env:CF_EMAIL_WEBHOOK_URL=''; $env:STRIPE_WEBHOOK_SECRET=''; $env:TURNSTILE_BYPASS='true'; $env:ALERT_EMAIL_ENABLED='true'; $env:EZ_DB_PATH=''; Push-Location server; node index.js
  - Then run:
      node tools/test-email-flows.js
*/

const DatabaseManager = require('../server/database/DatabaseManager');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getFetch() {
  if (typeof fetch === 'function') return fetch;
  try {
    // eslint-disable-next-line global-require
    return require('undici').fetch;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'email';
}

function writePreviews(emails, dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  for (const e of emails || []) {
    try {
      const base = `${String(e.id || '').padStart(4, '0')}-${safeName(e.subject)}-${safeName(e.to)}`;
      const html = e.html ? String(e.html) : '';
      const text = e.text ? String(e.text) : '';
      if (html) fs.writeFileSync(path.join(dir, `${base}.html`), html, 'utf8');
      if (text) fs.writeFileSync(path.join(dir, `${base}.txt`), text, 'utf8');
    } catch {
      // ignore
    }
  }
}

function hasAllTags(email, requiredTags) {
  const tags = Array.isArray(email?.tags) ? email.tags : [];
  return requiredTags.every((t) => tags.includes(t));
}

function writeOneOfEachPreviews(emails, dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const list = Array.isArray(emails) ? emails.slice() : [];

  // Predicates are ordered; first match wins.
  const types = [
    { key: 'subscribe-internal', match: (e) => hasAllTags(e, ['subscribe', 'internal']) },
    { key: 'subscribe-welcome', match: (e) => hasAllTags(e, ['subscribe', 'welcome']) },
    { key: 'contact-ack', match: (e) => hasAllTags(e, ['contact', 'ack']) },
    { key: 'contact-internal', match: (e) => Array.isArray(e?.tags) && e.tags.includes('contact') && !hasAllTags(e, ['contact', 'ack']) },
    { key: 'password-reset', match: (e) => hasAllTags(e, ['password-reset']) },
    { key: 'order-receipt-customer', match: (e) => hasAllTags(e, ['order', 'paid', 'customer']) },
    { key: 'order-paid-internal', match: (e) => hasAllTags(e, ['order', 'paid', 'internal']) },
    { key: 'report-daily-payout', match: (e) => hasAllTags(e, ['report', 'daily', 'payout']) },
    { key: 'report-weekly-payout', match: (e) => hasAllTags(e, ['report', 'weekly', 'payout']) },
    // Daily activity report uses ['report','daily'] only (no payout)
    { key: 'report-daily-activity', match: (e) => hasAllTags(e, ['report', 'daily']) && !(Array.isArray(e?.tags) && e.tags.includes('payout')) },
    { key: 'alert-error', match: (e) => Array.isArray(e?.tags) && e.tags.includes('alert') && e.tags.includes('error') },
    { key: 'newsletter', match: (e) => hasAllTags(e, ['newsletter']) }
  ];

  for (const t of types) {
    const found = list.find(t.match);
    if (!found) continue;
    try {
      const html = found.html ? String(found.html) : '';
      const text = found.text ? String(found.text) : '';
      if (html) fs.writeFileSync(path.join(dir, `${t.key}.html`), html, 'utf8');
      if (text) fs.writeFileSync(path.join(dir, `${t.key}.txt`), text, 'utf8');
    } catch {
      // ignore
    }
  }
}

async function detectBaseUrl() {
  const explicit = String(process.env.EZ_TEST_BASE_URL || '').trim();
  const doFetch = getFetch();
  if (!doFetch) throw new Error('fetch is not available; install/enable undici or upgrade Node');

  async function isHealthy(baseUrl) {
    try {
      const resp = await doFetch(`${baseUrl}/health`, { method: 'GET' });
      return !!resp.ok;
    } catch {
      return false;
    }
  }

  if (explicit) {
    const base = explicit.replace(/\/+$/g, '');
    if (await isHealthy(base)) return base;
    // Keep going if someone has an old port in their env.
    // eslint-disable-next-line no-console
    console.warn(`[test-email-flows] EZ_TEST_BASE_URL not reachable: ${base}; falling back to auto-detect.`);
  }

  const ports = [4242, 4243, 4244, 4245, 4246, 4247];
  for (const port of ports) {
    const base = `http://127.0.0.1:${port}`;
    if (await isHealthy(base)) return base;
  }
  throw new Error('Could not reach server on ports 4242-4247. Start it first.');
}

async function postJson(url, body) {
  const doFetch = getFetch();
  if (!doFetch) throw new Error('fetch is not available');

  const resp = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await resp.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg = data && (data.message || data.error || data.ok === false && data.error) ? (data.message || data.error) : text;
    throw new Error(`POST ${url} failed (${resp.status}): ${msg || 'unknown error'}`);
  }
  return data;
}

async function postRawJson(url, jsonObj) {
  const doFetch = getFetch();
  if (!doFetch) throw new Error('fetch is not available');

  let payload = jsonObj;
  let bodyStr = null;
  if (typeof jsonObj === 'string') {
    bodyStr = jsonObj;
  } else {
    bodyStr = JSON.stringify(jsonObj);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (payload && payload.__stripeSignature) {
    headers['stripe-signature'] = String(payload.__stripeSignature);
    // do not include helper field in request body
    if (typeof payload === 'object' && payload !== null) {
      const { __stripeSignature, ...rest } = payload;
      bodyStr = JSON.stringify(rest);
    }
  }

  const resp = await doFetch(url, {
    method: 'POST',
    headers,
    body: bodyStr
  });
  const text = await resp.text().catch(() => '');
  if (!resp.ok) throw new Error(`POST ${url} failed (${resp.status}): ${text}`);
  return text;
}

function readEnvKeyFromFile(envFilePath, key) {
  try {
    const raw = fs.readFileSync(envFilePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const k = trimmed.slice(0, idx).trim();
      if (k !== key) continue;
      // Keep everything after '=' as-is; strip surrounding quotes if present
      let v = trimmed.slice(idx + 1);
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch {
    // ignore
  }
  return '';
}

function makeStripeSignatureHeader({ payload, secret, timestamp }) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not available; cannot sign webhook');
  const t = Number(timestamp || Math.floor(Date.now() / 1000));
  const signedPayload = `${t}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

function isoDayUTC(d = new Date()) {
  return new Date(d.getTime()).toISOString().slice(0, 10);
}

async function main() {
  const startedAtIso = new Date().toISOString();
  const suffix = `${Date.now()}`;

  // Distinct addresses so we can query outbox easily.
  const contactEmail = `test+contact-${suffix}@example.com`;
  const subscriberEmail = `test+sub-${suffix}@example.com`;
  const customerEmail = `test+order-${suffix}@example.com`;

  const baseUrl = await detectBaseUrl();

  // 1) Subscribe (welcome + internal)
  await postJson(`${baseUrl}/api/marketing/subscribe`, {
    email: subscriberEmail,
    name: 'Email Flow Test',
    source: 'tools/test-email-flows.js',
    referer: baseUrl,
    hp: ''
  });

  // 2) Contact (ack + internal). Internal send depends on Turnstile bypass or success.
  await postJson(`${baseUrl}/api/marketing/contact`, {
    name: 'Email Flow Test',
    email: contactEmail,
    phone: '555-0100',
    subject: 'Email flow test',
    message: `Hello from email flow test at ${new Date().toISOString()}`,
    hp: '',
    // token omitted intentionally; TURNSTILE_BYPASS=true is the clean way to test internal sends
  });

  // Allow marketing route background handlers to queue emails
  await sleep(1200);

  // 2b) Password reset email (queued directly; avoids needing a real user record)
  try {
    // eslint-disable-next-line global-require
    const EmailService = require('../server/services/EmailService');
    // eslint-disable-next-line global-require
    const { renderBrandedEmailHtml, escapeHtml } = require('../server/services/EmailTheme');
    const token = `test-reset-${suffix}`;
    const url = new URL('/reset-password.html', baseUrl);
    url.searchParams.set('token', token);
    const link = url.toString();
    const emailSvc = new EmailService();
    const bodyHtml = `
      <p style="margin:0 0 10px;">We received a request to reset your password.</p>
      <p style="margin:0 0 12px;color:#5a5a5a;line-height:20px;">Click the button below to choose a new password. This link is valid for 1 hour.</p>
      <div style="margin:16px 0 14px;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#241773;color:#ffffff;text-decoration:none;font-weight:800;padding:10px 14px;border-radius:10px;">Reset Password</a>
      </div>
      <div style="margin:12px 0 8px;color:#5a5a5a;font-size:12px;line-height:18px;">If the button doesn’t work, copy and paste this link into your browser:</div>
      <div style="border:1px solid #d3d0d7;border-radius:10px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:12px;line-height:1.45;word-break:break-word;">${escapeHtml(link)}</div>
      <p style="margin:14px 0 0;color:#5a5a5a;line-height:20px;">If you didn’t request a password reset, you can ignore this email.</p>
    `;
    const html = renderBrandedEmailHtml({
      title: 'Reset your password',
      subtitle: 'EZ Sports Netting Account',
      bodyHtml
    });
    await emailSvc.queue({
      to: `test+reset-${suffix}@example.com`,
      subject: 'Reset your EZ Sports Netting password',
      text: `We received a request to reset your password.\n\nReset link (valid for 1 hour): ${link}\n\nIf you didn’t request this, you can ignore this email.`,
      html,
      tags: ['password-reset']
    });
  } catch {
    // ignore
  }

  // 3) Create an order record (does NOT send emails yet)
  const orderResp = await postJson(`${baseUrl}/api/order`, {
    userId: null,
    customer: { email: customerEmail, name: 'Email Flow Test', phone: '555-0101' },
    shipping: {
      name: 'Email Flow Test',
      address1: '123 Test St',
      address2: '',
      city: 'Testville',
      state: 'IN',
      postal: '46201',
      country: 'US',
      phone: '555-0101'
    },
    items: [
      {
        id: 'TEST-SKU-1',
        productId: 'TEST-SKU-1',
        productName: 'Test Item',
        name: 'Test Item',
        category: 'netting',
        price: 10,
        quantity: 1,
        subtotal: 10
      }
    ]
  });

  const orderId = orderResp && orderResp.orderId;
  if (!orderId) throw new Error('Order create did not return an orderId');

  // 4) Simulate Stripe webhook payment_intent.succeeded.
  // IMPORTANT: This requires STRIPE_WEBHOOK_SECRET to be unset/empty on the server so it will accept raw JSON without a signature.
  const webhookEvent = {
    id: `evt_test_${suffix}`,
    object: 'event',
    api_version: '2022-11-15',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_test_${suffix}`,
        object: 'payment_intent',
        amount: 1000,
        currency: 'usd',
        receipt_email: customerEmail,
        charges: { object: 'list', data: [] },
        metadata: {
          order_id: orderId,
          email: customerEmail,
          name: 'Email Flow Test'
        }
      }
    }
  };

  // Sign webhook using the same secret the server is configured with.
  // Prefer explicit env; fallback to reading server/.env.
  let webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    webhookSecret = String(readEnvKeyFromFile(path.join(__dirname, '..', 'server', '.env'), 'STRIPE_WEBHOOK_SECRET') || '').trim();
  }
  const payload = JSON.stringify(webhookEvent);
  const stripeSignature = makeStripeSignatureHeader({ payload, secret: webhookSecret });
  await postRawJson(`${baseUrl}/webhook/stripe`, { ...webhookEvent, __stripeSignature: stripeSignature });

  // Give background queueing a moment (contact route uses setImmediate)
  await sleep(500);

  // 5) Daily + weekly payout reports (queues via AlertingService)
  // These run in-process and write to the same outbox DB.
  // IMPORTANT: Requires ALERT_EMAIL_ENABLED=true to avoid "skipped".
  // eslint-disable-next-line global-require
  const PayoutReportService = require('../server/services/PayoutReportService');
  const prs = new PayoutReportService();
  const today = isoDayUTC(new Date());
  const dailyOut = await prs.sendDailyPayoutReport({ day: today });
  const weeklyOut = await prs.sendWeeklyPayoutReport({ end: new Date() });

  // 5b) Daily Activity report (queues via AlertingService.sendDailyReport)
  // eslint-disable-next-line global-require
  const DailyReportService = require('../server/services/DailyReportService');
  const drs = new DailyReportService();
  const activityOut = await drs.sendDailyActivityReport({ day: today });

  // 5c) Error alert email (queues via AlertingService.sendErrorAlert)
  try {
    // eslint-disable-next-line global-require
    const AlertingService = require('../server/services/AlertingService');
    const alerts = new AlertingService();
    await alerts.sendErrorAlert({
      title: 'EZSports Error (preview)',
      errorRecord: {
        createdAt: new Date().toISOString(),
        source: 'preview',
        message: 'This is a preview error alert for email layout review.',
        name: 'PreviewError',
        stack: 'PreviewError: Example stack trace\n    at tools/test-email-flows.js:1:1',
        path: '/preview',
        url: `${baseUrl}/preview`
      }
    });
  } catch {
    // ignore
  }

  // 5d) Newsletter sample email (queues directly)
  try {
    // eslint-disable-next-line global-require
    const EmailService = require('../server/services/EmailService');
    // eslint-disable-next-line global-require
    const { renderBrandedEmailHtml, escapeHtml } = require('../server/services/EmailTheme');
    const emailSvc = new EmailService();
    const body = `
      <p style="margin:0 0 10px;">Hi there,</p>
      <p style="margin:0 0 12px;color:#5a5a5a;line-height:20px;">This is a sample newsletter email used to preview formatting and spacing.</p>
      <div style="border:1px solid #d3d0d7;border-radius:10px;padding:12px 12px 10px;">
        <div style="font-weight:800;color:#241773;">Featured</div>
        <ul style="margin:8px 0 0;padding-left:18px;">
          <li>${escapeHtml('New netting sizes now available')}</li>
          <li>${escapeHtml('Save 10% on protective screens this week')}</li>
          <li>${escapeHtml('Design help for training facilities')}</li>
        </ul>
      </div>
    `;
    const html = renderBrandedEmailHtml({
      title: 'EZ Sports Netting Newsletter',
      subtitle: 'Preview email',
      bodyHtml: body
    });
    await emailSvc.queue({
      to: `test+newsletter-${suffix}@example.com`,
      subject: 'EZ Sports Netting Newsletter (Preview)',
      html,
      text: 'This is a sample newsletter email used to preview formatting and spacing.',
      tags: ['newsletter']
    });
  } catch {
    // ignore
  }

  // 6) Summarize emails recorded since start
  const db = new DatabaseManager();
  const all = await db.findAll('emails');
  const recent = (all || []).filter((e) => {
    try {
      return e && e.createdAt && e.createdAt >= startedAtIso;
    } catch {
      return false;
    }
  });

  const byStatus = {};
  const byTag = {};
  for (const e of recent) {
    const st = String(e.status || 'unknown');
    byStatus[st] = (byStatus[st] || 0) + 1;
    const tags = Array.isArray(e.tags) ? e.tags : [];
    for (const t of tags) {
      byTag[t] = (byTag[t] || 0) + 1;
    }
  }

  const keyTo = new Set([contactEmail, subscriberEmail, customerEmail]);
  const highlights = recent
    .filter((e) => keyTo.has(String(e.to || '').trim()) || (Array.isArray(e.tags) && e.tags.includes('report')))
    .slice(-20)
    .map((e) => ({
      id: e.id,
      to: e.to,
      subject: e.subject,
      status: e.status,
      tags: e.tags,
      from: e.from,
      replyTo: e.replyTo,
      createdAt: e.createdAt
    }));

  // Export preview files so templates are easy to tweak without digging in DB.
  try {
    const previewDir = path.join(__dirname, 'email-previews');
    writePreviews(recent, previewDir);
    writeOneOfEachPreviews(recent, path.join(previewDir, 'one-of-each'));
  } catch {}

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    startedAtIso,
    inputs: { contactEmail, subscriberEmail, customerEmail, orderId },
    payoutReports: {
      daily: { subject: dailyOut.subject, start: dailyOut.start, end: dailyOut.end, sent: dailyOut.sent },
      weekly: { subject: weeklyOut.subject, start: weeklyOut.start, end: weeklyOut.end, sent: weeklyOut.sent }
    },
    dailyReports: {
      activity: { subject: activityOut.subject, start: activityOut.start, end: activityOut.end, sent: activityOut.sent }
    },
    outbox: {
      recentCount: recent.length,
      byStatus,
      byTag,
      highlights
    }
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
