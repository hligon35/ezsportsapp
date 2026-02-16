# EZ Sports Netting — Full Stack Demo Store

This project is a lightweight, stateless-frontend + JSON file–backed API demo for a baseball / sports gear storefront. It now includes:

- Modern, mobile‑first static HTML/CSS/JS (no build pipeline required)
- Express backend with JSON file data layer (`server/database/*.json`)
- Product ingestion + normalization script (imports hundreds of product JSON specs)
- Optional Stripe integration (products/prices + checkout PaymentIntent)
- Dynamic product API with caching, search, category and field projection
- Mini-cart with localStorage persistence & ecommerce analytics event hooks
- Auto product sync on server boot via env flag
- Tax calculation at checkout based on shipping address (state-based, env-overridable)
- Basic SEO (OpenGraph, JSON‑LD: Organization + ItemList) and performance tweaks (preconnect, lazy loading, LCP hint)
- Simple analytics event dispatcher (client) with placeholders for server ingestion

## Key Directories / Files

Frontend (static root):

- `index.html` plus category / marketing pages
- `assets/css/styles.css` (single stylesheet)
- `assets/js/app.js` (UI, catalog fetch, cart, analytics hooks)
- `assets/info/prodInfo/` (raw scraped / source product JSON files by category folder)

Backend (`server/`):

- `server/index.js` Express app (Stripe, API routes, static hosting, auto-sync)
- `server/routes/*.js` modular API routes
- `server/services/*` thin service layer over JSON DB
- `server/database/*.json` persistent collections (products, users, orders, analytics, schema)
- `server/scripts/sync-products.js` product normalization + (optional) Stripe product/price creation

## Product Pipeline

Raw product specs live under `assets/info/prodInfo/<Category>/*.json`. Each file (one product) is normalized via the sync script into `server/database/products.json` with this shape:

```json
{
  "id": "...",
  "name": "...",
  "description": "...",
  "category": "bats",
  "price": 349.99,
  "currency": "usd",
  "image": "https://.../primary.jpg",
  "features": ["..."],
  "meta": { "sourceUrl": "https://..." },
  "isActive": true,
  "featured": false,
  "stock": 12,
  "stripe": { "productId": "prod_XXX", "defaultPriceId": "price_YYY", "currency": "usd" },
  "createdAt": "2025-09-01T00:00:00.000Z",
  "updatedAt": "2025-09-01T00:00:00.000Z"
}
```
 
Missing or removed source files cause previously imported products to be soft‑retired (`isActive:false`).

### Run Sync

From repo root (PowerShell):

```bash
npm run products:sync:dry   # Dry run (no write, no stripe)
npm run products:sync       # Real write (Stripe only if STRIPE_SECRET_KEY present or omit --no-stripe)
```

From `server/` subfolder:

```bash
npm run products:sync
```

Auto sync on server start: set `AUTOSYNC_PRODUCTS=1` (and `AUTOSYNC_STRIPE=1` if you want Stripe product/price creation each boot).

### Category Normalization
 
Folder names are slugified; frontend then maps heuristically to UI filter chips: `bats`, `gloves`, `netting`, `helmets`. Adjust mapping in `fetchProducts()` if you add new verticals.

### Zero‑Price Handling
 
Products with `price <= 0` are filtered out client-side (assumed incomplete). Update their JSON source with a numeric price and re‑sync to surface them.

## Run Locally

Backend server (serves API + static files):

```bash
npm install
npm run dev        # starts Express on default port 4242
```

Visit: <http://localhost:4242/>

(You can still open HTML directly for a purely static preview, but dynamic products & checkout require the server.)

## Database (Dev vs Production)

This project supports two database modes:

- **Dev (default)**: JSON files under `server/database/*.json` (or a custom folder via env)
- **Production**: Cloudflare D1 via a Cloudflare Worker HTTP API

### Dev (JSON DB)

- Default DB path is `server/database/`.
- To keep runtime writes out of git, set a local DB folder:
  - `EZ_DB_PATH=server/database/local`

### Production (Cloudflare D1)

Set the following environment variables on the Node server:

- `EZ_DB_DRIVER=cloudflare`
- `EZ_CF_DB_URL=<Cloudflare Worker URL>`
- `EZ_CF_DB_API_KEY=<shared secret>` (optional, but recommended)

Cloudflare setup docs are in `cloudflare/README.md`.

## Customize


## Stripe Payments (Test Mode)

Environment variables (configure in Render dashboard or a local `.env` for dev):

- STRIPE_PUBLISHABLE_KEY: your Stripe test publishable key (starts with `pk_test_...`).
- STRIPE_SECRET_KEY: your Stripe test secret key (store in .env; do not commit; format similar to `sk_test_...`).
- STRIPE_WEBHOOK_SECRET: the signing secret from the Stripe CLI or Dashboard for your webhook endpoint.

Endpoints:

- `GET /api/config` → `{ pk, enabled }`
- `POST /api/create-payment-intent` → `{ clientSecret, amount }` (amount computed from current product DB; includes shipping logic)
  - Response also includes a `breakdown` with `subtotal`, `shipping`, `discount`, `tax`, and `total`.
- `POST /webhook/stripe` (raw body) for `payment_intent.succeeded` (placeholder logic)

Product/price sync (Stripe): If a product lacks a Stripe Product or matching Price, the sync script creates them (unless `--no-stripe`). Price changes create a new Stripe Price (never mutate old ones).

## Marketing: Subscribers, Newsletters, and Coupons

This project includes a simple marketing system backed by the JSON DB:

- Subscribers: Public signup via footer forms posts to `/api/marketing/subscribe` (no auth). Admins can list subscribers.
- Newsletters: Admins can queue messages to all active subscribers (queued to an "outbox" file for demo—no real provider integration by default).
- Coupons/Promo codes: Admins can create/list/deactivate codes and optionally restrict them to specific emails. Checkout validates/applies codes and Stripe metadata records the code; successful payment consumes the coupon.

Admin UI

- Open `admin.html` → Marketing tab
  - Send Newsletter: Enter Subject + HTML/Text content and click “Queue Newsletter” (emails go to outbox in `server/database/emails.json`).
  - Create Coupon: Choose Type (percent/fixed), Value, optional expiration & max uses, optional restricted emails (comma separated), then Create.
  - Coupons: Lists all, with a Deactivate action.
  - Subscribers: Lists active subscribers.

API Endpoints

- Public
  - `POST /api/marketing/subscribe` → `{ email, name? }` → adds/updates subscriber
  - `POST /api/marketing/unsubscribe` → `{ email }` → marks subscriber inactive
  - `POST /api/marketing/validate-coupon` → `{ code, email? }` → `{ valid, reason?, coupon? }`
- Admin (require admin auth)
  - `GET /api/marketing/admin/subscribers?activeOnly=true`
  - `GET /api/marketing/admin/coupons`
  - `POST /api/marketing/admin/coupons` → `{ code, type: 'percent'|'fixed', value, expiresAt?, maxUses?, userEmails?[] }`
  - `POST /api/marketing/admin/coupons/:code/deactivate`
  - `POST /api/marketing/admin/newsletter` → `{ subject, html, text? }` queues emails for all active subscribers

Checkout + Coupons

- Checkout page has a Promo Code input. Clicking Apply validates via `/api/marketing/validate-coupon`.
- The server’s `POST /api/create-payment-intent` accepts `couponCode` and applies discount server-side to the PaymentIntent `amount`; it also sets metadata `coupon_code`.
- Stripe webhook (`/webhook/stripe`) consumes the coupon on `payment_intent.succeeded`.

Quick test

1) Add a product to the cart and go to Checkout.
2) Admin → Marketing → Create Coupon (e.g., code `SAVE10`, type `percent`, value `10`).
3) Back in Checkout, enter `SAVE10` and Apply. You should see a Discount row and reduced Total.
4) With Stripe keys configured, complete a test payment; the coupon will be marked as used on success (webhook).

## Taxes

Checkout computes sales tax server-side using a simple, efficient state-based rate map keyed by the shipping address:

- Default: United States → Georgia (GA) at 7%.
- Taxable base: subtotal + shipping − discount (never negative). Tax is rounded to the nearest cent.
- The server is authoritative and returns a breakdown with tax; the client mirrors this for responsive UX and test mode.

Environment overrides:

```env
# Provide a JSON object mapping countries → states → decimal rates
TAX_RATES_JSON={"US": {"GA": 0.07, "FL": 0.06, "TX": 0.0825}}

# Or a simple CSV for US states (country assumed US)
TAX_RATES=GA:0.07,FL:0.06,TX:0.0825
```

Notes

- If no rate is found for the destination state, tax is 0.
- The checkout UI hides the Tax row when tax equals 0 and displays "Free" when shipping is $0.00.
- Extend the rate map by setting the env vars without code changes.

## Analytics Events

Client emits (via `window.trackEvent`):
 
- `view_item_list`, `view_item`, `add_to_cart`, `view_cart`, `begin_checkout`, `purchase`
Events are now persisted server-side (best-effort) via:

- `POST /api/analytics/track` (pageviews)
- `POST /api/analytics/event` (clicks + ecommerce events)

The client also reports runtime errors to:

- `POST /api/errors/report`

## Error Alerts + Daily Email Reports

This repo includes email-based monitoring:

- **Instant error alerts** for server 5xx errors, unhandled rejections/exceptions, and client-reported runtime errors.
- **Daily visitor activity report** emailed to a configured address (pageviews, unique visitors, tracked clicks, carts/checkout/purchase events, paid orders + revenue).

### Configure Email Sending

The server will use the first available email transport:

1) SendGrid HTTP API (`SENDGRID_API_KEY`, `SENDGRID_FROM`)
2) SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`)
3) Cloudflare Worker (MailChannels) (`CF_EMAIL_WEBHOOK_URL`, optional `CF_EMAIL_API_KEY`)

### Monitoring Env Vars

Set these in Render (or local `server/.env`):

- `ALERT_EMAIL_ENABLED=true` (default)
- `ALERT_EMAIL_TO=hligon@getsparqd.com` (recipient for alerts + daily reports)
- `ALERT_DEDUPE_MINUTES=10` (prevents duplicate alert spam)
- `ERROR_REPORT_RATE_LIMIT_PER_MIN=30` (client error report rate limit)

### Daily Report Scheduling

- `DAILY_REPORT_ENABLED=true` to turn it on

Timezone-aware (recommended):

- `DAILY_REPORT_TZ=America/Indiana/Indianapolis`
- `DAILY_REPORT_TIME_LOCAL=07:00` (HH:MM in that timezone)

Fallback (UTC-based):

- `DAILY_REPORT_TIME_UTC=09:00` (HH:MM, UTC)

Manual send (admin-only):

- `POST /api/admin/reports/daily/send` with JSON `{ "day": "yesterday" }` or `{ "day": "YYYY-MM-DD" }`

## Checkout Flow (Simplified)

 
 
 
1. User adds items → cart persisted in localStorage.
2. On checkout page you POST items to `/api/create-payment-intent`.
3. Stripe Elements (future) confirms the PaymentIntent.
4. After successful confirmation call `Store.completePurchase(orderData)` to emit `purchase` analytics.

## Admin Products + Storefront Coordination

Admin Panel (`admin.html`)

- Products are managed via `/api/products` (requires admin login). The UI falls back to localStorage if the API is offline, so you can still draft items.
- On load, the admin fetches the live list and saves a lightweight copy in `localStorage.adminProducts` for storefront fallback.
- Add/Update/Delete first try the API, then gracefully fall back to local storage if the network fails.

 
Storefront behavior (`assets/js/app.js`)

- Catalog fetch tries `/api/products` first.
- If the API is empty/unavailable, it falls back to `localStorage.shopProducts` or `localStorage.adminProducts` so products still render.
- Category pages that use `assets/prodList.json` continue to render curated items, then append any admin‑managed products that match the page category.

 
Stripe‑linked Orders

- On `/api/create-payment-intent`, the server creates a local order first and returns `orderId` alongside `clientSecret`.
- Stripe webhook marks that order as `paid` on `payment_intent.succeeded`, keeping sales data and analytics in sync automatically.

### Quick Test (Dev)

1) Start server locally and log in as admin.
2) Go to Admin → add a product (Bats or Netting). Confirm it appears in the list.
3) Open the homepage and category pages; you should see products. Kill the server and refresh — admin products still render via local fallback.
4) Checkout:
 Without Stripe keys → test mode: order is still recorded via `/api/order` and confirmation page loads.
 With Stripe keys and webhook secret set → complete a test card payment; webhook should mark the order `paid`.

## Environment Variables Summary

```env
PORT=4242
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=<your-test-secret-key>
STRIPE_WEBHOOK_SECRET=whsec_xxx   # optional
AUTOSYNC_PRODUCTS=1               # optional auto product ingestion
AUTOSYNC_STRIPE=1                 # also create/update Stripe products/prices
CORS_ORIGINS=http://localhost:4242,http://127.0.0.1:4242  # optional allowlist
```

### Payments and Email: production tips

Stripe (Live)

- STRIPE_PUBLISHABLE_KEY=pk_live_… (set via host env, do not commit)
- STRIPE_SECRET_KEY=sk_live_… (set via host env, do not commit)
- STRIPE_WEBHOOK_SECRET=whsec_… (Dashboard → Webhooks → your Render URL)
- STRIPE_TAX_AUTOMATIC=1 to enable Stripe automatic tax when available; server will fall back to manual state-based tax otherwise.

Email sender

- SENDGRID_API_KEY=… (if using SendGrid)
- SENDGRID_FROM=<your-verified-sender@example> (must be a verified sender or domain in SendGrid)
- MAIL_FROM_NAME=EZ Sports Netting (optional friendly display name)

Notes:

- The email service prefers a verified SENDGRID_FROM and classifies 550 Sender Identity errors as permanent to avoid retries. Ensure you’ve verified the from address or domain in SendGrid to enable delivery.
- If not using SendGrid, configure SMTP_* variables (see comments in server/services/EmailService.js). The same MAIL_FROM_NAME will be applied across providers.

## Quality / Edge Cases

- Price cache TTL: 60s (server) – immediate heavy change requires waiting or code invalidation.
- Zero priced items hidden client-side.
- Missing image fallback: logo placeholder; consider adding better placeholders & width/height for CLS.
- Sync soft‑retires removed products (kept for historical references / potential orders).

## Roadmap Ideas

- Persist analytics events server-side & expose dashboard
- Product detail page for richer SEO (Product JSON-LD)
- Inventory management & low-stock alerts
- Variant / size / color pricing differentiation
- Tax calculation & shipping zones (currently flat/free threshold)

## Netting Calculator Pricing Configuration

The Custom Netting Calculator sources its pricing from `assets/netting.json`.

- Each `meshPrices` entry defines a `wholesaleSqFt` value (your base cost) and metadata (`id`, `label`, `sport`).
- Display/checkout price per square foot (MAP) is computed at runtime as `wholesaleSqFt + markupPerSqFt`.
- Global defaults live under `defaults`:
  - `markupPerSqFt` (default 0.25)
  - `borderSurchargePerFt` (default 0.35)
  - `expeditedFee` (default 25)
  - `shipPerItem` (default 100)

To change calculator pricing, edit `assets/netting.json` and refresh the page. No code changes are required, and the order flow will carry the explicit per‑item shipping amount through to the server.

## Contributing

Open a PR or file an issue. Keep changes minimal & focused; run the product sync script if you add or restructure product JSON sources.

## License

MIT — use freely for your projects.

## Production Runbook

This section captures the exact steps to take this app to production on Render with Stripe webhooks and Cloudflare traffic metrics.

### 1) Configure environment variables (Render dashboard)

Required

- NODE_ENV=production
- TRUST_PROXY=1
- STRIPE_PUBLISHABLE_KEY=pk_live_xxx
- STRIPE_SECRET_KEY=\<your-live-secret-key\>
- STRIPE_WEBHOOK_SECRET=whsec_xxx (from Stripe Dashboard webhook endpoint for your Render URL)
- JWT_SECRET=long-random-secret
- COOKIE_SECURE=true
- COOKIE_SAMESITE=None
- COOKIE_DOMAIN=.your-domain.com

Recommended

- CORS_ORIGINS=`https://your-domain.com`,`https://admin.your-domain.com`
- CLOUDFLARE_API_TOKEN=… (Analytics Read for your zone)
- CLOUDFLARE_ZONE_ID=…
- AUTOSYNC_PRODUCTS=1 (optional) and AUTOSYNC_STRIPE=1 (optional)

Tip: for local dev, create `server/.env` (gitignored) using `server/EZenvLIVE.TXT` as the reference template; do NOT commit real secrets.

### 2) Webhook setup options

Pick one:

- Production (recommended): In Stripe Dashboard → Developers → Webhooks, create an endpoint pointing to `https://<your-render-domain>/webhook/stripe`. Copy the Signing secret (whsec_…) into Render `STRIPE_WEBHOOK_SECRET`.
- Local dev (Stripe CLI): Forward cloud events to your local server.

PowerShell (Windows) — local dev flow


```powershell
# In one terminal: start the server
npm --prefix server install
npm --prefix server run dev

# In another terminal: login (once)
stripe login

# Start listener and print signing secret (copy whsec_xxx)
stripe listen --forward-to http://127.0.0.1:4242/webhook/stripe --print-secret

```

Paste the printed `whsec_…` into `server/.env` as `STRIPE_WEBHOOK_SECRET`, then restart the server.

Troubleshooting (Windows)

- If the fully-qualified path fails with exit code 1, try the `stripe` shim (as above) or run with a device label:

```powershell
stripe listen --forward-to http://127.0.0.1:4242/webhook/stripe --print-secret --device-name "Harold-PC"
```

- Use 127.0.0.1 instead of localhost to avoid IPv6 binding quirks.
- Add debug logging to see why it exits:

```powershell
stripe listen --forward-to http://127.0.0.1:4242/webhook/stripe --print-secret --log-level debug
```

- Firewalls/antivirus can block the local port the CLI uses internally; temporarily allowlist Stripe CLI.
- As a production alternative, skip CLI entirely and use the Dashboard endpoint (recommended in prod).

### 3) Smoke tests

With the server running and keys configured:

1. Add an item to cart and open `checkout.html`.
2. Create PaymentIntent by filling the form (it happens automatically on change). Totals should match the server’s breakdown.
3. Pay with a test card (4242 4242 4242 4242) and valid future expiry.
4. On success:

- Order is created locally and marked `paid` via webhook (`/webhook/stripe`).
- Admin → Finance shows recent totals; Orders show Stripe `fees` / `net` when retrievable.

Optional webhook triggers (dev):

```powershell
stripe trigger payment_intent.succeeded
stripe trigger charge.refunded
stripe trigger charge.dispute.created
stripe trigger payout.paid
```

### 4) Operational notes

- Webhook robustness: the server verifies signatures when `STRIPE_WEBHOOK_SECRET` is set and handles idempotent updates.
- Shipping calculation: sums per-line DSR when available from catalog; flat/free fallback otherwise.
- Security: helmet headers, rate-limiters on sensitive routes, CORS allowlist, `trust proxy` enabled for proper IP/cookies behind Render.
- Backups: JSON DB can be backed up with `npm --prefix server run db:backup`.
