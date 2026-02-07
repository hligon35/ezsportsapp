const DatabaseManager = require('../database/DatabaseManager');
const AlertingService = require('./AlertingService');

function startOfDayUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDayUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function inRange(ts, start, end) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function money(v) {
  const n = Number(v || 0);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function safeText(v, max = 120) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

class FinanceReportService {
  constructor() {
    this.db = new DatabaseManager();
    this.alerts = new AlertingService();
  }

  async buildDailyFinanceReport({ day = 'yesterday' } = {}) {
    const now = new Date();
    let target = now;
    if (day === 'yesterday') target = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    else if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) target = new Date(day + 'T00:00:00Z');

    const start = startOfDayUTC(target);
    const end = endOfDayUTC(target);
    const dayKey = start.toISOString().slice(0, 10);

    const orders = await this.db.findAll('orders');
    const paid = (Array.isArray(orders) ? orders : []).filter(o => {
      const status = String(o.status || '').toLowerCase();
      const paidAt = o.paymentInfo?.paidAt || o.paidAt || o.updatedAt || o.createdAt;
      return (status === 'paid' || status === 'fulfilled' || status === 'delivered') && inRange(paidAt, start, end);
    });

    const sums = {
      gross: 0,
      stripeFees: 0,
      netAfterStripeFees: 0,
      platformFees: 0,
      connectOrders: 0
    };

    for (const o of paid) {
      const p = o.paymentInfo || {};
      const gross = Number(p.amount || 0) || 0;
      const fees = Number(p.fees || 0) || 0;
      const net = Number(p.net || 0) || (gross - fees);
      const platformFee = Number(p.applicationFee || 0) || 0;
      sums.gross += gross;
      sums.stripeFees += fees;
      sums.netAfterStripeFees += net;
      sums.platformFees += platformFee;
      if (p.connectDestination) sums.connectOrders += 1;
    }

    const top = paid
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.paymentInfo?.paidAt || a.updatedAt || a.createdAt || 0) || 0;
        const tb = Date.parse(b.paymentInfo?.paidAt || b.updatedAt || b.createdAt || 0) || 0;
        return tb - ta;
      })
      .slice(0, 20);

    const lines = [];
    lines.push(`<h2>Finance Report — ${dayKey} (UTC)</h2>`);
    lines.push(`<ul>`);
    lines.push(`<li><strong>Paid orders:</strong> ${paid.length}</li>`);
    lines.push(`<li><strong>Gross (from Stripe PI amount):</strong> ${money(sums.gross)}</li>`);
    lines.push(`<li><strong>Stripe fees (when known):</strong> ${money(sums.stripeFees)}</li>`);
    lines.push(`<li><strong>Net after Stripe fees (when known):</strong> ${money(sums.netAfterStripeFees)}</li>`);
    lines.push(`<li><strong>Platform fees (Connect, when enabled):</strong> ${money(sums.platformFees)}</li>`);
    lines.push(`<li><strong>Connect orders (destination set):</strong> ${sums.connectOrders}</li>`);
    lines.push(`</ul>`);

    lines.push(`<h3>Recent paid orders</h3>`);
    if (!top.length) {
      lines.push(`<p>(no paid orders)</p>`);
    } else {
      lines.push(`<ol>`);
      for (const o of top) {
        const p = o.paymentInfo || {};
        const gross = Number(p.amount || 0) || 0;
        const platformFee = Number(p.applicationFee || 0) || 0;
        const dest = p.connectDestination ? safeText(p.connectDestination, 24) : '';
        const when = safeText(p.paidAt || o.updatedAt || o.createdAt || '', 32);
        lines.push(`<li>#${safeText(o.id, 24)} — ${money(gross)}${platformFee ? ` (fee ${money(platformFee)})` : ''}${dest ? ` — ${dest}` : ''} — ${when}</li>`);
      }
      lines.push(`</ol>`);
    }

    const subject = `EZSports Finance Report — ${dayKey} (UTC)`;
    const html = lines.join('\n');
    const text = [
      `Finance Report — ${dayKey} (UTC)`,
      `Paid orders: ${paid.length}`,
      `Gross: ${money(sums.gross)}`,
      `Stripe fees (known): ${money(sums.stripeFees)}`,
      `Net after Stripe fees (known): ${money(sums.netAfterStripeFees)}`,
      `Platform fees (known): ${money(sums.platformFees)}`,
      `Connect orders: ${sums.connectOrders}`
    ].join('\n');

    return { dayKey, start: start.toISOString(), end: end.toISOString(), subject, html, text };
  }

  async sendDailyFinanceReport({ day = 'yesterday' } = {}) {
    const report = await this.buildDailyFinanceReport({ day });
    const out = await this.alerts.sendDailyReport({ subject: report.subject, html: report.html, text: report.text });
    return { ...report, sent: out };
  }
}

module.exports = FinanceReportService;
