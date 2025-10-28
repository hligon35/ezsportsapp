#!/usr/bin/env node
/**
 * Export a CSV of products from assets/prodList.json
 * Columns: Name, SKU, Wholesale, MAP, Shipping, Profit, Profit %
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function parseAmount(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const s = String(val).trim();
  // Capture leading number, optionally with $ and ignoring unit suffix like /ft
  const m = s.match(/^\$?\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.[0-9]+)?/);
  if (!m) {
    // Try generic float
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }
  const head = m[0].replace(/[$,\s]/g, '');
  const n = Number(head);
  if (Number.isFinite(n)) return n;
  // Fallback: extract any decimal pattern
  const m2 = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m2 ? Number(m2[1]) || 0 : 0;
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

(async () => {
  try {
    const prodPath = path.resolve(__dirname, '..', 'assets', 'prodList.json');
    const raw = await fsp.readFile(prodPath, 'utf8');
    const json = JSON.parse(raw);
    const categories = json.categories || {};
    const rows = [];
  // Header
  rows.push(['Name','SKU','Wholesale','MAP','Shipping','Profit','Profit %']);

    for (const [catName, arr] of Object.entries(categories)) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        try {
          const name = item.name || item.title || item.sku || '';
          const sku = item.sku || item.id || '';
          const wholesale = parseAmount(item.wholesale);
          const map = parseAmount(item.map ?? item.price ?? (item.details && item.details.price));
          const shipping = parseAmount(item.dsr);
          const profit = (map > 0 && wholesale > 0) ? (map - wholesale) : 0;
          const profitPct = (map > 0 && profit !== 0) ? ((profit / map) * 100) : 0;
          rows.push([
            csvEscape(name),
            csvEscape(sku),
            wholesale.toFixed(2),
            map.toFixed(2),
            shipping ? shipping.toFixed(2) : '',
            profit ? profit.toFixed(2) : '',
            profitPct ? profitPct.toFixed(2) + '%' : ''
          ]);
          // Variations (if any): include as separate rows
          if (Array.isArray(item.variations) && item.variations.length) {
            for (const v of item.variations) {
              try {
                const vNamePart = v.name || v.title || v.label || v.id || '';
                const vName = vNamePart ? `${name} — ${vNamePart}` : `${name} — Option`;
                const vSku = v.id || (sku && vNamePart ? `${sku}-${vNamePart}` : vNamePart || sku);
                const vWholesale = parseAmount(v.wholesale != null ? v.wholesale : item.wholesale);
                const vMap = parseAmount(v.map != null ? v.map : (v.price != null ? v.price : (item.map ?? item.price ?? (item.details && item.details.price))));
                const vShip = parseAmount(v.dsr != null ? v.dsr : item.dsr);
                const vProfit = (vMap > 0 && vWholesale > 0) ? (vMap - vWholesale) : 0;
                const vPct = (vMap > 0 && vProfit !== 0) ? ((vProfit / vMap) * 100) : 0;
                rows.push([
                  csvEscape(vName),
                  csvEscape(vSku),
                  vWholesale.toFixed(2),
                  vMap.toFixed(2),
                  vShip ? vShip.toFixed(2) : '',
                  vProfit ? vProfit.toFixed(2) : '',
                  vPct ? vPct.toFixed(2) + '%' : ''
                ]);
              } catch {}
            }
          }
        } catch {
          // continue
        }
      }
    }

    const outDir = path.resolve(__dirname, '..', 'exports');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'products.csv');
    const csv = rows.map(r => r.join(',')).join('\n');
    await fsp.writeFile(outFile, csv, 'utf8');
    console.log('Wrote CSV:', outFile, 'rows:', rows.length - 1);
  } catch (e) {
    console.error('Export failed:', e.message);
    process.exit(1);
  }
})();
