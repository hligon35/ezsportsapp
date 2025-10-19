// Sanitizes shipping feature lines in server/database/products.json
// - Replaces any "free shipping/delivery" claims with "Fast and Reliable Shipping"
// - Normalizes variations like FREE & FAST DELIVERY, FAST & FREE Shipping, etc.
// - Skips spec lines like "Shipping Dimensions" or "Shipping Dimension"

const fs = require('fs');
const path = require('path');

const SERVER_PRODUCTS = path.join(__dirname, '..', 'server', 'database', 'products.json');
const STD = 'Fast and Reliable Shipping';

// Regex to detect shipping marketing claims (case-insensitive)
const claimRe = /(\bshipping\b|\bdelivery\b)[^\n]{0,80}?(free|fast\s*&\s*free|free\s*&\s*fast|fast\s+delivery|free\s+delivery)/i;
// Also match known uppercase variants like "FREE & FAST DELIVERY" or "FAST DELIVERY"
const knownPhrases = [
  /\bFREE\s*&\s*FAST\s*DELIVERY\b/i,
  /\bFAST\s*&\s*FREE\s*SHIPPING\b/i,
  /\bFREE\s+SHIPPING\b/i,
  /\bFAST\s+DELIVERY\b/i
];

// Regex to detect spec lines we should not replace
const specRe = /shipping\s*dimension(s)?/i;

function sanitizeFeatures(features) {
  if (!Array.isArray(features)) return features;
  let changed = false;
  const out = [];
  for (let f of features) {
    if (typeof f !== 'string') { out.push(f); continue; }
    const isSpec = specRe.test(f);
    const isClaim = claimRe.test(f) || knownPhrases.some(rx => rx.test(f));
    if (isClaim && !isSpec) {
      // Replace whole line with standardized text
      out.push(STD);
      changed = true;
    } else {
      out.push(f);
    }
  }
  // Ensure STD present at least once
  if (!out.some(s => typeof s === 'string' && s.trim().toLowerCase() === STD.toLowerCase())) {
    out.unshift(STD);
    changed = true;
  }
  // Dedupe while preserving order
  const seen = new Set();
  const deduped = out.filter(s => {
    const key = typeof s === 'string' ? s.trim().toLowerCase() : s;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return changed ? deduped : out;
}

// Sanitize marketing shipping claims inside free-form text (descriptions)
function sanitizeDescription(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  // Replace common marketing claims, case-insensitive, preserving other content
  const replacements = [
    /fast\s*&\s*free\s*shipping/gi,
    /free\s*&\s*fast\s*shipping/gi,
    /fast\s*&\s*free\s*delivery/gi,
    /free\s*&\s*fast\s*delivery/gi,
    /fast\s*\+\s*free\s*shipping/gi,
    /fast\s+delivery/gi, // sometimes appears alone as marketing
    /free\s+shipping/gi,
    /free\s+delivery/gi
  ];
  for (const rx of replacements) {
    out = out.replace(rx, STD);
  }
  return out;
}

function run() {
  const raw = fs.readFileSync(SERVER_PRODUCTS, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) {
    console.error('Failed to parse products.json:', e.message);
    process.exit(1);
  }
  let updates = 0;
  for (const p of data) {
    if (Array.isArray(p.features)) {
      const before = JSON.stringify(p.features);
      p.features = sanitizeFeatures(p.features);
      const after = JSON.stringify(p.features);
      if (before !== after) updates++;
    }
    if (p.description) {
      const beforeDesc = p.description;
      p.description = sanitizeDescription(p.description);
      if (beforeDesc !== p.description) updates++;
    }
  }
  fs.writeFileSync(SERVER_PRODUCTS, JSON.stringify(data, null, 2));
  console.log(`Sanitized features for ${updates}/${data.length} products. Wrote ${SERVER_PRODUCTS}`);
}

if (require.main === module) run();
