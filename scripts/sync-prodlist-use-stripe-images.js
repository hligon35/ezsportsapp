/*
  Ensure prodList.json uses Stripe image assets for site product images.

  Requirement:
    - Each product should use images under assets/stripeProdImgs.
    - Keep product.stripeImg and product.stripeImages normalized.
    - Remove legacy product.img and product.images fields.

  Notes:
    - Does not modify stripeImg/stripeImages except to normalize stripeImages when missing.
    - Intentionally does NOT write legacy img/images.

  Usage:
    node scripts/sync-prodlist-use-stripe-images.js
    node scripts/sync-prodlist-use-stripe-images.js --dry
*/

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');

const REPO_ROOT = path.resolve(__dirname, '..');
const PRODLIST_FILE = path.join(REPO_ROOT, 'assets', 'prodList.json');

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function normalizeStripeImages(p) {
  const stripeImg = String(p?.stripeImg || '').trim();
  let stripeImages = Array.isArray(p?.stripeImages) ? p.stripeImages.map(String).map(s => s.trim()).filter(Boolean) : [];

  if (!stripeImages.length && stripeImg) stripeImages = [stripeImg];
  if (stripeImages.length && !stripeImg) p.stripeImg = stripeImages[0];
  if (stripeImages.length) p.stripeImages = stripeImages;

  return { stripeImg: p.stripeImg ? String(p.stripeImg).trim() : '', stripeImages: stripeImages };
}

function isStripePath(rel) {
  const s = String(rel || '').trim();
  return s.startsWith('assets/stripeProdImgs/');
}

function existsRepoRelative(rel) {
  const cleaned = String(rel || '').trim();
  if (!cleaned) return false;
  const fsPath = path.join(REPO_ROOT, cleaned.replace(/\//g, path.sep));
  return fs.existsSync(fsPath);
}

async function main() {
  const raw = await fsp.readFile(PRODLIST_FILE, 'utf8');
  const prodList = JSON.parse(raw);
  if (!prodList || typeof prodList !== 'object' || !prodList.categories || typeof prodList.categories !== 'object') {
    throw new Error('assets/prodList.json missing categories object');
  }

  let updated = 0;
  let missingStripe = 0;
  let missingFiles = 0;

  for (const arr of Object.values(prodList.categories)) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      const sku = String(p?.sku || p?.id || '').trim();
      if (!sku) continue;

      const { stripeImages } = normalizeStripeImages(p);

      if (!stripeImages.length) {
        missingStripe += 1;
        continue;
      }

      // Filter to only stripeProdImgs paths (defensive)
      const cleanedStripeImages = stripeImages
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .map(s => toPosix(s.replace(/^\.?\/?/,'')).replace(/\\/g,'/'))
        .filter(isStripePath);

      if (!cleanedStripeImages.length) {
        missingStripe += 1;
        continue;
      }

      // Validate files exist on disk
      const existing = cleanedStripeImages.filter(existsRepoRelative);
      if (!existing.length) {
        missingFiles += 1;
        continue;
      }

      const nextImg = existing[0];
      const nextImages = existing;

      const prevStripeImg = String(p?.stripeImg || '').trim();
      const prevStripeImages = Array.isArray(p?.stripeImages) ? p.stripeImages.map(String).map(s => s.trim()).filter(Boolean) : [];

      const needsStripeImg = prevStripeImg !== nextImg;
      const needsStripeImages = (prevStripeImages.length !== nextImages.length) || prevStripeImages.some((v, i) => v !== nextImages[i]);

      if (needsStripeImg) p.stripeImg = nextImg;
      if (needsStripeImages) p.stripeImages = nextImages;

      // Remove legacy fields if present
      const hadLegacy = ('img' in p) || ('images' in p);
      if ('img' in p) delete p.img;
      if ('images' in p) delete p.images;

      if (needsStripeImg || needsStripeImages || hadLegacy) updated += 1;
    }
  }

  prodList.updatedAt = new Date().toISOString().slice(0, 10);

  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, updated, missingStripe, missingFiles }, null, 2));
    return;
  }

  await fsp.writeFile(PRODLIST_FILE, JSON.stringify(prodList, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ updated, missingStripe, missingFiles, file: path.relative(process.cwd(), PRODLIST_FILE) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
