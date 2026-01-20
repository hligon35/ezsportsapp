const DatabaseManager = require('../database/DatabaseManager');
const OrderService = require('./OrderService');
const AlertingService = require('./AlertingService');

function startOfDayUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  return d;
}

function endOfDayUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return d;
}

function inRange(ts, start, end) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function safeText(v, max = 120) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

class DailyReportService {
  constructor() {
    this.db = new DatabaseManager();
    this.orders = new OrderService();
    this.alerts = new AlertingService();
  }

  async buildDailyActivityReport({ day = 'yesterday' } = {}) {
    const now = new Date();
    let target = now;
    if (day === 'yesterday') target = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    else if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) target = new Date(day + 'T00:00:00Z');

    const start = startOfDayUTC(target);
    const end = endOfDayUTC(target);
    const dayKey = start.toISOString().slice(0, 10);

    const analytics = await this.db.find('analytics');
    const events = Array.isArray(analytics) ? analytics.filter(e => inRange(e.timestamp, start, end)) : [];

    const pageviews = events.filter(e => e.type === 'pageview');
    const clicks = events.filter(e => String(e.type || '').toLowerCase().includes('click'));

    const byPath = new Map();
    for (const ev of pageviews) {
      const p = String(ev.path || ev.meta?.path || '/');
      byPath.set(p, (byPath.get(p) || 0) + 1);
    }

    const topPages = Array.from(byPath.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const uniqueVisitors = new Set(pageviews.map(e => e.visitorId || e.userId || '')).size;

    // Orders (authoritative purchases)
    const ordersRes = await this.orders.getAllOrders(null, { page: 1, pageSize: 100000, sortBy: 'createdAt', sortDir: 'desc' });
    const orders = Array.isArray(ordersRes) ? ordersRes : (ordersRes.items || []);
    const ordersInRange = orders.filter(o => inRange(o.createdAt || o.timestamp || o.updatedAt, start, end));

    const paidOrders = ordersInRange.filter(o => String(o.status || '').toLowerCase() === 'paid' || String(o.paymentStatus || '').toLowerCase() === 'paid');
    const grossRevenue = paidOrders.reduce((s, o) => s + (Number(o.total || 0) || 0), 0);

    // Common ecommerce events
    const countByType = (t) => events.filter(e => String(e.type || '').toLowerCase() === String(t).toLowerCase()).length;
    const addToCart = countByType('add_to_cart');
    const beginCheckout = countByType('begin_checkout');
    const purchaseEvents = countByType('purchase');

    const lines = [];
    lines.push(`<h2>Daily Visitor Activity — ${dayKey} (UTC)</h2>`);
    lines.push(`<ul>`);
    lines.push(`<li><strong>Pageviews:</strong> ${pageviews.length}</li>`);
    lines.push(`<li><strong>Unique visitors:</strong> ${uniqueVisitors}</li>`);
    lines.push(`<li><strong>Clicks tracked:</strong> ${clicks.length}</li>`);
    lines.push(`<li><strong>Add to cart events:</strong> ${addToCart}</li>`);
    lines.push(`<li><strong>Begin checkout events:</strong> ${beginCheckout}</li>`);
    lines.push(`<li><strong>Purchase events (client):</strong> ${purchaseEvents}</li>`);
    lines.push(`<li><strong>Paid orders:</strong> ${paidOrders.length}</li>`);
    lines.push(`<li><strong>Gross revenue (paid orders):</strong> $${grossRevenue.toFixed(2)}</li>`);
    lines.push(`</ul>`);

    lines.push(`<h3>Top pages</h3>`);
    if (!topPages.length) {
      lines.push(`<p>(no pageviews recorded)</p>`);
    } else {
      lines.push(`<ol>`);
      topPages.forEach(p => lines.push(`<li>${safeText(p.path, 120)} — ${p.count}</li>`));
      lines.push(`</ol>`);
    }

    const subject = `EZSports Daily Report — ${dayKey} (UTC)`;
    const html = lines.join('\n');
    const text = `Daily Visitor Activity — ${dayKey} (UTC)\n\nPageviews: ${pageviews.length}\nUnique visitors: ${uniqueVisitors}\nClicks tracked: ${clicks.length}\nAdd to cart: ${addToCart}\nBegin checkout: ${beginCheckout}\nPurchase events (client): ${purchaseEvents}\nPaid orders: ${paidOrders.length}\nGross revenue: $${grossRevenue.toFixed(2)}\n\nTop pages:\n` + topPages.map(p => `- ${p.path}: ${p.count}`).join('\n');

    return { dayKey, start: start.toISOString(), end: end.toISOString(), subject, html, text };
  }

  async sendDailyActivityReport({ day = 'yesterday' } = {}) {
    const report = await this.buildDailyActivityReport({ day });
    const out = await this.alerts.sendDailyReport({ subject: report.subject, html: report.html, text: report.text });
    return { ...report, sent: out };
  }
}

module.exports = DailyReportService;
