# Repo Hygiene Cleanup (Oct 2025)

This document summarizes cleanup changes to reduce confusion and risk while keeping all production features intact.

## Changes

- Removed Vercel-specific artifacts not used by our Render + Express deployment:
  - `middleware.js` (Vercel middleware no-op)
  - `api/` folder (Vercel serverless endpoints). All functionality exists in `server/` Express routes.
- Protected secrets:
  - Added `render/.env` to `.gitignore`.
  - Added `render/.env.example` with placeholders. Move real secrets to Render dashboard environment.
- Left untouched by request: `cloudflare/` directory (MailChannels Worker example + docs).

## Why it’s safe

- Frontend calls `/api/...` endpoints served by Express in `server/routes/*`, not the `api/` serverless files.
- Our deployment target is Render using `server/index.js` with `render.yaml`.

## Action items

- If `render/.env` with real credentials was ever committed, rotate those keys (SendGrid, Cloudflare, Stripe as needed) and remove the file from git history.
- Confirm you don’t rely on the Vercel `api/` endpoints in any external integration. If in doubt, check server logs/analytics.

## Reversal

- If you later choose to deploy on Vercel, restore the `api/` folder from git history and reintroduce a real `middleware.js` as needed.
