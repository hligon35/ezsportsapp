// Training facility design configurator (MVP)
// - Dimensions + net type + add-ons
// - Live estimated price range
// - Lead capture via /api/marketing/contact

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function fmtMoney(n) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

function apiBases() {
  const bases = [];
  try {
    if (window.__API_BASE) bases.push(String(window.__API_BASE).replace(/\/$/, ''));
  } catch {}
  try {
    const meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) bases.push(String(meta.content).replace(/\/$/, ''));
  } catch {}
  // Relative (works when served by the same origin)
  bases.push('');
  // Known hosted backend fallback
  bases.push('https://ezsportsapp.onrender.com');
  return Array.from(new Set(bases));
}

async function fetchWithTimeout(url, options, timeoutMs = 4500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getTurnstileTokenSafe() {
  try {
    if (typeof window.getTurnstileToken === 'function') {
      return await window.getTurnstileToken();
    }
  } catch {}
  return '';
}

const DEFAULT_NET_TYPES = [
  // Fallbacks only. We attempt to derive $/sqft from real catalog MAP pricing (assets/prodList.json).
  { id: 'nylon-21', name: 'Nylon #21 (Standard)', rateLow: 2.5, rateHigh: 3.5 },
  { id: 'nylon-36', name: 'Nylon #36 (Heavy Duty)', rateLow: 3.5, rateHigh: 5.0 },
  { id: 'hdpe', name: 'Poly / HDPE (UV / Outdoor)', rateLow: 2.0, rateHigh: 3.0 },
  { id: 'high-impact', name: 'High-Impact / Premium', rateLow: 6.0, rateHigh: 9.0 }
];

let NET_TYPES = [...DEFAULT_NET_TYPES];
let PRICING_SOURCE = 'fallback';

function parseMoney(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const m = value.match(/-?\d+(?:\.\d+)?/);
  if (!m) return NaN;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : NaN;
}

function parseSizeTriple(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return null;
  const parts = sizeStr.split('x').map(s => Number(String(s).trim()));
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n <= 0)) return null;
  // Catalog convention appears to be width x height x length (ft)
  const [widthFt, heightFt, lengthFt] = parts;
  return { widthFt, heightFt, lengthFt };
}

function cageTubeAreaSqft(size) {
  // Pre-made cages are typically a tube (no end caps): perimeter * length
  const perimeterFt = 2 * (size.widthFt + size.heightFt);
  return perimeterFt * size.lengthFt;
}

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedAsc[base + 1] === undefined) return sortedAsc[base];
  return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
}

async function loadNetRatesFromCatalog() {
  const res = await fetchWithTimeout('assets/prodList.json', { method: 'GET' }, 6500);
  if (!res.ok) throw new Error(`Failed to load prodList.json (${res.status})`);
  const data = await res.json();

  const cages = data?.categories?.['Pre-Made Cages'];
  if (!Array.isArray(cages) || cages.length === 0) {
    throw new Error('No Pre-Made Cages found in prodList.json');
  }

  const byKey = new Map();
  for (const item of cages) {
    const material = String(item?.material || '').trim();
    const gauge = Number(item?.gauge);
    const size = parseSizeTriple(String(item?.size || ''));
    const map = parseMoney(item?.map);
    if (!material || !Number.isFinite(gauge) || !size || !Number.isFinite(map) || map <= 0) continue;

    const areaSqft = cageTubeAreaSqft(size);
    if (!Number.isFinite(areaSqft) || areaSqft <= 0) continue;

    const rate = map / areaSqft;
    if (!Number.isFinite(rate) || rate <= 0) continue;

    const key = `${material.toLowerCase()}-${gauge}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(rate);
  }

  const derived = {};
  for (const [key, rates] of byKey.entries()) {
    const sorted = rates.slice().sort((a, b) => a - b);
    const p25 = quantile(sorted, 0.25);
    const p75 = quantile(sorted, 0.75);
    if (!Number.isFinite(p25) || !Number.isFinite(p75)) continue;
    derived[key] = {
      low: Math.max(0.01, p25),
      high: Math.max(0.01, p75),
      sampleCount: sorted.length
    };
  }

  const netTypes = [...DEFAULT_NET_TYPES].map(nt => ({ ...nt }));

  const nylon21 = derived['nylon-21'];
  if (nylon21) {
    const nt = netTypes.find(n => n.id === 'nylon-21');
    if (nt) {
      nt.rateLow = nylon21.low;
      nt.rateHigh = nylon21.high;
      nt.name = 'Nylon #21 (Standard)';
    }
  }

  const nylon36 = derived['nylon-36'];
  if (nylon36) {
    const nt = netTypes.find(n => n.id === 'nylon-36');
    if (nt) {
      nt.rateLow = nylon36.low;
      nt.rateHigh = nylon36.high;
      nt.name = 'Nylon #36 (Heavy Duty)';
    }
  }

  // Best available outdoor proxy in current catalog: Poly #36 cages
  const poly36 = derived['poly-36'];
  if (poly36) {
    const nt = netTypes.find(n => n.id === 'hdpe');
    if (nt) {
      nt.rateLow = poly36.low;
      nt.rateHigh = poly36.high;
      nt.name = 'Poly / HDPE (UV / Outdoor)';
    }
  }

  return { netTypes, source: 'catalog-map', derived };
}

function setNetTypeOptions(selectEl, selectedValue) {
  if (!selectEl) return;
  const keepFirst = !!(selectEl.options && selectEl.options.length > 0 && (selectEl.options[0].value === '' || selectEl.options[0].disabled));
  const first = keepFirst ? selectEl.options[0] : null;
  selectEl.innerHTML = '';
  if (first) selectEl.appendChild(first);
  NET_TYPES.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = n.name;
    selectEl.appendChild(opt);
  });

  if (selectedValue && NET_TYPES.some(n => n.id === selectedValue)) {
    selectEl.value = selectedValue;
  } else if (NET_TYPES[0]) {
    selectEl.value = NET_TYPES[0].id;
  }
}

function estimatePrice(state) {
  const lengthFt = clampNumber(state.lengthFt, 10, 400);
  const widthFt = clampNumber(state.widthFt, 10, 400);
  const heightFt = clampNumber(state.heightFt, 8, 80);

  const perimeter = 2 * (lengthFt + widthFt);
  const wallArea = perimeter * heightFt;
  const ceilingArea = lengthFt * widthFt;

  const coverage = state.coverage;
  const baseArea = (coverage === 'full') ? (wallArea + ceilingArea) : wallArea;

  const dividerCount = clampNumber(state.dividerCount, 0, 20);
  const dividerAreaEach = widthFt * heightFt;
  const dividerArea = dividerCount * dividerAreaEach;

  const impactPct = clampNumber(state.impactPct, 0, 100) / 100;
  const impactArea = wallArea * impactPct;

  const totalSqft = Math.max(0, baseArea + dividerArea + impactArea);

  const net = NET_TYPES.find(n => n.id === state.netType) || NET_TYPES[0];
  let low = totalSqft * net.rateLow;
  let high = totalSqft * net.rateHigh;

  // System allowances:
  // Catalog-derived rates are based on comparable pre-made net packages.
  // Facilities typically require additional rigging/track/cable/hardware and often install labor.
  let multLow = 2.40;
  let multHigh = 3.40;

  if (state.trackSystem) { multLow += 0.85; multHigh += 1.60; }
  if (state.installation) { multLow += 0.75; multHigh += 1.35; }

  // Add-ons (flat)
  const doors = clampNumber(state.doorCount, 0, 12);
  const pad = state.padding;

  const flatLow = (doors * 200) + (pad ? 350 : 0);
  const flatHigh = (doors * 600) + (pad ? 850 : 0);

  low = low * multLow + flatLow;
  high = high * multHigh + flatHigh;

  // Round for cleaner ranges
  const roundTo = (n, step) => Math.round(n / step) * step;
  return {
    inputs: { lengthFt, widthFt, heightFt },
    pricingSource: PRICING_SOURCE,
    coverage,
    net,
    areas: {
      wallArea,
      ceilingArea,
      baseArea,
      dividerArea,
      impactArea,
      totalSqft
    },
    addOns: {
      dividerCount,
      impactPct: Math.round(impactPct * 100),
      trackSystem: !!state.trackSystem,
      installation: !!state.installation,
      padding: !!state.padding,
      doorCount: doors
    },
    price: {
      low: Math.max(0, roundTo(low, 50)),
      high: Math.max(0, roundTo(high, 50))
    }
  };
}

function buildMessage(estimate) {
  const a = estimate.areas;
  const add = estimate.addOns;
  const lines = [
    'Training Facility Design — Build Your Facility Request',
    '',
    `Dimensions (ft): ${estimate.inputs.lengthFt} L x ${estimate.inputs.widthFt} W x ${estimate.inputs.heightFt} H`,
    `Coverage: ${estimate.coverage === 'full' ? 'Full enclosure (walls + ceiling)' : 'Perimeter walls only'}`,
    `Net type: ${estimate.net.name}`,
    `Pricing source: ${estimate.pricingSource === 'catalog-map' ? 'Catalog (comparable net packages) + allowances' : 'Fallback estimate rates'}`,
    '',
    `Estimated netting area: ${Math.round(a.totalSqft).toLocaleString()} sq ft`,
    `  - Walls: ${Math.round(a.wallArea).toLocaleString()} sq ft`,
    `  - Ceiling: ${Math.round(a.ceilingArea).toLocaleString()} sq ft`,
    `  - Dividers: ${Math.round(a.dividerArea).toLocaleString()} sq ft (${add.dividerCount} divider(s))`,
    `  - Impact panels: ${Math.round(a.impactArea).toLocaleString()} sq ft (${add.impactPct}%)`,
    '',
    `Add-ons: Track=${add.trackSystem ? 'Yes' : 'No'}, Install=${add.installation ? 'Yes' : 'No'}, Padding=${add.padding ? 'Yes' : 'No'}, Doors/Openings=${add.doorCount}`,
    '',
    `Estimated range: ${fmtMoney(estimate.price.low)} – ${fmtMoney(estimate.price.high)}`,
    '',
    'Notes: (add any special requirements, bays/lanes, ceiling obstructions, pole spacing, etc.)'
  ];
  return lines.join('\n');
}

function renderEstimate(container, estimate) {
  if (!container) return;
  const totalSqft = Math.round(estimate.areas.totalSqft);
  container.innerHTML = `
    <div style="display:grid; gap:.6rem;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:.75rem; flex-wrap:wrap;">
        <div style="font-weight:900; font-size:1.1rem;">${fmtMoney(estimate.price.low)} – ${fmtMoney(estimate.price.high)}</div>
        <div class="muted" style="font-weight:700;">~${totalSqft.toLocaleString()} sq ft</div>
      </div>
      <div class="muted" style="font-size:.9rem; line-height:1.35;">
        Estimated price range based on your selections. For a detailed quote, please contact our team.
      </div>
      <div style="display:grid; gap:.35rem; font-size:.92rem;">
        <div><strong>Coverage:</strong> ${estimate.coverage === 'full' ? 'Full enclosure (walls + ceiling)' : 'Perimeter walls only'}</div>
        <div><strong>Net:</strong> ${estimate.net.name}</div>
        <div><strong>Add-ons:</strong> ${estimate.addOns.trackSystem ? 'Track' : 'No track'}, ${estimate.addOns.installation ? 'Install' : 'No install'}, ${estimate.addOns.padding ? 'Padding' : 'No padding'}, ${estimate.addOns.doorCount} door/opening(s)</div>
      </div>
    </div>
  `;
}

function initFacilityConfigurator() {
  const root = document.getElementById('facility-configurator');
  if (!root) return;

  const form = document.getElementById('facility-form');
  const estEl = document.getElementById('facility-estimate');
  const quoteForm = document.getElementById('facility-quote-form');
  const msgEl = document.getElementById('facility-quote-msg');
  const msgBox = document.getElementById('facility-message');

  if (!form || !estEl || !quoteForm) return;

  const state = {
    lengthFt: 60,
    widthFt: 40,
    heightFt: 16,
    coverage: 'full',
    netType: 'nylon-36',
    dividerCount: 0,
    impactPct: 0,
    trackSystem: false,
    installation: false,
    padding: false,
    doorCount: 0
  };

  const readStateFromForm = () => {
    const get = (name) => form.elements.namedItem(name);

    state.lengthFt = Number(get('lengthFt')?.value || state.lengthFt);
    state.widthFt = Number(get('widthFt')?.value || state.widthFt);
    state.heightFt = Number(get('heightFt')?.value || state.heightFt);
    state.coverage = String(get('coverage')?.value || state.coverage);
    state.netType = String(get('netType')?.value || state.netType);

    state.dividerCount = Number(get('dividerCount')?.value || 0);
    state.impactPct = Number(get('impactPct')?.value || 0);
    state.doorCount = Number(get('doorCount')?.value || 0);

    state.trackSystem = !!get('trackSystem')?.checked;
    state.installation = !!get('installation')?.checked;
    state.padding = !!get('padding')?.checked;
  };

  const update = () => {
    readStateFromForm();
    const est = estimatePrice(state);
    renderEstimate(estEl, est);
    if (msgBox) msgBox.value = buildMessage(est);
  };

  // Populate net types
  const netSelect = form.elements.namedItem('netType');
  if (netSelect && netSelect.options && netSelect.options.length <= 1) {
    setNetTypeOptions(netSelect, state.netType);
  }

  form.addEventListener('input', update, { passive: true });
  form.addEventListener('change', update);

  // Initial render (fast) using fallbacks, then refresh with catalog-derived pricing.
  update();

  // Try to load MAP-derived net pricing, then re-render.
  (async () => {
    try {
      const pricing = await loadNetRatesFromCatalog();
      if (pricing && Array.isArray(pricing.netTypes) && pricing.netTypes.length) {
        NET_TYPES = pricing.netTypes;
        PRICING_SOURCE = pricing.source || 'catalog-map';
        if (netSelect) setNetTypeOptions(netSelect, state.netType);
      }
    } catch (e) {
      console.debug('Facility configurator pricing fallback (catalog load failed):', e);
    } finally {
      update();
    }
  })();

  quoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const setMsg = (text, kind) => {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.classList.remove('is-success', 'is-error');
      if (kind) msgEl.classList.add(kind);
    };

    const fd = new FormData(quoteForm);
    const name = String(fd.get('name') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const company = String(fd.get('company') || '').trim();
    const locationText = String(fd.get('location') || '').trim();
    const notes = String(fd.get('notes') || '').trim();
    const hp = String(fd.get('hp') || '').trim();

    if (!name || !email) {
      setMsg('Please add your name and email.', 'is-error');
      return;
    }

    // Basic anti-bot honeypot
    if (hp) {
      setMsg('Thanks!', 'is-success');
      quoteForm.reset();
      return;
    }

    setMsg('Sending…');

    const est = estimatePrice(state);
    const message = [buildMessage(est), '', `Company/School: ${company}`, `Location: ${locationText}`, '', `Additional notes: ${notes}`].join('\n');

    const token = await getTurnstileTokenSafe();
    const payload = {
      name,
      email,
      phone,
      message,
      topic: 'training-facility-design',
      source: (location.pathname || '').replace(/^\\/, '/'),
      referer: document.referrer || '',
      facility: {
        state: { ...state },
        estimate: est
      },
      hp: '',
      finger: 'ok',
      started: Date.now(),
      'cf-turnstile-response': token
    };

    let lastErr = null;
    for (const base of apiBases()) {
      const url = `${base}/api/marketing/contact`;
      try {
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, 5500);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.ok !== false) {
          setMsg('Request sent! We’ll reach out shortly.', 'is-success');
          quoteForm.reset();
          return;
        }
        lastErr = data;
      } catch (e2) {
        lastErr = e2;
      }
    }

    console.debug('Facility quote submission failed:', lastErr);
    setMsg('Could not send right now. Please try again or call (386) 837-3131.', 'is-error');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFacilityConfigurator);
} else {
  initFacilityConfigurator();
}
