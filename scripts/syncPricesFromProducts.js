// Sync Prices.csv with values from exports/products.csv
// - Preserves Prices.csv schema and formatting (currency, /ft, Free shipping, notes)
// - Updates map, wholesale, shipping (when provided), profit, profitPct
// - Matches on SKU; when multiple rows per SKU in products.csv, chooses the closest match to existing values

const fs = require('fs');
const path = require('path');

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const PRICES_CSV = path.join(ROOT, 'Prices.csv');
const PRODUCTS_CSV = path.join(ROOT, 'exports', 'products.csv');

function parseCSV(text) {
  const rows = [];
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      if (ch === '\r') { // handle CRLF
        i++;
        continue;
      }
      field += ch;
      i++;
    }
  }
  // last field
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function stringifyCSV(rows) {
  const quoteIfNeeded = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    if (s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return '"' + s + '"';
    }
    return s;
  };
  return rows.map(r => r.map(quoteIfNeeded).join(',')).join('\n');
}

function parseMoney(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (/^free$/i.test(s)) return 0; // treat Free as 0 for math
  // handle unit pricing like $0.50/ft or 0.50/ft or $2.50
  const num = s.replace(/\$/g, '').replace(/\s*\/ft$/i, '');
  const v = parseFloat(num);
  return Number.isFinite(v) ? v : null;
}

function formatMoney(v, { unit = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '';
  const s = `$${v.toFixed(2)}`;
  return unit ? `${s}/ft` : s;
}

function formatPercent(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
}

function loadProducts() {
  const text = fs.readFileSync(PRODUCTS_CSV, 'utf8');
  const rows = parseCSV(text);
  const header = rows.shift();
  const idx = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const req = ['name', 'sku', 'wholesale', 'map', 'shipping'];
  for (const r of req) {
    if (!(r in idx)) throw new Error(`products.csv missing column: ${r}`);
  }
  const bySku = new Map();
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const sku = (row[idx['sku']] || '').trim();
    if (!sku) continue;
    const name = (row[idx['name']] || '').trim();
    const wholesale = parseMoney(row[idx['wholesale']]);
    const mapVal = parseMoney(row[idx['map']]);
    const ship = parseMoney(row[idx['shipping']]); // may be null or 0
    const profit = parseMoney(row[idx['profit']]);
    const profitPctStr = row[idx['profit %']] || row[idx['profit%']] || '';
    const item = { name, sku, wholesale, map: mapVal, shipping: ship, profit, profitPctStr };
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(item);
  }
  return bySku;
}

function loadPrices() {
  const text = fs.readFileSync(PRICES_CSV, 'utf8');
  const rows = parseCSV(text);
  const header = rows.shift();
  const idx = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const expected = ['category', 'sku', 'title', 'option', 'map', 'wholesale', 'shipping', 'profit', 'profitpct', 'notes'];
  for (const e of expected) {
    if (!(e in idx)) throw new Error(`Prices.csv missing column: ${e}`);
  }
  return { header, idx, rows };
}

function hasPerFt(row, idx) {
  const mapStr = row[idx['map']] || '';
  const title = (row[idx['title']] || '').toLowerCase();
  const sku = (row[idx['sku']] || '').toLowerCase();
  return /\/ft$/i.test(mapStr) || /by the ft/i.test(title) || sku.includes('xft') || sku.includes('inchxft');
}

function chooseBestCandidate(cands, currentWholesale, currentMap, currentShip) {
  if (cands.length === 1) return cands[0];
  // First try exact numeric match on map+wholesale
  for (const c of cands) {
    if (c.wholesale === currentWholesale && c.map === currentMap) return c;
  }
  // Then try exact match on map
  for (const c of cands) {
    if (c.map === currentMap) return c;
  }
  // Then try nearest by sum of absolute differences
  let best = cands[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of cands) {
    const dw = currentWholesale != null && Number.isFinite(currentWholesale) && Number.isFinite(c.wholesale) ? Math.abs(c.wholesale - currentWholesale) : 0;
    const dm = currentMap != null && Number.isFinite(currentMap) && Number.isFinite(c.map) ? Math.abs(c.map - currentMap) : 0;
    const ds = currentShip != null && Number.isFinite(currentShip) && Number.isFinite(c.shipping) ? Math.abs(c.shipping - currentShip) : 0;
    const score = dw + dm + ds;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function main() {
  const productsBySku = loadProducts();
  const { header, idx, rows } = loadPrices();

  let updated = 0;
  let unmatched = 0;
  let multiMatched = 0;

  for (const row of rows) {
    const sku = (row[idx['sku']] || '').trim();
    if (!sku) continue;
    const perFt = hasPerFt(row, idx);
    const currentWholesale = parseMoney(row[idx['wholesale']]);
    const currentMap = parseMoney(row[idx['map']]);
    const shipStr = (row[idx['shipping']] || '').trim();
    const shippingIsFree = /^free$/i.test(shipStr);
    const currentShip = parseMoney(shipStr);

    const cands = productsBySku.get(sku) || [];
    if (cands.length === 0) { unmatched++; continue; }

    let cand = null;
    if (cands.length === 1) {
      cand = cands[0];
    } else {
      cand = chooseBestCandidate(cands, currentWholesale, currentMap, currentShip);
      multiMatched++;
    }

    const newWholesale = Number.isFinite(cand.wholesale) ? cand.wholesale : currentWholesale;
    const newMap = Number.isFinite(cand.map) ? cand.map : currentMap;
    // Shipping: prefer existing when Free; else use candidate if provided; otherwise keep existing
    let newShipVal = currentShip;
    if (!shippingIsFree && Number.isFinite(cand.shipping)) {
      newShipVal = cand.shipping;
    }

    const profitVal = (Number.isFinite(newMap) && Number.isFinite(newWholesale)) ? (newMap - newWholesale) : null;
    const profitPctVal = (Number.isFinite(newMap) && newMap !== 0 && Number.isFinite(profitVal)) ? (profitVal / newMap * 100) : null;

    const newMapStr = perFt ? formatMoney(newMap, { unit: true }) : formatMoney(newMap);
    const newWholesaleStr = perFt ? formatMoney(newWholesale, { unit: true }) : formatMoney(newWholesale);
    const newProfitStr = perFt ? formatMoney(profitVal, { unit: true }) : formatMoney(profitVal);
    const newShipStr = shippingIsFree ? 'Free' : (Number.isFinite(newShipVal) ? formatMoney(newShipVal) : row[idx['shipping']]);
    const newProfitPctStr = formatPercent(profitPctVal);

    const before = [row[idx['map']], row[idx['wholesale']], row[idx['shipping']]].join('|');
    row[idx['map']] = newMapStr || row[idx['map']];
    row[idx['wholesale']] = newWholesaleStr || row[idx['wholesale']];
    row[idx['shipping']] = newShipStr;
    row[idx['profit']] = newProfitStr || row[idx['profit']];
    row[idx['profitpct']] = newProfitPctStr || row[idx['profitpct']];
    const after = [row[idx['map']], row[idx['wholesale']], row[idx['shipping']]].join('|');
    if (before !== after) updated++;
  }

  const out = stringifyCSV([header, ...rows]) + '\n';
  fs.writeFileSync(PRICES_CSV, out, 'utf8');
  console.log(`Updated Prices.csv rows: ${updated}. Unmatched SKUs: ${unmatched}. Multi-candidate SKUs: ${multiMatched}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Failed to sync Prices.csv:', err.message);
    process.exit(1);
  }
}
