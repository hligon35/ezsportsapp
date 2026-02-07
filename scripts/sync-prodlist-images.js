/*
  Sync assets/prodList.json product image fields to use local optimized assets.

  Source of truth for product images:
    - assets/stripeProdImgs (canonical)

  This script no longer writes legacy fields:
    - product.img
    - product.images

  It normalizes stripeImg/stripeImages and strips any legacy fields.

  Usage:
    node scripts/sync-prodlist-images.js
    node scripts/sync-prodlist-images.js --dry
*/

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');

const REPO_ROOT = path.resolve(__dirname, '..');
const PRODLIST_FILE = path.join(REPO_ROOT, 'assets', 'prodList.json');
const PROD_IMGS_DIR = path.join(REPO_ROOT, 'assets', 'prodImgs');

const IMAGE_EXTS = new Set(['.avif', '.jpg', '.jpeg', '.png', '.webp', '.gif']);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isImageFile(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

async function walkDirs(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        out.push(full);
        stack.push(full);
      }
    }
  }
  return out;
}

function pickBestImageFile(files, { preferBlack = true } = {}) {
  const imageFiles = (files || []).filter(isImageFile);
  if (!imageFiles.length) return null;

  const score = (file) => {
    const name = String(file).toLowerCase();
    let s = 0;
    // Prefer avif
    if (name.endsWith('.avif')) s += 50;
    // Prefer "black" as default (common for product hero image)
    if (preferBlack && name.includes('black')) s += 20;
    // Prefer non-alt variants if present
    if (!name.includes('_a')) s += 5;
    if (!name.includes('(1)')) s += 2;
    // Prefer leading/hero-ish names
    if (/(^|\/|_)0?1\./.test(name)) s += 5;
    return s;
  };

  const sorted = imageFiles.slice().sort((a, b) => score(b) - score(a) || String(a).localeCompare(String(b)));
  return sorted[0];
}

async function buildSkuDirIndex() {
  const dirs = await walkDirs(PROD_IMGS_DIR);
  const index = new Map();

  // Map leaf folder name => full path (case-insensitive).
  for (const d of dirs) {
    const leaf = path.basename(d);
    if (!leaf) continue;
    const key = leaf.toLowerCase();
    // Prefer shallowest path when duplicates exist.
    if (!index.has(key)) {
      index.set(key, d);
    } else {
      const prev = index.get(key);
      const prevDepth = prev.split(path.sep).length;
      const depth = d.split(path.sep).length;
      if (depth < prevDepth) index.set(key, d);
    }
  }

  return index;
}

async function chooseImageForProduct({ sku, name, categoryName, gauge, material, skuDirIndex }) {
  const skuKey = String(sku || '').trim();
  const skuLc = skuKey.toLowerCase();
  const nameLc = String(name || '').toLowerCase();

  // 1) Exact SKU folder match anywhere under assets/prodImgs/**/<SKU>/
  const folder = skuDirIndex.get(skuLc);
  if (folder) {
    const files = await fsp.readdir(folder).catch(() => []);
    const best = pickBestImageFile(files, { preferBlack: true });
    if (best) {
      const rel = path.relative(REPO_ROOT, path.join(folder, best));
      return { img: toPosix(rel), images: files.filter(isImageFile).map(f => toPosix(path.relative(REPO_ROOT, path.join(folder, f)))) };
    }
  }

  // 2) Heuristics (Accessories: twine, rope, etc.)
  if (skuLc.startsWith('ft-tnhl-') || nameLc.includes('twine')) {
    const twine = path.join(PROD_IMGS_DIR, 'Accessories', 'Forever', 'black_twine.jpeg');
    if (fs.existsSync(twine)) return { img: toPosix(path.relative(REPO_ROOT, twine)), images: [] };
  }

  // 3) Pre-Made Cages: pick by gauge/material when no SKU folder
  if (String(categoryName || '').toLowerCase().includes('pre-made') || nameLc.includes('cage')) {
    const cageDir = path.join(PROD_IMGS_DIR, 'Pre_Made_Cages');
    const m = String(material || '').toLowerCase();
    const g = Number(gauge || 0) || 0;

    const pick = (file) => {
      const full = path.join(cageDir, file);
      return fs.existsSync(full) ? toPosix(path.relative(REPO_ROOT, full)) : null;
    };

    if (m.includes('nylon') && g === 21) {
      const p = pick('21Nylon.avif') || pick('21Nylon2.avif');
      if (p) return { img: p, images: [] };
    }
    if (m.includes('nylon') && (g === 36 || g === 42 || g === 60)) {
      const p = pick('36Nylon.avif') || pick('36Nylon2.avif');
      if (p) return { img: p, images: [] };
    }
    if (m.includes('poly')) {
      const p = pick('36Poly.avif') || pick('36Poly2.avif');
      if (p) return { img: p, images: [] };
    }

    // Generic fallback: any image in Pre_Made_Cages
    const files = await fsp.readdir(cageDir).catch(() => []);
    const best = pickBestImageFile(files, { preferBlack: false });
    if (best) {
      return { img: toPosix(path.relative(REPO_ROOT, path.join(cageDir, best))), images: [] };
    }
  }

  // 4) Category-level fallback: pick first image under assets/prodImgs/<CategoryFolder>
  // (Best-effort; only if we can find a folder with a similar name)
  const categoryFolders = [
    String(categoryName || ''),
    // common normalizations
    String(categoryName || '').replace(/\s+/g, '_').replace(/-+/g, '_'),
    String(categoryName || '').replace(/\s+/g, ''),
  ].map(s => s.trim()).filter(Boolean);

  for (const cat of categoryFolders) {
    const maybe = path.join(PROD_IMGS_DIR, cat);
    if (!fs.existsSync(maybe)) continue;
    const files = await fsp.readdir(maybe).catch(() => []);
    const best = pickBestImageFile(files, { preferBlack: false });
    if (best) {
      return { img: toPosix(path.relative(REPO_ROOT, path.join(maybe, best))), images: [] };
    }
  }

  return null;
}

async function main() {
  const raw = await fsp.readFile(PRODLIST_FILE, 'utf8');
  const prodList = JSON.parse(raw);
  if (!prodList || typeof prodList !== 'object' || !prodList.categories) {
    throw new Error('assets/prodList.json missing categories object');
  }

  let updated = 0;
  let removedLegacyFields = 0;

  for (const [categoryName, arr] of Object.entries(prodList.categories)) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      const sku = String(p?.sku || p?.id || '').trim();
      if (!sku) continue;

      // Normalize stripe images
      if (p.stripeImg && !Array.isArray(p.stripeImages)) {
        p.stripeImages = [p.stripeImg];
        updated += 1;
      }
      if (!p.stripeImg && Array.isArray(p.stripeImages) && p.stripeImages.length) {
        p.stripeImg = p.stripeImages[0];
        updated += 1;
      }

      // Strip legacy fields
      if ('img' in p) { delete p.img; removedLegacyFields += 1; updated += 1; }
      if ('images' in p) { delete p.images; removedLegacyFields += 1; updated += 1; }
    }
  }

  prodList.updatedAt = new Date().toISOString().slice(0, 10);

  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, updated, removedLegacyFields }, null, 2));
    return;
  }

  await fsp.writeFile(PRODLIST_FILE, JSON.stringify(prodList, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ updated, removedLegacyFields, file: path.relative(process.cwd(), PRODLIST_FILE) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
