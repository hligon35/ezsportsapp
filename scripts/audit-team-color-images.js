/*
  Audit: team-color image sets

  Covered team-color products (screens + pitcher’s pockets, excluding replacement nets and
  screen-related accessories) should have a standardized 11-image set:
    assets/.../01.jpg ... 11.jpg

  This script scans assets/prodList.json and generates a markdown report.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROD_LIST_PATH = path.join(ROOT, 'assets', 'prodList.json');
const OUT_PATH = path.join(ROOT, 'docs', 'team-color-image-audit.md');

const TEAM_COLORS = ['black','columbiablue','darkgreen','green','maroon','navy','orange','purple','red','royal','yellow'];

function normalizeStr(v) {
  return String(v || '').trim();
}

function isScreenOrPocketTeamColorProduct({ sku, name }) {
  const titleLower = normalizeStr(name).toLowerCase();
  const idLower = normalizeStr(sku).toLowerCase();

  const isReplacementNet = (/\breplacement\b/.test(titleLower) && /\bnet\b/.test(titleLower)) || /replacement\s*nets?\b/.test(titleLower);
  const isScreenBulletz = /screen\s*bulletz/.test(titleLower);
  const isNonScreenAccessory = /screen\s*padding|screen\s*component|screen\s*wheel|wheel\s*kit|leg\s*caps?\b/.test(titleLower);
  const isPadKit = /\bpad\s*kit\b/.test(titleLower) || /^pk-?/.test(idLower);

  const looksLikeAnyScreen = (/(^|\b)screen(\b|$)/.test(titleLower) || /\bfront\s*toss\b/.test(titleLower) || /\bfast\s*pitch\b/.test(titleLower))
    && !isReplacementNet
    && !isNonScreenAccessory
    && !isScreenBulletz;

  const looksLikePitchersPocket = /pitcher'?s\s*pocket\b/.test(titleLower)
    || /\bpitchers\s*pocket\b/.test(titleLower)
    || /bbpp[-_]?pro/.test(idLower)
    || /pppro/.test(idLower);

  // Exclude pad kits from the strict screen/pocket requirement; those are accessories.
  return (looksLikeAnyScreen || looksLikePitchersPocket) && !isPadKit;
}

function isTeamColorAccessory({ sku, name }) {
  const titleLower = normalizeStr(name).toLowerCase();
  const idLower = normalizeStr(sku).toLowerCase();

  const isWBasket = idLower === 'wbasket' || /wheeled\s*ball\s*basket/.test(titleLower);
  const isScreenPadding = /screen\s*padding/.test(titleLower) || (idLower === 'screen component' && /padding/.test(titleLower));
  const isPadKit = /\bpad\s*kit\b/.test(titleLower) || /^pk-?/.test(idLower);

  return isWBasket || isScreenPadding || isPadKit;
}

function getNumberedImageIndexes(stripeImages) {
  const indexes = new Set();
  const nonNumbered = [];
  (Array.isArray(stripeImages) ? stripeImages : []).forEach(src => {
    const base = String(src || '').split('/').pop().toLowerCase();
    const m = base.match(/^(\d{2})\.(?:png|jpe?g|webp|avif|gif|svg)(\?|$)/);
    if (!m) {
      if (base) nonNumbered.push(base);
      return;
    }
    const idx = parseInt(m[1], 10);
    if (Number.isFinite(idx)) indexes.add(idx);
  });
  return { indexes, nonNumbered };
}

function main() {
  if (!fs.existsSync(PROD_LIST_PATH)) {
    console.error(`Missing ${PROD_LIST_PATH}`);
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(PROD_LIST_PATH, 'utf8');
  const json = JSON.parse(raw);
  const categories = json && json.categories ? json.categories : {};

  const products = [];
  for (const [categoryName, items] of Object.entries(categories)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const sku = item && (item.sku || item.id || item.SKU);
      const name = item && (item.name || item.title || item.details?.name || item.details?.title);
      const stripeImages = item && (item.stripeImages || item.images || item.gallery);
      products.push({ categoryName, sku, name, stripeImages });
    }
  }

  const strictCovered = products.filter(p => isScreenOrPocketTeamColorProduct(p));
  const accessoryCovered = products.filter(p => isTeamColorAccessory(p));

  const rowsStrict = strictCovered.map(p => {
    const { indexes, nonNumbered } = getNumberedImageIndexes(p.stripeImages);
    const missing = [];
    for (let i = 1; i <= TEAM_COLORS.length; i++) {
      if (!indexes.has(i)) missing.push(String(i).padStart(2, '0'));
    }
    const present = Array.from(indexes).sort((a, b) => a - b).map(n => String(n).padStart(2, '0'));
    const ok = missing.length === 0;
    return {
      ok,
      sku: normalizeStr(p.sku),
      name: normalizeStr(p.name),
      category: normalizeStr(p.categoryName),
      present,
      missing,
      extraCount: Math.max(0, (Array.isArray(p.stripeImages) ? p.stripeImages.length : 0) - indexes.size),
      nonNumbered: nonNumbered.slice(0, 5)
    };
  });

  const rowsAccessories = accessoryCovered.map(p => {
    const { indexes, nonNumbered } = getNumberedImageIndexes(p.stripeImages);
    const missing = [];
    for (let i = 1; i <= TEAM_COLORS.length; i++) {
      if (!indexes.has(i)) missing.push(String(i).padStart(2, '0'));
    }
    const present = Array.from(indexes).sort((a, b) => a - b).map(n => String(n).padStart(2, '0'));
    const ok = missing.length === 0;
    return {
      ok,
      sku: normalizeStr(p.sku),
      name: normalizeStr(p.name),
      category: normalizeStr(p.categoryName),
      present,
      missing,
      extraCount: Math.max(0, (Array.isArray(p.stripeImages) ? p.stripeImages.length : 0) - indexes.size),
      nonNumbered: nonNumbered.slice(0, 5)
    };
  });

  const okStrict = rowsStrict.filter(r => r.ok).length;
  const badStrict = rowsStrict.filter(r => !r.ok);
  const okAccessories = rowsAccessories.filter(r => r.ok).length;
  const badAccessories = rowsAccessories.filter(r => !r.ok);

  const now = new Date();
  const header = [
    '# Team-color image audit',
    '',
    `Generated: ${now.toISOString()}`,
    '',
    'Rules:',
    `- Screens + Pitcher\'s Pockets must have a full 11-image numbered set: 01..11.`,
    `- Team-color accessories (pad kits, screen padding by the FT, wheeled basket) may show dots with a hero fallback, but should ideally also have 01..11 for matching per-color photos.`,
    `- Expected palette order: ${TEAM_COLORS.join(', ')}`,
    '',
    'Summary:',
    `- Screens/Pockets covered: ${strictCovered.length}`,
    `- Screens/Pockets complete (01..11 present): ${okStrict}`,
    `- Screens/Pockets missing/invalid sets: ${badStrict.length}`,
    `- Accessories covered: ${accessoryCovered.length}`,
    `- Accessories complete (01..11 present): ${okAccessories}`,
    `- Accessories missing/invalid sets: ${badAccessories.length}`,
    ''
  ].join('\n');

  let body = '';
  body += '## Screens + Pitcher\'s Pockets\n\n';
  if (!badStrict.length) {
    body += 'All covered screens/pockets have complete 01..11 sets.\n\n';
  } else {
    body += '### Missing/invalid sets\n\n';
    body += '| SKU | Name | Category | Present | Missing | Notes |\n';
    body += '|---|---|---|---|---|---|\n';
    for (const r of badStrict) {
      const sku = r.sku || '(missing sku)';
      const name = r.name || '(missing name)';
      const category = r.category || '(unknown)';
      const present = r.present.length ? r.present.join(',') : '—';
      const missing = r.missing.length ? r.missing.join(',') : '—';
      const notesBits = [];
      if (r.extraCount) notesBits.push(`${r.extraCount} non-numbered images`);
      if (r.nonNumbered.length) notesBits.push(`examples: ${r.nonNumbered.join(', ')}`);
      const notes = notesBits.length ? notesBits.join('; ') : '—';
      body += `| ${sku} | ${name.replace(/\|/g, '\\|')} | ${category.replace(/\|/g, '\\|')} | ${present} | ${missing} | ${notes.replace(/\|/g, '\\|')} |\n`;
    }
    body += '\n';
  }

  body += '## Accessories\n\n';
  if (!badAccessories.length) {
    body += 'All covered accessories have complete 01..11 sets.\n';
  } else {
    body += '### Missing/invalid sets (dots may fall back to hero image)\n\n';
    body += '| SKU | Name | Category | Present | Missing | Notes |\n';
    body += '|---|---|---|---|---|---|\n';
    for (const r of badAccessories) {
      const sku = r.sku || '(missing sku)';
      const name = r.name || '(missing name)';
      const category = r.category || '(unknown)';
      const present = r.present.length ? r.present.join(',') : '—';
      const missing = r.missing.length ? r.missing.join(',') : '—';
      const notesBits = [];
      if (r.extraCount) notesBits.push(`${r.extraCount} non-numbered images`);
      if (r.nonNumbered.length) notesBits.push(`examples: ${r.nonNumbered.join(', ')}`);
      const notes = notesBits.length ? notesBits.join('; ') : '—';
      body += `| ${sku} | ${name.replace(/\|/g, '\\|')} | ${category.replace(/\|/g, '\\|')} | ${present} | ${missing} | ${notes.replace(/\|/g, '\\|')} |\n`;
    }
    body += '\n';
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, header + body, 'utf8');

  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`Screens/Pockets: ${strictCovered.length}; complete: ${okStrict}; missing/invalid: ${badStrict.length}`);
  console.log(`Accessories: ${accessoryCovered.length}; complete: ${okAccessories}; missing/invalid: ${badAccessories.length}`);
  if (badStrict.length) {
    console.log('First few screen/pocket missing/invalid:');
    badStrict.slice(0, 10).forEach(r => console.log(`- ${r.sku}: missing [${r.missing.join(', ')}]`));
  }
  if (badAccessories.length) {
    console.log('First few accessory missing/invalid:');
    badAccessories.slice(0, 10).forEach(r => console.log(`- ${r.sku}: missing [${r.missing.join(', ')}]`));
  }
}

main();
