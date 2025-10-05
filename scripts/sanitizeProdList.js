const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'assets', 'prodList.json');
const STANDARD_FEATURE = 'Fast and Reliable Shipping';

function normalizeFeatures(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (let f of arr) {
    if (typeof f !== 'string') continue;
    let s = f.trim();
    if (!s) continue;
    // Heuristic guards to avoid altering dimension/spec lines
    const isDimensions = /^\s*shipping\s*dimensions\b/i.test(s) || /\b(Screen Box|Pad Kit Box)\b/i.test(s);
    // Replace any feature that claims Free Shipping/Delivery with a standard non-free shipping line
    const hasFree = /\bfree\b/i.test(s);
    const hasShipOrDelivery = /\bship(?:ping)?\b|\bdelivery\b/i.test(s);
    if (!isDimensions && hasShipOrDelivery) {
      if (hasFree) {
        s = STANDARD_FEATURE;
      } else if (/^\s*shipping\s*:/i.test(s) || /^\s*delivery\s*:/i.test(s) || /ships in \d+\s*business\s*day/i.test(s) || /^\s*fast\s+shipping\b/i.test(s)) {
        // Normalize various shipping policy lines to standard
        s = STANDARD_FEATURE;
      }
    }
    // Dedup (case-insensitive)
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  // Ensure a shipping policy feature exists (exclude dimension/spec lines)
  const hasShippingPolicy = out.some(x => {
    if (typeof x !== 'string') return false;
    if (/^\s*shipping\s*dimensions\b/i.test(x) || /\b(Screen Box|Pad Kit Box)\b/i.test(x)) return false;
    return /(^\s*shipping\s*:|^\s*delivery\s*:|\bship(?:ping)?\b|\bdelivery\b|^\s*fast\s+shipping\b)/i.test(x);
  });
  if (!hasShippingPolicy) {
    out.unshift(STANDARD_FEATURE);
  }
  return out;
}

function run() {
  const raw = fs.readFileSync(FILE, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse JSON at', FILE);
    console.error(e.message);
    process.exit(1);
  }
  const cats = json && json.categories;
  if (!cats || typeof cats !== 'object') {
    console.error('No categories found in prodList.json');
    process.exit(1);
  }
  let prodCount = 0;
  let changedCount = 0;
  for (const key of Object.keys(cats)) {
    const arr = cats[key];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      prodCount++;
      const before = Array.isArray(p?.details?.features) ? p.details.features.slice() : null;
      if (!p.details) p.details = {};
      p.details.features = normalizeFeatures(p.details.features || []);
      const after = p.details.features;
      if (JSON.stringify(before) !== JSON.stringify(after)) changedCount++;
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`Sanitized features for ${changedCount}/${prodCount} products. Wrote ${FILE}`);
}

run();
