#!/usr/bin/env node
/*
  Sync assets/prodList.json into server/database/products.json.

  Goal:
    - Make prodList.json the source of truth for products used by API + order/checkout.
    - Ensure ALL product stock fields are 0 (inventory not tracked).

  Usage:
    node server/scripts/sync-prodlist-to-db.js
    node server/scripts/sync-prodlist-to-db.js --dry
*/

const fs = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');

const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

const PRODLIST_FILE = path.join(REPO_ROOT, 'assets', 'prodList.json');
const PRODUCTS_DB_FILE = path.join(SERVER_DIR, 'database', 'products.json');

function parseCatalogPrice(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s) return 0;
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function safeText(v, max = 6000) {
  const s = (v === undefined || v === null) ? '' : String(v);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function normalizeVariations(variations) {
  if (!Array.isArray(variations) || !variations.length) return [];
  return variations.map(v => {
    const option = String(v?.option || v?.name || v?.value || v?.id || '').trim();
    return {
      option,
      map: parseCatalogPrice(v?.map ?? v?.price ?? v?.MAP ?? null),
      wholesale: (v?.wholesale === undefined || v?.wholesale === null) ? undefined : parseCatalogPrice(v?.wholesale),
      color: v?.color
    };
  }).filter(v => v.option);
}

async function loadExistingIndex() {
  try {
    const raw = await fs.readFile(PRODUCTS_DB_FILE, 'utf8');
    const arr = JSON.parse(raw);
    const map = new Map();
    (Array.isArray(arr) ? arr : []).forEach(p => {
      const id = String(p?.id || '').trim();
      if (!id) return;
      map.set(id, p);
    });
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  const prodRaw = await fs.readFile(PRODLIST_FILE, 'utf8');
  const prodList = JSON.parse(prodRaw);
  if (!prodList || typeof prodList !== 'object' || !prodList.categories || typeof prodList.categories !== 'object') {
    throw new Error('assets/prodList.json missing categories object');
  }

  const existing = await loadExistingIndex();
  const nowIso = new Date().toISOString();

  const out = [];

  for (const [categoryName, arr] of Object.entries(prodList.categories)) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      const sku = String(p?.sku || p?.id || '').trim();
      if (!sku) continue;

      const prev = existing.get(sku) || null;

      const name = String(p?.name || p?.title || sku).trim();
      const description = safeText(p?.details?.description || p?.description || '', 12000);

      const mapPrice = parseCatalogPrice(p?.map ?? p?.price ?? 0);
      const wholesale = (p?.wholesale === undefined || p?.wholesale === null) ? undefined : parseCatalogPrice(p?.wholesale);

      const stripeImages = Array.isArray(p?.stripeImages) ? p.stripeImages.slice() : (p?.stripeImg ? [p.stripeImg] : undefined);
      const stripeImg = (p?.stripeImg || (Array.isArray(stripeImages) && stripeImages[0])) || undefined;

      const normalized = {
        id: sku,
        name,
        description,
        category: categoryName,
        price: mapPrice,
        currency: 'usd',
        map: mapPrice || undefined,
        wholesale: (wholesale && wholesale > 0) ? wholesale : undefined,
        dsr: (p?.dsr === undefined || p?.dsr === null) ? undefined : Number(p?.dsr || 0) || 0,
        image: String(stripeImg || ''),
        images: Array.isArray(stripeImages) ? stripeImages : undefined,
        stripeImg,
        stripeImages,
        variations: normalizeVariations(p?.variations),

        isActive: true,
        stock: 0,

        // Preserve linkage if it existed
        stripe: prev?.stripe,
        createdAt: prev?.createdAt || nowIso,
        updatedAt: nowIso
      };

      out.push(normalized);
    }
  }

  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, products: out.length, file: path.relative(process.cwd(), PRODUCTS_DB_FILE) }, null, 2));
    return;
  }

  const tmp = PRODUCTS_DB_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(out, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, PRODUCTS_DB_FILE);

  console.log(JSON.stringify({ products: out.length, file: path.relative(process.cwd(), PRODUCTS_DB_FILE) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
