# EZ Sports Netting — Full Stack Demo Store

This project is a lightweight, stateless-frontend + JSON file–backed API demo for a baseball / sports gear storefront. It now includes:

- Modern, mobile‑first static HTML/CSS/JS (no build pipeline required)
- Express backend with JSON file data layer (`server/database/*.json`)
- Product ingestion + normalization script (imports hundreds of product JSON specs)
- Optional Stripe integration (products/prices + checkout PaymentIntent)
- Dynamic product API with caching, search, category and field projection
- Mini-cart with localStorage persistence & ecommerce analytics event hooks
- Auto product sync on server boot via env flag
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
Visit: http://localhost:4242/

(You can still open HTML directly for a purely static preview, but dynamic products & checkout require the server.)

## Customize


## Stripe Payments (Test Mode)

Environment variables (configure in Render dashboard or a local `.env` for dev):

- STRIPE_PUBLISHABLE_KEY: your Stripe test publishable key (starts with `pk_test_...`).
- STRIPE_SECRET_KEY: your Stripe test secret key (starts with `sk_test_...`).
- STRIPE_WEBHOOK_SECRET: the signing secret from the Stripe CLI or Dashboard for your webhook endpoint.

Endpoints:
- `GET /api/config` → `{ pk, enabled }`
- `POST /api/create-payment-intent` → `{ clientSecret, amount }` (amount computed from current product DB; includes shipping logic)
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

## Analytics Events
Client emits (console by default via `window.trackEvent`):
- `view_item_list`, `view_item`, `add_to_cart`, `view_cart`, `begin_checkout`, `purchase`
Extend by wiring `trackEvent` to POST `/api/analytics/event` (already scaffolded). Server has placeholder services for future persistence.

## Checkout Flow (Simplified)
1. User adds items → cart persisted in localStorage.
2. On checkout page you POST items to `/api/create-payment-intent`.
3. Stripe Elements (future) confirms the PaymentIntent.
4. After successful confirmation call `Store.completePurchase(orderData)` to emit `purchase` analytics.

## Admin Products + Storefront Coordination

- Admin Panel (`admin.html`)
	- Products are managed via `/api/products` (requires admin login). The UI falls back to localStorage if the API is offline, so you can still draft items.
	- On load, the admin fetches the live list and saves a lightweight copy in `localStorage.adminProducts` for storefront fallback.
	- Add/Update/Delete first try the API, then gracefully fall back to local storage if the network fails.

- Storefront behavior (`assets/js/app.js`)
	- Catalog fetch tries `/api/products` first.
	- If the API is empty/unavailable, it falls back to `localStorage.shopProducts` or `localStorage.adminProducts` so products still render.
	- Category pages that use `assets/prodList.json` continue to render curated items, then append any admin‑managed products that match the page category.

- Stripe‑linked Orders
	- On `/api/create-payment-intent`, the server creates a local order first and returns `orderId` alongside `clientSecret`.
	- Stripe webhook marks that order as `paid` on `payment_intent.succeeded`, keeping sales data and analytics in sync automatically.

### Quick Test (Dev)

1) Start server locally and log in as admin.
2) Go to Admin → add a product (Bats or Netting). Confirm it appears in the list.
3) Open the homepage and category pages; you should see products. Kill the server and refresh — admin products still render via local fallback.
4) Checkout:
	 - Without Stripe keys → test mode: order is still recorded via `/api/order` and confirmation page loads.
	 - With Stripe keys and webhook secret set → complete a test card payment; webhook should mark the order `paid`.

## Environment Variables Summary
```env
PORT=4242
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx   # optional
AUTOSYNC_PRODUCTS=1               # optional auto product ingestion
AUTOSYNC_STRIPE=1                 # also create/update Stripe products/prices
CORS_ORIGINS=http://localhost:4242,http://127.0.0.1:4242  # optional allowlist
```

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

## Contributing
Open a PR or file an issue. Keep changes minimal & focused; run the product sync script if you add or restructure product JSON sources.

## License

MIT — use freely for your projects.
