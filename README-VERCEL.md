# Deploying to Vercel

This repo serves static files from the root and exposes API routes under `api/` as Vercel Functions.

## What changed

- Added `api/` with serverless functions:
  - `api/health.js`
  - `api/users/login.js`
  - `api/users/register.js`
- Added `api/_lib_db.js` using `@vercel/postgres` for a simple `users` table.
- Fixed `assets/js/auth.js` signup to treat the identifier as the email.
- Added `vercel.json` to set Node.js runtime.

## Environment

- Create a Vercel Postgres database (included in the Vercel free tier; scales well, very cost‑efficient).
- Add env var on Vercel: `DATABASE_URL` (Vercel will also inject one automatically when using Vercel Postgres).

## Frontend

- No build is required. Vercel will serve `index.html` and static assets from the repo root.
- Auth calls hit `/api/users/login` and `/api/users/register` on the same origin.

## Local dev

- You can continue using the existing Express server locally, or test functions locally with `vercel dev`.

## Notes

- The legacy JSON-file database isn’t used on Vercel (serverless is ephemeral). Users are stored in Postgres.
- To migrate existing users, import them into the `users` table with the same schema.
