#!/usr/bin/env node
/**
 * Sanitize all products in assets/prodList.json by:
 *  1. Removing any remote source URL references (fields: image, images.*, details.image_url, downloaded_images, details.downloaded_images)
 *  2. Assigning a random local image from assets/img/products to the `img` field
 *  3. Leaving pricing, ids, names intact
 *  4. Backing up the original JSON
 *
 * Safe to re-run; each run re-randomizes images.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROD_LIST = path.join(ROOT, 'assets', 'prodList.json');
const PRODUCT_IMG_DIR = path.join(ROOT, 'assets', 'img', 'products');

function listLocalImages(dir) {
  return fs.readdirSync(dir).filter(f => /\.(avif|webp|png|jpe?g)$/i.test(f));
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function stripImageFields(obj) {
  if (!obj || typeof obj !== 'object') return;
  delete obj.image;
  delete obj.img; // we'll overwrite later
  if (Array.isArray(obj.images)) delete obj.images;
  else if (obj.images && typeof obj.images === 'object') delete obj.images;
  if (Array.isArray(obj.downloaded_images)) delete obj.downloaded_images;
  if (obj.details && typeof obj.details === 'object') {
    // Remove any remote or nested image sources inside details
    delete obj.details.source_url;
    delete obj.details.image_url;
    if (obj.details.images) delete obj.details.images;
    if (Array.isArray(obj.details.downloaded_images)) delete obj.details.downloaded_images;
  }
}

function processProduct(p, images) {
  stripImageFields(p);
  p.img = `assets/img/products/${rand(images)}`;
}

function walkCategories(categories, images) {
  for (const key of Object.keys(categories)) {
    const arr = categories[key];
    if (!Array.isArray(arr)) continue;
    arr.forEach(prod => processProduct(prod, images));
  }
}

function main() {
  if (!fs.existsSync(PROD_LIST)) {
    console.error('prodList.json not found at', PROD_LIST); process.exit(1);
  }
  if (!fs.existsSync(PRODUCT_IMG_DIR)) {
    console.error('Product images directory missing:', PRODUCT_IMG_DIR); process.exit(1);
  }
  const images = listLocalImages(PRODUCT_IMG_DIR);
  if (!images.length) { console.error('No images found in', PRODUCT_IMG_DIR); process.exit(1); }

  const original = fs.readFileSync(PROD_LIST, 'utf8');
  let json;
  try { json = JSON.parse(original); } catch (e) { console.error('Failed to parse prodList.json:', e.message); process.exit(1); }

  if (json.categories && typeof json.categories === 'object') {
    walkCategories(json.categories, images);
  } else if (Array.isArray(json)) {
    json.forEach(p => processProduct(p, images));
  } else {
    console.error('Unknown prodList.json structure. Aborting.');
    process.exit(1);
  }

  const backup = PROD_LIST.replace(/\.json$/, `.full-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, original, 'utf8');
  fs.writeFileSync(PROD_LIST, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('Sanitized all products. Backup at', backup);
  console.log('Total local images available:', images.length);
}

if (require.main === module) main();
