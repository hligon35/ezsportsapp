# Test Suite

This suite uses Jest + Supertest for API/integration tests and scaffolds an E2E Stripe flow.

Run all tests:

```bash
npm test
```

Run E2E suite with verbose output:

```bash
npm run test:e2e
```

## ✅ Endpoints covered

- GET /health
- GET /api/config
- GET /api/products?limit=1
- POST /api/analytics/track
- POST /api/marketing/subscribe
- POST /api/create-payment-intent (when STRIPE_SECRET_KEY present)

## ⚠️ Keys and integrations

- Stripe: Set STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY (test mode) in .env.test
- Address validation: If ADDRESS_VALIDATION_ENABLED=true
  - google → GOOGLE_MAPS_API_KEY
  - smartystreets → SMARTY_AUTH_ID, SMARTY_AUTH_TOKEN
- Email: Optionally set SENDGRID_API_KEY or SMTP_* to exercise EmailService

Where to obtain:

- Stripe Dashboard → Developers → API Keys
- Google Cloud Console → APIs & Services → Credentials
- SmartyStreets Dashboard → API Keys
- SendGrid Dashboard → Settings → API Keys

## 🔑 .env.test template

See `.env.test` at repository root. Fill in test values as needed; the suite will skip Stripe-specific tests if keys are absent.

## Notes

- Tests spawn the server on PORT=5050 and wait for /health.
- JSON DB is used as-is; for isolation, run `npm --prefix server run db:reset` before tests if required.
