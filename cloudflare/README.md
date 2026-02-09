Cloudflare Worker Email Sender
==============================

This Worker relays transactional emails (like password reset) using MailChannels from Cloudflare’s edge.

Files
- `worker-email-sender.js`: The Worker script that accepts POST JSON and sends via MailChannels
- `wrangler.toml`: Example configuration for local dev and deployment

Additional DB Worker files
- `worker-db.js`: A Worker that exposes a tiny HTTP API backed by D1 (JSON collections)
- `wrangler.db.toml`: Wrangler config for the DB Worker + D1 binding
- `migrations/0001_collections.sql`: D1 schema (collections + meta)

Prerequisites
- A Cloudflare account (free plan is fine)
- A domain on Cloudflare (recommended for best deliverability)
- Node 18+ locally (for testing server; not strictly needed for Worker)

Quick Start
1) Install Wrangler CLI
   - `npm install -g wrangler`

2) Login
   - `wrangler login`

3) Create a new Worker project (optional if you want a separate repo)
   - `wrangler init ez-email-worker --type=javascript`
   - Replace the generated `src/index.js` with `cloudflare/worker-email-sender.js` from this repo
   - Or, run `wrangler dev cloudflare/worker-email-sender.js`

4) Set Worker environment variables
   - In Cloudflare dashboard → Workers & Pages → Select your Worker → Settings → Variables:
     - `CF_EMAIL_API_KEY` = a shared secret string (also set on your server)
   - `DEFAULT_FROM` = `no-reply@yourdomain.com` (optional)

5) Deploy
   - `wrangler deploy cloudflare/worker-email-sender.js`
   - Note the Worker URL (e.g., https://your-worker.your-subdomain.workers.dev)

6) Configure your server
   - Add these env vars for the Node server:
     - `APP_BASE_URL=https://yourdomain.com`
     - `CF_EMAIL_WEBHOOK_URL=https://your-worker.your-subdomain.workers.dev`
     - `CF_EMAIL_API_KEY=<same value as Worker>`
   - `MAIL_FROM=no-reply@yourdomain.com`
   - Optionally, set `CONTACT_INBOX` to the address that should receive internal notifications, e.g. `info@yourdomain.com`.

7) DNS & Deliverability

   - Use a real domain you control for the `From` address (e.g., `no-reply@yourdomain.com`).
   - If you don’t have a real `no-reply@` mailbox, create a forward/alias from `no-reply@yourdomain.com` to `info@yourdomain.com` (or any monitored inbox).
   - Add/verify SPF to include MailChannels: `v=spf1 include:relay.mailchannels.net ~all`
   - Add DMARC: `_dmarc.yourdomain.com TXT "v=DMARC1; p=none; rua=mailto:postmaster@yourdomain.com"`
   - DKIM: Optional. For best alignment, configure DKIM for your domain or your ESP. MailChannels can also operate without per-domain DKIM, but DMARC alignment may be stricter.
   - Reply-To: The Worker supports `replyTo`; your server can pass `replyTo: "info@yourdomain.com"` so customers can reply even if using a `no-reply@` From.

8) Test

   - Visit `/forgot-password.html` in your app, request a reset
   - Check Worker logs (Cloudflare dashboard) and your inbox

Security

- The Worker requires an Authorization header if `CF_EMAIL_API_KEY` is set. The server sends `Authorization: Bearer <CF_EMAIL_API_KEY>`.
- Keep the Worker URL secret; rely on the token for protection.

Local Dev

- `wrangler dev cloudflare/worker-email-sender.js` will start a local endpoint; update `CF_EMAIL_WEBHOOK_URL` accordingly when testing locally.

Cloudflare D1 Database Worker (Production DB)
--------------------------------------------

This repo can run production storage in Cloudflare (D1) while keeping the existing JSON-file database for local development.

1) Install Wrangler CLI
   - `npm install -g wrangler`

2) Login
   - `wrangler login`

3) Create a D1 database
   - `wrangler d1 create ezsports-prod`

4) Bind D1 to the Worker
   - Edit `cloudflare/wrangler.db.toml`:
     - Set `database_id` from step (3)
     - Optionally set `CF_DB_API_KEY` (recommended)

5) Apply migrations
   - `wrangler d1 migrations apply ezsports-prod --config wrangler.db.toml --cwd cloudflare --remote`

6) Run locally (optional)
   - `wrangler dev --config cloudflare/wrangler.db.toml`
   - Your DB Worker URL will be printed; use it for `EZ_CF_DB_URL`

7) Deploy
   - `wrangler deploy --config cloudflare/wrangler.db.toml`

8) Configure the Node server (Render)
   - Set:
     - `EZ_DB_DRIVER=cloudflare`
     - `EZ_CF_DB_URL=<your worker URL>`
     - `EZ_CF_DB_API_KEY=<same value as CF_DB_API_KEY>`

Security

- If `CF_DB_API_KEY` is set on the Worker, requests must include `Authorization: Bearer <token>`.
