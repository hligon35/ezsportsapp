#!/usr/bin/env node
/**
 * Product Sync Script
 *
 * Responsibilities:
 *  - Traverse assets/info/prodInfo/* for product JSON files (one product per file)
 *  - Normalize into unified product objects (see schema notes below)
 *  - Upsert into server/database/products.json (preserve existing stripe linkage & createdAt)
 *  - (Optional) Sync with Stripe if STRIPE_SECRET_KEY is present:
 *      * Create Stripe Product if missing (metadata.local_id = product.id)
 *      * Create Stripe Price if price changed or no matching price exists
 *      * Store/refresh: product.stripe = { productId, defaultPriceId, currency }
 *  - Supports dry run via --dry flag
 *
 * Unified Product Shape (stored):
 *  {
 *    id, name, description, category, price, currency, image,
 *    images?: [ { url, alt, position } ],
 *    features?: string[],
 *    meta?: { sourceUrl?, warranty? },
 *    isActive: true|false,
 *    featured?: boolean,
 *    stock?: number,
 *    stripe?: { productId, defaultPriceId, currency },
 *    createdAt, updatedAt
 *  }
 *
 * HOW TO SET STRIPE KEYS (TEST vs LIVE):
 *  - Place STRIPE_SECRET_KEY & STRIPE_PUBLISHABLE_KEY in server/.env (already loaded by server/index.js)
 *  - For production, replace with live keys (never commit live keys).
 *  - This script only needs STRIPE_SECRET_KEY; publishable key is for frontend.
 */

require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const NO_STRIPE = args.includes('--no-stripe');
const DEACTIVATE_REMOVED = args.includes('--deactivate-removed');
const FROM_DB = args.includes('--from-db');

// Root resolution: this file is server/scripts/sync-products.js
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

// Load env from both repo root and server/.env (second call is a no-op if file missing)
try { require('dotenv').config({ path: path.join(REPO_ROOT, '.env') }); } catch {}
try { require('dotenv').config({ path: path.join(SERVER_DIR, '.env') }); } catch {}
const PRODINFO_DIR = path.join(REPO_ROOT, 'assets', 'info', 'prodInfo');
const DB_DIR = path.join(SERVER_DIR, 'database');
const PRODUCTS_FILE = path.join(DB_DIR, 'products.json');
const PRODUCTS_IMG_DIR = path.join(REPO_ROOT, 'assets', 'img', 'products');

// Load existing products (if any)
async function loadExistingProducts() {
  try {
    const data = await fs.readFile(PRODUCTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function slugify(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function normalizeCategory(folderName) {
  return slugify(folderName).replace(/-/g, ' ')
    .replace(/\band\b/gi, '&') // optional stylistic revert
    .split(' ')[0] // simple fallback
    || folderName.toLowerCase();
}

// Server-side description cleaner (mirrors frontend sanitizeDescription, conservative to avoid data loss)
function cleanDescription(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let txt = raw;
  // Remove script/style tags
  txt = txt.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Strip tags
  txt = txt.replace(/<[^>]+>/g, ' ');
  // Decode a few entities
  const entities = { '&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&#39;':'\'' };
  txt = txt.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, m => entities[m] || ' ');
  const boiler = [ /privacy policy/i, /terms of (service|use)/i, /newsletter/i, /follow us/i, /all rights reserved/i ];
  let lines = txt.split(/\r?\n|\u2028|\u2029/).map(l=>l.trim()).filter(Boolean);
  lines = lines.filter(l => l.length > 1 && l.length < 600 && !boiler.some(re => re.test(l)));
  // Deduplicate consecutive
  const out = [];
  for (const l of lines) { if (out[out.length-1] !== l) out.push(l); }
  txt = out.join(' ');
  txt = txt.replace(/\s{2,}/g, ' ').trim();
  if (txt.length > 1000) txt = txt.slice(0, 1000) + '…';
  return txt;
}

async function walkJsonFiles(dir) {
  const out = [];
  async function walk(current, segments = []) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(full, [...segments, ent.name]);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
        out.push({ file: full, segments, filename: ent.name });
      }
    }
  }
  await walk(dir, []);
  return out;
}

let stripe = null;
if (!NO_STRIPE && process.env.STRIPE_SECRET_KEY) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); }
  catch (e) { console.warn('Stripe init failed:', e.message); }
}

async function ensureStripeProduct(localId, name, description, existingStripe) {
  if (!stripe) return null;
  // If we previously stored productId, confirm it still exists
  if (existingStripe?.productId) {
    try {
      const prod = await stripe.products.retrieve(existingStripe.productId);
      return prod;
    } catch (e) {
      console.warn('Existing stripe product missing, will recreate:', existingStripe.productId);
    }
  }
  // Try to find by metadata.local_id (search limited; fallback to create)
  try {
    const list = await stripe.products.search({ query: `metadata['local_id']:'${localId}'` });
    if (list.data.length) return list.data[0];
  } catch (e) {
    // search not available on some test modes older versions; ignore
  }
  // Create new
  return await stripe.products.create({
    name: name.substring(0, 255),
    description: (description || '').substring(0, 800),
    metadata: { local_id: localId }
  });
}

async function ensureStripePrice(productId, amountFloat, currency = 'usd') {
  if (!stripe) return null;
  const unitAmount = Math.round(Number(amountFloat) * 100);
  // Find existing matching active price
  try {
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    const match = prices.data.find(p => p.unit_amount === unitAmount && p.currency === currency);
    if (match) return match;
  } catch (e) {
    console.warn('List prices failed (continuing):', e.message);
  }
  // Create new one (Stripe best practice: don't update unit_amount of existing price)
  return await stripe.prices.create({ product: productId, unit_amount: unitAmount, currency });
}

async function main() {
  console.log('\n=== Product Sync Starting ===');
  if (DRY_RUN) console.log('Running in DRY RUN mode – no writes, no Stripe mutations.');
  if (!stripe && !NO_STRIPE) console.log('Stripe disabled (no key present or init failed).');

  // Ensure destination image directory exists (for normalized product image paths)
  try { await fs.mkdir(PRODUCTS_IMG_DIR, { recursive: true }); } catch {}

  const existing = await loadExistingProducts();
  const existingMap = new Map(existing.map(p => [p.id, p]));

  // If operating from DB, bypass filesystem scan and just refresh Stripe linkage on existing products
  if (FROM_DB) {
    const existing = await loadExistingProducts();
    console.log(`FROM_DB mode: found ${existing.length} existing products in DB.`);
    let updated = [];
    let warnings = [];
    for (const prev of existing) {
      const nowIso = new Date().toISOString();
      const product = { ...prev };
      product.updatedAt = nowIso;
      if (stripe && !DRY_RUN) {
        try {
          const sp = await ensureStripeProduct(product.id, product.name || product.id, product.description || '', product.stripe);
          const priceObj = await ensureStripePrice(sp.id, product.price, product.currency || 'usd');
          product.stripe = { productId: sp.id, defaultPriceId: priceObj.id, currency: (product.currency || 'usd') };
        } catch (e) {
          warnings.push(`Stripe sync failed for ${product.id}: ${e.message}`);
        }
      }
      updated.push(product);
    }
    if (DRY_RUN) {
      console.log(`DRY RUN: Would update ${updated.length} products in products.json`);
    } else {
      const tmp = PRODUCTS_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(updated, null, 2));
      await fs.rename(tmp, PRODUCTS_FILE);
      console.log(`Wrote ${updated.length} products to products.json`);
    }
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach(w => console.log(' - ' + w));
    }
    console.log('\n=== Product Sync Complete ===');
    return;
  }

  const files = await walkJsonFiles(PRODINFO_DIR);
  console.log(`Discovered ${files.length} product JSON files under prodInfo.`);

  const results = [];
  const warnings = [];

  for (const f of files) {
    try {
      const raw = await fs.readFile(f.file, 'utf8');
      const json = JSON.parse(raw);
      const basename = f.filename.replace(/\.json$/i, '');
      const id = slugify(basename);
      const categoryFolder = f.segments[0] || 'general';
      const category = slugify(categoryFolder); // simple normalized category
      const nameCandidate = json.title || json.productTitle || json.name || basename;
      let name = String(nameCandidate || '').trim();
      if (!name || /^div$/i.test(name)) {
        // Salvage a readable name from the slugified basename (before slugify removed info)
        name = basename
          .replace(/[-_]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\b([a-z])/g, m => m.toUpperCase())
          .slice(0, 140);
      }
  const rawDescription = (json.description || '').trim();
  const cleaned = cleanDescription(rawDescription);
  const description = cleaned;
      const price = Number(json.price); // assume already USD
      if (!price || isNaN(price)) warnings.push(`Price missing/invalid for ${id}`);
      const primaryImageRaw = (json.downloaded_images && json.downloaded_images[0])
        || (json.image_urls && json.image_urls[0])
        || json.image_url
        || '';
      let primaryImage = primaryImageRaw;
      let copied = false;
      // Normalize local filesystem paths to relative served path
      try {
        if (primaryImage && !/^https?:/i.test(primaryImage)) {
          // Windows absolute path or relative path from scraper; attempt to copy
          const absCandidate = path.isAbsolute(primaryImage) ? primaryImage : path.resolve(path.dirname(f.file), primaryImage);
          const exists = await fs.access(absCandidate).then(() => true).catch(() => false);
          if (exists) {
            const ext = path.extname(absCandidate) || '.jpg';
            const destName = `${id}${ext.toLowerCase().split('?')[0]}`; // stable filename
            const destPath = path.join(PRODUCTS_IMG_DIR, destName);
            if (!DRY_RUN) {
              try {
                await fs.copyFile(absCandidate, destPath);
                copied = true;
              } catch (e) {
                warnings.push(`Image copy failed for ${id}: ${e.message}`);
              }
            } else {
              // Dry run note
              console.log(`[dry-run] Would copy image ${absCandidate} -> ${destPath}`);
            }
            // Public web path (served as static asset)
            primaryImage = `assets/img/products/${destName}`;
          } else {
            // Could not resolve file; leave as-is (may be a placeholder string)
            warnings.push(`Image file missing for ${id}: ${absCandidate}`);
          }
        }
      } catch (e) {
        warnings.push(`Image normalization error for ${id}: ${e.message}`);
      }
      const features = Array.isArray(json.features) ? json.features.filter(x => typeof x === 'string') : [];

      const prev = existingMap.get(id);
      const nowIso = new Date().toISOString();
      const product = {
        id,
        name,
        description,
        category,
        price: Number(price) || 0,
        currency: 'usd',
        image: primaryImage,
        features: features.length ? features : undefined,
        meta: {
          sourceUrl: json.source_url || undefined,
          warranty: json.warranty || undefined,
          originalDescription: cleaned !== rawDescription ? rawDescription.slice(0, 1200) : undefined
        },
        isActive: true,
        featured: prev?.featured || false,
        stock: prev?.stock ?? 0,
        createdAt: prev?.createdAt || nowIso,
        updatedAt: nowIso,
        stripe: prev?.stripe || undefined
      };
      if (primaryImageRaw && primaryImage !== primaryImageRaw) {
        product.meta = product.meta || {};
        product.meta.originalImage = primaryImageRaw;
      }
      if (copied) {
        product.meta = product.meta || {};
        product.meta.normalizedImage = product.image;
      }

      // Stripe sync if enabled
      if (stripe && !DRY_RUN) {
        try {
          const sp = await ensureStripeProduct(product.id, product.name, product.description, product.stripe);
          const priceObj = await ensureStripePrice(sp.id, product.price, product.currency);
          product.stripe = {
            productId: sp.id,
            defaultPriceId: priceObj.id,
            currency: product.currency
          };
        } catch (e) {
          warnings.push(`Stripe sync failed for ${product.id}: ${e.message}`);
        }
      }

      results.push(product);
    } catch (e) {
      warnings.push(`Failed processing ${f.file}: ${e.message}`);
    }
  }

  // Merge with any existing products that were not present in current scan (mark inactive)
  const removed = [];
  const newIds = new Set(results.map(r => r.id));
  existing.forEach(p => {
    if (!newIds.has(p.id)) {
      // preserve but mark inactive (soft retire) unless already inactive
      results.push({ ...p, isActive: false, updatedAt: new Date().toISOString() });
      removed.push(p);
    }
  });

  // Sort for stable diffs
  results.sort((a, b) => a.name.localeCompare(b.name));

  if (DRY_RUN) {
    console.log(`DRY RUN: Would write ${results.length} products (including inactives).`);
  } else {
    // Atomic write
    const tmp = PRODUCTS_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(results, null, 2));
    await fs.rename(tmp, PRODUCTS_FILE);
    console.log(`Wrote ${results.length} products to products.json`);
  }

  // Optionally deactivate removed products in Stripe for parity (safe opt-in)
  if (!DRY_RUN && stripe && DEACTIVATE_REMOVED && removed.length) {
    console.log(`\nStripe: deactivating ${removed.length} removed product(s)...`);
    let ok = 0, fail = 0;
    for (const p of removed) {
      try {
        let stripeProductId = p?.stripe?.productId || null;
        if (!stripeProductId) {
          // Try to locate by metadata.local_id
          try {
            const found = await stripe.products.search({ query: `metadata['local_id']:'${p.id}'` });
            stripeProductId = found?.data?.[0]?.id || null;
          } catch {}
        }
        if (!stripeProductId) { fail++; continue; }
        await stripe.products.update(stripeProductId, { active: false });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    console.log(`Stripe deactivated: ${ok} succeeded, ${fail} skipped/failed.`);
  }

  if (warnings.length) {
    console.log('\nWarnings:');
    warnings.forEach(w => console.log(' - ' + w));
  }

  console.log('\n=== Product Sync Complete ===');
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
