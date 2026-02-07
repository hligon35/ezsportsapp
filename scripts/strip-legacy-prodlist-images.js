#!/usr/bin/env node
/*
  Strip legacy image fields from assets/prodList.json.

  Goal:
  - Keep ONLY `stripeImg` + `stripeImages` as the product image fields.
  - Remove legacy `img` + `images` from each product.

  Notes:
  - We treat stripe fields as canonical.
  - If stripe fields are missing, we fall back to legacy fields to avoid data loss.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODLIST_PATH = path.join(ROOT, 'assets', 'prodList.json');

function isUsableImgString(s) {
  return typeof s === 'string' && s.trim() && !/^([a-zA-Z]:\\|\\\\)/.test(s.trim());
}

function uniqStable(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!isUsableImgString(v)) continue;
    const s = v.trim();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function coerceImages(p) {
  // Preferred canonical sources
  const stripeImages = Array.isArray(p.stripeImages) ? p.stripeImages.slice() : [];
  const stripeImg = isUsableImgString(p.stripeImg) ? p.stripeImg.trim() : null;

  // Legacy sources (fallback only)
  const legacyImages = Array.isArray(p.images) ? p.images.slice() : [];
  const legacyImg = isUsableImgString(p.img) ? p.img.trim() : null;

  let out = [];
  if (stripeImg) out.push(stripeImg);
  out.push(...stripeImages);

  if (out.length === 0) {
    if (legacyImg) out.push(legacyImg);
    out.push(...legacyImages);
  }

  out = uniqStable(out);

  const canonicalImg = out[0] || null;
  return { stripeImg: canonicalImg, stripeImages: out.length ? out : [] };
}

function main() {
  const raw = fs.readFileSync(PRODLIST_PATH, 'utf8');
  const json = JSON.parse(raw);
  if (!json || typeof json !== 'object' || !json.categories || typeof json.categories !== 'object') {
    throw new Error('assets/prodList.json missing categories object');
  }

  let updatedProducts = 0;
  let removedLegacyFields = 0;
  let filledStripeFromLegacy = 0;
  let missingStripeImages = 0;

  for (const [catName, arr] of Object.entries(json.categories)) {
    if (!Array.isArray(arr)) continue;
    json.categories[catName] = arr.map((p) => {
      if (!p || typeof p !== 'object') return p;

      const hadStripe = !!(p.stripeImg || (Array.isArray(p.stripeImages) && p.stripeImages.length));
      const hadLegacy = !!(p.img || (Array.isArray(p.images) && p.images.length));

      const coerced = coerceImages(p);

      const next = { ...p };
      next.stripeImg = coerced.stripeImg || undefined;
      next.stripeImages = coerced.stripeImages;

      if (!hadStripe && hadLegacy && next.stripeImages.length) filledStripeFromLegacy++;
      if (!next.stripeImages.length) missingStripeImages++;

      if ('img' in next) { delete next.img; removedLegacyFields++; }
      if ('images' in next) { delete next.images; removedLegacyFields++; }

      updatedProducts++;
      return next;
    });
  }

  const tmp = PRODLIST_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, PRODLIST_PATH);

  console.log(JSON.stringify({
    file: path.relative(ROOT, PRODLIST_PATH),
    updatedProducts,
    removedLegacyFields,
    filledStripeFromLegacy,
    missingStripeImages
  }, null, 2));
}

main();
