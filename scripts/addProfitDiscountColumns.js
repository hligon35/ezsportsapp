// Adds 10PD and 15PD columns to Prices.csv after profitPct, representing
// profit at 10% and 15% discounts off MAP, respectively.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const PRICES_CSV = path.join(ROOT, 'Prices.csv');

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function stringifyCSV(rows) {
  const q = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"')) return '"' + s.replace(/"/g, '""') + '"';
    if (s.includes(',') || s.includes('\n') || s.includes('\r')) return '"' + s + '"';
    return s;
  };
  return rows.map(r => r.map(q).join(',')).join('\n');
}

function parseMoney(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (/^free$/i.test(s)) return 0;
  const num = s.replace(/\$/g, '').replace(/\s*\/ft$/i, '');
  const v = parseFloat(num);
  return Number.isFinite(v) ? v : null;
}

function isPerFt(mapStr, title, sku) {
  const m = (mapStr || '').trim();
  const t = (title || '').toLowerCase();
  const s = (sku || '').toLowerCase();
  return /\/ft$/i.test(m) || /by the ft/i.test(t) || s.includes('xft') || s.includes('inchxft');
}

function formatMoney(v, unit) {
  if (v == null || !Number.isFinite(v)) return '';
  const s = `$${v.toFixed(2)}`;
  return unit ? `${s}/ft` : s;
}

function main() {
  const text = fs.readFileSync(PRICES_CSV, 'utf8');
  const rows = parseCSV(text);
  if (rows.length === 0) throw new Error('Prices.csv is empty');
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));

  // Required columns
  const req = ['category','sku','title','option','map','wholesale','profit','profitpct'];
  for (const r of req) { if (!(r in idx)) throw new Error(`Missing column: ${r}`); }

  // Determine insert position: after profitPct
  const profitPctPos = idx['profitpct'];
  const have10 = '10pd' in idx; const have15 = '15pd' in idx;

  let newHeader = header.slice();
  let pos = profitPctPos + 1;
  if (!have10 && !have15) {
    newHeader.splice(pos, 0, '10PD', '15PD');
  } else if (!have10 && have15) {
    newHeader.splice(pos, 0, '10PD');
  } else if (have10 && !have15) {
    // place 15PD after 10PD if 10PD exists; else after profitPct
    const tenPos = idx['10pd'];
    newHeader.splice(tenPos + 1, 0, '15PD');
  }

  // Build mapping from old positions to new positions
  const colMap = new Map();
  for (let i = 0; i < header.length; i++) colMap.set(i, i);
  if (newHeader.length !== header.length) {
    // When inserting, columns after insertion shift
    // We'll rebuild each row based on header names rather than index mapping
  }

  const outRows = [newHeader];
  const lowerName = (n) => n.trim().toLowerCase();
  const newIdx = Object.fromEntries(newHeader.map((h, i) => [lowerName(h), i]));

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Expand row to new length
    const newRow = new Array(newHeader.length).fill('');
    // Copy existing columns by name
    for (let i = 0; i < header.length; i++) {
      const name = lowerName(header[i]);
      newRow[newIdx[name]] = row[i] ?? '';
    }

    const mapStr = newRow[newIdx['map']];
    const whStr = newRow[newIdx['wholesale']];
    const title = newRow[newIdx['title']];
    const sku = newRow[newIdx['sku']];
    const unit = isPerFt(mapStr, title, sku);

    const mapVal = parseMoney(mapStr);
    const wholesaleVal = parseMoney(whStr);
    let pd10 = null, pd15 = null;
    if (Number.isFinite(mapVal) && Number.isFinite(wholesaleVal)) {
      pd10 = mapVal * 0.90 - wholesaleVal;
      pd15 = mapVal * 0.85 - wholesaleVal;
    }

    if (newIdx['10pd'] != null) newRow[newIdx['10pd']] = formatMoney(pd10, unit);
    if (newIdx['15pd'] != null) newRow[newIdx['15pd']] = formatMoney(pd15, unit);

    outRows.push(newRow);
  }

  fs.writeFileSync(PRICES_CSV, stringifyCSV(outRows) + '\n', 'utf8');
  console.log('Added/updated 10PD and 15PD columns in Prices.csv');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
