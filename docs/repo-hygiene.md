# Repo Hygiene Cleanup (Oct 2025)

This document summarizes cleanup changes to reduce confusion and risk while keeping all production features intact.

## Changes

- Removed unused root-level serverless artifacts (kept separate from the Express server under `server/`).
- Protected secrets:
  - Added `render/.env` to `.gitignore`.
  - Added `render/.env.example` with placeholders. Move real secrets to Render dashboard environment.
- Left untouched by request: `cloudflare/` directory (MailChannels Worker example + docs).

## Why it’s safe

- Frontend calls `/api/...` endpoints served by Express in `server/routes/*`.
- Our deployment target is Render using `server/index.js` with `render.yaml`.

## Action items

- If `render/.env` with real credentials was ever committed, rotate those keys (SendGrid, Cloudflare, Stripe as needed) and remove the file from git history.
