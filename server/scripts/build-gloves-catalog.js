#!/usr/bin/env node
/**
 * Build a consolidated gloves-catalog.json from raw scraped product JSON & folders under
 * assets/info/prodInfo/Gloves
 * Data inconsistencies handled:
 *  - Many JSON have name:"div"; derive a human title from category_path (last element) or file slug
 *  - Description often polluted with site chrome & scripts; we lightly sanitize (strip obvious boilerplate tokens)
 *  - Images may exist as downloaded local copies in a parallel scraper path or subfolder; for now we only reference
 *    local images if present under assets/info/prodInfo/Gloves/images (or per‑product directory), else fallback logo.
 *  - Ensure stable slug id (file name sans .json, slugified) to avoid collisions with remote API ids.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const GLOVES_DIR = path.join(ROOT, 'assets', 'info', 'prodInfo', 'Gloves');
const OUTPUT = path.join(ROOT, 'assets', 'info', 'prodInfo', 'gloves-catalog.json');

function slugify(str){
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,140);
}

function deriveId(fileName){
  return slugify(fileName.replace(/\.json$/i,''));
}

// Very small sanitizer (frontend will further sanitize)
function cleanDesc(raw){
  if (!raw || typeof raw !== 'string') return '';
  let txt = raw.replace(/<script[\s\S]*?<\/script>/gi,' ')
               .replace(/<style[\s\S]*?<\/style>/gi,' ')
               .replace(/<[^>]+>/g,' ')
               .replace(/[\r\n]+/g,' ');
  // Remove obvious store boilerplate fragments
  const DROP = [ 'ALL RIGHTS RESERVED','PRIVACY POLICY','TERMS & CONDITIONS','BALLPLAYERS KNOW','SUBSCRIBE','CONTACT US','TRACK YOUR ORDER' ];
  DROP.forEach(k => { const re = new RegExp(k,'gi'); txt = txt.replace(re,' '); });
  txt = txt.replace(/\s{2,}/g,' ').trim();
  if (txt.length > 900) txt = txt.slice(0,900)+'…';
  return txt;
}

function buildFromLooseJson(file){
  const raw = JSON.parse(fs.readFileSync(file,'utf8'));
  const base = path.basename(file);
  const id = deriveId(base);
  let name = (raw.name && !/^div$/i.test(raw.name)) ? raw.name : (Array.isArray(raw.category_path) ? raw.category_path.slice(-1)[0] : id);
  name = String(name || id).replace(/[_-]+/g,' ').replace(/\s{2,}/g,' ').trim();
  const price = typeof raw.price === 'number' ? raw.price : Number(raw.price) || 0;
  if (price <= 0) return null; // skip zero price noise
  // Locate image: prefer local images folder pattern <id>_1.(jpg|png|webp)
  let image = null;
  const imagesDir = path.join(GLOVES_DIR, 'images');
  if (fs.existsSync(imagesDir)) {
    const cand = fs.readdirSync(imagesDir).find(n => n.startsWith(id) && /_1\.(jpe?g|png|webp|avif)$/i.test(n));
    if (cand) image = 'assets/info/prodInfo/Gloves/images/' + cand;
  }
  // Per‑product folder case (e.g. Some_Product_Folder/images/*.jpg) – match slug to folder slug fallback
  if (!image) {
    try {
      const entries = fs.readdirSync(GLOVES_DIR, { withFileTypes: true }).filter(e=>e.isDirectory());
      for (const e of entries) {
        const folderSlug = slugify(e.name);
        if (!folderSlug.includes(id.slice(0,20))) continue; // heuristic partial match
        const imgDir = path.join(GLOVES_DIR, e.name, 'images');
        if (fs.existsSync(imgDir)) {
          const imgs = fs.readdirSync(imgDir).filter(n => /_1\.(jpe?g|png|webp|avif)$/i.test(n));
          if (imgs.length) { image = 'assets/info/prodInfo/Gloves/' + e.name + '/images/' + imgs[0]; break; }
        }
      }
    } catch {}
  }
  return {
    id,
    name,
    title: name,
    description: cleanDesc(raw.description),
    price,
    category: 'gloves',
    image: image || 'assets/EZSportslogo.png',
    images: image ? [image] : [],
    features: Array.isArray(raw.features) ? raw.features.slice(0,30) : []
  };
}

function build(){
  if (!fs.existsSync(GLOVES_DIR)) {
    console.error('[gloves-build] Directory not found:', GLOVES_DIR);
    process.exit(1);
  }
  const entries = fs.readdirSync(GLOVES_DIR, { withFileTypes: true });
  const products = [];
  // Loose JSON files at root of Gloves directory
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.json')) {
      try {
        const prod = buildFromLooseJson(path.join(GLOVES_DIR, e.name));
        if (prod) products.push(prod);
      } catch(err){
        console.warn('Failed to parse', e.name, err.message);
      }
    }
    // Folder form rarely used for gloves (handled in image heuristic inside buildFromLooseJson)
  }
  products.sort((a,b)=> a.title.localeCompare(b.title));
  fs.writeFileSync(OUTPUT, JSON.stringify(products, null, 2));
  console.log(`Built ${products.length} Gloves products -> ${path.relative(ROOT, OUTPUT)}`);
}

build();
