// Adds/overwrites an `img` field on every product entry in assets/prodList.json
// using local images from assets/prodImgs/Bullet_L-Screens/Bullet_L_Screens_Baseball
// Run: node tools/assign-images.js

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'assets', 'prodList.json');
const IMG_DIR = path.join(__dirname, '..', 'assets', 'prodImgs', 'Bullet_L-Screens', 'Bullet_L_Screens_Baseball');

function pickImages() {
  if (!fs.existsSync(IMG_DIR)) throw new Error('Image directory not found: ' + IMG_DIR);
  const files = fs.readdirSync(IMG_DIR).filter(f => /\.avif$/i.test(f));
  if (!files.length) throw new Error('No .avif images found in ' + IMG_DIR);
  return files.map(f => 'assets/prodImgs/Bullet_L-Screens/Bullet_L_Screens_Baseball/' + f);
}

function loadJson() {
  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveJson(obj) {
  const out = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(JSON_PATH, out, 'utf8');
}

function assignImages(data) {
  const imgs = pickImages();
  let idx = 0;
  const nextImg = () => { const v = imgs[idx % imgs.length]; idx++; return v; };
  if (!data.categories || typeof data.categories !== 'object') return 0;
  let count = 0;
  for (const cat of Object.keys(data.categories)) {
    const arr = data.categories[cat];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && typeof item === 'object') {
        item.img = nextImg();
        count++;
      }
    }
  }
  return count;
}

function main(){
  try {
    const data = loadJson();
    const total = assignImages(data);
    saveJson(data);
    console.log(`Assigned local images to ${total} product entries.`);
  } catch (e) {
    console.error('Failed to assign images:', e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
