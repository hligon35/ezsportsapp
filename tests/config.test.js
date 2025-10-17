const fs = require('fs');

function expectEnv(name) {
  const v = process.env[name];
  expect(v === undefined || v === null || v === '').toBe(false);
}

describe('Environment keys are loaded from process.env (not hardcoded)', () => {
  test('Stripe keys present when running E2E', () => {
    if (process.env.E2E_STRIPE_REQUIRED === 'true') {
      expectEnv('STRIPE_PUBLISHABLE_KEY');
      expectEnv('STRIPE_SECRET_KEY');
    }
  });

  test('Google Maps and Tax provider keys are env-based when enabled', () => {
    if ((process.env.ADDRESS_VALIDATION_ENABLED || '').toLowerCase() === 'true') {
      const provider = (process.env.ADDRESS_VALIDATION_PROVIDER || 'none').toLowerCase();
      if (provider === 'google') expectEnv('GOOGLE_MAPS_API_KEY');
      if (provider === 'smartystreets') { expectEnv('SMARTY_AUTH_ID'); expectEnv('SMARTY_AUTH_TOKEN'); }
    }
  });

  test('Email provider keys use env', () => {
    if (process.env.E2E_EMAIL_REQUIRED === 'true') {
      // One of SendGrid API key or SMTP creds
      const hasSendGrid = !!process.env.SENDGRID_API_KEY;
      const hasSMTP = !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
      expect(hasSendGrid || hasSMTP).toBe(true);
    }
  });
});
