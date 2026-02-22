let cached = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    if (row.length === 1 && String(row[0] || '').trim() === '') return;
    rows.push(row);
    row = [];
  };

  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      pushField();
      continue;
    }

    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }

    if (ch === '\r') continue;

    field += ch;
  }

  pushField();
  pushRow();

  if (!rows.length) return [];

  const headers = rows[0].map(h => String(h || '').trim());
  const objects = [];
  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r];
    if (!vals || !vals.length) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      obj[key] = vals[c] != null ? String(vals[c]).trim() : '';
    }
    const hasAny = Object.values(obj).some(v => String(v || '').trim() !== '');
    if (hasAny) objects.push(obj);
  }
  return objects;
}

function toNumber(v, fallback = 0) {
  const raw = String(v ?? '').trim();
  if (raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function toNumberOrNaN(v) {
  const raw = String(v ?? '').trim();
  if (raw === '') return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

function resolveBorderWeight(weightsByName, borderType) {
  const k = normKey(borderType);
  if (!k) return 0;
  if (k === 'lead rope') {
    const alt = weightsByName.get('lead rope (bottom)');
    if (alt && Number.isFinite(alt.weight_per_unit)) return alt.weight_per_unit;
  }
  const rec = weightsByName.get(k);
  return rec && Number.isFinite(rec.weight_per_unit) ? rec.weight_per_unit : 0;
}

export async function getPricingData() {
  if (cached) return cached;

  const [weightsRes, borderRes] = await Promise.all([
    fetch('assets/product-pricing-weights.csv', { cache: 'no-store' }),
    fetch('assets/border-pricing-multipliers.csv', { cache: 'no-store' }),
  ]);

  if (!weightsRes.ok) throw new Error('Failed to load product-pricing-weights.csv');
  if (!borderRes.ok) throw new Error('Failed to load border-pricing-multipliers.csv');

  const [weightsRaw, borderRaw] = await Promise.all([weightsRes.text(), borderRes.text()]);

  const weightsRows = parseCsv(weightsRaw);
  const borderRows = parseCsv(borderRaw);

  const weightsByName = new Map();
  for (const r of weightsRows) {
    const name = String(r['Column 1'] || r['Column1'] || r['Name'] || r['name'] || '').trim();
    if (!name) continue;
    weightsByName.set(normKey(name), {
      name,
      retail_price_per_unit: toNumber(r['Retail'], 0),
      wholesale_price_per_unit: toNumber(r['Wholesale'], 0),
      weight_per_unit: toNumber(r['Weight'], 0),
    });
  }

  const borderOptions = borderRows
    .map((r) => {
      const border_type = String(r['Border Item'] || r['Border'] || r['border_type'] || '').trim();
      if (!border_type) return null;
      const standard = toNumber(r['Standard Cost Multiplier'], 0);
      const override = toNumberOrNaN(r['Override/Final Multiplier']);
      const base_cost = Number.isFinite(override) ? override : standard;
      const weight_per_unit = resolveBorderWeight(weightsByName, border_type);
      return { border_type, base_cost, weight_per_unit };
    })
    .filter(Boolean);

  if (!borderOptions.some(b => normKey(b.border_type) === 'no border')) {
    if (weightsByName.has('no border')) {
      borderOptions.push({ border_type: 'No Border', base_cost: 0, weight_per_unit: resolveBorderWeight(weightsByName, 'No Border') });
    }
  }

  const borderNameSet = new Set(borderOptions.map(b => normKey(b.border_type)));
  const netComponents = [];
  for (const rec of weightsByName.values()) {
    if (borderNameSet.has(normKey(rec.name))) continue;
    netComponents.push({
      name: rec.name,
      spec_type: 'netting',
      retail_price_per_unit: rec.retail_price_per_unit,
      wholesale_price_per_unit: rec.wholesale_price_per_unit,
      weight_per_unit: rec.weight_per_unit,
    });
  }

  cached = { pricingData: { netComponents, borderOptions } };
  return cached;
}

export function __resetPricingDataCache() {
  cached = null;
}
