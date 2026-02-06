#!/usr/bin/env node
/**
 * Sync assets/prodList.json -> Stripe Products & Prices
 *
 * Goal:
 *  - Treat prodList.json as the source of truth for what should exist in Stripe Dashboard.
 *  - Create/update Stripe Products keyed by metadata.local_id.
 *  - Create Stripe Prices when missing (never mutate unit_amount).
 *
 * Notes:
 *  - prodList images are often relative paths (assets/img/...). Stripe requires public URLs for product images.
 *    If PRODUCT_IMAGE_BASE_URL is set (e.g. https://yourdomain.com), relative paths will be converted.
 *
 * Usage:
 *  node server/scripts/sync-prodlist-stripe.js [--dry] [--limit=50]
 */

require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');

function readArgValue(prefix) {
  const hit = args.find(a => a.startsWith(prefix + '='));
  if (!hit) return null;
  return hit.slice(prefix.length + 1);
}

const LIMIT = (() => {
  const v = readArgValue('--limit');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
})();

const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

// Load env from repo root, server/.env, and render/.env (if present)
// (Later calls don't override existing vars unless dotenv is configured to.)
try { require('dotenv').config({ path: path.join(REPO_ROOT, '.env') }); } catch {}
try { require('dotenv').config({ path: path.join(SERVER_DIR, '.env') }); } catch {}
try { require('dotenv').config({ path: path.join(REPO_ROOT, 'render', '.env') }); } catch {}

const PROD_LIST_FILE = path.join(REPO_ROOT, 'assets', 'prodList.json');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.LIVE_STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY (or LIVE_STRIPE_SECRET_KEY). Set it in server/.env or environment variables.');
  process.exit(1);
}

let stripe;
try {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
} catch (e) {
  console.error('Failed to init Stripe SDK:', e.message);
  process.exit(1);
}

function slug(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function stableIdFromRaw(raw) {
  const base = (raw || '').toString().trim();
  const s = slug(base);
  if (s) return s;
  try {
    const crypto = require('crypto');
    return 'prod-' + crypto.createHash('sha1').update(base || String(Date.now())).digest('hex').slice(0, 12);
  } catch {
    return 'prod-' + Date.now();
  }
}

function asStripeMetadata(obj) {
  // Stripe metadata values must be strings (or omitted)
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null) continue;
    const key = String(k).slice(0, 40);
    const val = String(v).slice(0, 500);
    if (!key) continue;
    out[key] = val;
  }
  return out;
}

function parsePriceLike(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  // Handle values like "$0.50/ft" or "0.50/ft" or "$2,499.99"
  const cleaned = s
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s*\/ft\s*$/i, '')
    .trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickUnitPrice(obj) {
  // Mirror admin.js preference: MAP -> price -> details.price -> wholesale
  const mapVal = parsePriceLike(obj?.map);
  if (mapVal != null) return mapVal;
  const priceVal = parsePriceLike(obj?.price);
  if (priceVal != null) return priceVal;
  const detailsPriceVal = parsePriceLike(obj?.details?.price);
  if (detailsPriceVal != null) return detailsPriceVal;
  const wholesaleVal = parsePriceLike(obj?.wholesale);
  if (wholesaleVal != null) return wholesaleVal;
  return null;
}

function productTitle(item) {
  if (item?.name) return String(item.name);
  const parts = [];
  if (item?.material) parts.push(String(item.material));
  if (item?.gauge != null) parts.push(`#${String(item.gauge)}`);
  if (item?.size) parts.push(String(item.size));
  if (parts.length) return parts.join(' ').trim();
  if (item?.title) return String(item.title);
  return String(item?.sku || 'Product');
}

function cleanDescription(raw) {
  if (!raw) return '';
  let txt = String(raw);
  // Strip basic tags if present
  txt = txt.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  txt = txt.replace(/<[^>]+>/g, ' ');
  // Normalize whitespace/newlines
  txt = txt.replace(/\r\n/g, '\n');
  txt = txt.replace(/\n{3,}/g, '\n\n');
  txt = txt.replace(/\s{2,}/g, ' ').trim();
  // Stripe product.description max length is 800
  if (txt.length > 800) txt = txt.slice(0, 800);
  return txt;
}

function baseUrlForImages() {
  // Preferred: explicit public domain
  const explicit = (process.env.PRODUCT_IMAGE_BASE_URL || '').toString().trim();
  if (explicit) return explicit.replace(/\/$/, '');
  // Fallback: APP_BASE_URL (Render domain)
  const appBase = (process.env.APP_BASE_URL || '').toString().trim();
  if (appBase) return appBase.replace(/\/$/, '');
  return '';
}

function imageUrlFromProdList(img) {
  const raw = (img || '').toString().trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = baseUrlForImages();
  if (!base) return null;
  const rel = raw.startsWith('/') ? raw : `/${raw}`;
  return base + rel;
}

function resolveImageUrls(item) {
  const candidates = [];
  const push = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(push); return; }
    const u = imageUrlFromProdList(v);
    if (!u) return;
    if (!candidates.includes(u)) candidates.push(u);
  };
  push(item?.img);
  push(item?.images);
  // Stripe currently supports multiple images; keep it reasonable
  return candidates.slice(0, 8);
}

async function loadProdList() {
  const raw = await fs.readFile(PROD_LIST_FILE, 'utf8');
  const json = JSON.parse(raw);
  const cats = json && json.categories && typeof json.categories === 'object' ? json.categories : null;
  if (!cats) throw new Error('assets/prodList.json missing categories object');
  return { json, categories: cats };
}

async function findStripeProductByLocalId(localId) {
  // Prefer search by metadata.local_id
  try {
    const res = await stripe.products.search({ query: `metadata['local_id']:'${localId}'` });
    if (res?.data?.length) return res.data[0];
  } catch {
    // Search might be unavailable; ignore and fall back.
  }
  return null;
}

async function ensureStripeProduct({ localId, name, description, metadata, imageUrl, active }) {
  let prod = await findStripeProductByLocalId(localId);
  if (!prod) {
    if (DRY_RUN) {
      return { id: null, created: true, updated: false };
    }
    prod = await stripe.products.create({
      name: name.substring(0, 255),
      description: cleanDescription(description),
      active: typeof active === 'boolean' ? active : true,
      metadata: asStripeMetadata({ ...(metadata || {}), local_id: localId })
    });
  }

  // Keep product fields reasonably in sync (safe, idempotent)
  const nextMetadata = { ...(prod.metadata || {}), ...(metadata || {}), local_id: localId };
  const update = {
    name: name.substring(0, 255),
    description: cleanDescription(description),
    metadata: asStripeMetadata(nextMetadata)
  };
  if (typeof active === 'boolean') update.active = active;
  if (imageUrl) update.images = [imageUrl];

  if (DRY_RUN) {
    return { id: prod.id, created: false, updated: true };
  }

  // Only call update if something likely changed
  const needsUpdate =
    (prod.name || '') !== update.name ||
    (prod.description || '') !== update.description ||
    (typeof update.active === 'boolean' ? (prod.active !== update.active) : false) ||
    (imageUrl ? (Array.isArray(prod.images) && prod.images[0] === imageUrl ? false : true) : false);

  if (needsUpdate) {
    await stripe.products.update(prod.id, update);
    return { id: prod.id, created: false, updated: true };
  }
  return { id: prod.id, created: false, updated: false };
}

async function ensureStripePrice({ productId, unitAmountFloat, currency = 'usd' }) {
  const unitAmount = Math.round(Number(unitAmountFloat) * 100);
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
    throw new Error(`Invalid unit amount for Stripe price: ${unitAmountFloat}`);
  }

  // Find existing matching active price
  try {
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    const match = prices?.data?.find(p => p.unit_amount === unitAmount && p.currency === String(currency).toLowerCase());
    if (match) return { id: match.id, created: false };
  } catch (e) {
    // Continue; we'll create a new one if listing fails
    try { console.warn('List prices failed (continuing):', e.message); } catch {}
  }

  if (DRY_RUN) return { id: null, created: true };
  const created = await stripe.prices.create({ product: productId, unit_amount: unitAmount, currency: String(currency).toLowerCase() });
  return { id: created.id, created: true };
}

async function setDefaultPrice(productId, priceId) {
  if (!priceId) return;
  if (DRY_RUN) return;
  try {
    await stripe.products.update(productId, { default_price: priceId });
  } catch (e) {
    // Not fatal
    try { console.warn('Failed setting default_price for', productId, ':', e.message); } catch {}
  }
}

async function main() {
  console.log('\n=== prodList -> Stripe Sync Starting ===');
  if (DRY_RUN) console.log('Running in DRY RUN mode – no Stripe mutations.');
  console.log('prodList:', PROD_LIST_FILE);
  const mode = STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : (STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN');
  console.log('Stripe key mode:', mode);
  const imgBase = baseUrlForImages();
  if (!imgBase) {
    console.log('Image URL base: (not set) — product images will NOT be sent to Stripe unless img is already https://');
    console.log('Set PRODUCT_IMAGE_BASE_URL=https://yourdomain.com (preferred) or APP_BASE_URL to enable images.');
  } else {
    console.log('Image URL base:', imgBase);
  }

  const { categories } = await loadProdList();

  let planned = [];
  for (const [categoryName, items] of Object.entries(categories)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const baseSku = (item?.sku || '').toString().trim();
      const baseName = productTitle(item);
      const description = (item?.details?.description || item?.description || '').toString();
      const images = resolveImageUrls(item);
      const isActive = item?.active === false ? false : true;
      const commonMeta = {
        source: 'prodList',
        category: String(categoryName || ''),
        sku: baseSku || undefined
      };

      if (Array.isArray(item?.variations) && item.variations.length) {
        for (const v of item.variations) {
          const optRaw = (v?.option ?? v?.name ?? v?.id ?? 'Option');
          const opt = String(optRaw || 'Option');
          const localIdRaw = baseSku ? `${baseSku}-${opt}` : `${baseName}-${opt}`;
          const localId = stableIdFromRaw(localIdRaw);
          const price = pickUnitPrice(v);
          planned.push({
            localId,
            localIdRaw,
            name: `${baseName} (${opt})`.substring(0, 255),
            description,
            currency: 'usd',
            unitPrice: price,
            images,
            active: isActive,
            metadata: { ...commonMeta, local_id_raw: localIdRaw, variation: opt }
          });
        }
      } else {
        const localIdRaw = baseSku || baseName || `prod-${Date.now()}`;
        const localId = stableIdFromRaw(localIdRaw);
        const price = pickUnitPrice(item);
        planned.push({
          localId,
          localIdRaw,
          name: baseName.substring(0, 255),
          description,
          currency: 'usd',
          unitPrice: price,
          images,
          active: isActive,
          metadata: { ...commonMeta, local_id_raw: localIdRaw }
        });
      }
    }
  }

  // Filter unusable entries (no price)
  const warnings = [];
  planned = planned.filter(p => {
    if (p.unitPrice == null || !Number.isFinite(Number(p.unitPrice)) || Number(p.unitPrice) <= 0) {
      warnings.push(`Skipping ${p.localId}: missing/invalid price`);
      return false;
    }
    return true;
  });

  if (LIMIT) planned = planned.slice(0, LIMIT);
  console.log(`Planned Stripe products: ${planned.length}${LIMIT ? ` (limited to ${LIMIT})` : ''}`);

  let createdProducts = 0;
  let updatedProducts = 0;
  let createdPrices = 0;
  let matchedExistingProducts = 0;
  let ok = 0;
  let fail = 0;

  const last = [];

  for (const p of planned) {
    try {
      const primaryImage = Array.isArray(p.images) && p.images.length ? p.images[0] : null;
      const prodRes = await ensureStripeProduct({
        localId: p.localId,
        name: p.name,
        description: p.description,
        metadata: p.metadata,
        imageUrl: primaryImage,
        active: p.active
      });
      if (prodRes.created) createdProducts++;
      if (prodRes.updated) updatedProducts++;
      if (!prodRes.created) matchedExistingProducts++;

      const productId = prodRes.id;
      if (!productId) {
        // dry-run create path
        createdPrices++;
        ok++;
        last.push({ localId: p.localId, localIdRaw: p.localIdRaw, productId: '(dry-run)', priceId: '(dry-run)', priceCreated: true });
        continue;
      }

      const priceRes = await ensureStripePrice({ productId, unitAmountFloat: p.unitPrice, currency: p.currency });
      if (priceRes.created) createdPrices++;
      await setDefaultPrice(productId, priceRes.id);

      // If we have more than one image, update the product's images array.
      // (We do this after we know product exists; safe idempotent update.)
      if (!DRY_RUN && Array.isArray(p.images) && p.images.length > 1) {
        try {
          await stripe.products.update(productId, { images: p.images });
        } catch (e) {
          warnings.push(`Failed setting images for ${p.localId}: ${e.message}`);
        }
      }
      ok++;
      last.push({ localId: p.localId, localIdRaw: p.localIdRaw, productId, priceId: priceRes.id, priceCreated: !!priceRes.created });
    } catch (e) {
      fail++;
      warnings.push(`Failed ${p.localId}: ${e.message || String(e)}`);
      last.push({ localId: p.localId, localIdRaw: p.localIdRaw, productId: '(failed)', priceId: '(failed)', priceCreated: false });
    }
  }

  console.log('\n=== prodList -> Stripe Sync Complete ===');
  console.log(`Products: ${createdProducts} created, ${updatedProducts} updated, ${matchedExistingProducts} matched existing.`);
  console.log(`Prices: ${createdPrices} created.`);
  console.log(`Results: ${ok} ok, ${fail} failed.`);

  // Print a short mapping so you can verify in Stripe Dashboard
  const show = last.slice(-Math.min(last.length, 25));
  if (show.length) {
    console.log('\nRecent mappings (local -> Stripe):');
    for (const r of show) {
      const raw = r.localIdRaw ? ` (raw: ${String(r.localIdRaw).slice(0, 60)})` : '';
      const pc = r.priceCreated ? 'price:new' : 'price:existing';
      console.log(` - ${r.localId}${raw} => ${r.productId} / ${r.priceId} (${pc})`);
    }
  }

  if (warnings.length) {
    console.log('\nWarnings:');
    warnings.slice(0, 200).forEach(w => console.log(' - ' + w));
    if (warnings.length > 200) console.log(` - ...and ${warnings.length - 200} more`);
  }
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
