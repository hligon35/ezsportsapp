const path = require('path');
const fs = require('fs').promises;

const DatabaseManager = require('../database/DatabaseManager');
const AlertingService = require('./AlertingService');

function startOfDayUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDayUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function moneyNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt2(v) {
  return moneyNumber(v).toFixed(2);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inRange(ts, start, end) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function safeText(v, max = 240) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function parseByFootFeet(sizeRaw) {
  const s = String(sizeRaw || '').trim();
  if (!s) return null;
  // Common patterns: "By the Foot: 8'" or just "8'"
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function looksLikeCents(v) {
  // Orders DB stores subtotal/shipping/tax/total in cents.
  return Number.isInteger(v) && Math.abs(v) >= 100;
}

function centsToDollarsMaybe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return looksLikeCents(n) ? (n / 100) : n;
}

function renderEachBlocks(template, context) {
  return template.replace(/\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, name, block) => {
    const arr = context[name];
    if (!Array.isArray(arr) || !arr.length) return '';
    return arr.map(item => {
      let out = block;
      out = out.replace(/\{\{this\.([\w]+)\}\}/g, (_m2, k) => {
        const v = item && Object.prototype.hasOwnProperty.call(item, k) ? item[k] : '';
        return (v === undefined || v === null) ? '' : String(v);
      });
      return out;
    }).join('');
  });
}

function renderVars(template, context) {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_m, k) => {
    const v = context && Object.prototype.hasOwnProperty.call(context, k) ? context[k] : '';
    return (v === undefined || v === null) ? '' : String(v);
  });
}

function renderTemplate(template, context) {
  const withEach = renderEachBlocks(template, context);
  return renderVars(withEach, context);
}

function fmtMoneyHtml(amountString) {
  const s = String(amountString ?? '').trim();
  if (!s) return '$0.00';
  // amountString is already formatted like "123.45" or "123.45 (partial)"
  if (s.startsWith('$')) return escapeHtml(s);
  return '$' + escapeHtml(s);
}

function renderStyledReportHtml({ kind, subject, context, product_summary, text } = {}) {
  const THEME = {
    bg: '#ffffff',
    surface: '#ffffff',
    border: '#d3d0d7',
    ink: '#000000',
    muted: '#5a5a5a',
    brand: '#241773'
  };

  const startDate = String(context?.start_date || '');
  const endDate = String(context?.end_date || '');
  const dateLabel = (kind === 'daily' || startDate === endDate)
    ? startDate
    : `${startDate} to ${endDate}`;

  const safeSubject = escapeHtml(subject || 'Payout Report');

  const rows = [
    { label: 'Orders', value: escapeHtml(String(context?.order_count || '0')) },
    { label: 'MAP Total', value: fmtMoneyHtml(context?.map_total_sum) },
    { label: 'Wholesale Total', value: fmtMoneyHtml(context?.wholesale_total_sum) },
    { label: 'BB Shipping Amount', value: fmtMoneyHtml(context?.bb_shipping_sum) },
    { label: 'SparQ Digital Fee', value: fmtMoneyHtml(context?.sd_fee_sum) },
    { label: 'Stripe Fees', value: fmtMoneyHtml(context?.stripe_fee_sum) },
    { label: 'EZ Sports Net Payout', value: fmtMoneyHtml(context?.ezs_payout_sum) }
  ];

  const unknownWholesaleLines = Number(context?.unknown_wholesale_lines || 0) || 0;
  const note = unknownWholesaleLines
    ? `Note: ${unknownWholesaleLines} line item(s) had unknown wholesale and were excluded from wholesale totals.`
    : '';

  const products = Array.isArray(product_summary) ? product_summary : [];
  const productRows = products.map(p => {
    const name = escapeHtml(String(p?.product_name || ''));
    const sku = escapeHtml(String(p?.sku || ''));
    const units = escapeHtml(String(p?.total_units || ''));
    const feet = escapeHtml(String(p?.total_feet || ''));
    const map = fmtMoneyHtml(p?.total_map_value);
    const wholesale = fmtMoneyHtml(p?.total_wholesale_value);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};vertical-align:top;">${name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};vertical-align:top;color:${THEME.muted};">${sku}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};vertical-align:top;text-align:right;">${units}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};vertical-align:top;text-align:right;color:${THEME.muted};">${feet}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};vertical-align:top;text-align:right;">${map}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};vertical-align:top;text-align:right;">${wholesale}</td>
      </tr>`;
  }).join('');

  const productTable = products.length
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${THEME.border};border-radius:10px;overflow:hidden;">
        <thead>
          <tr>
            <th align="left" style="padding:10px 12px;border-bottom:1px solid ${THEME.border};background:${THEME.surface};font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.04em;">Product</th>
            <th align="left" style="padding:10px 12px;border-bottom:1px solid ${THEME.border};background:${THEME.surface};font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.04em;">SKU</th>
            <th align="right" style="padding:10px 12px;border-bottom:1px solid ${THEME.border};background:${THEME.surface};font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.04em;">Units</th>
            <th align="right" style="padding:10px 12px;border-bottom:1px solid ${THEME.border};background:${THEME.surface};font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.04em;">Feet</th>
            <th align="right" style="padding:10px 12px;border-bottom:1px solid ${THEME.border};background:${THEME.surface};font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.04em;">MAP Sales</th>
            <th align="right" style="padding:10px 12px;border-bottom:1px solid ${THEME.border};background:${THEME.surface};font-size:12px;color:${THEME.muted};text-transform:uppercase;letter-spacing:.04em;">Wholesale</th>
          </tr>
        </thead>
        <tbody>
          ${productRows}
        </tbody>
      </table>`
    : `<div style="padding:12px 14px;border:1px solid ${THEME.border};border-radius:10px;color:${THEME.muted};">No paid orders found in this period.</div>`;

  const plainTextBlock = text
    ? `
      <div style="margin-top:16px;padding:12px 14px;border:1px solid ${THEME.border};border-radius:10px;">
        <div style="font-weight:700;margin-bottom:8px;">Plain-text version</div>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace;font-size:12px;line-height:1.45;color:${THEME.ink};">${escapeHtml(text)}</pre>
      </div>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;background:${THEME.bg};color:${THEME.ink};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,\"Apple Color Emoji\",\"Segoe UI Emoji\";">
    <div style="padding:22px;">
      <div style="max-width:980px;margin:0 auto;border:1px solid ${THEME.border};border-radius:14px;overflow:hidden;background:${THEME.surface};">
        <div style="padding:18px 22px;border-bottom:1px solid ${THEME.border};">
          <div style="font-weight:800;color:${THEME.brand};font-size:14px;letter-spacing:.02em;">EZ Sports</div>
          <div style="font-weight:900;font-size:22px;margin-top:4px;">${escapeHtml(kind === 'daily' ? 'Daily Payout Report' : 'Weekly Payout Report')}</div>
          <div style="margin-top:6px;color:${THEME.muted};font-size:13px;">${escapeHtml(dateLabel)}</div>
        </div>

        <div style="padding:18px 22px;">
          <div style="font-weight:800;margin-bottom:10px;">Summary</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid ${THEME.border};border-radius:10px;overflow:hidden;">
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};color:${THEME.muted};width:52%;">${escapeHtml(r.label)}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid ${THEME.border};text-align:right;font-weight:800;">${r.value}</td>
                </tr>`).join('')}
            </tbody>
          </table>

          <div style="margin-top:14px;color:${THEME.muted};font-size:13px;line-height:1.5;">
            EZ Sports Net Payout = Cart Total − wholesale − BB Shipping Amount − SparQ Digital fee − Stripe fees
          </div>

          ${note ? `<div style="margin-top:10px;color:${THEME.muted};font-size:13px;">${escapeHtml(note)}</div>` : ''}

          <div style="margin-top:18px;font-weight:800;margin-bottom:10px;">Product Summary</div>
          ${productTable}

          ${plainTextBlock}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

async function loadFallbackCatalog() {
  try {
    const file = path.join(__dirname, '..', '..', 'assets', 'prodList.json');
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);
    const out = new Map();
    if (json && json.categories && typeof json.categories === 'object') {
      for (const arr of Object.values(json.categories)) {
        if (!Array.isArray(arr)) continue;
        for (const p of arr) {
          const id = String(p?.sku || p?.id || '').trim();
          if (!id) continue;
          out.set(id, {
            name: String(p?.name || p?.title || id),
            map: p?.map,
            wholesale: p?.wholesale,
            dsr: Number(p?.dsr || p?.details?.dsr || 0) || 0,
            variations: Array.isArray(p?.variations) ? p.variations : []
          });
        }
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

function parseCatalogPrice(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  // Handle "1.5/ft" and similar
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pickWholesaleUnit({ item, product, fallback }) {
  const strongOptRaw = String(item?.option || item?.variationOption || item?.variation || item?.variant || item?.style || item?.type || '').trim();
  const weakOptRaw = String(item?.size || '').trim();
  const strongOpt = strongOptRaw ? strongOptRaw.toLowerCase() : '';
  const weakOpt = weakOptRaw ? weakOptRaw.toLowerCase() : '';

  const variations = Array.isArray(product?.variations) ? product.variations : (Array.isArray(fallback?.variations) ? fallback.variations : []);

  const optOf = (v) => String(v?.option || v?.name || v?.value || '').trim();
  const vWholesaleOf = (v) => parseCatalogPrice(v?.wholesale ?? v?.cost ?? v?.wholesalePrice ?? v?.wholesale_price ?? null);

  const findByExactOpt = (needle) => {
    if (!needle) return null;
    return variations.find(v => optOf(v).toLowerCase() === needle) || null;
  };

  const findByContainsOpt = (needle) => {
    if (!needle) return null;
    return variations.find(v => needle.includes(optOf(v).toLowerCase())) || null;
  };

  let matched = null;
  matched = findByExactOpt(strongOpt) || findByContainsOpt(strongOpt);
  if (!matched) matched = findByExactOpt(weakOpt);
  if (!matched && variations.length === 1) matched = variations[0];
  if (!matched && variations.length) matched = variations.find(v => optOf(v).toLowerCase() === 'standard') || variations[0];

  if (matched) {
    const w = vWholesaleOf(matched);
    if (Number.isFinite(w) && w > 0) return w;
  }

  const topWholesale = parseCatalogPrice(product?.wholesale ?? fallback?.wholesale ?? null);
  if (Number.isFinite(topWholesale) && topWholesale > 0) return topWholesale;

  return null;
}

class PayoutReportService {
  constructor() {
    this.db = new DatabaseManager();
    this.alerts = new AlertingService();
    this._fallbackCatalogPromise = null;
    this._productIndexPromise = null;
  }

  async _getFallbackCatalog() {
    if (!this._fallbackCatalogPromise) this._fallbackCatalogPromise = loadFallbackCatalog();
    return await this._fallbackCatalogPromise;
  }

  async _getProductIndex() {
    if (!this._productIndexPromise) {
      this._productIndexPromise = (async () => {
        try {
          const products = await this.db.findAll('products');
          const map = new Map();
          (Array.isArray(products) ? products : []).forEach(p => {
            const id = String(p?.id || p?.sku || '').trim();
            if (!id) return;
            map.set(id, p);
          });
          return map;
        } catch {
          return new Map();
        }
      })();
    }
    return await this._productIndexPromise;
  }

  async _loadReportTemplate(kind = 'weekly') {
    const file = kind === 'daily'
      ? path.join(__dirname, '..', '..', 'assets', 'report-daily.yml')
      : path.join(__dirname, '..', '..', 'assets', 'report-weekly.yml');
    return await fs.readFile(file, 'utf8');
  }

  async buildPayoutReport({ start, end, kind = 'weekly' } = {}) {
    const startDt = (start instanceof Date) ? start : new Date(String(start || new Date().toISOString()));
    const endDt = (end instanceof Date) ? end : new Date(String(end || new Date().toISOString()));

    const orders = await this.db.findAll('orders');
    const paidOrders = (Array.isArray(orders) ? orders : []).filter(o => {
      const status = String(o.status || '').toLowerCase();
      if (!(status === 'paid' || status === 'fulfilled' || status === 'delivered')) return false;
      const paidAt = o.paymentInfo?.paidAt || o.paidAt || o.updatedAt || o.createdAt;
      return inRange(paidAt, startDt, endDt);
    });

    const fallbackCatalog = await this._getFallbackCatalog();
    const productIndex = await this._getProductIndex();

    let mapTotalSum = 0;
    let wholesaleTotalSum = 0;
    let bbShippingSum = 0;
    let stripeFeeSum = 0;
    let sdFeeSum = 0;
    let ezSportsPayoutSum = 0;

    let unknownWholesaleLines = 0;

    const productAgg = new Map();

    for (const o of paidOrders) {
      const customerPaid = moneyNumber(o.paymentInfo?.amount || 0) || centsToDollarsMaybe(o.total || 0);
      const tax = centsToDollarsMaybe(o.tax || 0);
      const cartBeforeTax = Math.max(0, customerPaid - tax);
      const stripeFees = moneyNumber(o.paymentInfo?.fees || 0);
      const sdFee = Number((cartBeforeTax * 0.015).toFixed(2));
      const shipping = centsToDollarsMaybe(o.shipping || 0);

      stripeFeeSum += stripeFees;
      sdFeeSum += sdFee;
      bbShippingSum += shipping;

      // Per-item aggregates
      let orderMap = 0;
      let orderWholesaleKnown = 0;

      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        const sku = String(it.productId || it.id || '').trim();
        const name = String(it.productName || it.name || sku || 'Item');
        const qty = Math.max(1, Number(it.quantity || it.qty || 1) || 1);

        const mapUnit = moneyNumber(it.price || 0);
        const lineMap = mapUnit * qty;
        orderMap += lineMap;

        const feet = parseByFootFeet(it.size);

        const product = productIndex.get(sku) || null;
        const fb = fallbackCatalog.get(sku) || null;
        const wholesaleUnitRaw = pickWholesaleUnit({ item: it, product, fallback: fb });
        let wholesaleLine = null;
        if (wholesaleUnitRaw !== null) {
          let wholesaleUnit = wholesaleUnitRaw;
          if (feet) wholesaleUnit = wholesaleUnit * feet;
          wholesaleLine = wholesaleUnit * qty;
          orderWholesaleKnown += wholesaleLine;
        } else {
          unknownWholesaleLines += 1;
        }

        const key = sku || name;
        const rec = productAgg.get(key) || {
          product_name: name,
          sku: sku,
          total_units: 0,
          total_feet: 0,
          total_map_value: 0,
          total_wholesale_value: 0,
          _hasUnknownWholesale: false
        };

        rec.total_units += qty;
        if (feet) rec.total_feet += (feet * qty);
        rec.total_map_value += lineMap;
        if (wholesaleLine !== null) rec.total_wholesale_value += wholesaleLine;
        else rec._hasUnknownWholesale = true;

        productAgg.set(key, rec);
      }

      mapTotalSum += orderMap;
      wholesaleTotalSum += orderWholesaleKnown;

      const ezSportsNet = Number((customerPaid - orderWholesaleKnown - shipping - sdFee - stripeFees).toFixed(2));
      ezSportsPayoutSum += ezSportsNet;
    }

    const product_summary = Array.from(productAgg.values())
      .sort((a, b) => (b.total_map_value - a.total_map_value) || String(a.product_name).localeCompare(String(b.product_name)))
      .map(p => ({
        product_name: safeText(p.product_name, 120),
        total_units: String(p.total_units || 0),
        total_feet: p.total_feet ? String(p.total_feet) : '',
        total_map_value: fmt2(p.total_map_value),
        total_wholesale_value: fmt2(p.total_wholesale_value) + (p._hasUnknownWholesale ? ' (partial)' : '')
      }));

    const template = await this._loadReportTemplate(kind);

    const context = {
      start_date: startDt.toISOString().slice(0, 10),
      end_date: endDt.toISOString().slice(0, 10),
      order_count: String(paidOrders.length),
      map_total_sum: fmt2(mapTotalSum),
      wholesale_total_sum: fmt2(wholesaleTotalSum) + (unknownWholesaleLines ? ' (partial)' : ''),
      bb_shipping_sum: fmt2(bbShippingSum),
      sd_fee_sum: fmt2(sdFeeSum),
      stripe_fee_sum: fmt2(stripeFeeSum),
      ezs_payout_sum: fmt2(ezSportsPayoutSum),
      unknown_wholesale_lines: String(unknownWholesaleLines),
      product_summary
    };

    const text = renderTemplate(template, context).trim() + (unknownWholesaleLines ? `\n\nNote: ${unknownWholesaleLines} line item(s) had unknown wholesale and were excluded from wholesale totals.` : '');

    const subject = (kind === 'daily')
      ? `Daily Payout Report — EZ Sports — ${context.start_date}`
      : `Weekly Payout Report — EZ Sports — ${context.start_date} to ${context.end_date}`;

    const html = renderStyledReportHtml({ kind, subject, context, product_summary, text });

    return {
      kind,
      start: startDt.toISOString(),
      end: endDt.toISOString(),
      subject,
      html,
      text,
      totals: {
        order_count: paidOrders.length,
        mapTotalSum,
        wholesaleTotalSum,
        bbShippingSum,
        sdFeeSum,
        stripeFeeSum,
        ezSportsPayoutSum,
        unknownWholesaleLines
      },
      product_summary
    };
  }

  async buildDailyPayoutReport({ day = 'yesterday' } = {}) {
    const now = new Date();
    let target = now;
    if (day === 'yesterday') target = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    else if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) target = new Date(day + 'T00:00:00Z');

    const start = startOfDayUTC(target);
    const end = endOfDayUTC(target);
    return await this.buildPayoutReport({ start, end, kind: 'daily' });
  }

  async buildWeeklyPayoutReport({ end = new Date() } = {}) {
    const endDt = (end instanceof Date) ? end : new Date(String(end));
    const endNorm = endOfDayUTC(endDt);
    const startNorm = new Date(endNorm.getTime() - (7 * 24 * 60 * 60 * 1000) + 1);
    return await this.buildPayoutReport({ start: startNorm, end: endNorm, kind: 'weekly' });
  }

  async sendDailyPayoutReport({ day = 'yesterday' } = {}) {
    const report = await this.buildDailyPayoutReport({ day });
    const sent = await this.alerts.sendReport({ subject: report.subject, html: report.html, text: report.text, tags: ['report', 'daily', 'payout'] });
    return { ...report, sent };
  }

  async sendWeeklyPayoutReport({ end = new Date() } = {}) {
    const report = await this.buildWeeklyPayoutReport({ end });
    const sent = await this.alerts.sendReport({ subject: report.subject, html: report.html, text: report.text, tags: ['report', 'weekly', 'payout'] });
    return { ...report, sent };
  }
}

module.exports = PayoutReportService;
