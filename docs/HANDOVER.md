# EZ Sports App — Production Readiness Handover

Date: 2025-10-17
Branch: v1.1 (default: main)

This document summarizes what is implemented, what was added in this review, and what remains for production readiness across performance, security, e‑commerce essentials, QA, and deployment.

## ✅ Completed in code

- Security headers, CORS, compression, logging
  - `server/index.js` — Helmet, compression, CORS, morgan (lines ~30–70)
- Rate limiting for API groups; tighter auth/marketing limits
  - `server/index.js` — Lines ~73–103 and ~108–118
- Stripe webhook with raw body verification and order/payment updates
  - `server/index.js` — Lines ~120–228
- Pricing, shipping, tax calculation server-side with fallback dataset
  - `server/index.js` — Lines ~285–423
- Stripe payment intent creation with idempotency key and input validation
  - `server/index.js` — Lines ~451–538 (added)
- Block static access to sensitive folders
  - `server/index.js` — Lines ~642–650 (added)
- HTTPS hardening (optional redirect + HSTS when behind proxy)
  - `server/index.js` — Lines ~56–69 and ~88–91 (added)
- Safer Google Maps key exposure (origin-gated)
  - `server/index.js` — Lines ~35–48 (added)
- Optional Sentry monitoring hooks (request/tracing/error)
  - `server/index.js` — initialization near top and request handler (lines ~14–31, ~60–70)
  - Controlled by env: `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`
- Address validation scaffolding (Google or SmartyStreets)
  - `server/services/AddressService.js` — new file
  - Integrated in checkout flow to normalize/validate shipping (see `server/index.js` near create-payment-intent)
- Admin-protected routes for orders, products, analytics, inventory
  - `server/routes/*.js` — Various `requireAdmin` enforced
- JWT-based auth with cookie configuration and refresh/logout
  - `server/middleware/auth.js` — Full implementation
- Email sending with Cloudflare Worker and SMTP fallback + audit log
  - `server/services/EmailService.js`
- Coupons: create/validate/consume and discount application
  - `server/services/CouponService.js`, used in checkout flow
- PWA assets (service worker + manifest) with cache strategy
  - `service-worker.js`, `manifest.webmanifest`
- Environment templates for secrets and configs
  - `server/EZenvLIVE.TXT` — Canonical reference template (do not commit secrets)
- QA smoke test script
  - `server/scripts/smoke-test.js` — Created

## ⚠️ Missing or optional items (with exact snippets)

- Content Security Policy (CSP) tightened (currently disabled to avoid breaking inline scripts). When ready to refactor inline code/styles, enable Helmet CSP:
  - Edit `server/index.js` near Helmet setup:
    - Replace the current Helmet call with a stricter CSP:
      
      // In server/index.js (replace existing helmet call)
      app.use(helmet({
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            "script-src": ["'self'", "https://js.stripe.com"],
            "frame-src": ["'self'", "https://js.stripe.com"],
            "img-src": ["'self'", "data:", "blob:"],
            "connect-src": ["'self'"],
            "upgrade-insecure-requests": null
          }
        }
      }));

- CI/CD workflow for lint/build/test (optional)
  - Not added by default (no tests yet). Suggested `.github/workflows/ci.yml` with Node 18, install, and `npm --prefix server run start` smoke.

- Stripe webhook endpoint secret
  - Add to environment: `STRIPE_WEBHOOK_SECRET=whsec_xxx` (Stripe Dashboard → Developers → Webhooks)
  - Render Dashboard or `.env` file.

- Admin auth seeding for operations
  - Ensure an admin account exists or set `JWT_SECRET` and login via `/api/users/register` and set `isAdmin` in DB, or seed via `server/seed.js`.

- Automated backups for JSON DB
  - Cron or platform task to run `npm --prefix server run db:backup`
  - Backups saved under `server/database/backups/<timestamp>`

- End-to-end tests (Playwright/Cypress) for checkout flow
  - Not included. Suggest adding a test suite exercising cart, coupon, PI creation, and success redirect.

## 🔑 Fill-in-the-blank secrets and configs

- Stripe
  - STRIPE_PUBLISHABLE_KEY: Stripe Dashboard → Developers → API Keys → Publishable key
  - STRIPE_SECRET_KEY: Stripe Dashboard → Developers → API Keys → Secret key
  - STRIPE_WEBHOOK_SECRET: Stripe Dashboard → Developers → Webhooks → Your endpoint → Signing secret
- JWT secret
  - JWT_SECRET: Generate a 32+ char random string. Store in Render → Environment or `.env`.
- Email
  - SENDGRID_API_KEY: SendGrid Dashboard → Settings → API Keys
  - or SMTP_*: Your SMTP provider credentials
- Cloudflare Analytics (optional)
  - CLOUDFLARE_API_TOKEN: Cloudflare Dashboard → My Profile → API Tokens (Analytics Read)
  - CLOUDFLARE_ZONE_ID: Cloudflare Dashboard → Websites → your site → Overview
- Google Maps (optional autocomplete)
  - GOOGLE_MAPS_API_KEY: Google Cloud Console → APIs & Services → Credentials → API Keys; enable Places API
- Address validation (optional)
  - ADDRESS_VALIDATION_ENABLED=true
  - ADDRESS_VALIDATION_PROVIDER=smartystreets or google
  - For SmartyStreets: SMARTY_AUTH_ID, SMARTY_AUTH_TOKEN (<https://www.smarty.com/>)
  - For Google Address Validation API: Use GOOGLE_MAPS_API_KEY with Address Validation API enabled
- Monitoring (optional)
  - SENTRY_DSN: Sentry project DSN (Settings → Projects → your project → Client Keys)
  - SENTRY_TRACES_SAMPLE_RATE: 0.0–1.0 (e.g., 0.1)
- CORS allowlist
  - CORS_ORIGINS: Comma-separated origins for your frontends

## 📍 Where to retrieve values

- Stripe Dashboard → <https://dashboard.stripe.com> → Developers
- Render Dashboard → Your Service → Environment
- SendGrid Dashboard → <https://app.sendgrid.com> → Settings → API Keys
- Cloudflare Dashboard → <https://dash.cloudflare.com> → Profile and Zone settings
- Google Cloud Console → <https://console.cloud.google.com> → APIs & Services

## QA and Monitoring

- Smoke test
  - Run: `node server/scripts/smoke-test.js http://localhost:4242`
  - Exits 0 on success
- Logs
  - Server uses morgan("tiny") and prints warnings for asset 404s and webhook handling.
- Rate limits
  - General: 300 requests/15m per IP on core APIs in production.
  - Tight: 20 requests/min on `/api/users/login|register` and `/api/marketing/*` in production.

## Deployment notes

- Render blueprint `render.yaml` is present. Ensure env vars are set before deployment (see `server/EZenvLIVE.TXT`).
- Enable `FORCE_HTTPS=true` and `TRUST_PROXY=1` in production for secure cookies and HSTS.
- Configure Stripe webhook to point to `https://<your-host>/webhook/stripe` with the signing secret.
- If enabling address validation, ensure corresponding API is enabled and keys are present.

## Handover checklist template

- Security
  - [ ] JWT_SECRET set in environment
  - [ ] FORCE_HTTPS enabled in production
  - [ ] CORS_ORIGINS set to production origins
  - [ ] CSP enabled and inline scripts/styles refactored
- Performance
  - [x] compression enabled
  - [x] cache headers for static assets
  - [x] service worker configured
  - [ ] CDN cache review (Cloudflare page rules, image optimization if desired)
- E‑commerce
  - [x] Stripe PI creation with idempotency
  - [x] Webhook handling for payment/refund/dispute
  - [x] Taxes and shipping computed server-side
  - [x] Coupons integrated
  - [ ] Address validation enabled and tested (if desired)
- QA
  - [x] Smoke test available
  - [ ] E2E tests added
- Deployment
  - [x] render.yaml present
  - [ ] Webhook configured in Stripe
  - [ ] Env vars populated in Render
  - [ ] Sentry DSN configured (optional)
