#!/usr/bin/env node
/**
 * Assign random local Bullet L-Screen images to all products within
 *   - "Better Baseball Pitcher's Pocket"
 *   - "Better Baseball L-Screens"
 * in assets/prodList.json.
 *
 * The script preserves other fields and only overwrites (or adds) an `img` field
 * pointing to: assets/prodImgs/Bullet_L-Screens/Bullet_L_Screens_Baseball/<file>
 *
 * Safe to run multiple times (results will reshuffle). A backup of the original
 * file is written once per invocation with a timestamp suffix.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROD_LIST_PATH = path.join(ROOT, 'assets', 'prodList.json');
const IMAGE_DIR = path.join(ROOT, 'assets', 'prodImgs', 'Bullet_L-Screens', 'Bullet_L_Screens_Baseball');
const TARGET_CATEGORIES = ["Better Baseball Pitcher's Pocket", 'Better Baseball L-Screens'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function main() {
  if (!fs.existsSync(PROD_LIST_PATH)) {
    console.error('prodList.json not found at', PROD_LIST_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(IMAGE_DIR)) {
    console.error('Image directory missing:', IMAGE_DIR);
    process.exit(1);
  }
  const images = fs.readdirSync(IMAGE_DIR)
    .filter(f => /\.(avif|webp|jpe?g|png)$/i.test(f));
  if (!images.length) {
    console.error('No image files found in', IMAGE_DIR);
    process.exit(1);
  }

  const raw = fs.readFileSync(PROD_LIST_PATH, 'utf8');
  let json;
  try { json = JSON.parse(raw); } catch (e) {
    console.error('Failed parsing prodList.json:', e.message); process.exit(1);
  }

  if (!json.categories || typeof json.categories !== 'object') {
    console.error('prodList.json missing categories object. Aborting.');
    process.exit(1);
  }

  let updatedCount = 0;
  for (const cat of TARGET_CATEGORIES) {
    const arr = json.categories[cat];
    if (!Array.isArray(arr)) continue;
    arr.forEach(p => {
      const file = pick(images);
      p.img = `assets/prodImgs/Bullet_L-Screens/Bullet_L_Screens_Baseball/${file}`;
      updatedCount++;
    });
  }

  const backupPath = PROD_LIST_PATH.replace(/\.json$/, `.backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, raw, 'utf8');
  fs.writeFileSync(PROD_LIST_PATH, JSON.stringify(json, null, 2) + '\n', 'utf8');

  console.log(`Updated ${updatedCount} products across ${TARGET_CATEGORIES.length} categories.`);
  console.log('Backup saved to', backupPath);
}

if (require.main === module) {
  main();
}
