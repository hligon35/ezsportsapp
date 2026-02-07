/*
  Remove duplicate image entries from assets/prodList.json.

  De-dupes (preserving order):
    - stripeImages

  Also normalizes:
    - stripeImg to be the first stripeImages entry when present

  Usage:
    node scripts/dedupe-prodlist-images.js
    node scripts/dedupe-prodlist-images.js --dry
*/

const fsp = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');

const REPO_ROOT = path.resolve(__dirname, '..');
const PRODLIST_FILE = path.join(REPO_ROOT, 'assets', 'prodList.json');

function uniqPreserve(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function main() {
  const raw = await fsp.readFile(PRODLIST_FILE, 'utf8');
  const prodList = JSON.parse(raw);
  if (!prodList || typeof prodList !== 'object' || !prodList.categories || typeof prodList.categories !== 'object') {
    throw new Error('assets/prodList.json missing categories object');
  }

  let productsTouched = 0;
  let stripeImagesDeduped = 0;

  for (const arr of Object.values(prodList.categories)) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      let touched = false;

      if (Array.isArray(p.stripeImages)) {
        const prev = p.stripeImages.map(String);
        const next = uniqPreserve(prev);
        if (prev.length !== next.length || prev.some((v, i) => String(v).trim() !== next[i])) {
          p.stripeImages = next;
          stripeImagesDeduped += 1;
          touched = true;
        }
        if (next.length) {
          const desired = next[0];
          if (String(p.stripeImg || '').trim() !== desired) {
            p.stripeImg = desired;
            touched = true;
          }
        }
      }

      // Ensure legacy fields are not reintroduced
      if ('img' in p) { delete p.img; touched = true; }
      if ('images' in p) { delete p.images; touched = true; }

      if (touched) productsTouched += 1;
    }
  }

  prodList.updatedAt = new Date().toISOString().slice(0, 10);

  const summary = { productsTouched, stripeImagesDeduped, file: path.relative(process.cwd(), PRODLIST_FILE), dryRun: DRY };

  if (DRY) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await fsp.writeFile(PRODLIST_FILE, JSON.stringify(prodList, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
