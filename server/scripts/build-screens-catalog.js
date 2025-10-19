#!/usr/bin/env node
/**
 * Build a consolidated screens-catalog.json from raw scraped product folders under
 * assets/info/prodInfo/Screens
 * Each product folder contains a single JSON file and an images/ subfolder with one primary image.
 * We normalize fields to match the frontend shape expected by fetchProducts() mapping.
 */
const fs = require('fs');
const path = require('path');

// ROOT previously went up three levels which pointed outside the project; adjust to project root
const ROOT = path.resolve(__dirname, '../..');
const SCREENS_DIR = path.join(ROOT, 'assets', 'info', 'prodInfo', 'Screens');
const OUTPUT = path.join(ROOT, 'assets', 'info', 'prodInfo', 'screens-catalog.json');

function slugify(str){
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);
}

function deriveId(fileName){
  return slugify(fileName.replace(/\.json$/i,''));
}

function loadProduct(dir){
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const jsonFile = entries.find(e => e.isFile() && e.name.endsWith('.json'));
  if (!jsonFile) return null;
  const raw = JSON.parse(fs.readFileSync(path.join(dir, jsonFile.name), 'utf8'));
  // Attempt to find a local image: prefer images/*.jpg if present else fallback to top-level images folder match
  let img = null;
  const imagesDir = path.join(dir, 'images');
  if (fs.existsSync(imagesDir)) {
    const imgs = fs.readdirSync(imagesDir).filter(n => /\.(jpe?g|png|webp|avif)$/i.test(n));
    if (imgs.length) img = 'assets/info/prodInfo/Screens/' + path.basename(dir) + '/images/' + imgs[0];
  }
  // Fallback: global images folder inside Screens/images for standalone JSON outside folder structure
  if (!img) {
    const globalImages = path.join(SCREENS_DIR, 'images');
    if (fs.existsSync(globalImages)) {
      const base = path.basename(jsonFile.name).replace(/\.json$/,'');
      const cand = fs.readdirSync(globalImages).find(n => n.startsWith(base) && /\.(jpe?g|png|webp|avif)$/i.test(n));
      if (cand) img = 'assets/info/prodInfo/Screens/images/' + cand;
    }
  }
  // Build feature list: use raw.features if present
  const features = Array.isArray(raw.features) ? raw.features : [];
  const description = raw.description || '';
  // Price
  const price = typeof raw.price === 'number' ? raw.price : Number(raw.price) || 0;
  // Name fallback
  let name = raw.name && raw.name !== 'div' && raw.name !== 'strong' ? raw.name : (raw.category_path ? raw.category_path.slice(-1)[0] : deriveId(jsonFile.name));
  name = name.replace(/[_-]+/g,' ').replace(/\s{2,}/g,' ').trim();
  const id = deriveId(jsonFile.name);
  return {
    id: id,
    name: name,
    title: name,
    description,
    price,
    category: 'l-screens',
    image: img || 'assets/EZSportslogo.png',
    images: img ? [img] : [],
    features
  };
}

function build(){
  if (!fs.existsSync(SCREENS_DIR)) {
    console.error('[screens-build] Directory not found:', SCREENS_DIR);
    console.error('Ensure your scraped data is placed at that path before running this script.');
    process.exit(1);
  }
  const entries = fs.readdirSync(SCREENS_DIR, { withFileTypes: true });
  const products = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'images') continue; // global images dir
      const dir = path.join(SCREENS_DIR, e.name);
      try {
        const prod = loadProduct(dir);
        if (prod && prod.price > 0) products.push(prod);
      } catch(err){
        console.warn('Failed to load', e.name, err.message);
      }
    } else if (e.isFile() && e.name.endsWith('.json')) {
      // Loose JSON in root (rare) - try to attach image from global images folder
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(SCREENS_DIR, e.name),'utf8'));
        const id = deriveId(e.name);
        let img = null;
        const globalImages = path.join(SCREENS_DIR, 'images');
        if (fs.existsSync(globalImages)) {
          img = fs.readdirSync(globalImages).find(n => n.startsWith(id) && /\.(jpe?g|png|webp|avif)$/i.test(n));
          if (img) img = 'assets/info/prodInfo/Screens/images/' + img;
        }
        const name = raw.name && !['div','strong'].includes(raw.name) ? raw.name : (raw.category_path ? raw.category_path.slice(-1)[0] : id);
        products.push({
          id,
            name,
            title: name,
            description: raw.description || '',
            price: typeof raw.price === 'number' ? raw.price : Number(raw.price) || 0,
            category: 'l-screens',
            image: img || 'assets/EZSportslogo.png',
            images: img ? [img] : [],
            features: Array.isArray(raw.features) ? raw.features : []
        });
      } catch(err) {
        console.warn('Failed loose JSON', e.name, err.message);
      }
    }
  }
  products.sort((a,b)=> a.title.localeCompare(b.title));
  fs.writeFileSync(OUTPUT, JSON.stringify(products, null, 2));
  console.log(`Built ${products.length} L-Screens products -> ${path.relative(ROOT, OUTPUT)}`);
}

build();
