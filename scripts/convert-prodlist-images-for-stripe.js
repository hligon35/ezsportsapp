#!/usr/bin/env node
/**
 * Convert/copy images referenced by assets/prodList.json into Stripe-friendly formats
 * and rewrite prodList.json to point at the converted images.
 *
 * Output structure:
 *   assets/stripeProdImgs/<product_key>/<index>.<ext>
 *
 * Defaults:
 *  - AVIF/WEBP -> JPG (quality 82)
 *  - JPG/JPEG/PNG/GIF -> copied as-is
 *
 * Usage:
 *  node scripts/convert-prodlist-images-for-stripe.js [--dry] [--limit=100] [--outDir=assets/stripeProdImgs] [--quality=82]
 */

require('dotenv').config();

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Missing dependency "sharp". Run: npm i -D sharp');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const FORCE = args.includes('--force');

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

const OUT_DIR = (() => {
  const v = readArgValue('--outDir');
  return (v || 'assets/stripeProdImgs').toString().trim();
})();

const PRODIMGS_ROOT = (() => {
  const v = readArgValue('--prodImgsRoot');
  return normalizeRelAssetPath((v || 'assets/prodImgs').toString().trim());
})();

const FALLBACK_IMAGE = (() => {
  const v = readArgValue('--fallback');
  return normalizeRelAssetPath((v || 'assets/img/netting.jpg').toString().trim());
})();

const JPG_QUALITY = (() => {
  const v = readArgValue('--quality');
  if (!v) return 82;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.floor(n) : 82;
})();

const REPO_ROOT = path.resolve(__dirname, '..');
const PROD_LIST_FILE = path.join(REPO_ROOT, 'assets', 'prodList.json');

const WRITE_TO = (() => {
  const v = readArgValue('--writeTo');
  if (!v) return PROD_LIST_FILE;
  const rel = String(v).trim();
  return path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
})();

function slug(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function stableKeyFromRaw(raw) {
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

function normToken(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isImageExt(ext) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff'].includes(String(ext || '').toLowerCase());
}

async function walkFiles(absDir) {
  const out = [];
  const stack = [absDir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

function toRelFromRepo(absPath) {
  const rel = path.relative(REPO_ROOT, absPath);
  return normalizeRelAssetPath(rel);
}

function pickBestProdImgsForProduct({ sku, name, filesAbs }) {
  const skuTok = normToken(sku);
  const nameTok = normToken(name);
  const dirs = new Map();

  const consider = (absFile) => {
    const rel = toRelFromRepo(absFile);
    if (!rel.toLowerCase().startsWith(PRODIMGS_ROOT.toLowerCase() + '/')) return;
    const ext = extLower(rel);
    if (!isImageExt(ext)) return;

    const segs = rel.split('/');
    const fileName = segs[segs.length - 1] || '';
    const fileStem = fileName.replace(/\.[^.]+$/, '');
    const dirRel = segs.slice(0, -1).join('/');

    const fileStemTok = normToken(fileStem);

    const segTokMatchesSku = skuTok ? segs.some(s => normToken(s) === skuTok) : false;
    const fileTokHasSku = skuTok ? normToken(fileName).includes(skuTok) : false;

    const segTokMatchesName = nameTok
      ? segs.some(s => {
          const t = normToken(s);
          if (!t) return false;
          return t.includes(nameTok) || nameTok.includes(t);
        })
      : false;
    const fileTokHasName = nameTok
      ? (() => {
          const t = fileStemTok || normToken(fileName);
          if (!t) return false;
          return t.includes(nameTok) || nameTok.includes(t);
        })()
      : false;

    const score =
      (segTokMatchesSku ? 50 : 0) +
      (fileTokHasSku ? 20 : 0) +
      (segTokMatchesName ? 8 : 0) +
      (fileTokHasName ? 4 : 0);

    if (!score) return;
    const cur = dirs.get(dirRel) || { dirRel, score: 0, files: [] };
    cur.score += score;
    cur.files.push(rel);
    dirs.set(dirRel, cur);
  };

  for (const absFile of (filesAbs || [])) consider(absFile);
  if (!dirs.size) return [];

  // Pick best directory by score then by file count
  const best = Array.from(dirs.values()).sort((a, b) => (b.score - a.score) || (b.files.length - a.files.length))[0];
  // De-dupe and sort for stable ordering
  const uniq = Array.from(new Set(best.files));
  uniq.sort((a, b) => a.localeCompare(b));
  return uniq;
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function normalizeRelAssetPath(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  // Keep as forward-slash relative path (prodList uses this style)
  return s.replace(/\\/g, '/');
}

function extLower(p) {
  const m = String(p || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function posixJoin(...parts) {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
}

async function fileExists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(absDir) {
  if (DRY_RUN) return;
  await fs.mkdir(absDir, { recursive: true });
}

async function removeDirIfExists(absDir) {
  if (DRY_RUN) return;
  try {
    await fs.rm(absDir, { recursive: true, force: true });
  } catch {}
}

async function convertOrCopyImage({ srcAbs, srcRel, destAbs, destRel }) {
  const srcExt = extLower(srcRel);
  if (DRY_RUN) return { action: 'dry-run', destRel };

  // Make idempotent: if output already exists, skip.
  if (fsSync.existsSync(destAbs)) {
    return { action: 'exists', destRel };
  }

  if (['jpg', 'jpeg', 'png', 'gif'].includes(srcExt)) {
    await fs.copyFile(srcAbs, destAbs);
    return { action: 'copied', destRel };
  }

  // Convert anything else (avif/webp/etc) to jpeg.
  await sharp(srcAbs)
    .jpeg({ quality: JPG_QUALITY, mozjpeg: true })
    .toFile(destAbs);
  return { action: `converted:${srcExt || 'unknown'}->jpg`, destRel };
}

async function main() {
  console.log('\n=== Convert prodList images for Stripe ===');
  if (DRY_RUN) console.log('Running in DRY RUN mode – no files will be written.');
  console.log('prodList:', PROD_LIST_FILE);
  if (WRITE_TO !== PROD_LIST_FILE) console.log('writeTo:', WRITE_TO);
  console.log('outDir:', OUT_DIR);
  console.log('prodImgsRoot:', PRODIMGS_ROOT);
  console.log('jpg quality:', JPG_QUALITY);
  console.log('fallback:', FALLBACK_IMAGE);
  if (FORCE) console.log('force:', 'enabled (will overwrite per-product outputs)');

  const raw = await fs.readFile(PROD_LIST_FILE, 'utf8');
  const prodList = JSON.parse(raw);
  const categories = prodList && prodList.categories && typeof prodList.categories === 'object' ? prodList.categories : null;
  if (!categories) throw new Error('assets/prodList.json missing categories object');

  // Backup prodList before mutation
  const backupName = `prodList.stripeimg-backup-${Date.now()}.json`;
  const backupAbs = path.join(REPO_ROOT, 'assets', backupName);
  if (!DRY_RUN) {
    await fs.copyFile(PROD_LIST_FILE, backupAbs);
    console.log('Backup written:', backupAbs);
  } else {
    console.log('Backup would be written:', backupAbs);
  }

  const warnings = [];
  let processedProducts = 0;
  let processedImages = 0;
  let converted = 0;
  let copied = 0;
  let skipped = 0;

  // Pre-index prodImgs files for auto-discovery.
  const prodImgsAbs = path.join(REPO_ROOT, PRODIMGS_ROOT);
  const prodImgsFilesAbs = [];
  if (fsSync.existsSync(prodImgsAbs)) {
    console.log('Indexing prodImgs...');
    prodImgsFilesAbs.push(...(await walkFiles(prodImgsAbs)));
    console.log(`Indexed ${prodImgsFilesAbs.length} files under ${PRODIMGS_ROOT}`);
  } else {
    warnings.push(`prodImgsRoot not found on disk: ${PRODIMGS_ROOT}`);
  }

  const entries = [];
  for (const [categoryName, items] of Object.entries(categories)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      entries.push({ categoryName, item });
    }
  }

  const toProcess = LIMIT ? entries.slice(0, LIMIT) : entries;
  console.log(`Products to process: ${toProcess.length}${LIMIT ? ` (limited to ${LIMIT})` : ''}`);

  for (const { categoryName, item } of toProcess) {
    processedProducts++;

    const baseSku = (item?.sku || '').toString().trim();
    const baseName = (item?.name || item?.title || '').toString().trim();
    const matchName = (
      baseName ||
      [item?.gauge, item?.material, item?.size].filter(Boolean).join(' ') ||
      baseSku ||
      categoryName ||
      ''
    ).toString().trim();
    const productKey = stableKeyFromRaw(baseSku || baseName || categoryName || `prod-${processedProducts}`);

    const srcList = [];
    const img = normalizeRelAssetPath(item?.img);
    const images = Array.isArray(item?.images) ? item.images.map(normalizeRelAssetPath) : [];

    // Put img first, then images
    if (img) srcList.push(img);
    for (const p of images) {
      if (!p) continue;
      if (!srcList.includes(p)) srcList.push(p);
    }

    // Only convert local assets paths. If none are available or they don't exist, we'll auto-discover
    // images from assets/prodImgs by SKU/name, then fallback.
    let localSrc = srcList.filter(p => p && !isHttpUrl(p) && p.toLowerCase().startsWith('assets/'));

    const destRelList = [];
    const destDirRel = posixJoin(OUT_DIR.replace(/\\/g, '/').replace(/^\/+/, ''), productKey);
    const destDirAbs = path.join(REPO_ROOT, destDirRel);

    if (FORCE) {
      await removeDirIfExists(destDirAbs);
    }
    await ensureDir(destDirAbs);

    // Filter localSrc to files that exist
    const existingLocalSrc = [];
    for (const rel of localSrc) {
      const abs = path.join(REPO_ROOT, rel);
      if (await fileExists(abs)) existingLocalSrc.push(rel);
    }
    localSrc = existingLocalSrc;

    // Auto-discover from prodImgs if needed
    if (localSrc.length === 0 && prodImgsFilesAbs.length) {
      const discovered = pickBestProdImgsForProduct({ sku: baseSku, name: matchName, filesAbs: prodImgsFilesAbs });
      if (discovered.length) {
        localSrc = discovered;
      }
    }

    // Category-specific defaults (when prodList doesn't specify images)
    if (localSrc.length === 0) {
      const skuUp = String(baseSku || '').toUpperCase();
      if (String(categoryName || '') === 'Bullet Pad Kits' || skuUp.startsWith('PK-')) {
        const padKitCandidates = [
          'assets/prodImgs/Bullet_Pad_Kit/bulletpadkit.avif',
          'assets/prodImgs/Screens/L-Screen_Padding_Kit/images/l-screen-padding-kit-bulletpadkit_1.jpg'
        ];
        for (const c of padKitCandidates) {
          const abs = path.join(REPO_ROOT, c);
          if (await fileExists(abs)) {
            localSrc = [c];
            break;
          }
        }
      }
    }

    for (let i = 0; i < localSrc.length; i++) {
      const srcRel = localSrc[i];
      const srcAbs = path.join(REPO_ROOT, srcRel);
      if (!(await fileExists(srcAbs))) {
        warnings.push(`Missing source image: ${srcRel} (product ${productKey})`);
        skipped++;
        continue;
      }

      const srcExt = extLower(srcRel);
      const destExt = ['png', 'gif', 'jpg', 'jpeg'].includes(srcExt) ? (srcExt === 'jpeg' ? 'jpg' : srcExt) : 'jpg';
      const destFile = `${String(i + 1).padStart(2, '0')}.${destExt}`;
      const destRel = posixJoin(destDirRel, destFile);
      const destAbs = path.join(REPO_ROOT, destRel);

      const res = await convertOrCopyImage({ srcAbs, srcRel, destAbs, destRel });
      processedImages++;
      destRelList.push(destRel);

      if (res.action.startsWith('converted')) converted++;
      else if (res.action === 'copied') copied++;
      else if (res.action === 'exists') {
        // no-op
      }

      // Light progress
      if (processedImages % 200 === 0) {
        console.log(`...processed images: ${processedImages}`);
      }
    }

    // If no images were usable, use fallback (if it exists)
    if (destRelList.length === 0 && FALLBACK_IMAGE && FALLBACK_IMAGE.toLowerCase().startsWith('assets/')) {
      const fbAbs = path.join(REPO_ROOT, FALLBACK_IMAGE);
      if (await fileExists(fbAbs)) {
        const fbExt = extLower(FALLBACK_IMAGE);
        const destExt = ['png', 'gif', 'jpg', 'jpeg'].includes(fbExt) ? (fbExt === 'jpeg' ? 'jpg' : fbExt) : 'jpg';
        const destFile = `01.${destExt}`;
        const destRel = posixJoin(destDirRel, destFile);
        const destAbs = path.join(REPO_ROOT, destRel);
        const res = await convertOrCopyImage({ srcAbs: fbAbs, srcRel: FALLBACK_IMAGE, destAbs, destRel });
        processedImages++;
        destRelList.push(destRel);
        warnings.push(`Used fallback image for product ${productKey} (category ${categoryName})`);
        if (res.action.startsWith('converted')) converted++;
        else if (res.action === 'copied') copied++;
      } else {
        warnings.push(`Fallback image missing: ${FALLBACK_IMAGE} (product ${productKey})`);
      }
    }

    // IMPORTANT: Do NOT touch existing img/images fields (those drive site display).
    // We only add Stripe-specific fields for the Stripe sync.
    if (destRelList.length) {
      item.stripeImg = destRelList[0];
      item.stripeImages = destRelList;
    }
  }

  // Persist updated prodList
  if (!DRY_RUN) {
    prodList.updatedAt = new Date().toISOString().slice(0, 10);
    await fs.writeFile(WRITE_TO, JSON.stringify(prodList, null, 2) + '\n', 'utf8');
    console.log('Updated prodList written:', WRITE_TO);
  } else {
    console.log('Updated prodList would be written:', WRITE_TO);
  }

  console.log('\n=== Done ===');
  console.log(`Products processed: ${processedProducts}`);
  console.log(`Images processed: ${processedImages}`);
  console.log(`Converted: ${converted}, Copied: ${copied}, Skipped: ${skipped}`);

  if (warnings.length) {
    console.log('\nWarnings (first 50):');
    warnings.slice(0, 50).forEach(w => console.log(' - ' + w));
    if (warnings.length > 50) console.log(` - ...and ${warnings.length - 50} more`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
