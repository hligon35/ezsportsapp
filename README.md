# EZ Sports Netting — Ecommerce Template

This is a lightweight, responsive ecommerce front-end template for a baseball gear store. It includes:

- Modern, mobile-first design with a sticky header and hero
- Category tiles and promotional banners
- Product catalog grid with filter chips
- Working mini-cart (add, increment/decrement, remove) with localStorage persistence
- No build step; pure HTML/CSS/JS

## Files

- `index.html` — page structure and components
- `assets/css/styles.css` — styling and responsive rules
- `assets/js/app.js` — mock products, rendering, and cart logic
- `assets/img/` — placeholder assets (logo). Product images load from Unsplash.

## Run locally

Open `index.html` directly in your browser, or start a simple server to avoid CORS issues with modules.

On Windows PowerShell:

```powershell
# Option 1: Use Python if installed
python -m http.server 8080

# Option 2: Node (if you have npx)
npx serve -l 8080
```

Then visit <http://localhost:8080> in your browser and navigate to `EZSports/`.

## Customize


### Stripe payments (test mode)

Environment variables (configure in Vercel project settings or a local `.env` for dev):

- STRIPE_PUBLISHABLE_KEY: your Stripe test publishable key (starts with `pk_test_...`).
- STRIPE_SECRET_KEY: your Stripe test secret key (starts with `sk_test_...`).
- STRIPE_WEBHOOK_SECRET: the signing secret from the Stripe CLI or Dashboard for your webhook endpoint.

Endpoints in this repo:

- `GET /api/config` returns `{ pk, enabled }` for the frontend to initialize Stripe.js.
- `POST /api/create-payment-intent` creates a PaymentIntent and a local order row, returning `{ clientSecret, amount, orderId }`.
- `POST /api/webhook/stripe` handles `payment_intent.succeeded` and marks the order as paid.

To use your test publishable key now, either set `STRIPE_PUBLISHABLE_KEY` in env, or replace it in `api/config.js`. The backend switches to real card collection automatically when `STRIPE_SECRET_KEY` is present.

## License

MIT — use freely for your projects.
